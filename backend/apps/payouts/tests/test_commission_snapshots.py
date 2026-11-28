"""Focused commission snapshot coverage; no real gateway calls."""

from datetime import date
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase
from django.utils import timezone

from apps.catalog.models import CourseInstructor
from apps.commerce import package_finance
from apps.commerce.models import CoursePrice, PriceTier, Refund
from apps.payouts import reconciliation, services
from apps.payouts.models import CommissionRule, Earning, RevenueShare
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase


class AllocationTest(SimpleTestCase):
    def test_approved_package_example(self):
        self.assertEqual(package_finance.allocate(8000, {"a": 4000, "b": 6000}), {"a": 3200, "b": 4800})

    def test_rounding_conserves_total_and_is_order_independent(self):
        for total in (0, 1, 2, 101, 8001):
            forward = package_finance.allocate(total, {"a": 4, "b": 6, "c": 3})
            reverse = package_finance.allocate(total, {"c": 3, "b": 6, "a": 4})
            self.assertEqual(forward, reverse)
            self.assertEqual(sum(forward.values()), total)
            self.assertTrue(all(value >= 0 for value in forward.values()))

    @mock.patch.object(services, "tenant_context")
    @mock.patch.object(services, "connection")
    @mock.patch.object(services, "Earning")
    def test_unverified_usage_never_credits_retries_or_overlaps(self, earning, _connection, _tenant):
        earning.objects.filter.return_value.exists.return_value = False
        with self.assertLogs("apps.payouts.services", level="WARNING"):
            for _ in range(3):
                self.assertEqual(services.settle_subscription_pool(date(2026, 10, 1)), 0)
        earning.objects.bulk_create.assert_not_called()

    @mock.patch.object(services, "tenant_context")
    @mock.patch.object(services, "connection")
    @mock.patch.object(services, "Earning")
    def test_settled_history_is_not_rewritten(self, earning, _connection, _tenant):
        earning.objects.filter.return_value.exists.return_value = True
        self.assertEqual(services.settle_subscription_pool(date(2026, 10, 1)), 0)
        earning.objects.bulk_create.assert_not_called()
        earning.objects.update.assert_not_called()


class PackageSnapshotTest(SchemaTransactionTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.staff, self.tom, self.sara, self.buyer = f.users()
        with tenant_context(staff=True):
            f.money(self.staff)
            self.a = f.course(staff=self.staff, owner=self.tom, slug="snapshot-a", title="A")
            self.b = f.course(staff=self.staff, owner=self.sara, slug="snapshot-b", title="B")
            for course, amount in ((self.a, 4000), (self.b, 6000)):
                tier = PriceTier.objects.create(name=f"Snapshot {amount}", gbp_minor=amount)
                CoursePrice.objects.filter(course=course).update(tier=tier)
            self.order = package_finance.prepare_order(
                user=self.buyer, course_ids=[self.a.id, self.b.id], currency_code="GBP", amount=8000,
                quotes={self.a.id: {"list_minor": 4000}, self.b.id: {"list_minor": 6000}},
            )

    def test_frozen_prices_rates_retries_and_refund_reconcile(self):
        with tenant_context(staff=True):
            self.order.status, self.order.paid_at = "paid", timezone.now()
            self.order.save()
            rates_before = dict(RevenueShare.objects.values_list("channel", "instructor_bps"))
            self.assertEqual(services.record_sale(self.order.id), 2)
            originals = list(Earning.objects.filter(order_item__order=self.order).values_list(
                "user_id", "share_bps", "gross_gbp_minor", "amount_gbp_minor"))
            item = self.order.items.get(course=self.a)
            self.assertEqual((item.gbp_gross_minor, services._undiscounted_gbp(item)), (3200, 4000))
            # Mutating the live catalogue and instructor set cannot alter this purchase.
            CoursePrice.objects.filter(course=self.a).update(tier=CoursePrice.objects.get(course=self.b).tier)
            CourseInstructor.objects.create(course=self.a, user=self.sara, revenue_share_bps=5000)
            CommissionRule.objects.create(scope="course", target_id=self.a.id, instructor_bps=10000)
            self.assertEqual(services.record_sale(self.order.id), 0)
            self.assertEqual(services._undiscounted_gbp(item), 4000)
            self.assertEqual(list(Earning.objects.filter(order_item__order=self.order).values_list(
                "user_id", "share_bps", "gross_gbp_minor", "amount_gbp_minor")), originals)
            Refund.objects.create(item=item, user=self.buyer, requested_by=self.staff,
                                  amount_minor=item.gross_minor, status="succeeded")
            item.refunded_at = timezone.now()
            item.save(update_fields=["refunded_at"])
            services.record_refund(item.id)
            services.record_refund(item.id)
            result = reconciliation.reconcile_order(self.order.id)
            self.assertEqual(result["issues"], [])
            self.assertEqual(result["refunded_gbp_minor"], 3200)
            self.assertEqual(result["instructor_net_gbp_minor"] + result["platform_residual_gbp_minor"], 4800)
            self.assertEqual(dict(RevenueShare.objects.values_list("channel", "instructor_bps")), rates_before)

    def test_snapshot_order_rejects_another_checkout(self):
        from core.errors import ServiceError

        with tenant_context(staff=True), self.assertRaises(ServiceError) as error:
            package_finance.fulfil_order(order_id=self.order.id, user_id=self.buyer.id, session={"id": "wrong"})
        self.assertEqual(error.exception.code, "checkout_mismatch")
