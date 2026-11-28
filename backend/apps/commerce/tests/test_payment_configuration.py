"""B2C payment regressions. SimpleTestCase forbids every database connection."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import PermissionDenied
from django.test import SimpleTestCase, override_settings

from apps.commerce import api, gateway, packages, pricing, token_api
from apps.platform.console import platform_settings
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
            conversion.assert_called_once_with(1234, "ISK", 0)
            provider.assert_not_called()

    def test_iso_to_stripe_conversion_uses_stored_exponent(self):
        for code, exponent, minor, expected in (
            ("GBP", 2, 1234, 1234),
            ("JPY", 0, 1234, 1234),
            ("ISK", 0, 1234, 123400),
            ("UGX", 2, 123400, 1234),
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
