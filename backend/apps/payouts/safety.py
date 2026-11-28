"""Shared payout locks and eligibility. Historical ledger rows are never repaired here."""

from datetime import timedelta

from django.db import connection
from django.db.models import Q
from django.utils import timezone

from apps.commerce.models import Order, Refund
from core.errors import ServiceError

from .models import Earning, Payout, PayoutAccount, PayoutRequest

OPEN_REQUESTS = ("pending", "approved", "disputed")


def lock_payouts():
    # All callers must be in a transaction. Use the same lock before row locks.
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended('payouts:run', 0))")


def matured(now=None):
    from .services import hold_days

    now = now or timezone.now()
    # Preserve each refund's recorded maturity (paired with its original sale).
    # A refund never starts an additional hold based on its own earned_at.
    return Q(available_at__lte=now) & (
        Q(amount_gbp_minor__lte=0) | (
            ~Q(kind__in=[Earning.Kind.TOKEN_SPEND, Earning.Kind.SUBSCRIPTION])
            & (Q(kind=Earning.Kind.ADJUSTMENT) | Q(earned_at__lte=now - timedelta(days=hold_days())))
        )
    )


def destination_ready(account, method=None):
    from .services import configured_methods

    method = method or (account.method if account else None)
    return bool(account and account.verified_at and method in {
        m["method"] for m in configured_methods(account)
    })


def require_destination(account, method):
    if not destination_ready(account, method):
        raise ServiceError("not_verified", "Add and verify the selected payout destination first.")


def guard_account_change(user_id):
    lock_payouts()
    if PayoutRequest.objects.filter(user_id=user_id, status__in=OPEN_REQUESTS).exists() or (
        Payout.objects.filter(user_id=user_id).exclude(status__in=["paid", "failed"]).exists()
    ):
        raise ServiceError("payout_in_progress", "Resolve the open payout before changing its destination.")


def validate_lines(lines, *, user_id, now=None):
    """Called under the payout lock, with orders locked before reading refund state."""
    from .services import hold_days

    now = now or timezone.now()
    for line in lines:
        if line.user_id != user_id:
            raise ServiceError("mismatch", "The payout contains another instructor's earnings.")
        if line.amount_gbp_minor > 0 and (
            line.available_at > now or (
                line.kind != Earning.Kind.ADJUSTMENT
                and line.earned_at + timedelta(days=hold_days()) > now
            )
        ):
            raise ServiceError("immature_earnings", "The payout contains earnings still inside the refund hold.")
        if line.kind in (Earning.Kind.TOKEN_SPEND, Earning.Kind.SUBSCRIPTION):
            raise ServiceError("policy_blocked", "Token/subscription settlement requires resolution of F02/F03/C06 and K02.")
    item_ids = {line.order_item_id for line in lines if line.order_item_id}
    orders = Order.objects.filter(items__id__in=item_ids).values("pk")
    # Refund services lock the order first; take that same lock before checking.
    list(Order.objects.filter(pk__in=orders).order_by("pk").select_for_update())
    refunds = {r.item_id: r for r in Refund.objects.filter(item_id__in=item_ids)}
    from apps.commerce.models import OrderItem

    items = {i.id: i for i in OrderItem.objects.filter(pk__in=item_ids).select_related("order")}
    for line in lines:
        if line.kind != Earning.Kind.SALE:
            continue
        item = items.get(line.order_item_id)
        if item is None or item.order.status not in ("paid", "partially_refunded", "refunded"):
            raise ServiceError("unconfirmed_sale", "An earning has no confirmed paid order.")
        refund = refunds.get(item.id)
        if refund and refund.status == Refund.Status.PENDING:
            raise ServiceError("refund_pending", "A refund is pending for these earnings.")
        if item.refunded_at or (refund and refund.status == Refund.Status.SUCCEEDED):
            reversals = [e for e in lines if e.kind == Earning.Kind.REFUND and e.order_item_id == item.id]
            if not refund or refund.status != Refund.Status.SUCCEEDED or refund.amount_minor != item.gross_minor or (
                sum(e.amount_gbp_minor for e in reversals) != -line.amount_gbp_minor
            ):
                raise ServiceError("refund_mismatch", "Refunded earnings need reconciliation before settlement.")


def validate_bundle(payout):
    from .services import minimum_gbp_minor

    if payout.amount_gbp_minor < max(1, minimum_gbp_minor()):
        raise ServiceError("below_minimum", "The payout is below the configured minimum.")
    from .selectors import balance

    if balance(user_id=payout.user_id)["reconciliation_required"]:
        raise ServiceError("reconciliation_required", "Historical payout records need reconciliation before execution.")
    validate_refund_ledger(payout.user_id)
    lines = list(payout.earnings.all())
    if sum(e.amount_gbp_minor for e in lines) != payout.amount_gbp_minor:
        raise ServiceError("mismatch", "Payout total does not match its earnings; reconcile the historical records.")
    validate_lines(lines, user_id=payout.user_id)
    # A later refund/debit cannot be ignored merely because the original bundle exists.
    from django.db.models import Sum

    debit = Earning.objects.filter(user_id=payout.user_id, payout__isnull=True).filter(matured()).aggregate(
        total=Sum("amount_gbp_minor", default=0)
    )["total"]
    if debit < 0:
        raise ServiceError("balance_changed", "An outstanding debit must be reconciled before execution.")
    account = PayoutAccount.objects.select_for_update().filter(user_id=payout.user_id).first()
    require_destination(account, payout.method)
    return account


def validate_refund_ledger(user_id):
    """Cover carry-over adjustments whose original sale is in an earlier payout.

    Refund posting is asynchronous. A missing reversal must not turn a carry-over
    adjustment into free money between the refund commit and its ledger posting.
    Lock the same orders as refunds until provider execution finishes.
    """
    sales = list(Earning.objects.filter(user_id=user_id, kind=Earning.Kind.SALE, order_item__isnull=False))
    item_ids = {line.order_item_id for line in sales}
    orders = Order.objects.filter(items__id__in=item_ids).values("pk")
    list(Order.objects.filter(pk__in=orders).order_by("pk").select_for_update())
    refunds = {r.item_id: r for r in Refund.objects.filter(item_id__in=item_ids).exclude(status=Refund.Status.FAILED)}
    if any(r.status == Refund.Status.PENDING for r in refunds.values()):
        raise ServiceError("refund_pending", "Resolve the instructor's pending refunds before settlement.")
    reversals = {e.order_item_id: e for e in Earning.objects.filter(
        user_id=user_id, kind=Earning.Kind.REFUND, order_item_id__in=refunds,
    )}
    for sale in sales:
        if sale.order_item_id not in refunds:
            continue
        reverse = reversals.get(sale.order_item_id)
        if reverse is None or reverse.amount_gbp_minor != -sale.amount_gbp_minor:
            raise ServiceError("refund_mismatch", "A confirmed refund has no matching earning reversal yet.")
