"""Reports-only projections of canonical receipt records; never writes financial data.

Orders own checkout cash and their frozen allocations. Invoices linked to an order
are not a second receipt. Instalment schedules own their confirmed settlements.
Missing historical FX stays unknown; token consumption is never cash revenue.
"""

from collections import defaultdict
from datetime import datetime, time
from heapq import heappush, heapreplace

from django.db.models import Prefetch
from django.utils import timezone

from apps.commerce.models import CourseInstalment, Currency, Invoice, OrderItem, Refund, TokenGrant
from apps.commerce.pricing import gbp_equivalent
from apps.learning.models import ProgressEvent, QuizAttempt, Submission

from . import metrics


def snapshot_kpi(value):
    return {"value": value, "previous": 0, "change_pct": None}


def series(start, end, receipts, *, kind=None, counts=False):
    values = defaultdict(int)
    for row in receipts:
        if kind is None or row["kind"] == kind:
            values[timezone.localdate(row["at"])] += (
                row.get("count", 1) if counts else (row["gbp_minor"] or 0)
            )
    # End is exclusive, including when it lands precisely at midnight.
    return metrics._fill(start, end, values)


def activity_users(enrolments, start, end):
    ids = enrolments.values("id")
    watch = ProgressEvent.objects.filter(
        enrollment_id__in=ids, created_at__gte=start, created_at__lt=end, seconds__gt=0
    ).values_list("user_id", flat=True)
    quiz = QuizAttempt.objects.filter(
        enrollment_id__in=ids, started_at__gte=start, started_at__lt=end
    ).values_list("user_id", flat=True)
    submissions = Submission.objects.filter(
        enrollment_id__in=ids, submitted_at__gte=start, submitted_at__lt=end
    ).values_list("user_id", flat=True)
    completed = enrolments.filter(completed_at__gte=start, completed_at__lt=end).values_list(
        "user_id", flat=True
    )
    return watch.union(quiz, submissions, completed).count()


