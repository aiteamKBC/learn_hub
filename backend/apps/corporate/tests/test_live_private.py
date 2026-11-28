"""Private live intake: request with no money, admin approves with a date (private
intake), company names employees and pays the deposit share of the private price."""

from datetime import timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone

from apps.corporate.live_booking import fulfil_deposit, next_intake
from apps.corporate.models import (
    LiveBooking,
    LiveCohort,
    LiveCourseTerms,
    PrivateIntakeRequest,
    SeatInstalment,
)
from apps.corporate.tests import test_company_http as base
from apps.engagement.models import Notification
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

STRIPE = "apps.corporate.live_booking.gateway.create_checkout_session"


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class PrivateIntakeTest(SchemaTransactionTestCase):
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def setUp(self):
        base.CompanyHttpTest.setUp(self)
        from django.contrib.auth import get_user_model

        with tenant_context(staff=True):
            self.staff_user = get_user_model().objects.create_user(
                f"pi-staff-{self.org.id.hex[:8]}@test.com", "test123", is_staff=True
            )
            # seat: 200 deposit + 2 x 200 = 600; private price 6000 -> 2000 + 2000 + 2000
            LiveCourseTerms.objects.create(
                course=self.course, programme_months=6, deposit_months=2, deposit_minor=20000,
                instalments=[{"months": 2, "amount_minor": 20000}, {"months": 2, "amount_minor": 20000}],
                private_price_minor=600000,
            )  # fmt: skip

    def _console(self, path, body):
        self.client.force_login(self.staff_user)
        r = self.client.post(f"/api/v1/console{path}", body, content_type="application/json")
        self.client.force_login(self.admin)
        return r

    def _ask(self):
        r = self._post(
            "/live/private-intakes",
            {"course_id": str(self.course.id), "expected_people": 12, "message": "Hi"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        return self._get("/live/private-intakes").json()[0]

    def test_request_needs_no_money_and_is_once(self):
        row = self._ask()
        self.assertEqual(
            (row["status"], row["price_minor"], row["deposit_minor"]), ("submitted", 600000, 200000)
        )
        self.assertEqual([p["amount_minor"] for p in row["instalments"]], [200000, 200000])
        again = self._post("/live/private-intakes", {"course_id": str(self.course.id)})
        self.assertEqual(again.json()["error"]["code"], "already_asked")
        self.assertEqual(
            self._post(
                "/live/private-intakes", {"course_id": str(self.course.id)}, user=self.emp
            ).status_code,
            403,
        )
        # cannot pay before approval
        r = self._post(f"/live/private-intakes/{row['id']}/book", {"employees": [{"email": "a@example.com"}]})
        self.assertEqual(r.json()["error"]["code"], "not_approved")

    def test_reject_tells_the_company(self):
        row = self._ask()
        r = self._console(f"/corporate/private-intakes/{row['id']}/reject", {"reply": "No trainer then."})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._get("/live/private-intakes").json()[0]["status"], "rejected")
        with tenant_context(staff=True):
            self.assertTrue(
                Notification.objects.filter(
                    user=self.admin, kind="corporate_private_intake_rejected"
                ).exists()
            )

    @patch(STRIPE)
    def test_approve_book_and_pay(self, stripe):
        row = self._ask()
        start = timezone.localdate() + timedelta(days=20)
        r = self._console(f"/corporate/private-intakes/{row['id']}/approve", {"starts_on": str(start)})
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(staff=True):
            cohort = LiveCohort.objects.get(private_org_id=self.org.id)
            self.assertIsNone(next_intake(self.course.id))  # never offered to other companies
            self.assertTrue(
                Notification.objects.filter(
                    user=self.admin, kind="corporate_private_intake_approved"
                ).exists()
            )
        row = self._get("/live/private-intakes").json()[0]
        self.assertEqual((row["status"], row["starts_on"]), ("approved", str(start)))

        stripe.return_value = {"id": "cs", "url": "https://checkout.stripe.com/p"}
        people = [{"email": self.emp.email}, {"email": "b@example.com"}, {"email": "c@example.com"}]
        r = self._post(f"/live/private-intakes/{row['id']}/book", {"employees": people})
        self.assertEqual(r.status_code, 200, r.content)
        line = stripe.call_args.kwargs["line_items"][0]
        self.assertEqual((line["price_data"]["unit_amount"], line["quantity"]), (200000, 1))
        again = self._post(f"/live/private-intakes/{row['id']}/book", {"employees": people})
        self.assertEqual(again.json()["error"]["code"], "already_booking")

        with tenant_context(staff=True):
            fulfil_deposit({"payment_status": "paid"}, {"id": r.json()["purchase_id"]})
            b = LiveBooking.objects.get(pk=r.json()["purchase_id"])
            self.assertEqual((b.status, b.cohort_id), ("placed", cohort.id))
            amounts = list(
                SeatInstalment.objects.filter(seat_purchase_id=b.deposit_purchase_id)
                .order_by("sequence")
                .values_list("amount_minor", flat=True)
            )
            self.assertEqual(amounts, [200000, 200000])  # totals, not x3 people
            self.assertEqual(PrivateIntakeRequest.objects.get(pk=row["id"]).status, "booked")
