"""Cash-package purchase snapshots, using the existing order and earnings ledgers."""

from django.db import transaction

from apps.payouts import services as payouts
from core.errors import ServiceError

from . import pricing, services
from .models import CoursePrice, Currency, Order, OrderItem, PriceSnapshot


def guard_package_refund(order_id):
    """P06 is unresolved: stop before money, ledger, enrolment or certificate writes.

    Course snapshots also identify package orders created before the explicit pack
    marker. Independent purchases are not classified by current entitlements.
    """
    if PriceSnapshot.objects.filter(source_ref_kind="order", source_ref=str(order_id),
                                    scope__in=["course", "pack"]).exists():
        raise ServiceError("P06_BLOCKED", "Package refunds require policy approval and manual review. No payment or access rights were changed.", status=409)


def allocate(total: int, weights: dict) -> dict:
    """Integer pro-rata allocation; largest fractions receive the remaining pennies.

    Stable IDs break equal-fraction ties. No revenue is created or dropped.
    """
    if total < 0 or not weights or any(value <= 0 for value in weights.values()):
        raise ServiceError("invalid_allocation", "Positive purchase-time list prices are required.")
    denominator = sum(weights.values())
    shares = {key: total * value // denominator for key, value in weights.items()}
    ranked = sorted(weights, key=lambda key: (-(total * weights[key] % denominator), str(key)))
    for key in ranked[:total - sum(shares.values())]:
        shares[key] += 1
    return shares


@transaction.atomic
def prepare_order(*, user, course_ids, currency_code, amount, quotes):
    """Freeze list prices, FX and allocated consideration before starting checkout."""
    currency = Currency.objects.get(pk=currency_code, is_active=True)
    prices = dict(CoursePrice.objects.filter(course_id__in=course_ids).values_list("course_id", "tier__gbp_minor"))
    if set(prices) != set(course_ids) or any(not value for value in prices.values()):
        raise ServiceError("missing_price", "Every package course needs a GBP list price.")
    allocated = allocate(amount, prices)
    rate = pricing.latest_rate(currency_code)
    gbp_total = pricing.gbp_equivalent(amount, currency.exponent, rate)
    gbp_allocated = allocate(gbp_total, prices)
    if any(allocated[cid] > quotes[cid]["list_minor"] for cid in course_ids):
        raise ServiceError("invalid_allocation", "Package allocation exceeds a course's currency list price.")
    order = services._build_pending_order(user=user, priced={
        "currency": currency, "coupon": None, "promotion": None, "country": "",
        "subtotal": sum(quotes[cid]["list_minor"] for cid in course_ids),
        "total": amount, "rate": rate,
        "lines": [(cid, quotes[cid]["list_minor"], allocated[cid]) for cid in course_ids],
    })
    # Converting each line separately can lose pennies. Allocate the canonical
    # converted order total instead; preserve the list GBP independently.
    items = list(order.items.all())
    for item in items:
        item.gbp_gross_minor = gbp_allocated[item.course_id]
    OrderItem.objects.bulk_update(items, ["gbp_gross_minor"])
    PriceSnapshot.objects.bulk_create([
        PriceSnapshot(scope="course", target_id=str(cid), amount_minor=prices[cid], currency="GBP",
                      source_ref_kind="order", source_ref=str(order.id))
        for cid in course_ids
    ])
    return order


@transaction.atomic
def fulfil_order(*, order_id, session, user_id):
    """Verify the stored checkout, then freeze earnings in the payment transaction."""
    order = Order.objects.select_for_update().get(pk=order_id, user_id=user_id, org__isnull=True)
    if not order.stripe_session_id or order.stripe_session_id != session.get("id"):
        raise ServiceError("checkout_mismatch", "Package checkout does not match its order.")
    if order.total_minor and not session.get("payment_intent"):
        raise ServiceError("payment_reference_required", "The paid package needs its payment reference.")
    if order.status in (Order.Status.REFUNDED, Order.Status.PARTIALLY_REFUNDED):
        return order
    order = services.fulfil_order(
        order_id=order.id, payment_intent=session.get("payment_intent") or "",
        amount_minor=session.get("amount_total"), currency=session.get("currency") or "",
    )
    payouts.record_sale(order.id)
    return order
