"""B2C payment regressions. SimpleTestCase forbids every database connection."""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import PermissionDenied
from django.test import SimpleTestCase, override_settings

from apps.commerce import api, gateway, packages, pricing, services, subscriptions, token_api
from apps.platform.console import platform_settings
from apps.platform.models import AuditLog
from core.errors import ServiceError


class PersonalPaymentConfigurationTests(SimpleTestCase):
    @override_settings(
        STRIPE_SECRET_KEY="", STRIPE_PUBLISHABLE_KEY="", PERSONAL_TOKEN_CONTENT_UNLOCKS_ENABLED=False
    )
    def test_configuration_reports_unavailable_without_keys(self):
        self.assertEqual(
            api.payment_configuration(None),
            {
                "stripe_configured": False,
                "embedded_configured": False,
                "token_unlocks_enabled": False,
            },
        )

    @override_settings(STRIPE_SECRET_KEY="test-placeholder", STRIPE_PUBLISHABLE_KEY="")
    def test_hosted_configuration_does_not_promise_embedded_checkout_or_expose_keys(self):
        result = api.payment_configuration(None)
        self.assertTrue(result["stripe_configured"])
        self.assertFalse(result["embedded_configured"])
        self.assertTrue(all(isinstance(value, bool) for value in result.values()))

    @override_settings(PERSONAL_TOKEN_CONTENT_UNLOCKS_ENABLED=False)
    def test_k02_refuses_all_new_unlock_scopes_before_database_or_debit(self):
        for scope in ("course", "lecture", "material"):
            with self.subTest(scope=scope), self.assertRaises(ServiceError) as caught:
                token_api.unlock_content(None, token_api.UnlockIn(scope=scope, target_id=uuid4()))
            self.assertEqual(caught.exception.code, "content_unlocks_temporarily_unavailable")

    def test_learner_cannot_save_canonical_settings(self):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, is_staff=False))
        with self.assertRaises(PermissionDenied):
            platform_settings.save_settings(
                request,
                platform_settings.ConsoleSettingsSaveIn(values={"payments.allow_promotion_stacking": True}),
            )


class CheckoutCurrencyTests(SimpleTestCase):
    def test_package_checkout_uses_iso_exponent_before_provider_request(self):
        package = SimpleNamespace(price_tier=object(), starts_at=None, ends_at=None)
        with (
            patch.object(packages.CashPackage.objects, "select_related") as package_query,
            patch.object(packages.PriceTierAmount.objects, "filter") as amount_query,
            patch.object(pricing.Currency.objects, "filter") as currency_query,
            patch.object(packages.CashPackageCourse.objects, "filter") as course_query,
            patch.object(gateway, "to_stripe_amount", wraps=gateway.to_stripe_amount) as conversion,
            patch.object(gateway, "create_checkout_session") as provider,
        ):
            package_query.return_value.filter.return_value.first.return_value = package
            amount_query.return_value.first.return_value = SimpleNamespace(amount_minor=1234)
            currency_query.return_value.first.return_value = SimpleNamespace(code="ISK", exponent=0)
            course_query.return_value.values_list.return_value = []
            # Stop at the next eligibility check, before any accounting or provider writes.
            with self.assertRaises(ServiceError) as caught:
                packages.create_package_checkout(
                    user=None, package_id=uuid4(), currency_code="ISK", success_url="", cancel_url=""
                )
            self.assertEqual(caught.exception.code, "invalid_courses")
            conversion.assert_called_once_with(1234, "ISK", 0, ugx_compatibility=True)
            provider.assert_not_called()

    def test_iso_to_stripe_conversion_uses_stored_exponent(self):
        for code, exponent, minor, expected in (
            ("GBP", 2, 1234, 1234),
            ("JPY", 0, 1234, 1234),
            ("ISK", 0, 1234, 123400),
            ("UGX", 0, 5, 500),
            ("UGX", 2, 500, 500),
            ("KWD", 3, 12340, 12340),
        ):
            with self.subTest(code=code), patch.object(pricing.Currency.objects, "filter") as query:
                query.return_value.first.return_value = SimpleNamespace(code=code, exponent=exponent)
                self.assertEqual(pricing.checkout_amount(minor, code), expected)
                query.assert_called_once_with(code=code, is_active=True, stripe_supported=True)

    def test_unavailable_currency_rejected_before_provider(self):
        with patch.object(pricing.Currency.objects, "filter") as query:
            query.return_value.first.return_value = None
            with self.assertRaises(ServiceError) as caught:
                pricing.checkout_amount(100, "GBP")
            self.assertEqual(caught.exception.code, "bad_currency")

    def test_unrepresentable_amount_is_not_silently_truncated(self):
        with patch.object(pricing.Currency.objects, "filter") as query:
            query.return_value.first.return_value = SimpleNamespace(code="UGX", exponent=2)
            with self.assertRaises(ServiceError) as caught:
                pricing.checkout_amount(12345, "UGX")
            self.assertEqual(caught.exception.code, "bad_amount")


