"""M5 P10: checkout honours platform promotions (targets, limits, schedule, segments,
first purchase, minimum order, stacking) and the console manages them. M1 behaviour
(site-wide sale, instructor coupons) stays the same when the new features are unused."""

from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.commerce import services
from apps.commerce.models import Coupon, Order, Promotion, PromotionRedemption, PromotionTarget
from apps.commerce.tests.test_commerce import CommerceBase, fake_session
from apps.platform import services as platform
from apps.platform.models import AuditLog
from core.errors import ServiceError
from core.tenancy import tenant_context

API = "/api/v1/console"


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class PromotionCheckoutTest(CommerceBase):
    def promo(self, **kw):
        now = timezone.now()
        targets = kw.pop("targets", [])
        defaults = {"name": "Sale", "percent_off": 30, "starts_at": now - timedelta(hours=1),
                    "ends_at": now + timedelta(days=7)}  # fmt: skip
        with tenant_context(**self.STAFF):
            p = Promotion.objects.create(**(defaults | kw))
            for t in targets:
                PromotionTarget.objects.create(promotion=p, **t)
        return p

    def price(self, ids, code=None, user=None, currency="GBP"):
        user = user or self.sara
        with tenant_context(user_id=user.id):
            return services.price_cart(user=user, course_ids=ids, currency=currency, coupon_code=code)

    def pay(self, ids, code=None, user=None, event="evt_p1"):
        user = user or self.sara
        with tenant_context(user_id=user.id):
            order = services.create_order(user=user, course_ids=ids, currency="GBP", coupon_code=code)[
                "order"
            ]
        self.deliver(self.paid_event(order, event_id=event))
        return order

    def test_targeted_campaign_applies_to_its_course_only_and_counts_usage(self, _s):
        p = self.promo(kind="campaign", targets=[{"target_type": "course", "target_id": self.python.id}])
        priced = self.price([self.python.id, self.sql.id])
        lines = {cid: price for cid, _, price in priced["lines"]}
        self.assertEqual(lines[self.python.id], 2499)  # 34.99 less 30% = 24.49 -> natural 24.99
        self.assertEqual(lines[self.sql.id], 1499)  # not targeted
        self.assertEqual(priced["promotion"].pk, p.pk)
        order = self.pay([self.python.id, self.sql.id])
        with tenant_context(**self.STAFF):
            order.refresh_from_db()
            self.assertEqual(order.promotion_id, p.id)
            self.assertEqual(order.discount_minor, 1000)
            r = PromotionRedemption.objects.get(order=order)
            self.assertEqual(r.discount_minor, 1000)
            self.assertEqual(Promotion.objects.get(pk=p.pk).redeemed_count, 1)

    def test_promo_code_minimum_order_and_limits(self, _s):
        self.promo(kind="promo_code", code="SAVE20", percent_off=20, min_order_minor=5000, per_user_limit=1)
        with self.assertRaises(ServiceError) as e:
            self.price([self.python.id, self.sql.id], code="save20")  # £49.98 < £50.00
        self.assertIn("Spend at least £50.00", e.exception.message)
        with tenant_context(**self.STAFF):
            Promotion.objects.filter(code="SAVE20").update(min_order_minor=4000)
        priced = self.price([self.python.id, self.sql.id], code="save20")
        self.assertEqual(priced["total"], 2799 + 1199)
        self.assertEqual(priced["promo_code"], "SAVE20")
        # without the code nothing applies
        self.assertIsNone(self.price([self.python.id, self.sql.id])["promotion"])
        # per person: once
        self.pay([self.sql.id, self.python.id], code="SAVE20")
        with tenant_context(**self.STAFF):
            Promotion.objects.filter(code="SAVE20").update(min_order_minor=0)
        with self.assertRaises(ServiceError) as e:
            self.price([self.free.id], code="SAVE20")  # different course, still the same person
        self.assertEqual(e.exception.code, "coupon_used_up")
        # total limit reached: refused for everyone
        with tenant_context(**self.STAFF):
            Promotion.objects.filter(code="SAVE20").update(max_redemptions=1)
        with self.assertRaises(ServiceError):
            self.price([self.python.id], code="SAVE20", user=self.omar)
        with self.assertRaises(ServiceError):
            self.price([self.python.id], code="NOPE")

    def test_schedule_draft_and_ended_never_apply(self, _s):
        now = timezone.now()
        self.promo(name="Later", starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=2))
        self.promo(name="Draft", status="draft")
        self.promo(name="Off", is_active=False)
        self.promo(name="Over", starts_at=now - timedelta(days=3), ends_at=now - timedelta(days=1))
        priced = self.price([self.python.id])
        self.assertIsNone(priced["promotion"])
        self.assertEqual(priced["total"], 3499)

    def test_first_purchase_and_segments(self, _s):
        self.promo(kind="first_purchase", name="Welcome", percent_off=10)
        self.assertEqual(self.price([self.python.id])["promotion"].name, "Welcome")
        self.pay([self.sql.id])
        self.assertIsNone(self.price([self.python.id])["promotion"])  # no longer a first purchase
        with tenant_context(**self.STAFF):  # Omar has bought nothing, so switch the welcome offer off
            Promotion.objects.filter(name="Welcome").update(is_active=False)
        # a campaign only for company members: Omar is in no company
        self.promo(name="Teams", targets=[{"target_type": "user_segment", "segment": "company_members"}])
        self.assertIsNone(self.price([self.python.id], user=self.omar)["promotion"])
        self.promo(name="Newcomers", percent_off=5,
                   targets=[{"target_type": "user_segment", "segment": "new_users"}])  # fmt: skip
        self.assertEqual(self.price([self.python.id], user=self.omar)["promotion"].name, "Newcomers")

    def test_coupon_and_promotion_do_not_stack_unless_allowed(self, _s):
        with tenant_context(**self.STAFF):
            Coupon.objects.create(code="TOM10", course=self.python, percent_off=10, starts_at=timezone.now(),
                                  created_by=self.teacher)  # fmt: skip
        self.promo()  # 30% site-wide campaign
        lines = {c: p for c, _, p in self.price([self.python.id], code="TOM10")["lines"]}
        self.assertEqual(lines[self.python.id], 2499)  # the better of 31.49 and 24.99
        with tenant_context(**self.STAFF):
            platform.set_setting(key="payments.allow_promotion_stacking", value=True, by=self.staff)
        lines = {c: p for c, _, p in self.price([self.python.id], code="TOM10")["lines"]}
        self.assertEqual(lines[self.python.id], 2299)  # 31.49 less 30% = 22.04 -> 22.99
        with tenant_context(**self.STAFF):  # settings are cached: put the default back
            platform.set_setting(key="payments.allow_promotion_stacking", value=False, by=self.staff)

    def test_instructor_coupon_alone_is_unchanged(self, _s):
        with tenant_context(**self.STAFF):
            Coupon.objects.create(code="TOM10", course=self.python, percent_off=10, starts_at=timezone.now(),
                                  created_by=self.teacher)  # fmt: skip
        priced = self.price([self.python.id, self.sql.id], code="tom10")
        self.assertEqual(priced["total"], 3499 * 90 // 100 + 1499)
        self.assertIsNone(priced["promotion"])
        order = self.pay([self.python.id], code="TOM10")
        with tenant_context(**self.STAFF):
            self.assertIsNone(Order.objects.get(pk=order.pk).promotion_id)
            self.assertFalse(PromotionRedemption.objects.exists())


class PromotionConsoleTest(CommerceBase):
    def test_create_edit_duplicate_deactivate_with_audit(self):
        self.client.force_login(self.staff)
        now = timezone.now()
        body = {"name": "Summer", "kind": "campaign", "percent_off": 30, "starts_at": now.isoformat(),
                "ends_at": (now + timedelta(days=30)).isoformat(), "max_redemptions": 100,
                "targets": [{"target_type": "course", "target_id": str(self.python.id)}]}  # fmt: skip
        r = self.client.post(f"{API}/promotions", body, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        pid = r.json()["id"]
        rows = self.client.get(f"{API}/promotions").json()
        self.assertEqual(rows[0]["status"], "active")
        self.assertEqual(rows[0]["target_summary"], "1 course")
        # a promo code must have a code, and codes are unique
        bad = self.client.post(
            f"{API}/promotions", body | {"kind": "promo_code"}, content_type="application/json"
        )
        self.assertEqual(bad.json()["error"]["code"], "code_required")
        r = self.client.put(f"{API}/promotions/{pid}", body | {"percent_off": 40, "draft": True},
                            content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.client.get(f"{API}/promotions/{pid}").json()["promotion"]["status"], "draft")
        copy = self.client.post(f"{API}/promotions/{pid}/duplicate").json()["id"]
        self.assertEqual(
            self.client.get(f"{API}/promotions/{copy}").json()["promotion"]["target_summary"], "1 course"
        )
        r = self.client.post(f"{API}/promotions/{pid}/deactivate", {"reason": "Ended early"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200)
        detail = self.client.get(f"{API}/promotions/{pid}").json()
        self.assertEqual(detail["promotion"]["status"], "ended")
        self.assertIn("promotion.deactivate", [a["action"] for a in detail["activity"]])
        with tenant_context(**self.STAFF):
            self.assertTrue(AuditLog.objects.filter(action="promotion.create", target_id=pid).exists())
        overview = self.client.get(f"{API}/promotions/overview").json()
        self.assertEqual(overview["active"], 0)
        self.assertEqual(self.client.get(f"{API}/promotions/export.csv").status_code, 200)

    @mock.patch("apps.commerce.gateway.create_coupon", return_value="coupon_test_1")
    def test_subscription_promotion_gets_a_stripe_coupon(self, coupon):
        self.client.force_login(self.staff)
        now = timezone.now()
        r = self.client.post(f"{API}/promotions", {
            "name": "Year deal", "kind": "subscription", "percent_off": 20, "starts_at": now.isoformat(),
            "ends_at": (now + timedelta(days=30)).isoformat()}, content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        coupon.assert_called_once()
        with tenant_context(**self.STAFF):
            self.assertEqual(Promotion.objects.get(pk=r.json()["id"]).stripe_coupon_id, "coupon_test_1")
