"""Commerce: natural prices, ECB rates and the drift rule, server-side quotes, checkout
through a signed webhook, idempotency, coupons, refunds, subscriptions, RLS.
Stripe itself is replaced at the gateway boundary; everything else is real."""

from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.db import DatabaseError, connection
from django.test import override_settings
from django.utils import timezone

from apps.catalog import services as cat
from apps.commerce import pricing, services, webhooks
from apps.commerce.models import (
    CartItem,
    Coupon,
    CoursePrice,
    Currency,
    FxRate,
    Order,
    Plan,
    PlanPrice,
    PriceTier,
    PriceTierAmount,
    Promotion,
    StripeEvent,
    Subscription,
)
from apps.identity.models import User
from apps.learning.models import Enrollment
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

ECB_XML = """<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<Cube><Cube time="2026-11-04">
<Cube currency="USD" rate="1.1600"/><Cube currency="JPY" rate="175.00"/><Cube currency="GBP" rate="0.8700"/>
<Cube currency="INR" rate="97.50"/></Cube></Cube></gesmes:Envelope>"""


def fake_session(**kw):
    return {"id": f"cs_test_{kw['metadata']['id']}", "url": "https://checkout.stripe.test/pay"}


class CommerceBase(SchemaTransactionTestCase):
    extra_course_lecture = False

    def setUp(self):
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        self.teacher = User.objects.create_user("teacher@learnhub-demo.com", "x", full_name="Tom Teacher")
        self.sara = User.objects.create_user("sara@demo.com", "x", full_name="Sara Ahmed")
        self.omar = User.objects.create_user("omar@demo.com", "x")
        self.STAFF = {"user_id": self.staff.id, "staff": True}
        with tenant_context(**self.STAFF):
            pricing.store_ecb_rates(*pricing.parse_ecb(ECB_XML))
            pricing.refresh_tier_amounts()
            self.tier5 = PriceTier.objects.get(name="Tier 5")  # £34.99
            self.python = self.course("python", tier=self.tier5)
            self.sql = self.course("sql", tier=PriceTier.objects.get(name="Tier 1"))
            self.free = self.course("intro", free=True)

    def course(self, slug, tier=None, free=False):
        c = cat.create_course(title=f"Course {slug}", slug=slug, ownership="platform", created_by=self.staff)
        sec = cat.add_section(version=c.versions.get(), title="Basics")
        cat.add_lecture(
            section=sec,
            kind="article",
            title="Read",
            body="<p>x</p>",
            token_price=1 if tier else None,
        )
        if self.extra_course_lecture:
            cat.add_lecture(
                section=sec,
                kind="article",
                title="Practice",
                body="<p>y</p>",
                token_price=1 if tier else None,
            )
        CoursePrice.objects.create(course=c, tier=tier, is_free=free)
        cat.submit(version=c.versions.get(), by=self.staff)
        c.refresh_from_db()
        return c

    def paid_event(self, order, *, event_id="evt_1", amount=None, currency=None):
        return {
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": order.stripe_session_id,
                    "payment_status": "paid",
                    "payment_intent": "pi_123",
                    "amount_total": order.total_minor if amount is None else amount,
                    "currency": (currency or order.currency_id).lower(),
                    "metadata": {"kind": "order", "id": str(order.id)},
                }
            },
        }

    def deliver(self, event):
        with mock.patch("apps.commerce.gateway.construct_event", return_value=event):
            return webhooks.handle(b"{}", "sig")