class RequestedCurrencyTests(SimpleTestCase):
    def test_invalid_explicit_subscription_currency_cannot_be_replaced_by_resolver(self):
        body = token_api.SubCheckoutIn(plan_id=uuid4(), currency="ZZZ", success_url="x", cancel_url="x")
        with (
            patch.object(pricing.Currency.objects, "filter") as query,
            patch.object(token_api, "request_currency") as resolve,
        ):
            query.return_value.first.return_value = None
            with self.assertRaises(ServiceError) as caught:
                token_api.subscription_checkout(None, body)
            self.assertEqual(caught.exception.code, "bad_currency")
            resolve.assert_not_called()

    def test_unavailable_requested_currency_rejected_before_price_fallback(self):
        for code in ("ZZZ", "USD", "EUR"):
            for checkout in (packages.create_package_checkout, subscriptions.create_subscription_checkout):
                with (
                    self.subTest(code=code, checkout=checkout.__name__),
                    patch.object(pricing.Currency.objects, "filter") as query,
                ):
                    query.return_value.first.return_value = None
                    args = {
                        "package_id" if checkout is packages.create_package_checkout else "plan_id": uuid4()
                    }
                    with self.assertRaises(ServiceError) as caught:
                        checkout(user=None, currency_code=code, success_url="", cancel_url="", **args)
                    self.assertEqual(caught.exception.code, "bad_currency")
                    query.assert_called_once_with(code=code, is_active=True, stripe_supported=True)

    def test_supported_package_currency_without_price_still_falls_back_to_gbp(self):
        package = SimpleNamespace(price_tier=SimpleNamespace(gbp_minor=500), starts_at=None, ends_at=None)
        with (
            patch.object(pricing.Currency.objects, "filter") as currency_query,
            patch.object(packages.CashPackage.objects, "select_related") as package_query,
            patch.object(packages.PriceTierAmount.objects, "filter") as price_query,
            patch.object(packages.CashPackageCourse.objects, "filter") as course_query,
            patch.object(gateway, "to_stripe_amount", wraps=gateway.to_stripe_amount) as convert,
        ):
            currency_query.return_value.first.side_effect = [
                SimpleNamespace(code="USD", exponent=2),
                SimpleNamespace(code="GBP", exponent=2),
            ]
            package_query.return_value.filter.return_value.first.return_value = package
            price_query.return_value.first.return_value = None
            course_query.return_value.values_list.return_value = []
            with self.assertRaises(ServiceError) as caught:
                packages.create_package_checkout(
                    user=None, package_id=uuid4(), currency_code="USD", success_url="", cancel_url=""
                )
            self.assertEqual(caught.exception.code, "invalid_courses")
            convert.assert_called_once_with(500, "GBP", 2, ugx_compatibility=True)

    def test_supported_subscription_currency_without_price_still_quotes_gbp(self):
        plan = SimpleNamespace(id=uuid4(), trial_days=0)
        with (
            patch.object(pricing.Currency.objects, "filter") as currency_query,
            patch.object(subscriptions.Subscription.objects, "filter") as pending,
            patch.object(subscriptions.Plan.objects, "filter") as plans,
            patch.object(subscriptions.PlanPrice.objects, "filter") as prices,
            patch.object(subscriptions.promotions, "for_plan", return_value=None),
        ):
            currency_query.return_value.first.return_value = SimpleNamespace(code="USD", exponent=2)
            pending.return_value.order_by.return_value.first.return_value = None
            plans.return_value.first.return_value = plan
            prices.return_value.first.side_effect = [
                None,
                SimpleNamespace(amount_minor=500, currency_id="GBP"),
            ]
            result = subscriptions.quote_subscription(user=None, plan_id=plan.id, currency_code="USD")
            self.assertEqual((result["currency"], result["first_payment_minor"]), ("GBP", 500))

    def test_token_pack_rejects_unsupported_currency_before_price_fallback(self):
        with (
            patch.object(token_api, "get_object_or_404", return_value=SimpleNamespace(price_tier=None)),
            patch.object(token_api, "request_currency", return_value={"code": "USD", "exponent": 2}),
            patch.object(pricing.Currency.objects, "filter") as currencies,
            patch.object(token_api.PriceTierAmount.objects, "filter") as prices,
        ):
            currencies.return_value.first.return_value = None
            with self.assertRaises(ServiceError) as caught:
                token_api.pack_checkout(None, uuid4(), None)
            self.assertEqual(caught.exception.code, "bad_currency")
            prices.assert_not_called()


