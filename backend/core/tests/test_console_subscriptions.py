"""M5 P8: plans with included courses (enforced when a subscriber enrols), Stripe prices,
deactivate / duplicate, subscribers, cancellation and the plan-change log from webhooks."""

from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.commerce import services
from apps.commerce.models import Plan, PlanCourse, PlanPrice, Subscription, SubscriptionEvent
from apps.commerce.tests.test_commerce import CommerceBase, fake_session
from apps.engagement.models import Notification
from core.errors import ServiceError
from core.tenancy import tenant_context

API = "/api/v1/console"


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class ConsoleSubscriptionsTest(CommerceBase):
    def subscribe(self, plan):
        with tenant_context(user_id=self.sara.id):
            sub = services.start_subscription(user=self.sara, plan=plan, currency="GBP")["subscription"]
        end = int((timezone.now() + timedelta(days=30)).timestamp())
        meta = {"kind": "subscription", "id": str(sub.id)}
        self.deliver({"id": "evt_s1", "type": "checkout.session.completed",
                      "data": {"object": {"metadata": meta, "subscription": "sub_1"}}})  # fmt: skip
        self.deliver({"id": "evt_s2", "type": "customer.subscription.updated", "data": {"object": {
            "id": "sub_1", "status": "active", "metadata": meta,
            "items": {"data": [{"quantity": 1, "current_period_end": end, "price": {"id": "price_1"}}]}}}})  # fmt: skip
        return sub, meta, end

    @mock.patch("apps.commerce.gateway.create_price", return_value="price_new")
    def test_plan_with_included_courses_limits_what_subscribers_get(self, create_price, _s):
        self.client.force_login(self.staff)
        r = self.client.post(f"{API}/plans", {
            "name": "SQL plan", "code": "sql-monthly", "description": "Only SQL", "interval": "month",
            "renewal": "automatic", "course_ids": [str(self.sql.id)],
            "prices": [{"currency": "GBP", "amount_minor": 999, "create_stripe_price": True}],
        }, content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        create_price.assert_called_once()
        self.assertEqual(create_price.call_args.kwargs["unit_amount"], 999)
        plan_id = r.json()["id"]
        row = next(p for p in self.client.get(f"{API}/plans").json() if p["id"] == plan_id)
        self.assertEqual(row["included_courses"], 1)
        self.assertEqual(row["prices"][0]["stripe_price_id"], "price_new")
        with tenant_context(**self.STAFF):
            plan = Plan.objects.get(pk=plan_id)
            PlanPrice.objects.filter(plan=plan).update(stripe_price_id="price_1")
        sub, _, _ = self.subscribe(plan)
        with tenant_context(user_id=self.sara.id):
            services.enrol_with_plan(user=self.sara, course=self.sql)
            with self.assertRaises(ServiceError) as e:
                services.enrol_with_plan(
                    user=self.sara, course=self.python
                )  # in_subscription, not in this plan
            self.assertEqual(e.exception.code, "not_in_plan")
        with tenant_context(**self.STAFF):
            self.assertTrue(SubscriptionEvent.objects.filter(subscription=sub, kind="created").exists())
            self.assertTrue(Notification.objects.filter(user=self.sara, kind="subscription_started").exists())
        # an empty list: back to every course marked for plans (M1 behaviour)
        self.client.put(f"{API}/plans/{plan_id}/courses", {"course_ids": []}, content_type="application/json")
        with tenant_context(**self.STAFF):
            self.assertFalse(PlanCourse.objects.filter(plan_id=plan_id).exists())
        with tenant_context(user_id=self.sara.id):
            services.enrol_with_plan(user=self.sara, course=self.python)

    def test_deactivate_duplicate_cancel_and_events(self, _s):
        with tenant_context(**self.STAFF):
            plan = Plan.objects.create(
                code="personal", name="Personal", audience="personal", interval="month"
            )
            PlanPrice.objects.create(
                plan=plan, currency_id="GBP", amount_minor=1999, stripe_price_id="price_1"
            )
        sub, meta, end = self.subscribe(plan)
        self.client.force_login(self.staff)
        r = self.client.post(
            f"{API}/plans/{plan.id}/status", {"is_active": False}, content_type="application/json"
        )
        self.assertEqual(r.json()["error"]["code"], "reason_required")
        r = self.client.post(f"{API}/plans/{plan.id}/status", {"is_active": False, "reason": "Replaced"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200)
        copy = self.client.post(f"{API}/plans/{plan.id}/duplicate").json()["id"]
        with tenant_context(**self.STAFF):
            c = Plan.objects.get(pk=copy)
            self.assertFalse(c.is_active)
            self.assertEqual(c.prices.get().amount_minor, 1999)
            self.assertEqual(c.prices.get().stripe_price_id, "")
        subs = self.client.get(f"{API}/subscribers").json()["items"]
        self.assertEqual(subs[0]["status"], "active")
        with mock.patch("apps.commerce.gateway.cancel_at_period_end") as cancel:
            r = self.client.post(f"{API}/subscribers/{sub.id}/cancel", {"reason": "Asked by phone"},
                                 content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        cancel.assert_called_once_with("sub_1")
        # Stripe then confirms: no second "cancelled" entry
        self.deliver({"id": "evt_s3", "type": "customer.subscription.updated", "data": {"object": {
            "id": "sub_1", "status": "active", "metadata": meta, "cancel_at_period_end": True,
            "items": {"data": [{"quantity": 1, "current_period_end": end, "price": {"id": "price_1"}}]}}}})  # fmt: skip
        self.deliver({"id": "evt_s4", "type": "invoice.payment_failed",
                      "data": {"object": {"id": "in_f", "subscription": "sub_1", "amount_due": 1999}}})  # fmt: skip
        with tenant_context(**self.STAFF):
            kinds = list(SubscriptionEvent.objects.filter(subscription=sub).values_list("kind", flat=True))
            self.assertEqual(sorted(kinds), ["cancelled", "created", "payment_failed"])
            self.assertTrue(Subscription.objects.get(pk=sub.pk).cancel_at_period_end)
            self.assertTrue(
                Notification.objects.filter(user=self.sara, kind="subscription_cancelled").exists()
            )
            self.assertTrue(
                Notification.objects.filter(user=self.sara, kind="subscription_payment_failed").exists()
            )
        events = self.client.get(f"{API}/subscription-events?kind=cancelled").json()["items"]
        self.assertEqual(len(events), 1)
        overview = self.client.get(f"{API}/subscriptions/overview").json()
        self.assertEqual(overview["kpis"]["active"]["value"], 1)


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class ExtraStripeEventsTest(CommerceBase):
    """The events added in Stripe on 2026-11-08: failed delayed payments, paused /
    resumed subscriptions, trial ending; invoice_payment.paid and payout.paid are ignored."""

    def test_failed_delayed_payment_closes_the_order(self, _s):
        from apps.commerce.models import Order

        with tenant_context(user_id=self.sara.id):
            order = services.create_order(user=self.sara, course_ids=[self.python.id], currency="GBP")[
                "order"
            ]
        failed = {"id": "evt_f1", "type": "checkout.session.async_payment_failed",
                  "data": {"object": {"metadata": {"kind": "order", "id": str(order.id)}}}}  # fmt: skip
        self.assertEqual(self.deliver(failed), "processed")
        with tenant_context(**self.STAFF):
            self.assertEqual(Order.objects.get(pk=order.pk).status, "failed")
            self.assertEqual(
                Notification.objects.filter(user=self.sara, kind="order_payment_failed").count(), 1
            )
        self.deliver({**failed, "id": "evt_f2"})  # a repeat changes nothing and tells nobody again
        with tenant_context(**self.STAFF):
            self.assertEqual(
                Notification.objects.filter(user=self.sara, kind="order_payment_failed").count(), 1
            )

    def test_paused_resumed_and_trial_ending(self, _s):
        with tenant_context(**self.STAFF):
            plan = Plan.objects.create(
                code="personal", name="Personal", audience="personal", interval="month"
            )
            PlanPrice.objects.create(
                plan=plan, currency_id="GBP", amount_minor=1999, stripe_price_id="price_1"
            )
        with tenant_context(user_id=self.sara.id):
            sub = services.start_subscription(user=self.sara, plan=plan, currency="GBP")["subscription"]
        meta = {"kind": "subscription", "id": str(sub.id)}
        end = int((timezone.now() + timedelta(days=30)).timestamp())
        self.deliver({"id": "evt_p0", "type": "checkout.session.completed",
                      "data": {"object": {"metadata": meta, "subscription": "sub_9"}}})  # fmt: skip

        def event(eid, kind, status, **extra):
            return {"id": eid, "type": kind, "data": {"object": {
                "id": "sub_9", "status": status, "metadata": meta, **extra,
                "items": {"data": [{"quantity": 1, "current_period_end": end, "price": {"id": "price_1"}}]}}}}  # fmt: skip

        trial_end = int((timezone.now() + timedelta(days=3)).timestamp())
        self.deliver(event("evt_p1", "customer.subscription.created", "trialing", trial_end=trial_end))
        self.deliver(event("evt_p2", "customer.subscription.trial_will_end", "trialing", trial_end=trial_end))
        self.deliver(event("evt_p3", "customer.subscription.paused", "paused"))
        with tenant_context(**self.STAFF):
            self.assertEqual(Subscription.objects.get(pk=sub.pk).status, "paused")
        self.deliver(event("evt_p4", "customer.subscription.resumed", "active"))
        self.deliver({"id": "evt_p5", "type": "invoice_payment.paid", "data": {"object": {"id": "inpay_1"}}})
        self.deliver({"id": "evt_p6", "type": "payout.paid", "data": {"object": {"id": "po_1"}}})
        with tenant_context(**self.STAFF):
            self.assertEqual(Subscription.objects.get(pk=sub.pk).status, "active")
            kinds = set(Notification.objects.filter(user=self.sara).values_list("kind", flat=True))
            self.assertTrue(
                {"subscription_trial_ending", "subscription_paused", "subscription_resumed"} <= kinds
            )
            trial = Notification.objects.get(user=self.sara, kind="subscription_trial_ending")
            when = timezone.now() + timedelta(days=3)
            self.assertIn(f"{when.day} {when:%b %Y}", trial.body)  # the trial's end, not the period's
