"""B2C-07 — Unlimited personal subscription service.

Handles listing plans, creating checkout, and querying user's subscription state.
Lifecycle (create/cancel/renew) is managed by the existing webhook handler;
this module provides the learner-facing read + checkout layer.
"""

from __future__ import annotations

from uuid import UUID

from django.db.models import Q
from django.utils import timezone

from apps.platform.services import audit

from . import gateway
from .models import Plan, PlanPrice, Subscription


def list_unlimited_plans(currency_code: str) -> list[dict]:
    plans = Plan.objects.filter(
        kind="unlimited_b2c", is_active=True,
    ).order_by("interval", "name")

    result = []
    for plan in plans:
        price_row = PlanPrice.objects.filter(plan=plan, currency_id=currency_code).first()
        if price_row is None:
            price_row = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
        if price_row is None:
            continue
        result.append({
            "id": plan.id,
            "code": plan.code,
            "name": plan.name,
            "interval": plan.interval,
            "trial_days": plan.trial_days,
            "description": plan.description,
            "amount_minor": price_row.amount_minor,
            "currency": price_row.currency_id,
            "stripe_price_id": price_row.stripe_price_id,
        })
    return result


def get_active_subscription(user) -> dict | None:
    now = timezone.now()
    sub = Subscription.objects.filter(
        user=user,
        org__isnull=True,
        plan__kind="unlimited_b2c",
        status__in=("active", "trialing", "past_due"),
    ).filter(
        Q(current_period_end__isnull=True) | Q(current_period_end__gt=now)
    ).select_related("plan").first()
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
    *, user, plan_id: UUID, currency_code: str, success_url: str, cancel_url: str,
    customer_email: str | None = None,
) -> dict:
    from core.errors import ServiceError

    plan = Plan.objects.filter(pk=plan_id, kind="unlimited_b2c", is_active=True).first()
    if plan is None:
        raise ServiceError("not_found", "Plan not found or inactive.", status=404)

    now = timezone.now()
    existing = Subscription.objects.filter(
        user=user, org__isnull=True, plan__kind="unlimited_b2c",
        status__in=("active", "trialing"),
    ).filter(Q(current_period_end__isnull=True) | Q(current_period_end__gt=now)).exists()
    if existing:
        raise ServiceError("already_subscribed", "You already have an active unlimited subscription.", status=409)

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

    session = gateway.create_checkout_session(
        mode="subscription",
        line_items=[{
            "price": price_row.stripe_price_id,
            "quantity": 1,
        }],
        metadata={
            "kind": "subscription",
            "id": str(sub.id),
        },
        customer_email=customer_email or user.email,
        success_url=success_url,
        cancel_url=cancel_url,
        subscription_data={
            "trial_period_days": plan.trial_days if plan.trial_days > 0 else None,
        },
    )

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
