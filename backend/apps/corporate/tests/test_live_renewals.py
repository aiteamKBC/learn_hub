"""Live renewals: instalments scheduled from the intake start, a reminder a week before
the paid months end, payment extends access, employees lose join links after them."""

from datetime import timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone

from apps.corporate.attendees import my_live_training
from apps.corporate.live_booking import fulfil_deposit
from apps.corporate.live_renewals import instalment_paid, paid_until, send_due_reminders
from apps.corporate.models import LiveBooking, LiveCohort, LiveCourseTerms, SeatInstalment, Session
from apps.corporate.tests import test_company_http as base
from apps.engagement.models import Notification
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

STRIPE = "apps.corporate.live_booking.gateway.create_checkout_session"


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class LiveRenewalTest(SchemaTransactionTestCase):
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def setUp(self):
        base.CompanyHttpTest.setUp(self)
        with tenant_context(staff=True):
            LiveCourseTerms.objects.create(
                course=self.course, programme_months=6, deposit_months=2, deposit_minor=20000,
                instalments=[{"months": 2, "amount_minor": 20000}, {"months": 2, "amount_minor": 20000}],
            )  # fmt: skip
            self.cohort = LiveCohort.objects.create(
                course=self.course, delivery_mode="online", max_learners=30,
                scheduled_start=timezone.localdate() + timedelta(days=3),
            )  # fmt: skip

    @patch(STRIPE)
    def _placed(self, stripe):
        stripe.return_value = {"id": "cs", "url": "u"}
        body = {
            "course_id": str(self.course.id),
            "quantity": 2,
            "employees": [{"email": self.emp.email}, {"email": "x@example.com"}],
        }
        bid = self._post("/live/book", body).json()["purchase_id"]
        with tenant_context(staff=True):
            fulfil_deposit({"payment_status": "paid"}, {"id": bid})
            return LiveBooking.objects.select_related("cohort").get(pk=bid)

    def test_schedule_reminder_payment_and_lock(self):
        b = self._placed()
        with tenant_context(staff=True):
            insts = list(
                SeatInstalment.objects.filter(seat_purchase_id=b.deposit_purchase_id).order_by("sequence")
            )
            self.assertEqual([(i.amount_minor, i.covers_months) for i in insts], [(40000, 2), (40000, 2)])
            until = paid_until(b)
        # a week before the deposit months end: one reminder, never twice
        with tenant_context(staff=True):
            self.assertEqual(send_due_reminders(now=until - timedelta(days=30)), 0)
            self.assertEqual(send_due_reminders(now=until - timedelta(days=6)), 1)
            self.assertEqual(send_due_reminders(now=until - timedelta(days=5)), 0)
            self.assertTrue(
                Notification.objects.filter(user=self.admin, kind="corporate_live_renewal_due").exists()
            )
            # a session after the paid months: no join link for the employee
            Session.objects.create(cohort=self.cohort, sequence=1, scheduled_at=until + timedelta(days=1),
                                   duration_min=60, delivery_mode="online", zoom_join_url="https://zoom.example/j")  # fmt: skip
            mine = my_live_training(self.emp.id, now=until + timedelta(days=1, minutes=5))
            self.assertTrue(mine[0]["sessions"][0]["locked"])
            self.assertIsNone(mine[0]["sessions"][0]["join_url"])
            # paying the next instalment moves the paid date on by its months
            instalment_paid({}, {"id": str(insts[0].id)})
            self.assertGreater(paid_until(b), until)
            mine = my_live_training(self.emp.id, now=until + timedelta(days=1, minutes=5))
            self.assertFalse(mine[0]["sessions"][0]["locked"])
            self.assertEqual(mine[0]["sessions"][0]["join_url"], "https://zoom.example/j")

    @patch("apps.corporate.live_renewals.gateway.create_checkout_session")
    def test_company_sees_what_is_due_and_pays(self, stripe):
        b = self._placed()
        row = next(r for r in self._get("/live/bookings").json() if r["id"] == str(b.id))
        self.assertEqual(
            (row["next_due_minor"], row["next_due_months"], row["instalments_left"]), (40000, 2, 2)
        )
        self.assertIsNotNone(row["paid_until"])
        stripe.return_value = {"id": "cs2", "url": "https://checkout.stripe.com/n"}
        r = self._post(f"/live/bookings/{b.id}/pay-next", {})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(stripe.call_args.kwargs["metadata"]["kind"], "corporate_live_instalment")
        self.assertEqual(stripe.call_args.kwargs["line_items"][0]["quantity"], 2)
        self.assertEqual(self._post(f"/live/bookings/{b.id}/pay-next", {}, user=self.emp).status_code, 403)
