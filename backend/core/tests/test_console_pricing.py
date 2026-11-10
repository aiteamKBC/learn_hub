"""M5 P9: regional prices at checkout (buyer's country), the course price grid, bulk
updates, pricing rules (preview then apply once), tier base prices."""

from unittest import mock

from apps.commerce import pricing, services
from apps.commerce.models import CoursePrice, PriceTier, PriceTierAmount, PricingRule, RegionalPrice
from apps.commerce.tests.test_commerce import CommerceBase, fake_session
from apps.platform import services as platform
from core.tenancy import tenant_context

API = "/api/v1/console"


class BuyerCountryTest(CommerceBase):
    def test_country_from_edge_header_or_browser_language(self):
        self.assertEqual(pricing.country_from_headers({"HTTP_CF_IPCOUNTRY": "in"}), "IN")
        self.assertEqual(pricing.country_from_headers({"HTTP_ACCEPT_LANGUAGE": "en-US,en;q=0.9"}), "US")
        self.assertEqual(pricing.country_from_headers({"HTTP_ACCEPT_LANGUAGE": "zh-Hant-TW"}), "TW")
        self.assertEqual(pricing.country_from_headers({"HTTP_ACCEPT_LANGUAGE": "en"}), "")
        self.assertEqual(pricing.country_from_headers({"HTTP_CF_IPCOUNTRY": "XX"}), "")


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class RegionalPriceTest(CommerceBase):
    def test_checkout_uses_the_buyers_country_price(self, _s):
        with tenant_context(**self.STAFF):
            RegionalPrice.objects.create(
                course=self.python, country="US", currency_id="USD", amount_minor=2999
            )
            RegionalPrice.objects.create(
                tier=self.sql.price.tier, country="US", currency_id="USD", amount_minor=999
            )
        token = pricing.BUYER_COUNTRY.set("US")
        try:
            with tenant_context(user_id=self.sara.id):
                q = pricing.quote([self.python.id, self.sql.id], "USD")
                self.assertEqual(q[self.python.id]["list_minor"], 2999)  # course beats tier
                self.assertEqual(q[self.sql.id]["list_minor"], 999)  # the tier's country price
                self.assertEqual(pricing.quote([self.python.id], "GBP")[self.python.id]["list_minor"], 3499)
                order = services.create_order(user=self.sara, course_ids=[self.python.id], currency="USD")[
                    "order"
                ]
                self.assertEqual((order.total_minor, order.country), (2999, "US"))
            with tenant_context(**self.STAFF):
                platform.set_setting(key="pricing.regional_enabled", value=False, by=self.staff)
            with tenant_context(user_id=self.sara.id):
                self.assertEqual(pricing.quote([self.python.id], "USD")[self.python.id]["list_minor"], 4699)
            with tenant_context(**self.STAFF):
                platform.set_setting(key="pricing.regional_enabled", value=True, by=self.staff)
        finally:
            pricing.BUYER_COUNTRY.reset(token)
        with tenant_context(user_id=self.omar.id):  # nobody from the US: the standard price
            self.assertEqual(pricing.quote([self.python.id], "USD")[self.python.id]["list_minor"], 4699)

    def test_console_regional_and_grid(self, _s):
        self.client.force_login(self.staff)
        r = self.client.post(f"{API}/pricing/regional", {"course_id": str(self.python.id), "country": "us",
                             "currency": "USD", "amount_minor": 2999}, content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        rows = self.client.get(f"{API}/pricing/regional").json()
        self.assertEqual((rows[0]["country"], rows[0]["standard_minor"]), ("US", 4699))
        grid = self.client.get(f"{API}/pricing/courses?kind=custom").json()
        self.assertEqual([c["title"] for c in grid["items"]], ["Course python"])
        usd = next(a for a in grid["items"][0]["amounts"] if a["currency"] == "USD")
        self.assertTrue(usd["regional"])
        self.client.patch(f"{API}/pricing/regional/{r.json()['id']}", {"is_active": False},
                          content_type="application/json")  # fmt: skip
        self.assertEqual(self.client.get(f"{API}/pricing/overview").json()["regional_overrides"], 0)
        self.assertEqual(self.client.get(f"{API}/pricing/courses/export.csv").status_code, 200)


class PricingRuleTest(CommerceBase):
    def test_preview_then_apply_once_and_bulk(self):
        self.client.force_login(self.staff)
        r = self.client.post(f"{API}/pricing/rules", {"name": "Up 15%", "action": "percent", "percent": 15,
                             "rounding": "up"}, content_type="application/json")  # fmt: skip
        rule = r.json()["id"]
        preview = self.client.get(f"{API}/pricing/rules/{rule}/preview").json()
        by = {c["title"]: c for c in preview["changes"]}
        self.assertEqual(by["Course python"]["to_gbp_minor"], 4499)  # 34.99 + 15% = 40.24 -> tier above
        self.assertEqual(by["Course sql"]["to_gbp_minor"], 1999)  # 14.99 + 15% = 17.24 -> 19.99
        applied = self.client.post(f"{API}/pricing/rules/{rule}/apply").json()
        self.assertEqual(applied["updated"], 2)
        with tenant_context(**self.STAFF):
            self.assertEqual(CoursePrice.objects.get(course=self.python).tier.gbp_minor, 4499)
            self.assertIsNotNone(PricingRule.objects.get(pk=rule).applied_at)
        self.assertEqual(self.client.post(f"{API}/pricing/rules/{rule}/apply").json()["error"]["code"],
                         "already_applied")  # fmt: skip
        tier1 = PriceTier.objects.get(name="Tier 1")
        r = self.client.post(f"{API}/pricing/bulk", {"course_ids": [str(self.python.id), str(self.sql.id)],
                             "tier_id": str(tier1.id)}, content_type="application/json")  # fmt: skip
        self.assertEqual(r.json()["updated"], 2)
        self.assertEqual(pricing_pick(1500, "nearest"), 1499)

    def test_tier_base_price_reprices_unlocked_currencies(self):
        self.client.force_login(self.staff)
        tier = self.tier5
        old = tier.gbp_minor
        try:
            with tenant_context(**self.STAFF):
                pricing.set_tier_amount(tier=tier, code="JPY", amount_minor=7000, lock=True)
            r = self.client.patch(
                f"{API}/price-tiers/{tier.id}", {"gbp_minor": 3999}, content_type="application/json"
            )
            self.assertEqual(r.status_code, 200, r.content)
            with tenant_context(**self.STAFF):
                amt = {a.currency_id: a.amount_minor for a in PriceTierAmount.objects.filter(tier=tier)}
            self.assertEqual(amt["GBP"], 3999)
            self.assertEqual(amt["USD"], 5399)  # 39.99 x 1.3333 = 53.32 -> 53.99
            self.assertEqual(amt["JPY"], 7000)  # locked by hand
        finally:  # tiers are reference data kept between tests
            with tenant_context(**self.STAFF):
                PriceTier.objects.filter(pk=tier.pk).update(gbp_minor=old)
                pricing.reprice_tier(PriceTier.objects.get(pk=tier.pk))
                PriceTierAmount.objects.filter(tier=tier, currency_id="JPY").update(is_locked=False)


def pricing_pick(gbp, rounding):
    from apps.platform.console.pricing import pick_tier

    return pick_tier(gbp, list(PriceTier.objects.filter(is_active=True)), rounding).gbp_minor