class PricingTest(CommerceBase):
    def test_natural_rounding(self):
        cases = [
            (Decimal("12.30"), 2, 1299),
            (Decimal("40.59"), 2, 4099),
            (Decimal("1234.50"), 2, 129900),  # ₹1,299
            (Decimal("4567"), 2, 459900),
            (Decimal("2345"), 0, 2399),  # ¥2,399
            (Decimal("4.2"), 3, 4990),  # KWD keeps the trailing zero Stripe needs
            (Decimal("0"), 2, 0),
        ]
        for amount, exp, expected in cases:
            self.assertEqual(pricing.natural_minor(amount, exp), expected, amount)

    def test_ecb_rebased_to_gbp_and_tiers_follow_with_drift_rule(self):
        with tenant_context(**self.STAFF):
            usd = FxRate.objects.get(currency_id="USD", rate_date=date(2026, 11, 4)).rate
            self.assertAlmostEqual(float(usd), 1.16 / 0.87, places=6)
            eur = FxRate.objects.get(currency_id="EUR").rate
            self.assertAlmostEqual(float(eur), 1 / 0.87, places=6)
            amt = lambda c: PriceTierAmount.objects.get(tier=self.tier5, currency_id=c).amount_minor  # noqa: E731
            self.assertEqual(amt("GBP"), 3499)
            self.assertEqual(amt("USD"), 4699)  # 34.99 x 1.3333 = 46.65 -> 46.99
            self.assertEqual(amt("JPY"), 7099)  # 34.99 x 201.15 = 7,038 -> ¥7,099

            # 3% FX move: prices stay put. 10% move: re-priced. Locked prices never move.
            pricing.set_tier_amount(tier=self.tier5, code="JPY", amount_minor=6900, lock=True)
            FxRate.objects.create(
                currency_id="USD", rate_date=date(2026, 11, 5), rate=usd * Decimal("1.03"), source="ecb"
            )
            pricing.refresh_tier_amounts()
            self.assertEqual(amt("USD"), 4699)
            FxRate.objects.create(
                currency_id="USD", rate_date=date(2026, 11, 6), rate=usd * Decimal("1.10"), source="ecb"
            )
            FxRate.objects.create(
                currency_id="JPY", rate_date=date(2026, 11, 6), rate=Decimal(260), source="ecb"
            )
            pricing.refresh_tier_amounts()
            self.assertEqual(amt("USD"), 5199)
            self.assertEqual(amt("JPY"), 6900)

    def test_manual_rates_only_for_non_ecb_currencies(self):
        with tenant_context(**self.STAFF):
            pricing.set_manual_rate(code="AED", rate=Decimal("4.85"))
            with self.assertRaises(ServiceError):
                pricing.set_manual_rate(code="USD", rate=Decimal("1.2"))
            Currency.objects.filter(code="AED").update(is_active=True)
            q = pricing.quote([self.python.id], "AED")  # no tier row yet: converted on the fly
            self.assertEqual(q[self.python.id]["list_minor"], 16900)  # 34.99 x 4.85 = 169.70 -> AED 169

    def test_quote_is_batched_and_applies_promotions(self):
        now = timezone.now()
        with tenant_context(**self.STAFF):
            Promotion.objects.create(
                name="Sale",
                percent_off=50,
                starts_at=now - timedelta(hours=1),
                ends_at=now + timedelta(days=1),
            )
        with tenant_context(user_id=self.sara.id):
            with self.assertNumQueries(4):
                q = pricing.quote([self.python.id, self.sql.id, self.free.id], "GBP")
        self.assertEqual(q[self.python.id], {"free": False, "list_minor": 3499, "sale_minor": 1799})
        self.assertTrue(q[self.free.id]["free"])

    def test_learners_cannot_change_reference_data(self):
        with tenant_context(user_id=self.sara.id):
            self.assertTrue(Currency.objects.filter(code="GBP").exists())  # readable
            with self.assertRaises(DatabaseError), connection.cursor() as cur:
                cur.execute("UPDATE commerce.price_tier_amounts SET amount_minor = 1")
                if cur.rowcount == 0:
                    raise DatabaseError("RLS hid every row")


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class CheckoutTest(CommerceBase):
    def test_paid_checkout_enrols_only_after_signed_webhook(self, _session):
        with tenant_context(user_id=self.sara.id):
            services.add_to_cart(user=self.sara, course_id=self.python.id)
            result = services.create_order(
                user=self.sara, course_ids=[self.python.id, self.sql.id], currency="USD"
            )
            order = result["order"]
            self.assertEqual(result["checkout_url"], "https://checkout.stripe.test/pay")
            self.assertEqual(order.total_minor, 4699 + 1999)
            self.assertFalse(Enrollment.objects.filter(user=self.sara).exists())  # not before payment

        self.assertEqual(self.deliver(self.paid_event(order)), "processed")
        self.assertEqual(self.deliver(self.paid_event(order)), "duplicate")  # Stripe retry
        with tenant_context(user_id=self.sara.id):
            order.refresh_from_db()
            self.assertEqual(order.status, "paid")
            self.assertEqual(Enrollment.objects.filter(user=self.sara, source="purchase").count(), 2)
            self.assertFalse(CartItem.objects.filter(user=self.sara).exists())
            with self.assertRaises(ServiceError):  # cannot buy twice
                services.create_order(user=self.sara, course_ids=[self.python.id], currency="GBP")
        with tenant_context(user_id=self.omar.id):  # another person sees nothing of it
            self.assertFalse(Order.objects.exists())

    def test_amount_mismatch_is_refused_and_recorded(self, _session):
        with tenant_context(user_id=self.sara.id):
            order = services.create_order(user=self.sara, course_ids=[self.python.id], currency="GBP")[
                "order"
            ]
        with self.assertRaises(ServiceError), self.assertLogs("apps.commerce.webhooks", "ERROR"):
            self.deliver(self.paid_event(order, amount=1))
        with tenant_context(**self.STAFF):
            ev = StripeEvent.objects.get(event_id="evt_1")
            self.assertIsNone(ev.processed_at)
            self.assertIn("does not match", ev.error)
            self.assertEqual(Order.objects.get(pk=order.pk).status, "pending")

    def test_free_course_and_full_coupon_need_no_payment(self, session):
        now = timezone.now()
        with tenant_context(**self.STAFF):
            Coupon.objects.create(
                code="LAUNCH100",
                course=self.python,
                percent_off=100,
                max_redemptions=1,
                starts_at=now,
                created_by=self.teacher,
            )
        with tenant_context(user_id=self.sara.id):
            r = services.create_order(user=self.sara, course_ids=[self.free.id], currency="GBP")
            self.assertIsNone(r["checkout_url"])
            r = services.create_order(
                user=self.sara, course_ids=[self.python.id], currency="EUR", coupon_code="launch100"
            )
            self.assertEqual(r["order"].status, "paid")
            self.assertEqual(Enrollment.objects.filter(user=self.sara).count(), 2)
        session.assert_not_called()
        with tenant_context(user_id=self.omar.id), self.assertRaises(ServiceError):
            services.create_order(
                user=self.omar, course_ids=[self.python.id], currency="GBP", coupon_code="LAUNCH100"
            )

    def test_refund_within_window_removes_access(self, _session):
        with tenant_context(user_id=self.sara.id):
            order = services.create_order(
                user=self.sara, course_ids=[self.python.id, self.sql.id], currency="GBP"
            )["order"]
        self.deliver(self.paid_event(order))
        with (
            tenant_context(user_id=self.sara.id),
            mock.patch("apps.commerce.gateway.refund", return_value="re_1") as refund,
        ):
            item = order.items.get(course=self.python)
            services.request_refund(item=item, by=self.sara, reason="Not for me")
            refund.assert_called_once()
            self.assertEqual(refund.call_args.kwargs["amount"], 3499)
            self.assertEqual(Enrollment.objects.get(user=self.sara, course=self.python).status, "revoked")
            self.assertEqual(Order.objects.get(pk=order.pk).status, "partially_refunded")
            with self.assertRaises(ServiceError):
                services.request_refund(item=item, by=self.sara)
            Order.objects.filter(pk=order.pk).update(paid_at=timezone.now() - timedelta(days=31))
            with self.assertRaises(ServiceError):
                services.request_refund(item=order.items.get(course=self.sql), by=self.sara)

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_test")
    def test_webhook_endpoint_rejects_bad_signatures(self, _session):
        resp = self.client.post(
            "/api/v1/commerce/webhooks/stripe", data=b'{"id":"evt_x"}', content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=bad",
        )  # fmt: skip
        self.assertEqual(resp.status_code, 400)
        with tenant_context(**self.STAFF):
            self.assertFalse(StripeEvent.objects.exists())


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class SubscriptionTest(CommerceBase):
    def test_personal_plan_access_follows_the_subscription(self, _session):
        with tenant_context(**self.STAFF):
            plan = Plan.objects.create(
                code="personal-monthly", name="Personal", audience="personal", interval="month"
            )
            PlanPrice.objects.create(
                plan=plan, currency_id="GBP", amount_minor=1999, stripe_price_id="price_1"
            )
        with tenant_context(user_id=self.sara.id):
            sub = services.start_subscription(user=self.sara, plan=plan, currency="GBP")["subscription"]
            with self.assertRaises(ServiceError):
                services.enrol_with_plan(user=self.sara, course=self.python)
        end = int((timezone.now() + timedelta(days=30)).timestamp())
        meta = {"kind": "subscription", "id": str(sub.id)}
        self.deliver({"id": "evt_s1", "type": "checkout.session.completed",
                      "data": {"object": {"metadata": meta, "subscription": "sub_1"}}})  # fmt: skip
        self.deliver({"id": "evt_s2", "type": "customer.subscription.updated", "data": {"object": {
            "id": "sub_1", "status": "active", "metadata": meta,
            "items": {"data": [{"quantity": 1, "current_period_end": end}]}}}})  # fmt: skip
        with tenant_context(user_id=self.sara.id):
            e = services.enrol_with_plan(user=self.sara, course=self.python)
            self.assertEqual(int(e.access_expires_at.timestamp()), end)
        self.deliver({"id": "evt_s3", "type": "customer.subscription.deleted", "data": {"object": {
            "id": "sub_1", "status": "canceled", "metadata": meta, "canceled_at": end - 100,
            "items": {"data": [{"quantity": 1, "current_period_end": end}]}}}})  # fmt: skip
        with tenant_context(user_id=self.sara.id):
            self.assertEqual(Subscription.objects.get(pk=sub.pk).status, "canceled")
            e.refresh_from_db()
            self.assertLessEqual(e.access_expires_at, timezone.now())
