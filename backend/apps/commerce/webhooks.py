"""Stripe webhooks: the only way an order becomes paid or a subscription active.

    1. verify the signature on the RAW body (gateway.construct_event)
    2. store the event once (unique event id): a redelivery is acknowledged and ignored
    3. process it in its own transaction; on failure the error is saved and Stripe
       retries later (it redelivers for up to 3 days)

Runs as a platform job (staff RLS context): the request has no logged-in user.
"""

import logging
from datetime import UTC, datetime

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.platform import services as platform
from core.tenancy import tenant_context

from . import gateway, services
from .models import (
    AddonSubscription,
    Invoice,
    Order,
    Payment,
    Plan,
    PlanPrice,
    Promotion,
    StripeEvent,
    Subscription,
    SubscriptionEvent,
)

log = logging.getLogger(__name__)


def _ts(value) -> datetime | None:
    return datetime.fromtimestamp(value, tz=UTC) if value else None


def handle(payload: bytes, signature: str) -> str:
    event = gateway.construct_event(payload, signature)
    with tenant_context(staff=True):
        row, created = StripeEvent.objects.get_or_create(
            event_id=event["id"], defaults={"type": event["type"], "payload": event}
        )
        if not created and row.processed_at:
            return "duplicate"
    try:
        with tenant_context(staff=True):
            dispatch(event)
            StripeEvent.objects.filter(pk=row.pk).update(processed_at=timezone.now(), error="")
    except Exception as exc:
        log.exception("stripe event %s failed", event["id"])
        with tenant_context(staff=True):
            StripeEvent.objects.filter(pk=row.pk).update(error=str(exc)[:2000])
        raise
    return "processed"


def dispatch(event: dict) -> None:
    obj = event["data"]["object"]
    kind = event["type"]
    meta = obj.get("metadata") or {}
    if kind in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        _session_completed(obj, meta)
    elif kind == "checkout.session.expired" and meta.get("kind") == "order":
        services.expire_order(order_id=meta["id"])
    elif kind == "checkout.session.expired" and meta.get("kind") in ("corporate_recorded", "corporate_live"):
        from apps.corporate.fulfillment import expire_purchase

        expire_purchase(obj, meta)
    elif kind == "checkout.session.async_payment_failed" and meta.get("kind") == "order":
        services.fail_order(order_id=meta["id"])
    elif kind == "checkout.session.async_payment_failed" and meta.get("kind") in (
        "corporate_recorded",
        "corporate_live",
    ):
        from apps.corporate.fulfillment import fail_purchase

        fail_purchase(obj, meta)
    elif kind.startswith("customer.subscription."):
        # created / updated / deleted / paused / resumed / pending_update_* / trial_will_end:
        # each carries the whole subscription, so access always follows its status
        _subscription_changed(obj, meta)
        _subscription_notice(kind, obj, meta)
    elif kind == "invoice.paid":
        _invoice_paid(obj)
    elif kind == "invoice.payment_failed":
        _invoice_failed(obj)
    elif kind == "charge.succeeded":
        _charge_succeeded(obj)
    # every other event type is stored and ignored, on purpose:
    # - invoice_payment.paid repeats invoice.paid (which carries the invoice we keep)
    # - payout.paid is Stripe paying the platform's own bank account; instructor payouts
    #   are recorded in Console > Payouts, not by Stripe