def financials(f, start, end, *, detail_limit=None, exponents=None):
    from .reports import _payment_method

    if exponents is None:
        exponents = dict(Currency.objects.values_list("code", "exponent"))
    out = {
        "gbp": 0,
        "order_gbp": 0,
        "course_gbp": 0,
        "subscription_gbp": 0,
        "gross": 0,
        "discounts": 0,
        "refunds": 0,
        "orders": 0,
        "currencies": defaultdict(int),
        "exponents": exponents,
        "receipts": [],
        "notices": [],
    }
    daily = defaultdict(lambda: {"gbp": 0, "count": 0})
    out["by_product"] = defaultdict(int)
    out["by_plan"] = defaultdict(int)
    missing_fx = 0
    newest = []

    def receipt(row):
        nonlocal missing_fx
        out["currencies"][row["currency"]] += row["amount_minor"]
        out["gbp"] += row["gbp_minor"] or 0
        out["by_product"][row["kind"]] += row["gbp_minor"] or 0
        if row["kind"] == "subscription":
            out["by_plan"][row["plan_id"]] += row["gbp_minor"] or 0
        missing_fx += row["gbp_minor"] is None
        bucket = daily[(timezone.localdate(row["at"]), row["kind"])]
        bucket["gbp"] += row["gbp_minor"] or 0
        bucket["count"] += 1
        if detail_limit is None:
            out["receipts"].append(row)
        elif detail_limit:
            entry = (row["at"], str(row["id"]), row["kind"], row)
            if len(newest) < detail_limit:
                heappush(newest, entry)
            elif entry[:3] > newest[0][:3]:
                heapreplace(newest, entry)

    items = OrderItem.objects.filter(f.courses("course__")).select_related("course")
    orders = metrics.paid_orders(start, end).filter(f.scope_q())
    if f.filtered:
        orders = orders.filter(id__in=items.values("order_id"))
    orders = orders.select_related("user", "currency").prefetch_related(
        Prefetch("items", queryset=items, to_attr="report_items")
    )
    for order in orders.iterator(chunk_size=500):
        lines = order.report_items
        amount = sum(i.gross_minor for i in lines) if f.filtered else order.total_minor
        gbp = sum(i.gbp_gross_minor for i in lines) if f.filtered else order.gbp_total_minor
        gross = sum(i.list_minor for i in lines) if f.filtered else order.subtotal_minor
        discount = sum(i.discount_minor for i in lines) if f.filtered else order.discount_minor
        if order.fx_rate > 0:
            out["gross"] += gbp_equivalent(gross, order.currency.exponent, order.fx_rate)
            out["discounts"] += gbp_equivalent(discount, order.currency.exponent, order.fx_rate)
        else:
            out["notices"].append(
                "Some orders lack a valid checkout FX rate; gross list value and discounts are incomplete."
            )
        out["course_gbp"] += sum(i.gbp_gross_minor for i in lines)
        out["orders"] += 1
        out["order_gbp"] += gbp
        titles = [i.course.title for i in lines]
        receipt(
            {
                "id": order.id,
                "kind": "order",
                "reference": str(order.id)[-8:].upper(),
                "customer": order.user.full_name or order.user.email,
                "product": ", ".join(titles) if titles else "Order",
                "amount_minor": amount,
                "currency": order.currency_id,
                "exponent": order.currency.exponent,
                "gbp_minor": gbp,
                "payment_method": _payment_method(
                    order.card_brand, order.card_last4, order.payment_method_type
                ),
                "at": order.paid_at,
                "status": order.status,
                "url": f"/console/sales?order={order.id}",
            }
        )
    invoices = (
        Invoice.objects.none()
        if f.filtered
        else metrics.subscription_invoices(start, end).filter(f.scope_q("subscription__"), order__isnull=True)
    )
    for inv in invoices.select_related("user", "currency", "subscription__plan").iterator(chunk_size=500):
        gbp = inv.amount_minor if inv.currency_id == "GBP" else None
        out["subscription_gbp"] += gbp or 0
        receipt(
            {
                "id": inv.id,
                "kind": "subscription",
                "reference": inv.number or str(inv.id)[-8:].upper(),
                "customer": (inv.user.full_name or inv.user.email) if inv.user_id else "",
                "product": f"{inv.subscription.plan.name} subscription",
                "plan_id": inv.subscription.plan_id,
                "amount_minor": inv.amount_minor,
                "currency": inv.currency_id,
                "exponent": inv.currency.exponent,
                "gbp_minor": gbp,
                "payment_method": "Stripe",
                "at": inv.issued_at,
                "status": inv.status,
                "url": f"/console/subscriptions?subscription={inv.subscription_id}",
            }
        )
    instalments = CourseInstalment.objects.filter(
        f.scope_q("purchase__"),
        f.courses("purchase__course__"),
        status="paid",
        paid_at__gte=start,
        paid_at__lt=end,
    ).select_related("purchase__currency", "purchase__course", "purchase__user")
    for inst in instalments.iterator(chunk_size=500):
        purchase = inst.purchase
        gbp = inst.amount_minor if purchase.currency_id == "GBP" else None
        receipt(
            {
                "id": inst.id,
                "kind": "instalment",
                "reference": inst.payment_reference or str(inst.id)[-8:].upper(),
                "customer": purchase.user.full_name or purchase.user.email,
                "product": f"{purchase.course.title} — instalment {inst.number}",
                "amount_minor": inst.amount_minor,
                "currency": purchase.currency_id,
                "exponent": purchase.currency.exponent,
                "gbp_minor": gbp,
                "payment_method": "Recorded settlement",
                "at": inst.paid_at,
                "status": "paid",
                "url": "/console/course-payments",
            }
        )
    # Refund records, not mere item timestamps, establish successful money movement.
    refunds = Refund.objects.filter(
        f.scope_q("item__order__"),
        f.courses("item__course__"),
        status="succeeded",
        item__refunded_at__gte=start,
        item__refunded_at__lt=end,
    ).select_related("item__order__currency")
    for refund in refunds.iterator(chunk_size=500):
        item, order = refund.item, refund.item.order
        if refund.amount_minor == item.gross_minor:
            out["refunds"] += item.gbp_gross_minor
        elif order.fx_rate > 0:
            out["refunds"] += gbp_equivalent(refund.amount_minor, order.currency.exponent, order.fx_rate)
        else:
            out["notices"].append(
                "A successful refund lacks historical FX; net collected revenue is incomplete."
            )
    if missing_fx:
        out["notices"].append(
            f"{missing_fx} receipt(s) in this or the comparison period lack frozen FX. GBP totals exclude them; native-currency totals retain them."
        )
    if not f.filtered and f.scope != "company":
        grants = TokenGrant.objects.filter(
            source__in=("pack", "topup"), granted_at__gte=start, granted_at__lt=end
        ).count()
        if grants:
            out["notices"].append(
                f"{grants} token purchase grant(s) in this or the comparison period lack an authoritative cash receipt. Token purchases are excluded, and token spending is never new cash revenue."
            )
    out["notices"].append(
        "Legacy cash packages without paid orders and token purchases without authoritative cash receipts are not included in cash totals."
    )
    if detail_limit is not None:
        out["receipts"] = [entry[3] for entry in newest]
    out["daily"] = [
        {
            "at": timezone.make_aware(datetime.combine(day, time.min)),
            "kind": kind,
            "gbp_minor": values["gbp"],
            "count": values["count"],
        }
        for (day, kind), values in daily.items()
    ]
    out["receipts"].sort(key=lambda row: (row["at"], str(row["id"])), reverse=True)
    return out
