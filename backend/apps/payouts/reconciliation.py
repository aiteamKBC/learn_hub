"""Read-only reconciliation. Never repair history or infer missing commission rates."""

from apps.commerce.models import Order, Refund
from core.tenancy import tenant_context

from .models import Earning


def reconcile_order(order_id) -> dict:
    """Compare canonical paid consideration, discounts, refunds and frozen earnings.

    Platform residual includes unallocated minor units; summing instructor allocated
    gross alone drops those pennies. Discounts are already in item gross, never
    subtracted a second time. Currency amounts and GBP amounts remain separate.
    """
    with tenant_context(staff=True):
        order = Order.objects.get(pk=order_id)
        items = list(order.items.select_related("course"))
        earnings = list(Earning.objects.filter(order_item__order=order, kind__in=["sale", "refund"]))
        refunds = {r.item_id: r for r in Refund.objects.filter(item__order=order, status="succeeded")}
        issues = []
        if order.paid_at is None:
            issues.append("order_not_paid")
        if sum(i.gross_minor for i in items) != order.total_minor:
            issues.append("order_item_total_mismatch")
        if sum(i.gbp_gross_minor for i in items) != order.gbp_total_minor:
            issues.append("order_item_gbp_total_mismatch")
        if sum(i.discount_minor for i in items) != order.discount_minor:
            issues.append("order_discount_mismatch")
        for item in items:
            sales = [e for e in earnings if e.order_item_id == item.id and e.kind == "sale"]
            reversals = [e for e in earnings if e.order_item_id == item.id and e.kind == "refund"]
            if item.course.ownership == "instructor" and item.gbp_gross_minor and not sales:
                issues.append(f"missing_sale_snapshot:{item.id}")
            if item.list_minor - item.discount_minor != item.gross_minor:
                issues.append(f"item_discount_mismatch:{item.id}")
            if sum(e.amount_gbp_minor for e in sales) > item.gbp_gross_minor:
                issues.append(f"earning_exceeds_sale:{item.id}")
            if item.id in refunds:
                if item.refunded_at is None:
                    issues.append(f"refund_timestamp_missing:{item.id}")
                if refunds[item.id].amount_minor != item.gross_minor:
                    issues.append(f"partial_refund_requires_policy:{item.id}")
                expected = {(e.user_id, e.channel, e.share_bps, -e.gross_gbp_minor, -e.amount_gbp_minor) for e in sales}
                actual = {(e.user_id, e.channel, e.share_bps, e.gross_gbp_minor, e.amount_gbp_minor) for e in reversals}
                if expected != actual:
                    issues.append(f"refund_snapshot_mismatch:{item.id}")
            elif reversals:
                issues.append(f"earning_refund_without_canonical_refund:{item.id}")
        refunded_gbp = sum(i.gbp_gross_minor for i in items if i.id in refunds)
        earned = sum(e.amount_gbp_minor for e in earnings)
        net = order.gbp_total_minor - refunded_gbp
        return {
            "order_id": str(order.id), "currency": order.currency_id,
            "discount_minor": order.discount_minor, "paid_gbp_minor": order.gbp_total_minor,
            "refunded_gbp_minor": refunded_gbp, "net_gbp_minor": net,
            "instructor_net_gbp_minor": earned, "platform_residual_gbp_minor": net - earned,
            "issues": issues,
        }


def subscription_snapshot_totals(period) -> dict:
    """Report existing allocations only; current rates never revalue settled history."""
    from django.db.models import Sum

    from apps.commerce.models import Invoice

    from .services import _month_bounds

    with tenant_context(staff=True):
        start, end = _month_bounds(period)
        paid = list(Invoice.objects.filter(
            subscription__isnull=False, subscription__org__isnull=True,
            subscription__plan__audience="personal", org__isnull=True,
            status="paid", issued_at__gte=start, issued_at__lt=end,
        ).values("currency_id").annotate(amount_minor=Sum("amount_minor")))
        totals = Earning.objects.filter(kind="subscription", period=period.replace(day=1)).aggregate(
            gross_gbp_minor=Sum("gross_gbp_minor", default=0),
            instructor_gbp_minor=Sum("amount_gbp_minor", default=0),
        )
    return totals | {
        "paid_invoices_by_currency": paid,
        "eligibility_verified": False, "blocker": "F03/C06 and historical usage evidence",
    }
