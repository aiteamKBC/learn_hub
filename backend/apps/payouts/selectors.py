"""Instructor revenue screens (studio). RLS limits every query to the instructor's own rows."""

from django.db.models import Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from .models import Earning, Payout, PayoutRequest
from .safety import OPEN_REQUESTS, matured


def _amounts(now):
    unpaid = Q(payout__isnull=True)
    mature = matured(now)
    return dict(
        available=Sum("amount_gbp_minor", filter=unpaid & mature, default=0),
        pending=Sum("amount_gbp_minor", filter=unpaid & ~mature, default=0),
        paid=Sum("amount_gbp_minor", filter=Q(payout__status=Payout.Status.PAID), default=0),
        # Failed rows with attached earnings are inconsistent history, not free money.
        in_payout=Sum("amount_gbp_minor", filter=Q(payout__isnull=False) & ~Q(payout__status=Payout.Status.PAID), default=0),
        total=Sum("amount_gbp_minor", default=0),
    )


def _reserve(rows):
    reserved = dict(PayoutRequest.objects.filter(
        user_id__in=[r["user_id"] for r in rows], status__in=OPEN_REQUESTS, payout__isnull=True,
    ).values("user_id").annotate(t=Sum("amount_gbp_minor")).values_list("user_id", "t"))
    bundles = Payout.objects.filter(user_id__in=[r["user_id"] for r in rows]).annotate(
        ledger_total=Sum("earnings__amount_gbp_minor", default=0),
    )
    inconsistent = {p.user_id for p in bundles if (
        (p.status != Payout.Status.FAILED and p.ledger_total != p.amount_gbp_minor)
        or (p.status == Payout.Status.FAILED and p.ledger_total != 0)
        or (p.status == Payout.Status.PAID and (not p.provider_ref or not p.paid_at or p.failure_reason))
    )}
    for row in rows:
        row["reconciliation_required"] = row["user_id"] in inconsistent
        row["reserved"] = reserved.get(row["user_id"], 0)
        row["available"] -= row["reserved"]
    return rows


def balance(*, user_id) -> dict:
    row = Earning.objects.filter(user_id=user_id).aggregate(**_amounts(timezone.now()))
    row["user_id"] = user_id
    _reserve([row])
    row.pop("user_id")
    return row


def balances(*, q: str = "", limit: int | None = 200) -> list[dict]:
    qs = Earning.objects.all()
    if q:
        qs = qs.filter(Q(user__full_name__icontains=q) | Q(user__email__icontains=q))
    rows = qs.values("user_id", "user__full_name", "user__email").annotate(
        **_amounts(timezone.now())
    ).order_by("-available", "user__full_name")
    return _reserve(list(rows if limit is None else rows[:limit]))


def totals_by_user(user_ids) -> dict:
    """{user_id: all-time earnings} for a page of instructors (one query)."""
    return dict(
        Earning.objects.filter(user_id__in=list(user_ids))
        .values("user_id")
        .annotate(t=Sum("amount_gbp_minor"))
        .values_list("user_id", "t")
    )


def by_month(*, user_id, months: int = 12) -> list[dict]:
    since = timezone.now() - timezone.timedelta(days=31 * months)
    return list(
        Earning.objects.filter(user_id=user_id, earned_at__gte=since)
        .annotate(month=TruncMonth("earned_at"))
        .values("month", "channel")
        .annotate(amount=Sum("amount_gbp_minor"))
        .order_by("month", "channel")
    )


def by_course(*, user_id):
    return (
        Earning.objects.filter(user_id=user_id)
        .values("course_id", "course__title")
        .annotate(amount=Sum("amount_gbp_minor"))
        .order_by("-amount")
    )
