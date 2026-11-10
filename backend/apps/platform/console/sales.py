"""Console > Sales & orders (mockup 22): overview, all orders, refunds and invoices.

Money: every KPI is GBP pence (each order stores its GBP value at checkout). An order's
own amounts are in its own currency."""

import csv
from datetime import date, datetime
from uuid import UUID

from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from ninja import Schema

from apps.commerce import services as shop
from apps.commerce.models import Invoice, Order, OrderItem, Payment, Refund
from core import cursor as keyset

from ..services import audit_request
from . import metrics
from .common import (
    ConsoleKpiOut,
    ConsolePointOut,
    ConsoleRangeOut,
    ConsoleReasonIn,
    ConsoleStatusOut,
    clamp,
    kpi,
    parse_range,
    router,
    staff,
)


def order_number(order_id) -> str:
    """A short, stable reference for people (the id's last 8 characters)."""
    return f"ORD-{str(order_id).replace('-', '')[-8:].upper()}"


def csv_response(filename: str, header: list, rows) -> HttpResponse:
    """A small CSV built in the request (rows are read inside the RLS context)."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    w = csv.writer(response)
    w.writerow(header)
    for row in rows:
        w.writerow(
            ["" if v is None else (f"'{v}" if str(v)[:1] in "=+-@" and not _number(v) else v) for v in row]
        )
    return response


def _number(v) -> bool:
    return isinstance(v, int | float)


# ---------------------------------------------------------------- overview
class ConsoleSalesKpisOut(Schema):
    total_sales: ConsoleKpiOut  # paid orders
    revenue: ConsoleKpiOut  # courses + subscriptions, GBP
    course_sales: ConsoleKpiOut
    subscriptions: ConsoleKpiOut
    refunds: ConsoleKpiOut
    average_order: ConsoleKpiOut


class ConsoleSalesSliceOut(Schema):
    key: str
    label: str
    value: int


class ConsoleSalesOverviewOut(Schema):
    range: ConsoleRangeOut
    kpis: ConsoleSalesKpisOut
    series: list[ConsolePointOut]  # daily revenue (courses + subscriptions), GBP pence
    by_type: list[ConsoleSalesSliceOut]


@router.get("/sales/overview", response=ConsoleSalesOverviewOut)
def sales_overview(request, range: str = "30d", start: date | None = None, end: date | None = None):
    staff(request)
    r = parse_range(range, start, end)
    now, before = metrics.sales(r.start, r.end), metrics.sales(r.previous_start, r.previous_end)
    subs = metrics.subscription_revenue_gbp(r.start, r.end)
    subs_before = metrics.subscription_revenue_gbp(r.previous_start, r.previous_end)
    avg = now["gbp"] // now["orders"] if now["orders"] else 0
    avg_before = before["gbp"] // before["orders"] if before["orders"] else 0
    courses = metrics.revenue_series(r.start, r.end)
    plans = {p["day"]: p["value"] for p in metrics.subscription_series(r.start, r.end)}
    return {
        "range": r.out(),
        "kpis": {
            "total_sales": kpi(now["orders"], before["orders"]),
            "revenue": kpi(now["gbp"] + subs, before["gbp"] + subs_before),
            "course_sales": kpi(now["gbp"], before["gbp"]),
            "subscriptions": kpi(subs, subs_before),
            "refunds": kpi(
                metrics.refunds_gbp(r.start, r.end), metrics.refunds_gbp(r.previous_start, r.previous_end)
            ),
            "average_order": kpi(avg, avg_before),
        },
        "series": [{"day": p["day"], "value": p["value"] + plans.get(p["day"], 0)} for p in courses],
        "by_type": [
            {"key": "courses", "label": "Courses", "value": now["gbp"]},
            {"key": "subscriptions", "label": "Subscriptions", "value": subs},
        ],
    }


# ---------------------------------------------------------------- orders
class ConsoleOrderRowOut(Schema):
    id: UUID
    number: str
    user_id: UUID
    name: str
    email: str
    products: str
    item_count: int
    status: str
    currency: str
    exponent: int
    total_minor: int
    gbp_total_minor: int
    payment_method: str  # card / paypal / link …, '' before M5
    card_brand: str
    card_last4: str
    created_at: datetime
    paid_at: datetime | None
    payment_intent: str


class ConsoleOrderPageOut(Schema):
    items: list[ConsoleOrderRowOut]
    next_cursor: str | None
    total: int


def _orders(q, status, product, method, currency, user, start, end):
    qs = Order.objects.exclude(status=Order.Status.EXPIRED)
    if q:
        term = q.strip()[:100]
        cond = Q(user__email__icontains=term) | Q(user__full_name__icontains=term)
        ref = term.upper().removeprefix("ORD-")
        if len(ref) >= 4 and all(c in "0123456789ABCDEF" for c in ref):
            cond |= Q(id__iendswith=ref[-8:])
        qs = qs.filter(cond)
    if status:
        qs = qs.filter(status=status)
    if product:
        qs = qs.filter(items__course_id=product)
    if method:
        qs = qs.filter(payment_method_type="" if method == "unknown" else method)
    if currency:
        qs = qs.filter(currency_id=currency.upper()[:3])
    if user:
        qs = qs.filter(user_id=user)
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    return qs


def _row(o: Order) -> dict:
    titles = [i.course.title for i in o.items.all()]
    products = titles[0] if len(titles) == 1 else f"{len(titles)} courses" if titles else "—"
    return {"id": o.id, "number": order_number(o.id), "user_id": o.user_id, "name": o.user.full_name,
            "email": o.user.email, "products": products, "item_count": len(titles), "status": o.status,
            "currency": o.currency_id, "exponent": o.currency.exponent, "total_minor": o.total_minor,
            "gbp_total_minor": o.gbp_total_minor, "payment_method": o.payment_method_type,
            "card_brand": o.card_brand, "card_last4": o.card_last4, "created_at": o.created_at,
            "paid_at": o.paid_at, "payment_intent": o.stripe_payment_intent_id}  # fmt: skip


@router.get("/orders", response=ConsoleOrderPageOut)
def orders(
    request, q: str | None = None, status: str | None = None, product: UUID | None = None,
    method: str | None = None, currency: str | None = None, user: UUID | None = None,
    start: date | None = None, end: date | None = None, cursor: str | None = None, limit: int = 25,
):  # fmt: skip
    staff(request)
    limit = clamp(limit, 100)
    qs = _orders(q, status, product, method, currency, user, start, end).distinct()
    total = qs.count() if not cursor else -1
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(
        qs.select_related("user", "currency").prefetch_related("items__course").order_by("-id")[: limit + 1]
    )
    page = rows[:limit]
    return {"items": [_row(o) for o in page], "total": total,
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip


@router.get("/orders/export.csv", include_in_schema=False)
def orders_csv(
    request, q: str | None = None, status: str | None = None, product: UUID | None = None,
    method: str | None = None, currency: str | None = None, start: date | None = None, end: date | None = None,
):  # fmt: skip
    staff(request)
    qs = _orders(q, status, product, method, currency, None, start, end).distinct()
    data = [
        _row(o)
        for o in qs.select_related("user", "currency")
        .prefetch_related("items__course")
        .order_by("-id")[:20000]
    ]
    audit_request(request, "orders.export", "order", "*", {"rows": len(data)})
    header = ["Order", "Customer", "Email", "Products", "Status", "Currency", "Total", "Total (GBP)",
              "Payment method", "Card", "Created", "Paid", "Stripe reference"]  # fmt: skip
    return csv_response("orders.csv", header, (
        [r["number"], r["name"], r["email"], r["products"], r["status"], r["currency"],
         r["total_minor"] / 10 ** r["exponent"], r["gbp_total_minor"] / 100, r["payment_method"],
         f"{r['card_brand']} {r['card_last4']}".strip(), r["created_at"].isoformat(),
         r["paid_at"].isoformat() if r["paid_at"] else "", r["payment_intent"]]
        for r in data
    ))  # fmt: skip


class ConsoleOrderItemOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    list_minor: int
    discount_minor: int
    gross_minor: int
    refunded_at: datetime | None
    refund_reason: str


class ConsoleOrderDetailOut(Schema):
    order: ConsoleOrderRowOut
    items: list[ConsoleOrderItemOut]
    subtotal_minor: int
    discount_minor: int
    discount_label: str  # "Coupon LAUNCH10" / "Summer sale (30%)"
    tax_minor: int
    prices_include_tax: bool
    payment_status: str
    invoice_url: str | None
    customer_orders: int
    refundable: bool
    country: str


@router.get("/orders/{order_id}", response=ConsoleOrderDetailOut)
def order_detail(request, order_id: UUID):
    staff(request)
    from apps.platform.services import get_setting

    o = get_object_or_404(
        Order.objects.select_related("user", "currency", "coupon", "promotion").prefetch_related(
            "items__course"
        ),
        pk=order_id,
    )
    refunds = dict(Refund.objects.filter(item__order=o).values_list("item_id", "reason"))
    labels = []
    if o.coupon_id:
        labels.append(f"Coupon {o.coupon.code} ({o.coupon.percent_off}%)")
    if o.promotion_id:
        labels.append(f"{o.promotion.name} ({o.promotion.percent_off}%)")
    pay = Payment.objects.filter(order=o).order_by("-created_at").values_list("status", flat=True).first()
    inv = Invoice.objects.filter(order=o).order_by("-issued_at").first()
    return {
        "order": _row(o),
        "items": [
            {
                "id": i.id,
                "course_id": i.course_id,
                "course_title": i.course.title,
                "list_minor": i.list_minor,
                "discount_minor": i.discount_minor,
                "gross_minor": i.gross_minor,
                "refunded_at": i.refunded_at,
                "refund_reason": refunds.get(i.id, ""),
            }
            for i in o.items.all()
        ],  # fmt: skip
        "subtotal_minor": o.subtotal_minor,
        "discount_minor": o.discount_minor,
        "discount_label": " + ".join(labels),
        "tax_minor": o.tax_minor,
        "prices_include_tax": bool(get_setting("payments.prices_include_tax")),
        "payment_status": pay or ("free" if o.total_minor == 0 and o.paid_at else o.status),
        "invoice_url": (inv.pdf_url or inv.hosted_url) if inv else None,
        "customer_orders": Order.objects.filter(user_id=o.user_id).exclude(status="expired").count(),
        "refundable": o.status in ("paid", "partially_refunded"),
        "country": o.country,
    }


@router.post("/orders/items/{item_id}/refund", response=ConsoleStatusOut)
def refund(request, item_id: UUID, body: ConsoleReasonIn):
    """Staff refund (any time, reason required): money back, access removed, learner told."""
    staff(request)
    item = get_object_or_404(OrderItem, pk=item_id)
    r = shop.request_refund(item=item, by=request.user, reason=body.reason)
    audit_request(request, "order.refund", "order_item", item_id,
                  {"reason": body.reason, "order": str(item.order_id), "amount_minor": item.gross_minor})  # fmt: skip
    return {"status": r.status}


# ---------------------------------------------------------------- refunds & invoices
class ConsoleRefundRowOut(Schema):
    id: UUID
    order_id: UUID
    order_number: str
    item_id: UUID
    course_title: str
    name: str
    email: str
    amount_minor: int
    currency: str
    exponent: int
    reason: str
    status: str
    by_staff: bool
    created_at: datetime


class ConsoleRefundPageOut(Schema):
    items: list[ConsoleRefundRowOut]
    next_cursor: str | None


@router.get("/refunds", response=ConsoleRefundPageOut)
def refunds(request, q: str | None = None, cursor: str | None = None, limit: int = 25):
    staff(request)
    limit = clamp(limit, 100)
    qs = Refund.objects.select_related("item__course", "item__order__currency", "user", "requested_by")
    if q:
        term = q.strip()[:100]
        qs = qs.filter(Q(user__email__icontains=term) | Q(item__course__title__icontains=term))
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {"items": [{"id": r.id, "order_id": r.item.order_id, "order_number": order_number(r.item.order_id),
                       "item_id": r.item_id, "course_title": r.item.course.title, "name": r.user.full_name,
                       "email": r.user.email, "amount_minor": r.amount_minor, "currency": r.item.order.currency_id,
                       "exponent": r.item.order.currency.exponent, "reason": r.reason, "status": r.status,
                       "by_staff": r.requested_by.is_staff, "created_at": r.created_at} for r in page],
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip


class ConsoleInvoiceRowOut(Schema):
    id: UUID
    number: str
    kind: str  # order / subscription
    order_id: UUID | None
    name: str
    email: str
    amount_minor: int
    currency: str
    exponent: int
    status: str
    url: str
    issued_at: datetime


class ConsoleInvoicePageOut(Schema):
    items: list[ConsoleInvoiceRowOut]
    next_cursor: str | None


def invoice_rows(qs) -> list[dict]:
    return [{"id": i.id, "number": i.number or i.stripe_invoice_id[-10:], "kind": "subscription" if i.subscription_id
             else "order", "order_id": i.order_id, "name": i.user.full_name, "email": i.user.email,
             "amount_minor": i.amount_minor, "currency": i.currency_id, "exponent": i.currency.exponent,
             "status": i.status, "url": i.pdf_url or i.hosted_url, "issued_at": i.issued_at} for i in qs]  # fmt: skip


@router.get("/invoices", response=ConsoleInvoicePageOut)
def invoices(
    request, q: str | None = None, kind: str | None = None, cursor: str | None = None, limit: int = 25
):
    staff(request)
    limit = clamp(limit, 100)
    qs = Invoice.objects.select_related("user", "currency")
    if kind == "subscription":
        qs = qs.filter(subscription__isnull=False)
    elif kind == "order":
        qs = qs.filter(subscription__isnull=True)
    if q:
        term = q.strip()[:100]
        qs = qs.filter(Q(user__email__icontains=term) | Q(number__icontains=term))
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": invoice_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


class ConsoleSalesFacetsOut(Schema):
    currencies: list[str]
    methods: list[str]


@router.get("/sales/facets", response=ConsoleSalesFacetsOut)
def sales_facets(request):
    """The values the order filters offer (only what really occurs)."""
    staff(request)
    cur = Order.objects.values("currency_id").annotate(n=Count("id")).order_by("currency_id")
    methods = Order.objects.exclude(payment_method_type="").values("payment_method_type").distinct()
    return {"currencies": [c["currency_id"] for c in cur],
            "methods": sorted({m["payment_method_type"] for m in methods})}  # fmt: skip
