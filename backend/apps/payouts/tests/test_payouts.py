"""Payouts: revenue share per channel, co-instructor splits, refunds as negative lines,
the refund hold, the monthly bundle, approval, the subscription pool and RLS."""

from datetime import date, timedelta
from unittest import mock

from django.db import DatabaseError, connection
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import CourseInstructor
from apps.commerce import pricing
from apps.commerce import services as shop
from apps.commerce.models import Coupon, CoursePrice, Invoice, Plan, PriceTier, Subscription
from apps.identity.models import User
from apps.learning import services as learning
from apps.payouts import selectors, services
from apps.payouts.models import Earning, Payout
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

ECB = """<x><Cube><Cube time="2026-11-04"><Cube currency="GBP" rate="0.87"/><Cube currency="USD" rate="1.16"/></Cube></Cube></x>"""


def restore_default_fee(staff_ctx):
    with tenant_context(**staff_ctx):
        services.set_default_fee(fee_bps=6300)


def fake_session(**kw):
    return {"id": f"cs_{kw['metadata']['id']}", "url": "https://pay.test"}


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class PayoutsTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        self.tom = User.objects.create_user("tom@teach.com", "x")
        self.ana = User.objects.create_user("ana@teach.com", "x")
        self.buyer = User.objects.create_user("buyer@demo.com", "x")
        self.STAFF = {"user_id": self.staff.id, "staff": True}
        with tenant_context(**self.STAFF):
            pricing.store_ecb_rates(*pricing.parse_ecb(ECB))
            pricing.refresh_tier_amounts()
            self.tier = PriceTier.objects.get(name="Tier 5")  # £34.99
        self.course = self.instructor_course(self.tom, "django", co=self.ana)
        self.solo = self.instructor_course(self.ana, "react")
        with tenant_context(**self.STAFF):
            self.platform = cat.create_course(
                title="Fire", slug="fire", ownership="platform", created_by=self.staff
            )
            sec = cat.add_section(version=self.platform.versions.get(), title="s")
            cat.add_lecture(section=sec, kind="article", title="r", body="<p>x</p>")
            cat.submit(version=self.platform.versions.get(), by=self.staff)
            CoursePrice.objects.create(course=self.platform, tier=self.tier)

    def instructor_course(self, owner, slug, co=None):
        with tenant_context(user_id=owner.id):
            c = cat.create_course(title=slug, slug=slug, ownership="instructor", created_by=owner)
            sec = cat.add_section(version=c.versions.get(), title="s")
            cat.add_lecture(section=sec, kind="article", title="r", body="<p>x</p>")
            cat.submit(version=c.versions.get(), by=owner)
            if co:  # 70/30 split between co-instructors
                CourseInstructor.objects.filter(course=c, user=owner).update(revenue_share_bps=7000)
                CourseInstructor.objects.create(course=c, user=co, revenue_share_bps=3000)
        with tenant_context(**self.STAFF):
            cat.approve(version=c.versions.get(), reviewer=self.staff)
            CoursePrice.objects.create(course=c, tier=self.tier)
            c.refresh_from_db()
        return c

    def buy(self, courses, coupon=None):
        with tenant_context(user_id=self.buyer.id):
            r = shop.create_order(
                user=self.buyer, course_ids=[c.id for c in courses], currency="GBP", coupon_code=coupon
            )
        order = r["order"]
        if order.status == "pending":
            with tenant_context(**self.STAFF):
                shop.fulfil_order(
                    order_id=order.id,
                    payment_intent=f"pi_{order.id}",
                    amount_minor=order.total_minor,
                    currency="gbp",
                )
        return order

    def lines(self, user):
        with tenant_context(user_id=user.id):
            return list(Earning.objects.filter(user=user).values_list("kind", "channel", "amount_gbp_minor"))

    def verify(self, user, method="stripe"):
        services.set_payout_account(
            user=user, method=method, stripe_account_id="acct_1", paypal_email="p@x.com"
        )
        with tenant_context(**self.STAFF):
            services.verify_account(account=user.payout_account)

    def test_sale_splits_by_channel_and_co_instructor(self, _s):
        self.buy([self.course, self.platform])  # platform course earns nobody anything
        self.assertEqual(self.lines(self.tom), [("sale", "marketplace", 906)])  # 3499 x 70% x 37%
        self.assertEqual(self.lines(self.ana), [("sale", "marketplace", 388)])  # 3499 x 30% x 37%
        with tenant_context(**self.STAFF):
            Coupon.objects.create(
                code="ANA50", course=self.solo, percent_off=50, starts_at=timezone.now(), created_by=self.ana
            )
        self.buy([self.solo], coupon="ANA50")  # £17.49, instructor's own coupon
        self.assertIn(("sale", "instructor_coupon", 1696), self.lines(self.ana))  # 1749 x 97%

    def test_instructor_fee_replaces_default_on_marketplace_only(self, _s):
        from apps.identity.models import InstructorProfile

        self.addCleanup(restore_default_fee, self.STAFF)  # revenue_shares survives between tests
        with tenant_context(**self.STAFF):
            services.set_default_fee(fee_bps=6300)  # the seeded default: 37% to the instructor
            self.assertEqual(services.default_fee_bps(), 6300)
            InstructorProfile.objects.create(user=self.ana, status="approved", platform_fee_bps=2000)
            services.set_default_fee(fee_bps=5000)  # a later default change leaves Ana's own fee alone
        self.buy([self.course])
        self.assertEqual(self.lines(self.tom), [("sale", "marketplace", 1224)])  # 3499 x 70% x 50%
        self.assertEqual(self.lines(self.ana), [("sale", "marketplace", 839)])  # 3499 x 30% x 80%
        with tenant_context(**self.STAFF):
            services.set_instructor_fee(user_id=self.ana.id, fee_bps=None)  # back to the default
            self.assertRaises(ServiceError, services.set_instructor_fee, user_id=self.ana.id, fee_bps=10001)
            Coupon.objects.create(
                code="ANA50", course=self.solo, percent_off=50, starts_at=timezone.now(), created_by=self.ana
            )
        self.buy([self.solo], coupon="ANA50")
        self.assertIn(("sale", "instructor_coupon", 1696), self.lines(self.ana))  # coupon rate untouched
        with tenant_context(user_id=self.ana.id):  # the rate is stored on the line: history never changes
            self.assertEqual(Earning.objects.get(user=self.ana, channel="marketplace").share_bps, 8000)

    def test_refund_hold_bundle_minimum_and_approval(self, _s):
        order = self.buy([self.solo])
        self.verify(self.ana)
        now = timezone.now()
        self.assertEqual(services.create_payouts(period_end=date(2026, 11, 30), now=now), [])  # still on hold
        with tenant_context(user_id=self.ana.id):
            self.assertEqual(
                selectors.balance(user_id=self.ana.id),
                {"available": 0, "pending": 1294, "paid": 0, "in_payout": 0},
            )

        # refund inside the window: a negative line that cancels the sale in the same bundle
        with (
            tenant_context(user_id=self.buyer.id),
            mock.patch("apps.commerce.gateway.refund", return_value="re_1"),
        ):
            shop.request_refund(item=order.items.get(), by=self.buyer)
        self.assertEqual(sorted(a for _, _, a in self.lines(self.ana)), [-1294, 1294])

        # two more sales, then after the hold: £25.88 >= £25 minimum -> one payout
        self.buy([self.course])  # Ana earns 388
        self.buyer = User.objects.create_user("b2@demo.com", "x")
        self.buy([self.course])  # and 388 again
        later = now + timedelta(days=31)
        self.assertEqual(services.create_payouts(period_end=date(2026, 12, 31), now=later), [])  # 776 < 2500
        with tenant_context(**self.STAFF):
            Earning.objects.create(
                user=self.ana, kind="adjustment", course=self.solo, channel="marketplace", gross_gbp_minor=0,
                share_bps=0, amount_gbp_minor=2000, earned_at=now, available_at=now, note="Launch bonus",
            )  # fmt: skip
        made = services.create_payouts(period_end=date(2026, 12, 31), now=later)
        self.assertEqual(len(made), 1)
        self.assertEqual(services.create_payouts(period_end=date(2026, 12, 31), now=later), [])  # idempotent
        with (
            tenant_context(**self.STAFF),
            mock.patch("apps.commerce.gateway.transfer", return_value="tr_1") as tr,
        ):
            p = Payout.objects.get(pk=made[0])
            self.assertEqual(p.amount_gbp_minor, 2776)  # 1294 - 1294 + 388 + 388 + 2000
            services.approve_payout(payout=p, by=self.staff)
            tr.assert_called_once()
            with self.assertRaises(ServiceError):
                services.approve_payout(payout=p, by=self.staff)
        with tenant_context(user_id=self.ana.id):
            self.assertEqual(selectors.balance(user_id=self.ana.id)["paid"], 2776)

    def test_unverified_accounts_are_not_paid_and_failures_roll_over(self, _s):
        self.buy([self.solo])
        later = timezone.now() + timedelta(days=31)
        with tenant_context(**self.STAFF):
            Earning.objects.filter(user=self.ana).update(amount_gbp_minor=3000)
        services.set_payout_account(user=self.ana, method="paypal", paypal_email="ana@pay.com")
        self.assertEqual(services.create_payouts(period_end=date(2026, 12, 31), now=later), [])
        with tenant_context(**self.STAFF):
            services.verify_account(account=self.ana.payout_account)
        made = services.create_payouts(period_end=date(2026, 12, 31), now=later)
        with tenant_context(**self.STAFF):
            p = Payout.objects.get(pk=made[0])
            with self.assertRaises(ServiceError):  # PayPal needs the reference
                services.approve_payout(payout=p, by=self.staff)
            services.fail_payout(payout=p, reason="PayPal account closed")
            self.assertFalse(Earning.objects.filter(payout=p).exists())
        self.assertEqual(len(services.create_payouts(period_end=date(2027, 1, 31), now=later)), 1)

    def test_instructors_read_only_their_own_ledger(self, _s):
        self.buy([self.course])
        with tenant_context(user_id=self.tom.id):
            self.assertEqual(Earning.objects.count(), 1)  # Ana's line is invisible to Tom
            with self.assertRaises(DatabaseError), connection.cursor() as cur:
                cur.execute("UPDATE payouts.earnings SET amount_gbp_minor = 999999")
                if cur.rowcount == 0:
                    raise DatabaseError("no rows writable")
            with self.assertRaises(DatabaseError):
                with connection.cursor() as cur:
                    cur.execute("SAVEPOINT s")
                    try:
                        cur.execute(
                            "INSERT INTO payouts.earnings (id, created_at, updated_at, user_id, kind, course_id, channel,"
                            " gross_gbp_minor, share_bps, amount_gbp_minor, earned_at, available_at, note)"
                            " VALUES (uuidv7(), now(), now(), %s, 'adjustment', %s, 'marketplace', 0, 0, 100000, now(), now(), '')",
                            [self.tom.id, self.course.id],
                        )
                    finally:
                        cur.execute("ROLLBACK TO SAVEPOINT s")

    def test_subscription_pool_split_by_minutes(self, _s):
        month = date(2026, 10, 1)
        with tenant_context(**self.STAFF):
            plan = Plan.objects.create(code="p", name="Personal", audience="personal", interval="month")
            sub = Subscription.objects.create(user=self.buyer, plan=plan, currency_id="GBP", status="active",
                                              current_period_end=timezone.now() + timedelta(days=20))  # fmt: skip
            Invoice.objects.create(user=self.buyer, subscription=sub, stripe_invoice_id="in_1", currency_id="GBP",
                                   amount_minor=100000, status="paid", issued_at=timezone.make_aware(
                                       timezone.datetime(2026, 10, 3)))  # fmt: skip
        with tenant_context(user_id=self.buyer.id):
            e1 = learning.enrol(user=self.buyer, course=self.course, source="subscription", source_ref=sub.id)
            e2 = learning.enrol(user=self.buyer, course=self.solo, source="subscription", source_ref=sub.id)
        with tenant_context(**self.STAFF), connection.cursor() as cur:
            for e, secs in ((e1, 3000), (e2, 1000)):
                cur.execute(
                    "INSERT INTO learning.progress_events (created_at, enrollment_id, org_id, user_id, course_id,"
                    " lecture_key, seconds) VALUES ('2026-10-10', %s, NULL, %s, %s, uuidv7(), %s)",
                    [e.id, self.buyer.id, e.course_id, secs],
                )
        self.assertEqual(services.settle_subscription_pool(month), 3)
        self.assertEqual(services.settle_subscription_pool(month), 0)  # once per month
        # pool 25% of £1,000; django 75% of minutes (Tom 70 / Ana 30), react 25% (Ana)
        self.assertEqual(self.lines(self.tom), [("subscription", "subscription_pool", 13125)])
        self.assertEqual(sorted(a for *_, a in self.lines(self.ana)), [5625, 6250])
