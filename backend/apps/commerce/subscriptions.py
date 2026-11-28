"""B2C-07 — Unlimited personal subscription service.

Handles listing plans, creating checkout, and querying user's subscription state.
Lifecycle (create/cancel/renew) is managed by the existing webhook handler;
this module provides the learner-facing read + checkout layer.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.platform.services import audit

from . import gateway, promotions
from .models import Plan, PlanPrice, Promotion, Subscription

_PENDING_CHECKOUT_MAX_AGE = timedelta(hours=25)


def _first_payment_discount(amount_minor: int, percent_off: int) -> int:
    return int((Decimal(amount_minor) * percent_off / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def quote_subscription(*, user, plan_id: UUID, currency_code: str, promo_code: str = "") -> dict:
    """Read-only first-invoice quote; checkout rechecks and reserves the offer."""
    from core.errors import ServiceError

    pending = (
        Subscription.objects.filter(
            user=user,
            org__isnull=True,
            plan_id=plan_id,
            status="incomplete",
        )
        .order_by("-created_at")
        .first()
    )
    if pending:
        if pending.created_at < timezone.now() - _PENDING_CHECKOUT_MAX_AGE:
            try:
                expired = pending.stripe_session_id and (
                    gateway.retrieve_checkout_session(pending.stripe_session_id).get("status") == "expired"
                )
            except Exception as exc:
                raise ServiceError(
                    "checkout_pending", "We could not confirm the earlier checkout outcome.", status=409
                ) from exc
            if not expired:
                raise ServiceError(
                    "checkout_pending", "An earlier checkout needs support review.", status=409
                )
            pending = None
    if pending:
        snapshot = promotions.subscription_snapshot(pending.id)
        if snapshot and snapshot["promo_code"] == promo_code.strip().upper():
            return {
                "plan_id": plan_id,
                "currency": snapshot["currency"],
                "amount_minor": snapshot["amount_minor"],
                "discount_minor": snapshot["discount_minor"],
                "first_payment_minor": snapshot["amount_minor"] - snapshot["discount_minor"],
                "trial_days": snapshot["trial_days"],
                "promotion_name": snapshot["promotion_name"],
                "percent_off": snapshot["percent_off"],
            }
        raise ServiceError(
            "checkout_pending", "Finish your existing subscription checkout first.", status=409
        )

    plan = Plan.objects.filter(pk=plan_id, kind="unlimited_b2c", audience="personal", is_active=True).first()
    if plan is None:
        raise ServiceError("not_found", "Plan not found or inactive.", status=404)
    price = PlanPrice.objects.filter(plan=plan, currency_id=currency_code).first()
    if price is None:
        price = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
    if price is None:
        raise ServiceError("no_price", "No price configured for this plan.", status=400)
    promo = promotions.for_plan(user=user, plan=plan, code=promo_code.strip())
    discount = _first_payment_discount(price.amount_minor, promo.percent_off) if promo else 0
    return {
        "plan_id": plan.id,
        "currency": price.currency_id,
        "amount_minor": price.amount_minor,
        "discount_minor": discount,
        "first_payment_minor": price.amount_minor - discount,
        "trial_days": plan.trial_days,
        "promotion_name": promo.name if promo else None,
        "percent_off": promo.percent_off if promo else None,
    }


def list_unlimited_plans(currency_code: str) -> list[dict]:
    plans = Plan.objects.filter(
        kind="unlimited_b2c",
        is_active=True,
    ).order_by("interval", "name")

    result = []
    for plan in plans:
        price_row = PlanPrice.objects.filter(plan=plan, currency_id=currency_code).first()
        if price_row is None:
            price_row = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
        if price_row is None:
            continue
        result.append(
            {
                "id": plan.id,
                "code": plan.code,
                "name": plan.name,
                "interval": plan.interval,
                "trial_days": plan.trial_days,
                "description": plan.description,
                "amount_minor": price_row.amount_minor,
                "currency": price_row.currency_id,
                "stripe_price_id": price_row.stripe_price_id,
            }
        )
    return result


def get_active_subscription(user) -> dict | None:
    now = timezone.now()
    subscriptions = list(
        Subscription.objects.filter(
            user=user,
            org__isnull=True,
            plan__kind="unlimited_b2c",
            status__in=("active", "trialing", "past_due"),
        )
        .filter(Q(current_period_end__isnull=True) | Q(current_period_end__gt=now))
        .select_related("plan")
        .order_by("-current_period_end", "-created_at")[:2]
    )
    if len(subscriptions) > 1:
        from core.errors import ServiceError

        raise ServiceError(
            "multiple_active_subscriptions",
            "More than one active personal subscription needs support review.",
            status=409,
        )
    sub = subscriptions[0] if subscriptions else None
    if sub is None:
        return None
    return {
        "id": sub.id,
        "plan_code": sub.plan.code,
        "plan_name": sub.plan.name,
        "status": sub.status,
        "interval": sub.plan.interval,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }


def create_subscription_checkout(
    *,
    user,
    plan_id: UUID,
    currency_code: str,
    success_url: str,
    cancel_url: str,
    customer_email: str | None = None,
    promo_code: str = "",
) -> dict:
    from core.errors import ServiceError

    now = timezone.now()
    # A lock on Subscription rows alone does not serialize two first checkouts: there
    # may be no row yet.  Lock the existing learner record instead, which is stable for
    # every personal checkout and leaves company/B2B checkout behaviour untouched.
    from apps.identity.models import User

    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        active = (
            Subscription.objects.filter(
                user=user,
                org__isnull=True,
                plan__kind="unlimited_b2c",
                status__in=("active", "trialing", "past_due"),
            )
            .filter(Q(current_period_end__isnull=True) | Q(current_period_end__gt=now))
            .exists()
        )
        if active:
            raise ServiceError(
                "already_subscribed",
                "You already have an active unlimited subscription.",
                status=409,
            )

        # Only a provider-confirmed expired session can release an old reservation.
        # A missing session ID can represent an uncertain network result, so age alone
        # cannot prove that no payment was made.
        stale = list(
            Subscription.objects.select_for_update().filter(
                user=user,
                org__isnull=True,
                plan__kind="unlimited_b2c",
                status="incomplete",
                created_at__lt=now - _PENDING_CHECKOUT_MAX_AGE,
            )
        )
        for old in stale:
            if old.stripe_subscription_id:
                raise ServiceError("checkout_pending", "An earlier payment needs support review.", status=409)
            if not old.stripe_session_id:
                raise ServiceError(
                    "checkout_pending", "An earlier checkout needs support review.", status=409
                )
            try:
                provider_session = gateway.retrieve_checkout_session(old.stripe_session_id)
            except Exception as exc:
                raise ServiceError(
                    "checkout_pending", "We could not confirm the earlier checkout outcome.", status=409
                ) from exc
            if provider_session.get("status") != "expired":
                raise ServiceError(
                    "checkout_pending", "An earlier checkout needs support review.", status=409
                )
            Subscription.objects.filter(pk=old.pk, status="incomplete").update(
                status="canceled", canceled_at=now, updated_at=now
            )

        # A current incomplete row is retried with its original ID. Stripe receives the
        # same idempotency key, so a timeout with an uncertain provider outcome cannot
        # create another Checkout Session or charge.
        sub = (
            Subscription.objects.select_for_update()
            .select_related("plan")
            .filter(
                user=user,
                org__isnull=True,
                plan__kind="unlimited_b2c",
                status="incomplete",
                created_at__gte=now - _PENDING_CHECKOUT_MAX_AGE,
            )
            .order_by("-created_at")
            .first()
        )
        if sub is None:
            plan = Plan.objects.filter(
                pk=plan_id, kind="unlimited_b2c", audience="personal", is_active=True
            ).first()
            if plan is None:
                raise ServiceError("not_found", "Plan not found or inactive.", status=404)
            price_row = PlanPrice.objects.filter(plan=plan, currency_id=currency_code).first()
            if price_row is None:
                price_row = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
            if price_row is None:
                raise ServiceError("no_price", "No price configured for this plan.", status=400)
            # Serialise all subscription offer claims while choosing the best eligible
            # offer. The snapshot below is the reservation; no money is taken here.
            from core.tenancy import tenant_context

            with tenant_context(staff=True):
                list(
                    Promotion.objects.select_for_update()
                    .filter(kind=Promotion.Kind.SUBSCRIPTION, is_active=True)
                    .order_by("id")
                )
            promo = promotions.for_plan(user=user, plan=plan, code=promo_code.strip())
            sub = Subscription.objects.create(
                user=user, plan=plan, currency_id=price_row.currency_id, status="incomplete"
            )
            snapshot = {
                "plan_id": str(plan.id),
                "price_id": price_row.stripe_price_id,
                "amount_minor": price_row.amount_minor,
                "currency": price_row.currency_id,
                "trial_days": plan.trial_days,
                "promotion_id": str(promo.id) if promo else "",
                "coupon": promo.stripe_coupon_id if promo else "",
                "promotion_name": promo.name if promo else None,
                "percent_off": promo.percent_off if promo else None,
                "discount_minor": _first_payment_discount(price_row.amount_minor, promo.percent_off)
                if promo
                else 0,
                "promo_code": promo_code.strip().upper(),
                "customer_email": customer_email or user.email,
                "success_url": success_url,
                "cancel_url": cancel_url,
            }
            audit(
                promotions.SNAPSHOT_ACTION,
                "subscription",
                str(sub.id),
                actor_id=user.id,
                data=snapshot,
            )
        else:
            snapshot = promotions.subscription_snapshot(sub.id)
            if snapshot is None:
                raise ServiceError(
                    "checkout_pending", "An earlier checkout needs support review.", status=409
                )
            if str(plan_id) != snapshot["plan_id"] or promo_code.strip().upper() != snapshot["promo_code"]:
                raise ServiceError(
                    "checkout_pending", "Finish your existing subscription checkout first.", status=409
                )

    try:
        session = gateway.create_checkout_session(
            mode="subscription",
            line_items=[{"price": snapshot["price_id"], "quantity": 1}],
            metadata={
                "kind": "subscription",
                "id": str(sub.id),
                **({"promotion": snapshot["promotion_id"]} if snapshot["promotion_id"] else {}),
            },
            customer_email=snapshot["customer_email"],
            success_url=snapshot["success_url"],
            cancel_url=snapshot["cancel_url"],
            trial_days=snapshot["trial_days"],
            coupon=snapshot["coupon"],
            idempotency_key=f"subscription-checkout-{sub.id}",
        )
    except ServiceError as exc:
        # This error is raised before a provider request, so the local attempt is safe
        # to release. Other errors may be an ambiguous network/provider outcome and
        # deliberately retain the row for a retry with the same idempotency key.
        if exc.code == "payments_unavailable":
            Subscription.objects.filter(pk=sub.pk, status="incomplete").update(
                status="canceled", canceled_at=timezone.now(), updated_at=timezone.now()
            )
        raise

    Subscription.objects.filter(pk=sub.pk).update(
        stripe_session_id=session.get("id"),
    )

    audit(
        "subscription.checkout_started",
        "subscription",
        str(sub.id),
        actor_id=str(user.id),
        data={
            "plan_id": snapshot["plan_id"],
            "currency": snapshot["currency"],
            "promotion_id": snapshot["promotion_id"],
        },
    )

    return {"url": session["url"], "subscription_id": sub.id}
