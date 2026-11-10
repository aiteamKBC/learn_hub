"""Read-only numbers shared by the dashboard (P3) and Reports (P17). Every function takes a
window [start, end) so the same code gives "this period" and "the period before"."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.commerce import pricing
from apps.commerce.models import Currency, Invoice, Order, OrderItem
from core.errors import ServiceError

PAID = ("paid", "partially_refunded", "refunded")  # money came in (refunds are reported apart)


def paid_orders(start: datetime, end: datetime):
    return Order.objects.filter(status__in=PAID, paid_at__gte=start, paid_at__lt=end)


def sales(start: datetime, end: datetime) -> dict:
    """Course sales in the window: GBP revenue (pence), orders and items sold."""
    row = paid_orders(start, end).aggregate(gbp=Sum("gbp_total_minor"), orders=Count("id"))
    items = OrderItem.objects.filter(
        order__status__in=PAID, order__paid_at__gte=start, order__paid_at__lt=end
    )
    return {"gbp": row["gbp"] or 0, "orders": row["orders"], "items": items.count()}


def refunds_gbp(start: datetime, end: datetime) -> int:
    return (
        OrderItem.objects.filter(refunded_at__gte=start, refunded_at__lt=end).aggregate(
            gbp=Sum("gbp_gross_minor")
        )["gbp"]
        or 0
    )


def _to_gbp(rows, cache: dict | None = None) -> int:
    """rows of (currency code, minor amount) -> pence at the latest rate (reporting only).
    Pass the same `cache` dict across calls to look each rate up once."""
    cache = {} if cache is None else cache
    if "_exp" not in cache:
        cache["_exp"] = dict(Currency.objects.values_list("code", "exponent"))
    total = 0
    for code, minor in rows:
        if code not in cache:
            try:
                cache[code] = pricing.latest_rate(code)
            except ServiceError:  # a currency without a rate is left out, not a 500
                cache[code] = None
        if cache[code] is not None:
            total += pricing.gbp_equivalent(minor or 0, cache["_exp"].get(code, 2), cache[code])
    return total


def subscription_invoices(start: datetime, end: datetime):
    return Invoice.objects.filter(
        subscription__isnull=False, issued_at__gte=start, issued_at__lt=end
    ).exclude(status__in=("void", "uncollectible", "draft"))


def subscription_revenue_gbp(start: datetime, end: datetime) -> int:
    rows = subscription_invoices(start, end).values_list("currency_id").annotate(minor=Sum("amount_minor"))
    return _to_gbp(rows)


def days(start: datetime, end: datetime) -> list[date]:
    tz = timezone.get_current_timezone()
    first, last = timezone.localtime(start, tz).date(), timezone.localtime(end, tz).date()
    out, d = [], first
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


def _fill(start, end, values: dict) -> list[dict]:
    return [{"day": d, "value": int(values.get(d, 0))} for d in days(start, end)]


def revenue_series(start: datetime, end: datetime) -> list[dict]:
    """GBP course revenue per day (pence)."""
    rows = (
        paid_orders(start, end)
        .annotate(day=TruncDate("paid_at"))
        .values("day")
        .annotate(v=Sum("gbp_total_minor"))
    )
    return _fill(start, end, {r["day"]: r["v"] or 0 for r in rows})


def orders_series(start: datetime, end: datetime) -> list[dict]:
    rows = paid_orders(start, end).annotate(day=TruncDate("paid_at")).values("day").annotate(v=Count("id"))
    return _fill(start, end, {r["day"]: r["v"] for r in rows})


def subscription_series(start: datetime, end: datetime) -> list[dict]:
    """GBP subscription revenue per day (pence)."""
    rows = (
        subscription_invoices(start, end)
        .annotate(day=TruncDate("issued_at"))
        .values_list("day", "currency_id")
        .annotate(minor=Sum("amount_minor"))
    )
    per_day: dict = defaultdict(list)
    for day, code, minor in rows:
        per_day[day].append((code, minor))
    cache: dict = {}
    return _fill(start, end, {d: _to_gbp(r, cache) for d, r in per_day.items()})


def created_series(qs, field: str, start: datetime, end: datetime) -> list[dict]:
    rows = (
        qs.filter(**{f"{field}__gte": start, f"{field}__lt": end})
        .annotate(day=TruncDate(field))
        .values("day")
        .annotate(v=Count("id"))
    )
    return _fill(start, end, {r["day"]: r["v"] for r in rows})


def students():
    from apps.identity.models import User

    return User.objects.filter(is_staff=False).exclude(
        Q(instructor_profile__isnull=False) & Q(instructor_profile__status="approved")
    )
