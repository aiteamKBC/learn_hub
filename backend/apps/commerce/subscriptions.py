"""B2C-07 — Unlimited personal subscription service.

Handles listing plans, creating checkout, and querying user's subscription state.
Lifecycle (create/cancel/renew) is managed by the existing webhook handler;
this module provides the learner-facing read + checkout layer.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.platform.services import audit

from . import gateway
from .models import Plan, PlanPrice, Subscription

_PENDING_CHECKOUT_MAX_AGE = timedelta(hours=25)


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
) -> dict:
    from core.errors import ServiceError

    plan = Plan.objects.filter(pk=plan_id, kind="unlimited_b2c", is_active=True).first()
    if plan is None:
        raise ServiceError("not_found", "Plan not found or inactive.", status=404)

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

        # Checkout sessions expire within a day.  This fallback releases stale local
        # attempts when Stripe's expiry webhook was delayed or unavailable, while never
        # touching an attempt already linked to a Stripe subscription.
        stale = Subscription.objects.filter(
            user=user,
            org__isnull=True,
            plan__kind="unlimited_b2c",
            status="incomplete",
            stripe_subscription_id__isnull=True,
            created_at__lt=now - _PENDING_CHECKOUT_MAX_AGE,
        )
        stale.update(status="canceled", canceled_at=now, updated_at=now)

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
            price_row = PlanPrice.objects.filter(plan=plan, currency_id=currency_code).first()
            if price_row is None:
                price_row = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
            if price_row is None:
                raise ServiceError("no_price", "No price configured for this plan.", status=400)
            sub = Subscription.objects.create(
                user=user,
                plan=plan,
                currency_id=price_row.currency_id,
                status="incomplete",
            )
        else:
            plan = sub.plan
            price_row = PlanPrice.objects.filter(plan=plan, currency_id=sub.currency_id).first()
            if price_row is None:
                # A staff price deletion cannot turn an uncertain existing checkout
                # into a new charge.  Keep the pending row for its expiry webhook.
                raise ServiceError(
                    "no_price", "The pending subscription price is no longer configured.", status=409
                )

    try:
        session = gateway.create_checkout_session(
            mode="subscription",
            line_items=[{"price": price_row.stripe_price_id, "quantity": 1}],
            metadata={"kind": "subscription", "id": str(sub.id)},
            customer_email=customer_email or user.email,
            success_url=success_url,
            cancel_url=cancel_url,
            trial_days=plan.trial_days,
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
        data={"plan": plan.code, "currency": price_row.currency_id},
    )

    return {"url": session["url"], "subscription_id": sub.id}