def _session_completed(session: dict, meta: dict) -> None:
    if meta.get("kind") == "order":
        if session.get("payment_status") != "paid":
            return  # e.g. bank transfer still pending: async_payment_succeeded follows
        services.fulfil_order(
            order_id=meta["id"],
            payment_intent=session.get("payment_intent") or "",
            amount_minor=session.get("amount_total"),
            currency=session.get("currency") or "",
        )
    elif meta.get("kind") == "cash_package":
        _fulfil_cash_package(session, meta)
    elif meta.get("kind") == "token_pack":
        _fulfil_token_pack(session, meta)
    elif meta.get("kind") == "token_topup":
        _fulfil_token_topup(session, meta)
    elif meta.get("kind") == "corporate_recorded":
        if session.get("payment_status") != "paid":
            return
        from apps.corporate.fulfillment import fulfil_recorded_purchase

        fulfil_recorded_purchase(session, meta)
    elif meta.get("kind") == "corporate_live":
        if session.get("payment_status") != "paid":
            return
        from apps.corporate.live_checkout import fulfil_live_purchase

        fulfil_live_purchase(session, meta)
    elif meta.get("kind") in ("subscription", "addon"):
        model = Subscription if meta["kind"] == "subscription" else AddonSubscription
        linked = model.objects.filter(pk=meta["id"], stripe_subscription_id__isnull=True).update(
            stripe_subscription_id=session.get("subscription"), updated_at=timezone.now()
        )
        services.remember_customer(
            kind=meta["kind"], row_id=meta["id"], customer=session.get("customer") or ""
        )
        if linked and meta["kind"] == "subscription":
            if meta.get("promotion"):  # usage of a subscription promotion
                Promotion.objects.filter(pk=meta["promotion"]).update(redeemed_count=F("redeemed_count") + 1)
            sub = Subscription.objects.select_related("plan").filter(pk=meta["id"]).first()
            if sub and sub.plan.renewal == "manual" and session.get("subscription"):
                # a plan that renews by hand: Stripe stops at the end of the period
                gateway.cancel_at_period_end(session["subscription"])
                Subscription.objects.filter(pk=sub.pk).update(cancel_at_period_end=True)


def _period_end(sub: dict):
    # Newer Stripe API versions keep the period on each subscription item
    end = sub.get("current_period_end")
    if end is None:
        items = (sub.get("items") or {}).get("data") or []
        end = max((i.get("current_period_end") or 0) for i in items) if items else None
    return _ts(end)


@transaction.atomic
def _subscription_changed(sub: dict, meta: dict) -> None:
    model = AddonSubscription if meta.get("kind") == "addon" else Subscription
    row = model.objects.select_for_update().filter(stripe_subscription_id=sub["id"]).first()
    if row is None and meta.get("id"):
        row = model.objects.select_for_update().filter(pk=meta["id"]).first()
    if row is None:
        log.warning("subscription %s not ours", sub["id"])
        return
    before = {"status": row.status, "seats": getattr(row, "seats", None),
              "cancel": getattr(row, "cancel_at_period_end", False), "plan": getattr(row, "plan_id", None)}  # fmt: skip
    row.stripe_subscription_id = sub["id"]
    row.status = sub.get("status", row.status)
    row.current_period_end = _period_end(sub) or row.current_period_end
    fields = ["stripe_subscription_id", "status", "current_period_end", "updated_at"]
    if model is Subscription:
        row.cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
        row.canceled_at = _ts(sub.get("canceled_at"))
        items = (sub.get("items") or {}).get("data") or []
        if items and items[0].get("quantity"):
            row.seats = items[0]["quantity"]
        price_id = ((items[0].get("price") or {}).get("id") if items else None) or ""
        new_plan = (
            PlanPrice.objects.filter(stripe_price_id=price_id).values_list("plan_id", flat=True).first()
        )
        if new_plan:
            row.plan_id = new_plan
        fields += ["cancel_at_period_end", "canceled_at", "seats", "plan"]
    row.save(update_fields=fields)
    if model is Subscription:
        _record_changes(row, before)
    active = row.status in ("trialing", "active", "past_due")
    ends = row.current_period_end if active else timezone.now()
    if model is Subscription:
        services.sync_subscription_access(row.id, ends)
        feature = "business" if row.plan.audience == "team" else "personal_plan"
        source, seats = "subscription", row.seats
    else:
        feature, source, seats = row.addon.code, "addon", None
    platform.sync_entitlement(
        feature=feature, source=source, source_ref=row.id, active=active, ends_at=ends,
        org_id=row.org_id, user_id=None if row.org_id else row.user_id, seats_count=seats,
    )  # fmt: skip


LIVE = ("trialing", "active", "past_due")
NOTICES = {
    "customer.subscription.paused": "paused",
    "customer.subscription.resumed": "resumed",
    "customer.subscription.trial_will_end": "trial_ending",
}


def _subscription_notice(kind: str, sub: dict, meta: dict) -> None:
    """Paused, resumed and trial-ending notices (plans only; add-ons have none)."""
    what = NOTICES.get(kind)
    if what is None or meta.get("kind") == "addon":
        return
    row = Subscription.objects.select_related("plan").filter(stripe_subscription_id=sub["id"]).first()
    if row is not None:
        services.subscription_notice(
            row, what, date=_ts(sub.get("trial_end")) if what == "trial_ending" else None
        )


