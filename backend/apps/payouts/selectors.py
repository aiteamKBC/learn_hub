"""Instructor revenue screens (studio). RLS limits every query to the instructor's own rows."""

from django.db.models import Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from .models import Earning, Payout


def balance(*, user_id) -> dict:
    """One query: payable now, still in the refund window, paid out to date."""
    now = timezone.now()
    unpaid = Q(payout__isnull=True)
    agg = Earning.objects.filter(user_id=user_id).aggregate(
        available=Sum("amount_gbp_minor", filter=unpaid & Q(available_at__lte=now), default=0),
        pending=Sum("amount_gbp_minor", filter=unpaid & Q(available_at__gt=now), default=0),
        paid=Sum("amount_gbp_minor", filter=Q(payout__status=Payout.Status.PAID), default=0),
        in_payout=Sum(
            "amount_gbp_minor", filter=Q(payout__isnull=False) & ~Q(payout__status__in=SETTLED), default=0
        ),
    )
    return agg


SETTLED = (Payout.Status.PAID, Payout.Status.FAILED)


def balances(*, q: str = "", limit: int = 200) -> list[dict]:
    """Console > Payouts > Balances: one aggregate over the ledger, per instructor."""
    now = timezone.now()
    unpaid = Q(payout__isnull=True)
    qs = Earning.objects.all()
    if q:
        qs = qs.filter(Q(user__full_name__icontains=q) | Q(user__email__icontains=q))
    rows = (
        qs.values("user_id", "user__full_name", "user__email")
        .annotate(
            available=Sum("amount_gbp_minor", filter=unpaid & Q(available_at__lte=now), default=0),
            pending=Sum("amount_gbp_minor", filter=unpaid & Q(available_at__gt=now), default=0),
            in_payout=Sum("amount_gbp_minor", filter=Q(payout__isnull=False) & ~Q(payout__status__in=SETTLED),
                          default=0),
            paid=Sum("amount_gbp_minor", filter=Q(payout__status=Payout.Status.PAID), default=0),
            total=Sum("amount_gbp_minor", default=0),
        )
        .order_by("-available", "user__full_name")
    )  # fmt: skip
    return list(rows[:limit])


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
