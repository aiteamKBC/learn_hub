"""Database-free regressions for the final Commissions safety corrections."""

from contextlib import nullcontext
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from apps.commerce import package_checkout, package_finance, packages, services
from apps.payouts.pool_status import subscription_pool_status
from core.errors import ServiceError


class CommissionGuardTests(SimpleTestCase):
    def test_pool_status_is_explicitly_blocked(self):
        status = subscription_pool_status()
        self.assertEqual(status["pool_settlement_status"], "blocked")
        self.assertIn("F03/C06", status["pool_settlement_reason"])
        self.assertIn("historical", status["pool_settlement_reason"])

    def test_overview_status_overrides_old_cached_data(self):
        from apps.platform.console import commissions

        with (
            patch.object(commissions, "staff"),
            patch.object(commissions.cache, "get_or_set", return_value={"pool_pct": 25}),
        ):
            response = commissions.commission_overview(None)
        self.assertEqual(response["pool_settlement_status"], "blocked")
        self.assertEqual(response["pool_pct"], 25)

    def test_package_refund_stops_before_any_money_or_rights_mutation(self):
        order = SimpleNamespace(id="order", status="paid")
        item = SimpleNamespace(pk="item", order_id="order")
        with (
            patch.object(services, "Order") as orders,
            patch.object(services, "OrderItem") as items,
            patch.object(package_finance, "PriceSnapshot") as snapshots,
            patch.object(services, "Refund") as refunds,
            patch.object(services, "Enrollment") as enrollments,
            patch.object(services.gateway, "refund") as provider,
        ):
            orders.objects.select_for_update.return_value.get.return_value = order
            items.objects.get.return_value = item
            snapshots.objects.filter.return_value.exists.return_value = True
            with self.assertRaises(ServiceError) as raised:
                services.request_refund.__wrapped__(item=item, by=SimpleNamespace(is_staff=True))
            self.assertEqual(raised.exception.code, "P06_BLOCKED")
            provider.assert_not_called()
            refunds.objects.create.assert_not_called()
            enrollments.objects.filter.assert_not_called()
            items.objects.filter.assert_not_called()

    def test_independent_order_not_classified_from_current_access(self):
        with patch.object(package_finance, "PriceSnapshot") as snapshots:
            snapshots.objects.filter.return_value.exists.return_value = False
            package_finance.guard_package_refund("independent-order")
            self.assertEqual(snapshots.objects.filter.call_args.kwargs["source_ref"], "independent-order")

    def test_checkout_retries_lock_and_resume_before_creating_order_or_payment(self):
        result = {"url": "https://checkout.example/session", "pending": False}
        calls = []
        with (
            patch("apps.commerce.pricing.checkout_currency"),
            patch.object(packages, "tenant_context", return_value=nullcontext()),
            patch.object(package_checkout, "lock_checkout", side_effect=lambda *args: calls.append("lock")),
            patch.object(package_checkout, "existing_checkout", side_effect=lambda *args: calls.append("read") or result),
            patch.object(package_finance, "prepare_order") as prepare,
            patch.object(package_checkout, "reserve") as reserve,
        ):
            for currency in ("GBP", "USD"):
                self.assertEqual(packages.create_package_checkout.__wrapped__(
                    user=SimpleNamespace(id="buyer"), package_id="package", currency_code=currency,
                    success_url="success", cancel_url="cancel",
                ), result)
            self.assertEqual(calls, ["lock", "read", "lock", "read"])
            prepare.assert_not_called()
            reserve.assert_not_called()

    def test_reservation_only_enqueues_immutable_request(self):
        request = {"idempotency_key": "cash_package_order:order"}
        with (
            patch.object(package_checkout, "PriceSnapshot"),
            patch.object(package_checkout.outbox, "publish") as publish,
            patch.object(package_checkout.gateway, "create_checkout_session") as provider,
        ):
            result = package_checkout.reserve(
                order=SimpleNamespace(id="order", total_minor=8000, currency_id="GBP"),
                package_id="package", request=request,
            )
            self.assertEqual(result, {"url": None, "pending": True})
            publish.assert_called_once_with(package_checkout.TOPIC, {"order_id": "order", "request": request})
            provider.assert_not_called()

    def test_worker_retry_reuses_key_and_completed_worker_does_not_charge_again(self):
        order = SimpleNamespace(id="order", status="pending", stripe_session_id=None, created_at=timezone.now())
        payload = {"order_id": "order", "request": {"idempotency_key": "cash_package_order:order"}}
        with (
            patch.object(package_checkout, "tenant_context", return_value=nullcontext()),
            patch.object(package_checkout, "Order") as orders,
            patch.object(package_checkout, "OutboxEvent"),
            patch.object(package_checkout.gateway, "create_checkout_session") as provider,
        ):
            orders.objects.select_for_update.return_value.get.return_value = order
            orders.objects.filter.return_value.update.side_effect = lambda **kw: setattr(order, "stripe_session_id", kw["stripe_session_id"])
            provider.side_effect = [TimeoutError(), {"id": "cs_once", "url": "https://checkout.example/once"}]
            with self.assertRaises(TimeoutError):
                package_checkout.dispatch_checkout.__wrapped__(payload)
            package_checkout.dispatch_checkout.__wrapped__(payload)
            package_checkout.dispatch_checkout.__wrapped__(payload)
            self.assertEqual(provider.call_count, 2)
            self.assertEqual(provider.call_args_list[0], provider.call_args_list[1])
            self.assertEqual(order.stripe_session_id, "cs_once")

    def test_old_ambiguous_attempt_never_reissues_payment(self):
        order = SimpleNamespace(id="order", status="pending", stripe_session_id=None,
                                created_at=timezone.now() - timedelta(hours=2))
        with (
            patch.object(package_checkout, "tenant_context", return_value=nullcontext()),
            patch.object(package_checkout, "Order") as orders,
            patch.object(package_checkout.gateway, "create_checkout_session") as provider,
        ):
            orders.objects.select_for_update.return_value.get.return_value = order
            with self.assertRaises(ServiceError) as raised:
                package_checkout.dispatch_checkout.__wrapped__({"order_id": "order", "request": {}})
            self.assertEqual(raised.exception.code, "package_checkout_review")
            provider.assert_not_called()

    def test_existing_reservation_returns_same_saved_url(self):
        order = SimpleNamespace(id="order", status="pending", stripe_session_id="cs_once", created_at=timezone.now())
        with (
            patch.object(package_checkout, "PriceSnapshot"),
            patch.object(package_checkout, "Order") as orders,
            patch.object(package_checkout, "OutboxEvent") as events,
        ):
            orders.objects.filter.return_value.order_by.return_value.first.return_value = order
            events.objects.filter.return_value.first.return_value = SimpleNamespace(payload={"checkout_url": "same-url"})
            self.assertEqual(package_checkout.existing_checkout("buyer", "package"), {"url": "same-url", "pending": False})

    def test_lock_identity_is_buyer_and_package_not_currency(self):
        cursor = Mock()
        with patch.object(package_checkout, "connection") as connection:
            connection.cursor.return_value.__enter__.return_value = cursor
            package_checkout.lock_checkout("buyer", "package")
        self.assertIn("pg_advisory_xact_lock", cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], ["package-checkout:buyer:package"])