class UgxVerificationTests(SimpleTestCase):
    def order(self, **kwargs):
        values = dict(
            id=uuid4(),
            org_id=None,
            currency_id="UGX",
            user_id=uuid4(),
            currency=SimpleNamespace(code="UGX", exponent=0),
            total_minor=5,
            status="pending",
            promotion_id=None,
            payment_method_type="card",
            card_brand="",
            card_last4="",
        )
        return SimpleNamespace(**(values | kwargs))

    def test_new_order_snapshot_preserves_conversion_exponent(self):
        order = self.order()
        with patch("apps.platform.services.audit") as audit:
            pricing.snapshot_order_currency(order)
            audit.assert_called_once_with(
                "payment.currency_snapshot",
                "order",
                str(order.id),
                actor_id=order.user_id,
                data={"ugx_compatibility": True, "iso_exponent": 0},
            )

    def test_new_order_verification_accepts_500_not_5_for_five_ugx(self):
        order = self.order()
        with (
            patch("core.tenancy.tenant_context", side_effect=lambda **kw: nullcontext()),
            patch.object(AuditLog.objects, "filter") as snapshots,
            patch.object(services.Order.objects, "select_for_update") as orders,
            patch.object(
                services.Payment.objects, "create", side_effect=RuntimeError("verified; stop before writes")
            ) as payment,
        ):
            snapshots.return_value.values_list.return_value.first.return_value = {
                "ugx_compatibility": True,
                "iso_exponent": 0,
            }
            orders.return_value.get.return_value = order
            with self.assertRaises(ServiceError) as caught:
                services.fulfil_order.__wrapped__(order_id=order.id, amount_minor=5, currency="UGX")
            self.assertEqual(caught.exception.code, "amount_mismatch")
            payment.assert_not_called()
            with self.assertRaisesRegex(RuntimeError, "verified; stop before writes"):
                services.fulfil_order.__wrapped__(order_id=order.id, amount_minor=500, currency="UGX")
            payment.assert_called_once()
            # Partial refunds use the same frozen convention, without current currency eligibility.
            self.assertEqual(pricing.order_stripe_amount(order, 2), 200)

    def test_historical_order_keeps_original_verification_and_refund_units(self):
        order = self.order()
        with (
            patch("core.tenancy.tenant_context", side_effect=lambda **kw: nullcontext()),
            patch.object(AuditLog.objects, "filter") as snapshots,
        ):
            snapshots.return_value.values_list.return_value.first.return_value = None
            self.assertEqual(pricing.order_stripe_amount(order, 5), 5)
            self.assertEqual(pricing.order_stripe_amount(order, 2), 2)

    def test_b2b_is_unchanged_and_does_not_read_or_write_snapshot(self):
        order = self.order(org_id=uuid4())
        with (
            patch.object(AuditLog.objects, "filter") as snapshots,
            patch("apps.platform.services.audit") as audit,
        ):
            self.assertEqual(pricing.order_stripe_amount(order, 5), 5)
            pricing.snapshot_order_currency(order)
            snapshots.assert_not_called()
            audit.assert_not_called()
        self.assertEqual(gateway.to_stripe_amount(5, "UGX", 0), 5)

    def test_previously_paid_order_replay_does_not_reverify_or_change_history(self):
        order = self.order(status="paid")
        with (
            patch.object(services.Order.objects, "select_for_update") as orders,
            patch.object(pricing, "order_stripe_amount") as convert,
        ):
            orders.return_value.get.return_value = order
            self.assertIs(
                services.fulfil_order.__wrapped__(order_id=order.id, amount_minor=5, currency="UGX"), order
            )
            convert.assert_not_called()