def _record_changes(row: Subscription, before: dict) -> None:
    """The plan-change log (console > Subscriptions) and the subscriber's notices."""
    started = before["status"] not in LIVE and row.status in ("trialing", "active")
    if started and not SubscriptionEvent.objects.filter(subscription=row, kind="created").exists():
        services.subscription_event(row, SubscriptionEvent.Kind.CREATED, to_value=row.plan.code)
        services.subscription_notice(row, "started")
    if before["plan"] and row.plan_id != before["plan"]:
        old = PlanPrice.objects.filter(plan_id=before["plan"], currency_id=row.currency_id).first()
        new = PlanPrice.objects.filter(plan_id=row.plan_id, currency_id=row.currency_id).first()
        up = bool(old and new and new.amount_minor >= old.amount_minor)
        codes = dict(Plan.objects.filter(pk__in=[before["plan"], row.plan_id]).values_list("id", "code"))
        services.subscription_event(
            row, SubscriptionEvent.Kind.UPGRADED if up else SubscriptionEvent.Kind.DOWNGRADED,
            from_value=codes.get(before["plan"], ""), to_value=codes.get(row.plan_id, ""),
        )  # fmt: skip
    if before["seats"] and row.seats != before["seats"] and not started:
        services.subscription_event(
            row, SubscriptionEvent.Kind.SEATS_CHANGED, from_value=before["seats"], to_value=row.seats
        )
    ended = row.status == "canceled" and before["status"] != "canceled"
    if not before["cancel"] and (row.cancel_at_period_end or ended):
        services.subscription_event(row, SubscriptionEvent.Kind.CANCELLED, from_value=row.plan.code)
        services.subscription_notice(row, "cancelled")


def _subscription_of(inv: dict) -> Subscription | None:
    sub_id = inv.get("subscription") or (
        ((inv.get("parent") or {}).get("subscription_details") or {}).get("subscription")
    )
    return Subscription.objects.filter(stripe_subscription_id=sub_id).first() if sub_id else None


def _order_invoice(inv: dict) -> None:
    """A paid order's Stripe invoice (Checkout invoice_creation): staff download its PDF."""
    meta = inv.get("metadata") or {}
    if meta.get("kind") != "order":
        return
    order = Order.objects.filter(pk=meta.get("id")).first()
    if order is None:
        return
    Invoice.objects.update_or_create(
        stripe_invoice_id=inv["id"],
        defaults={
            "user_id": order.user_id, "org_id": order.org_id, "order": order, "number": inv.get("number") or "",
            "currency_id": order.currency_id, "amount_minor": order.total_minor, "status": inv.get("status") or "paid",
            "hosted_url": inv.get("hosted_invoice_url") or "", "pdf_url": inv.get("invoice_pdf") or "",
            "issued_at": _ts(inv.get("created")) or timezone.now(),
        },
    )  # fmt: skip


def _charge_succeeded(charge: dict) -> None:
    """Card brand and last 4 digits for the console (Stripe never sends the full number)."""
    details = charge.get("payment_method_details") or {}
    kind = details.get("type") or ""
    card = (details.get(kind) or {}) if kind in ("card", "card_present") else {}
    fields = {"payment_method_type": kind[:32], "card_brand": (card.get("brand") or "")[:20],
              "card_last4": (card.get("last4") or "")[:4]}  # fmt: skip
    pi = charge.get("payment_intent") or ""
    meta = charge.get("metadata") or {}
    if meta.get("kind") == "order" and meta.get("id"):
        Order.objects.filter(pk=meta["id"]).update(**fields, updated_at=timezone.now())
    elif pi:
        Order.objects.filter(stripe_payment_intent_id=pi).update(**fields, updated_at=timezone.now())
    if pi:
        Payment.objects.filter(provider_ref=pi).update(**fields, updated_at=timezone.now())


def _invoice_failed(inv: dict) -> None:
    sub = _subscription_of(inv)
    if sub is None:
        return
    services.subscription_event(
        sub, SubscriptionEvent.Kind.PAYMENT_FAILED, amount_minor=inv.get("amount_due")
    )
    services.subscription_notice(sub, "payment_failed")


