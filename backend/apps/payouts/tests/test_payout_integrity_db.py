"""Postgres/RLS regressions. Run ONLY on an authorized exclusive isolated target.

These were added but not executed during the payout completion pass.
"""

from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.identity.models import InstructorProfile
from apps.payouts import selectors, services
from apps.payouts.models import Earning, Payout, PayoutAccount
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase


class PayoutIntegrityDatabaseTests(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, _, _ = f.users()
        f.money(self.staff)
        InstructorProfile.objects.create(user=self.teacher, status="approved")
        self.course = f.course(staff=self.staff, owner=self.teacher, slug="payout-integrity", title="Payout integrity")
        for target in ("apps.engagement.notify.notify", "apps.engagement.notify.notify_staff"):
            patch = mock.patch(target)
            patch.start()
            self.addCleanup(patch.stop)
        with tenant_context(staff=True):
            PayoutAccount.objects.create(user=self.teacher, method="bank", bank_account_name="Teacher",
                                         bank_account_last4="4242", verified_at=timezone.now())
            at = timezone.now() - timedelta(days=40)
            self.earning = Earning.objects.create(user=self.teacher, course=self.course, kind="adjustment",
                channel="marketplace", gross_gbp_minor=0, share_bps=0, amount_gbp_minor=5000,
                earned_at=at, available_at=at)

    def request(self, amount=2500):
        return services.create_request(user=self.teacher, amount_gbp_minor=amount, method="bank")

    def test_invalid_and_duplicate_requests_never_reserve_twice(self):
        for amount in (0, -1, 2499, 5001):
            with self.subTest(amount=amount), self.assertRaises(ServiceError):
                self.request(amount)
        self.request()
        with self.assertRaises(ServiceError):
            self.request()
        with tenant_context(staff=True):
            balance = selectors.balance(user_id=self.teacher.id)
        self.assertEqual((balance["available"], balance["reserved"]), (2500, 2500))

    def test_partial_bundle_rejection_restores_exact_original_balance(self):
        request = services.approve_request(req=self.request(), by=self.staff)
        with tenant_context(staff=True):
            balance = selectors.balance(user_id=self.teacher.id)
        self.assertEqual((balance["available"], balance["reserved"], balance["in_payout"]), (2500, 0, 2500))
        services.reject_request(req=request, by=self.staff, reason="Not submitted")
        with tenant_context(staff=True):
            balance = selectors.balance(user_id=self.teacher.id)
        self.assertEqual((balance["available"], balance["total"]), (5000, 5000))

    def test_scheduled_run_skips_request_reservations(self):
        self.request()
        self.assertEqual(services.create_payouts(period_end=timezone.now().date()), [])

    def test_paid_payout_cannot_be_failed_or_detached(self):
        with tenant_context(staff=True):
            payout = Payout.objects.create(user=self.teacher, period_end=timezone.now().date(),
                amount_gbp_minor=5000, status="paid", method="stripe", provider_ref="tr_test", paid_at=timezone.now())
            self.earning.payout = payout
            self.earning.save(update_fields=["payout"])
            with self.assertRaises(ServiceError):
                services.fail_payout(payout=payout, reason="Unsafe release")
            self.earning.refresh_from_db()
            self.assertEqual(self.earning.payout_id, payout.id)

    def test_destination_change_is_blocked_during_reservation(self):
        self.request()
        with self.assertRaises(ServiceError):
            services.save_method(user=self.teacher, method="bank", bank_account_name="Changed", bank_account_last4="1234")
