"""B2B recorded flow: the employer lists employees (typed or CSV) for paid seats; with the
platform setting off invites go out at once, with it on a platform admin approves first.
New people create an account, accept, and the course is open. Over HTTP as the app role."""

import re
from unittest.mock import patch

from django.core import mail
from django.test import override_settings

from apps.corporate.models import PendingSeat, SeatRequest
from apps.corporate.tests import test_company_http as base
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.org.models import MemberJobRole, OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

APPROVAL = "apps.corporate.pending.approval_required"


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class SeatRequestTest(SchemaTransactionTestCase):
    setUp = base.CompanyHttpTest.setUp
    _paid_recorded = base.CompanyHttpTest._paid_recorded
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def _send(self, employees, user=None, source="manual"):
        body = {"offering_id": str(self.recorded.id), "source": source, "employees": employees}
        return self._post("/seat-requests", body, user)

    def _accept(self, email, name=""):
        token = re.search(r"/invite/(\S+)", mail.outbox[-1].body).group(1)
        with tenant_context(staff=True):
            person = User.objects.create_user(email, "pw-12345678")
        self.client.force_login(person)
        r = self.client.post(f"/api/v1/org/invitations/{token}/accept")
        self.assertEqual(r.status_code, 200, r.content)
        return person

    def _console(self, path, body=None):
        self.client.force_login(self.staff)
        return self.client.post(f"/api/v1/console{path}", body or {}, content_type="application/json")

    # ------------------------------------------------------------ approval OFF

    @patch(APPROVAL, return_value=False)
    def test_off_invites_at_once_and_course_opens_on_join(self, _):
        self._paid_recorded(qty=2)
        mail.outbox.clear()
        r = self._send(
            [
                {
                    "email": "new.starter@example.com",
                    "full_name": "New Starter",
                    "job_title": "Care Assistant",
                },
                {"email": self.emp.email.upper()},
            ]
        )
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual((d["status"], d["auto_approved"]), ("approved", True))
        states = {row["email"]: row["status"] for row in d["rows"]}
        self.assertEqual(states, {"new.starter@example.com": "pending", self.emp.email.lower(): "fulfilled"})
        # existing member: course open now; new person: one email naming the course
        with tenant_context(org_id=self.org.id, user_id=self.emp.id):
            self.assertTrue(Enrollment.objects.filter(user=self.emp, course=self.course).exists())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(self.course.title, mail.outbox[0].body)
        # all seats used (one given, one held)
        self.assertEqual(
            self._send([{"email": "x@example.com"}]).json()["error"]["code"], "no_seats_available"
        )

        person = self._accept("new.starter@example.com")
        with tenant_context(org_id=self.org.id, user_id=person.id):
            self.assertTrue(
                Enrollment.objects.filter(user=person, course=self.course, org_id=self.org.id).exists()
            )
            member = OrgMember.objects.get(org=self.org, user=person)
            self.assertEqual(MemberJobRole.objects.get(member=member).job_role.name, "Care Assistant")
        person.refresh_from_db()
        self.assertEqual(person.full_name, "New Starter")

    @patch(APPROVAL, return_value=False)
    def test_duplicates_refused(self, _):
        self._paid_recorded(qty=5)
        twice = self._send([{"email": "a@example.com"}, {"email": "A@example.com"}])
        self.assertEqual(twice.json()["error"]["code"], "bad_rows")
        self.assertEqual(self._send([{"email": "a@example.com"}]).status_code, 200)
        again = self._send([{"email": "a@example.com"}], source="csv")
        self.assertEqual(again.json()["error"]["code"], "already_has_seat")
        self.assertEqual(len(mail.outbox), 1, "never a second invite")

    # ------------------------------------------------------------ approval ON

    @patch(APPROVAL, return_value=True)
    def test_on_waits_for_admin_then_approve_sends_invites(self, _):
        self._paid_recorded(qty=1)
        mail.outbox.clear()
        d = self._send([{"email": "wait@example.com"}], source="csv").json()
        self.assertEqual((d["status"], d["rows"][0]["status"]), ("pending_approval", "awaiting"))
        self.assertEqual(len(mail.outbox), 0, "nothing sent before approval")
        # the held seat is not free while waiting
        self.assertEqual(
            self._send([{"email": "b@example.com"}]).json()["error"]["code"], "no_seats_available"
        )
        # only platform staff may approve
        self.client.force_login(self.admin)
        self.assertEqual(
            self.client.post(
                f"/api/v1/console/seat-requests/{d['id']}/approve", {}, content_type="application/json"
            ).status_code,
            403,
        )

        listed = self.client.get("/api/v1/console/seat-requests")
        self.client.force_login(self.staff)
        listed = self.client.get("/api/v1/console/seat-requests").json()
        self.assertIn(d["id"], [x["id"] for x in listed])
        ok = self._console(f"/seat-requests/{d['id']}/approve")
        self.assertEqual(ok.json()["status"], "approved", ok.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(
            self._console(f"/seat-requests/{d['id']}/approve").json()["error"]["code"], "already_reviewed"
        )
        person = self._accept("wait@example.com")
        with tenant_context(org_id=self.org.id, user_id=person.id):
            self.assertTrue(Enrollment.objects.filter(user=person, course=self.course).exists())

    @patch(APPROVAL, return_value=True)
    def test_on_reject_frees_seats_and_sends_nothing(self, _):
        self._paid_recorded(qty=1)
        mail.outbox.clear()
        d = self._send([{"email": "no@example.com"}]).json()
        r = self._console(f"/seat-requests/{d['id']}/reject", {"note": "Wrong course"})
        self.assertEqual(r.json()["status"], "rejected")
        self.assertEqual(len(mail.outbox), 0)
        with tenant_context(staff=True):
            self.assertEqual(PendingSeat.objects.get(request_id=d["id"]).status, "cancelled")
        self.assertEqual(self._send([{"email": "yes@example.com"}]).status_code, 200, "seat is free again")

    def test_setting_change_keeps_waiting_requests_waiting(self):
        self._paid_recorded(qty=2)
        with patch(APPROVAL, return_value=True):
            d = self._send([{"email": "keep@example.com"}]).json()
        with patch(APPROVAL, return_value=False):
            self._send([{"email": "other@example.com"}])
        with tenant_context(staff=True):
            self.assertEqual(SeatRequest.objects.get(pk=d["id"]).status, "pending_approval")

    # ------------------------------------------------------------ permissions and live

    def test_learner_cannot_send_and_live_refused(self):
        self._paid_recorded(qty=1)
        self.assertEqual(self._send([{"email": "x@example.com"}], self.emp).status_code, 403)
        live = self._post(
            "/seat-requests", {"offering_id": str(self.live.id), "employees": [{"email": "a@example.com"}]}
        )
        self.assertEqual(live.json()["error"]["code"], "live_offering")

    def test_unpaid_seats_never_used(self):
        r = self._send([{"email": "x@example.com"}])
        self.assertEqual(r.json()["error"]["code"], "no_seats_available")
        self.assertEqual(len(mail.outbox), 0)

    # ------------------------------------------------------------ employees named while buying

    def _unpaid_with_plan(self, employees, qty=2):
        from django.utils import timezone

        from apps.corporate.models import SeatPurchase

        with tenant_context(staff=True):
            return SeatPurchase.objects.create(
                org=self.org, offering=self.recorded, buyer=self.admin, quantity=qty,
                unit_price_minor=10000, currency="GBP", total_minor=10000 * qty,
                gbp_total_minor=10000 * qty, status="pending", created_at=timezone.now(),
                planned_employees=employees,
            )  # fmt: skip

    @patch(APPROVAL, return_value=False)
    def test_planned_employees_invited_only_after_payment_and_once(self, _):
        from apps.corporate.fulfillment import fulfil_recorded_purchase

        sp = self._unpaid_with_plan(
            [{"email": "buy.time@example.com", "full_name": "Buy Time", "job_title": "", "_source": "csv"}]
        )
        mail.outbox.clear()
        self.assertEqual(len(mail.outbox), 0, "nothing before payment")
        with tenant_context(staff=True):
            fulfil_recorded_purchase({"payment_intent": "pi_test"}, {"id": str(sp.id)})
            fulfil_recorded_purchase({"payment_intent": "pi_test"}, {"id": str(sp.id)})  # webhook replay
        self.assertEqual(len(mail.outbox), 1)
        with tenant_context(staff=True):
            req = SeatRequest.objects.get(org=self.org)
            self.assertEqual(
                (req.status, req.source, req.submitted_by_id), ("approved", "csv", self.admin.id)
            )

    @patch(APPROVAL, return_value=True)
    def test_planned_employees_wait_for_approval_when_on(self, _):
        from apps.corporate.fulfillment import fulfil_recorded_purchase

        sp = self._unpaid_with_plan([{"email": "later@example.com"}])
        mail.outbox.clear()
        with tenant_context(staff=True):
            fulfil_recorded_purchase({"payment_intent": "pi_x"}, {"id": str(sp.id)})
            self.assertEqual(SeatRequest.objects.get(org=self.org).status, "pending_approval")
        self.assertEqual(len(mail.outbox), 0)

    def test_checkout_refuses_more_people_than_seats(self):
        body = {"quantity": 1, "employees": [{"email": "a@example.com"}, {"email": "b@example.com"}]}
        r = self._post(f"/packages/{self.recorded.id}/checkout", body)
        self.assertEqual(r.json()["error"]["code"], "too_many_employees", r.content)
        short = self._post(
            f"/packages/{self.recorded.id}/checkout",
            {"quantity": 2, "employees": [{"email": "a@example.com"}]},
        )
        self.assertEqual(short.json()["error"]["code"], "employees_required", short.content)
        none = self._post(f"/packages/{self.recorded.id}/checkout", {"quantity": 1})
        self.assertEqual(none.json()["error"]["code"], "employees_required", none.content)