def _invoice_paid(inv: dict) -> None:
    meta = inv.get("metadata") or {}
    if meta.get("kind") == "corporate_quote":
        from apps.corporate.quotes import fulfil_quote

        fulfil_quote(inv)
        return
    sub = _subscription_of(inv)
    if sub is None:
        _order_invoice(inv)
        return
    if inv.get("billing_reason") == "subscription_cycle":
        services.subscription_event(
            sub, SubscriptionEvent.Kind.RENEWED, to_value=sub.plan.code, amount_minor=inv.get("amount_paid")
        )
        services.subscription_notice(sub, "renewed")
    Invoice.objects.update_or_create(
        stripe_invoice_id=inv["id"],
        defaults={
            "user_id": sub.user_id,
            "org_id": sub.org_id,
            "subscription": sub,
            "number": inv.get("number") or "",
            "currency_id": (inv.get("currency") or sub.currency_id).upper(),
            "amount_minor": inv.get("amount_paid") or 0,
            "status": inv.get("status") or "paid",
            "hosted_url": inv.get("hosted_invoice_url") or "",
            "pdf_url": inv.get("invoice_pdf") or "",
            "issued_at": _ts(inv.get("created")) or timezone.now(),
        },
    )


# ---------------------------------------------------------------- cash packages
def _fulfil_cash_package(session: dict, meta: dict) -> None:
    if session.get("payment_status") != "paid":
        return
    from . import packages

    course_ids_str = meta.get("course_ids", "")
    course_id_strs = [c.strip() for c in course_ids_str.split(",") if c.strip()]
    if not course_id_strs:
        log.warning("cash_package: no course_ids in session %s", session.get("id"))
        return
    packages.fulfil_package(
        session_id=session.get("id", ""),
        user_id=meta["user_id"],
        package_id=meta["id"],
        course_id_strs=course_id_strs,
    )


# ---------------------------------------------------------------- token top-ups
def _fulfil_token_pack(session: dict, meta: dict) -> None:
    if session.get("payment_status") != "paid":
        return
    from apps.commerce.models import TokenPack
    from apps.identity.models import User

    from . import wallet

    user = User.objects.filter(pk=meta["user_id"]).first()
    if user is None:
        log.warning("token_pack: user %s not found", meta.get("user_id"))
        return
    pack = TokenPack.objects.filter(pk=meta["id"]).first()
    token_amount = int(meta.get("token_amount") or (pack.token_amount if pack else 0))
    if token_amount <= 0:
        log.warning("token_pack: zero amount for session %s", session.get("id"))
        return
    amount_total = session.get("amount_total") or 0
    from decimal import ROUND_HALF_UP, Decimal

    if amount_total > 0 and token_amount > 0:
        unit_cost = (Decimal(str(amount_total)) / Decimal(str(token_amount))).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
    else:
        unit_cost = None
    wallet.grant_tokens(
        user=user,
        source="pack",
        amount=token_amount,
        unit_cost_gbp=unit_cost,
        source_ref=f"pack:{meta['id']}",
        stripe_session_id=session.get("id"),
        note=f"Pack: {pack.name}" if pack else "Token pack purchase",
    )


def _fulfil_token_topup(session: dict, meta: dict) -> None:
    if session.get("payment_status") != "paid":
        return
    from apps.identity.models import User

    from . import wallet

    user = User.objects.filter(pk=meta["user_id"]).first()
    if user is None:
        log.warning("token_topup: user %s not found", meta.get("user_id"))
        return
    token_amount = int(meta.get("token_amount", 0))
    if token_amount <= 0:
        log.warning("token_topup: zero amount for session %s", session.get("id"))
        return
    gbp_minor = int(meta.get("gbp_minor", 0))
    from decimal import ROUND_HALF_UP, Decimal

    if gbp_minor > 0 and token_amount > 0:
        unit_cost = (Decimal(str(gbp_minor)) / Decimal(str(token_amount))).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
    else:
        unit_cost = None
    wallet.grant_tokens(
        user=user,
        source="topup",
        amount=token_amount,
        unit_cost_gbp=unit_cost,
        source_ref=f"topup:{meta.get('rate_id', '')}",
        stripe_session_id=session.get("id"),
        note=f"Top-up {meta.get('amount_minor', '')} {meta.get('currency', 'GBP')} minor",
    )
