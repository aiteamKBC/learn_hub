"""Live option 1: book seats + name employees, pay the deposit, get placed in the next
intake (or wait for one), employees attend once they join the company."""

import re
from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from apps.corporate.live_booking import fulfil_deposit
from apps.corporate.models import (
    CohortCompany,
    LiveAttendee,
    LiveBooking,
    LiveBookingPerson,
    LiveCohort,
    LiveCourseTerms,
    SeatPurchase,
)
from apps.corporate.tests import test_company_http as base
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

STRIPE = "apps.corporate.live_booking.gateway.create_checkout_session"


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class LiveBookingTest(SchemaTransactionTestCase):
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def setUp(self):
        base.CompanyHttpTest.setUp(self)
        with tenant_context(staff=True):
            LiveCourseTerms.objects.create(
                course=self.course, programme_months=6, deposit_months=2, deposit_minor=20000,
                instalments=[{"months": 2, "amount_minor": 20000}, {"months": 2, "amount_minor": 20000}],
            )  # fmt: skip

    def _intake(self, days=30, **kw):
        with tenant_context(staff=True):
            return LiveCohort.objects.create(
                course=self.course, delivery_mode="online", max_learners=30,
                scheduled_start=timezone.localdate() + timedelta(days=days), **kw,
            )  # fmt: skip

    def _book(self, emails, stripe):
        stripe.return_value = {"id": "cs_live", "url": "https://checkout.stripe.com/l"}
        body = {
            "course_id": str(self.course.id),
            "quantity": len(emails),
            "employees": [{"email": e} for e in emails],
        }
        return self._post("/live/book", body)

    def _pay(self, booking_id):
        with tenant_context(staff=True):
            fulfil_deposit(
                {"id": "cs_live", "payment_status": "paid", "payment_intent": "pi"}, {"id": booking_id}
            )

    @patch(STRIPE)
    def test_deposit_places_in_next_intake_and_invites(self, stripe):
        later = self._intake(days=120)
        soon = self._intake(days=30)
        self._intake(days=-5)  # already started: never used
        r = self._book(["new1@example.com", self.emp.email], stripe)
        self.assertEqual(r.status_code, 200, r.content)
        # deposit only: 2 seats x £200
        self.assertEqual(stripe.call_args.kwargs["line_items"][0]["price_data"]["unit_amount"], 20000)
        self.assertEqual(stripe.call_args.kwargs["line_items"][0]["quantity"], 2)
        bid = r.json()["purchase_id"]
        mail.outbox.clear()
        self._pay(bid)
        self._pay(bid)  # webhook replay
        with tenant_context(staff=True):
            b = LiveBooking.objects.get(pk=bid)
            self.assertEqual((b.status, b.cohort_id), ("placed", soon.id))
            self.assertNotEqual(b.cohort_id, later.id)
            self.assertEqual(CohortCompany.objects.get(cohort=soon, org=self.org).approved_seats, 2)
            self.assertEqual(SeatPurchase.objects.get(pk=b.deposit_purchase_id).status, "paid")
            # the existing employee attends at once; the new one after joining
            self.assertTrue(LiveAttendee.objects.filter(cohort=soon, user=self.emp).exists())
        self.assertEqual([m.to for m in mail.outbox], [["new1@example.com"]])
        token = re.search(r"/invite/(\S+)", mail.outbox[0].body).group(1)
        with tenant_context(staff=True):
            person = User.objects.create_user("new1@example.com", "pw-12345678")
        self.client.force_login(person)
        self.assertEqual(self.client.post(f"/api/v1/org/invitations/{token}/accept").status_code, 200)
        with tenant_context(staff=True):
            self.assertTrue(LiveAttendee.objects.filter(cohort=soon, user=person).exists())

    @patch(STRIPE)
    def test_waits_for_an_intake_then_is_placed(self, stripe):
        r = self._book([self.emp.email], stripe)
        bid = r.json()["purchase_id"]
        self._pay(bid)
        with tenant_context(staff=True):
            self.assertEqual(LiveBooking.objects.get(pk=bid).status, "waiting_intake")
        # the admin opens an intake and gives it a start date
        cohort = self._intake(days=60)
        self.client.force_login(self.staff)
        r = self.client.patch(
            f"/api/v1/console/corporate/cohorts/{cohort.id}",
            {"scheduled_start": str(cohort.scheduled_start)},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(staff=True):
            b = LiveBooking.objects.get(pk=bid)
            self.assertEqual((b.status, b.cohort_id), ("placed", cohort.id))
            self.assertEqual(LiveBookingPerson.objects.get(booking=b).status, "joined")

    @patch(STRIPE)
    def test_rules(self, stripe):
        short = self._post(
            "/live/book",
            {"course_id": str(self.course.id), "quantity": 2, "employees": [{"email": "a@example.com"}]},
        )
        self.assertEqual(short.json()["error"]["code"], "employees_required")
        learner = self._post(
            "/live/book",
            {"course_id": str(self.course.id), "quantity": 1, "employees": [{"email": "a@example.com"}]},
            user=self.emp,
        )
        self.assertEqual(learner.status_code, 403)
        with tenant_context(staff=True):
            LiveCourseTerms.objects.filter(course=self.course).delete()
        none = self._post(
            "/live/book",
            {"course_id": str(self.course.id), "quantity": 1, "employees": [{"email": "a@example.com"}]},
        )
        self.assertEqual(none.json()["error"]["code"], "not_bookable")
        stripe.assert_not_called()

    @patch(STRIPE)
    def test_offer_shows_plan_and_next_intake(self, stripe):
        cohort = self._intake(days=45)
        r = self._get(f"/live/offer/{self.course.id}")
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        self.assertEqual((j["deposit_minor"], j["seat_price_minor"], j["deposit_months"]), (20000, 60000, 2))
        self.assertEqual(str(j["next_intake_starts_on"])[:10], str(cohort.scheduled_start))
