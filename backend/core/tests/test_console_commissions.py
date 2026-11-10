"""M5 P11: commission rules (course > instructor > category > price band > own rate >
default, priority, dates), past earnings never rewritten, the discount setting, the
console endpoints and the M4 behaviour when no rule exists."""

from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone

from apps.commerce import services as shop
from apps.commerce.models import Coupon
from apps.engagement.models import Notification
from apps.identity.models import InstructorProfile
from apps.payouts import services as payouts
from apps.payouts.models import CommissionRule, Earning
from apps.platform import services as platform
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"
PRICE = 3499  # Tier 5


def fake_session(**kw):
    return {"id": f"cs_{kw['metadata']['id']}", "url": "https://pay.test"}


def reset_shares():
    """Back to the seeded rates (payouts migration 0002)."""
    from apps.payouts.models import RevenueShare

    with tenant_context(staff=True):
        for channel, bps in (("marketplace", 3700), ("instructor_coupon", 9700), ("subscription_pool", 2500)):
            RevenueShare.objects.filter(channel=channel).update(instructor_bps=bps)


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class CommissionRulesTest(SchemaTransactionTestCase):
    def setUp(self):
        cache.clear()  # settings are cached for 60 s
        self.addCleanup(cache.clear)  # and must not leak into the next test class
        reset_shares()  # revenue_shares is seed data the suite keeps: undo our edits after
        self.addCleanup(reset_shares)
        self.staff, self.tom, self.sara, self.omar = f.users()
        self.category = f.money(self.staff)
        InstructorProfile.objects.create(user=self.tom, status="approved")  # no own rate: the default applies
        self.py = f.course(
            staff=self.staff, owner=self.tom, slug="py", title="Python", category=self.category
        )
        self.go = f.course(staff=self.staff, owner=self.tom, slug="go", title="Go")
        self.n = 0

    def buyer(self):
        from apps.identity.models import User

        self.n += 1
        return User.objects.create_user(
            f"buyer{self.n}@learnhub.example.com", "x", full_name=f"Buyer {self.n}"
        )

    def buy(self, course, coupon=None):
        user = self.buyer()
        with tenant_context(user_id=user.id):
            order = shop.create_order(user=user, course_ids=[course.id], currency="GBP", coupon_code=coupon)[
                "order"
            ]
        with tenant_context(user_id=self.staff.id, staff=True):
            shop.fulfil_order(order_id=order.id, payment_intent=f"pi_{order.id}", amount_minor=order.total_minor,
                              currency="gbp")  # fmt: skip
        with tenant_context(staff=True):  # the ledger line is written once the payment commits
            return Earning.objects.filter(order_item__order=order, kind="sale").get()

    def rule(self, scope, pct, target=None, **kw):
        with tenant_context(user_id=self.staff.id, staff=True):
            return CommissionRule.objects.create(
                scope=scope, target_id=target, instructor_bps=pct * 100, **kw
            )

    def default_bps(self):
        with tenant_context(staff=True):
            return payouts._rates()["marketplace"]

    def test_precedence_dates_and_history(self, _s):
        line = self.buy(self.py)  # no rules: exactly the M4 behaviour
        self.assertEqual(line.share_bps, self.default_bps())
        self.assertEqual(line.amount_gbp_minor, PRICE * self.default_bps() // 10000)
        first = line.pk

        self.rule("price_band", 50, band_min_gbp_minor=3000, band_max_gbp_minor=5000)
        self.rule("price_band", 10, band_min_gbp_minor=5000)  # does not match £34.99
        self.assertEqual(self.buy(self.py).share_bps, 5000)
        self.rule("category", 60, self.category.id)
        self.assertEqual(self.buy(self.py).share_bps, 6000)
        self.assertEqual(self.buy(self.go).share_bps, 5000)  # no category: the band still applies
        self.rule("instructor", 65, self.tom.id)
        self.rule("instructor", 66, self.tom.id, priority=5)  # higher priority wins inside a scope
        self.assertEqual(self.buy(self.py).share_bps, 6600)
        now = timezone.now()
        self.rule("course", 90, self.py.id, starts_at=now + timedelta(days=1))  # not started
        self.rule("course", 95, self.py.id, ends_at=now - timedelta(days=1))  # over
        self.rule("course", 99, self.py.id, is_active=False)  # switched off
        self.assertEqual(self.buy(self.py).share_bps, 6600)
        self.rule("course", 80, self.py.id)
        line = self.buy(self.py)
        self.assertEqual((line.share_bps, line.amount_gbp_minor), (8000, PRICE * 8000 // 10000))
        self.assertTrue(line.note.startswith("Commission rule"))

        with tenant_context(staff=True):  # older earnings keep the rate of their sale
            self.assertEqual(Earning.objects.get(pk=first).share_bps, self.default_bps())

    def test_own_rate_still_applies_without_rules(self, _s):
        InstructorProfile.objects.filter(user=self.tom).update(platform_fee_bps=2500)
        self.assertEqual(self.buy(self.py).share_bps, 7500)
        self.rule("category", 60, self.category.id)  # a rule is more specific than the own rate
        self.assertEqual(self.buy(self.py).share_bps, 6000)

    def test_discount_setting(self, _s):
        with tenant_context(user_id=self.staff.id, staff=True):
            Coupon.objects.create(code="HALF", course=self.py, percent_off=50, starts_at=timezone.now(),
                                  created_by=self.staff)  # a platform discount  # fmt: skip
        self.rule("course", 50, self.py.id)
        cut = self.buy(self.py, coupon="HALF")
        self.assertEqual(
            cut.amount_gbp_minor, cut.gross_gbp_minor * 5000 // 10000
        )  # default: shared discount
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="payments.discount_reduces_commission", value=False, by=self.staff)
        full = self.buy(self.py, coupon="HALF")
        self.assertEqual(full.gross_gbp_minor, cut.gross_gbp_minor)
        self.assertGreater(full.amount_gbp_minor, cut.amount_gbp_minor)  # the platform absorbs it
        self.assertLessEqual(full.amount_gbp_minor, full.gross_gbp_minor)  # never more than was paid

    def test_console_rules_preview_and_settings(self, _s):
        self.client.force_login(self.staff)
        post = lambda body: self.client.post(f"{API}/console/commissions/rules", data=body,  # noqa: E731
                                             content_type="application/json")  # fmt: skip
        self.assertEqual(post({"scope": "course", "keeps_pct": 80}).status_code, 400)  # target needed
        self.assertEqual(post({"scope": "price_band", "keeps_pct": 80, "band_min_gbp_minor": 5000,
                               "band_max_gbp_minor": 1000}).status_code, 400)  # fmt: skip
        self.assertEqual(
            post({"scope": "course", "keeps_pct": 120, "target_id": str(self.py.id)}).status_code, 422
        )
        r = post({"name": "Launch deal", "scope": "course", "keeps_pct": 80, "target_id": str(self.py.id)})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["target_label"], r.json()["is_live"]), ("Python", True))
        with tenant_context(staff=True):
            self.assertTrue(Notification.objects.filter(user=self.tom, kind="commission_changed").exists())
        preview = self.client.get(f"{API}/console/commissions/preview?course_id={self.py.id}").json()
        self.assertEqual(
            (preview["keeps_pct"], preview["source"], preview["rule_name"]), (80.0, "rule", "Launch deal")
        )
        rule_id = r.json()["id"]
        body = {"name": "Launch deal", "scope": "course", "keeps_pct": 80, "target_id": str(self.py.id),
                "is_active": False}  # fmt: skip
        self.client.put(
            f"{API}/console/commissions/rules/{rule_id}", data=body, content_type="application/json"
        )
        preview = self.client.get(f"{API}/console/commissions/preview?course_id={self.py.id}").json()
        self.assertEqual(preview["source"], "default")

        s = self.client.put(f"{API}/console/commissions/settings", data={"pool_pct": 15, "default_keeps_pct": 70,
                            "discount_reduces_commission": False}, content_type="application/json").json()  # fmt: skip
        self.assertEqual(
            (s["pool_pct"], s["default_keeps_pct"], s["discount_reduces_commission"]), (15.0, 70.0, False)
        )
        row = self.client.get(f"{API}/console/commissions/instructors?q=tom").json()["items"][0]
        self.assertEqual((row["courses"], row["keeps_pct"]), (2, 70.0))
        keeps = self.client.put(f"{API}/console/commissions/instructors/{self.tom.id}", data={"keeps_pct": 75},
                                content_type="application/json").json()  # fmt: skip
        self.assertEqual((keeps["platform_fee_pct"], keeps["fee_is_custom"]), (25.0, True))
        actions = {a["action"] for a in self.client.get(f"{API}/console/audit").json()["items"]}
        self.assertTrue(
            {"commission_rule.create", "commission_rule.update", "commissions.settings"} <= actions
        )
