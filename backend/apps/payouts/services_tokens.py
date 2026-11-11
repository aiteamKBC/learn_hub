"""B2C-08 — Token-spend instructor earnings.

When a learner spends tokens on an instructor's content, this records the
instructor's earning. The gross GBP amount comes from the token spend's
weighted_unit_cost_gbp × tokens_total; the instructor's share is determined
by commission rules, the instructor's own fee, or the platform default.

F02 (bonus-token funding) and F03/C06 (subscription pool) are BLOCKED.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from apps.catalog.models import Course, CourseInstructor
from core.tenancy import tenant_context

from .models import CommissionRule, Earning, RevenueShare
from .services import (
    _rates,
    _weights,
    active_rules,
    hold_days,
    instructor_fees,
    match_rule,
    marketplace_rate,
)

C = RevenueShare.Channel


def record_token_spend_earning(spend_id) -> int:
    from apps.commerce.models import TokenSpend

    with tenant_context(staff=True):
        spend = TokenSpend.objects.filter(pk=spend_id).first()
        if spend is None:
            return 0
        if spend.course_id is None:
            return 0
        course = Course.objects.filter(pk=spend.course_id).only("ownership", "category_id").first()
        if course is None or course.ownership != Course.Ownership.INSTRUCTOR:
            return 0
        if Earning.objects.filter(token_spend=spend).exists():
            return 0

        unit_cost = spend.weighted_unit_cost_gbp or Decimal("0")
        gross_gbp = int(
            (Decimal(str(spend.tokens_total)) * unit_cost).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        if gross_gbp <= 0:
            return 0

        now = timezone.now()
        weights = _weights([spend.course_id])
        instructors = weights.get(spend.course_id, [])
        if not instructors:
            return 0

        rates = _rates()
        fees = instructor_fees({u for u, _ in instructors})
        rules = active_rules(now)
        available = now + timedelta(days=hold_days())

        lines = []
        for user_id, w in instructors:
            share = int(gross_gbp * w)
            rule = match_rule(
                rules,
                course_id=spend.course_id,
                category_id=course.category_id,
                user_id=user_id,
                price_gbp_minor=gross_gbp,
            )
            bps, _ = marketplace_rate(rule=rule, user_id=user_id, fees=fees, rates=rates)
            amount = share * bps // 10000
            lines.append(
                Earning(
                    user_id=user_id,
                    kind=Earning.Kind.TOKEN_SPEND,
                    course_id=spend.course_id,
                    token_spend=spend,
                    channel=C.TOKEN_SPEND,
                    gross_gbp_minor=share,
                    share_bps=bps,
                    amount_gbp_minor=amount,
                    earned_at=now,
                    available_at=available,
                    note=f"{spend.tokens_total} tokens, unit cost {unit_cost}",
                )
            )
        return len(Earning.objects.bulk_create(lines, ignore_conflicts=True))
