"""Commerce endpoints: currencies, cart, wishlist, checkout, orders, refunds, plans.
Prices are always computed here; the browser only sends ids, a currency and a coupon."""

from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Router, Schema

from apps.catalog.api import _cards, _instructor_names
from apps.catalog.models import Course
from apps.platform.services import audit_request
from core import cursor as keyset
from core.auth import session_auth
from core.errors import ServiceError
from core.money import request_currency
from core.permissions import OrgRole, org_scope

from . import gateway, services, webhooks
from .token_api import router as token_router
from .models import (
    Addon,
    CartItem,
    Currency,
    Invoice,
    Order,
    OrderItem,
    Plan,
    PlanPrice,
    Subscription,
    WishlistItem,
)
from .schemas import (
    AddonOut,
    CancelOut,
    CartCountOut,
    CartOut,
    CheckoutIn,
    CheckoutOut,
    CourseRef,
    CurrencyOut,
    InvoiceOut,
    OkOut,
    OrderOut,
    OrderPage,
    PlanEnrollOut,
    PlanPriceOut,
    RefundIn,
    RefundOut,
    SubscribeOut,
    SubscriptionOut,
    UrlOut,
    WishlistOut,
    WishlistToggleOut,
)

router = Router(tags=["commerce"])
router.add_router("/tokens", token_router)


@router.get("/currencies", response=list[CurrencyOut], auth=None)
def currencies(request):
    return Currency.objects.filter(is_active=True, stripe_supported=True).order_by("code")


@router.get("/plans", response=list[PlanPriceOut], auth=None)
def plans(request, currency: str | None = None):
    cur = request_currency(request, currency)
    rows = PlanPrice.objects.filter(currency_id=cur["code"], plan__is_active=True).select_related("plan")
    return [
        {"plan_id": p.plan_id, "code": p.plan.code, "name": p.plan.name, "audience": p.plan.audience,
         "interval": p.plan.interval, "trial_days": p.plan.trial_days, "currency": cur["code"],
         "exponent": cur["exponent"], "amount_minor": p.amount_minor}
        for p in rows
    ]  # fmt: skip


# ---------------------------------------------------------------- cart & wishlist
def _courses(ids) -> list[Course]:
    by_id = {
        c.id: c
        for c in Course.objects.filter(pk__in=ids)
        .select_related("category")
        .prefetch_related(_instructor_names())
    }
    return [by_id[i] for i in ids if i in by_id]


@router.get("/cart", response=CartOut, auth=session_auth)
def cart(request, currency: str | None = None, coupon: str | None = None):
    cur = request_currency(request, currency)
    ids = list(
        CartItem.objects.filter(user=request.user).order_by("created_at").values_list("course_id", flat=True)
    )
    empty = {"currency": cur["code"], "exponent": cur["exponent"], "lines": [], "subtotal_minor": 0,
             "discount_minor": 0, "total_minor": 0}  # fmt: skip
    if not ids:
        return empty
    coupon_error = None
    try:
        priced = services.price_cart(
            user=request.user, course_ids=ids, currency=cur["code"], coupon_code=coupon
        )
    except ServiceError as exc:
        if exc.code not in ("bad_coupon", "coupon_used_up") or not coupon:
            raise
        coupon_error = exc.message
        priced = services.price_cart(user=request.user, course_ids=ids, currency=cur["code"])
    cards = {c["id"]: c for c in _cards(_courses(ids), cur, quotes=priced["quotes"])}
    return {
        **empty,
        "lines": [
            {"course": cards[cid], "list_minor": lst, "price_minor": price}
            for cid, lst, price in priced["lines"]
        ],
        "subtotal_minor": priced["subtotal"],
        "discount_minor": priced["subtotal"] - priced["total"],
        "total_minor": priced["total"],
        "coupon": priced["coupon"].code if priced["coupon"] else priced["promo_code"],
        "promotion": priced["promotion"].name if priced["promotion"] else None,
        "coupon_error": coupon_error,
    }


@router.get("/cart/count", response=CartCountOut, auth=session_auth)
def cart_count(request):
    """For the cart badge in the header (one indexed count)."""
    return {"count": CartItem.objects.filter(user=request.user).count()}


@router.post("/cart", response=OkOut, auth=session_auth)
def add_to_cart(request, body: CourseRef):
    services.add_to_cart(user=request.user, course_id=body.course_id)
    return {"ok": True}


@router.delete("/cart/{course_id}", response=OkOut, auth=session_auth)
def remove_from_cart(request, course_id: str):
    services.remove_from_cart(user=request.user, course_id=course_id)
    return {"ok": True}


@router.get("/wishlist", response=WishlistOut, auth=session_auth)
def wishlist(request, currency: str | None = None):
    cur = request_currency(request, currency)
    ids = list(
        WishlistItem.objects.filter(user=request.user)
        .order_by("-created_at")
        .values_list("course_id", flat=True)
    )
    return {"items": _cards(_courses(ids), cur)}


@router.post("/wishlist/{course_id}/toggle", response=WishlistToggleOut, auth=session_auth)
def toggle_wishlist(request, course_id: str):
    return {"in_wishlist": services.toggle_wishlist(user=request.user, course_id=course_id)}


# ---------------------------------------------------------------- checkout & orders
@router.post("/checkout", response=CheckoutOut, auth=session_auth)
def checkout(request, body: CheckoutIn):
    result = services.create_order(
        user=request.user, course_ids=body.course_ids, currency=body.currency.upper(), coupon_code=body.coupon
    )
    order = result["order"]
    return {"order_id": order.id, "status": order.status, "checkout_url": result["checkout_url"],
            "total_minor": order.total_minor, "currency": order.currency_id}  # fmt: skip


def _order_out(order: Order) -> dict:
    window = timedelta(days=services.refund_window_days())
    open_window = order.paid_at is not None and timezone.now() - order.paid_at < window
    return {
        "id": order.id, "status": order.status, "currency": order.currency_id, "exponent": order.currency.exponent,
        "subtotal_minor": order.subtotal_minor, "discount_minor": order.discount_minor,
        "total_minor": order.total_minor, "created_at": order.created_at, "paid_at": order.paid_at,
        "items": [
            {"id": i.id, "course_id": i.course_id, "course_title": i.course.title, "course_slug": i.course.slug,
             "gross_minor": i.gross_minor,
             "refunded_at": i.refunded_at,
             "refundable": open_window and i.refunded_at is None and order.status in ("paid", "partially_refunded")}
            for i in order.items.all()
        ],
    }  # fmt: skip


@router.get("/orders", response=OrderPage, auth=session_auth)
def orders(request, cursor: str | None = None, limit: int = 20):
    limit = max(1, min(limit, 50))
    qs = (
        Order.objects.filter(user=request.user, org__isnull=True)
        .exclude(status__in=["pending", "expired", "failed"])
        .select_related("currency")
        .prefetch_related("items__course")
        .order_by("-id")
    )
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs[: limit + 1])
    page = rows[:limit]
    return {
        "items": [_order_out(o) for o in page],
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


@router.get("/orders/{order_id}", response=OrderOut, auth=session_auth)
def order(request, order_id: str):
    """Polled by the 'thank you' page until the payment webhook marks the order paid."""
    qs = Order.objects.select_related("currency").prefetch_related("items__course")
    o = get_object_or_404(qs, pk=order_id, user=request.user)
    if services.sync_order_from_stripe(o):  # paid, but the webhook hasn't arrived yet
        o = qs.get(pk=o.pk)
    return _order_out(o)


@router.post("/orders/items/{item_id}/refund", response=RefundOut, auth=session_auth)
def refund(request, item_id: str, body: RefundIn):
    item = get_object_or_404(OrderItem, pk=item_id, user=request.user, order__org__isnull=True)
    r = services.request_refund(item=item, by=request.user, reason=body.reason)
    return {"ok": True, "status": r.status}


@router.post("/plan/enroll", response=PlanEnrollOut, auth=session_auth)
def plan_enroll(request, body: CourseRef):
    course = get_object_or_404(Course, pk=body.course_id)
    e = services.enrol_with_plan(user=request.user, course=course)
    return {"enrollment_id": e.id}


# ---------------------------------------------------------------- subscriptions, add-ons, billing
class SubscribeIn(Schema):
    plan_id: UUID
    currency: str = Field(..., min_length=3, max_length=3)
    seats: int = Field(1, ge=1, le=100000)
    promo_code: str = Field("", max_length=40)


class AddonIn(Schema):
    addon: str = Field(..., max_length=40)
    currency: str = Field(..., min_length=3, max_length=3)
    interval: str = "month"


def _billing_owner(request):
    """Inside a company workspace: the company (admins only). Otherwise: the person."""
    org_id = getattr(request, "org_id", None)
    if org_id:
        org_scope(request, OrgRole.ADMIN)
    return org_id


@router.get("/subscriptions", response=list[SubscriptionOut], auth=session_auth)
def subscriptions(request):
    org_id = _billing_owner(request)
    qs = Subscription.objects.filter(org_id=org_id) if org_id else Subscription.objects.filter(user=request.user,
                                                                                                org__isnull=True)  # fmt: skip
    return [{"id": s.id, "plan": s.plan.name, "audience": s.plan.audience, "status": s.status, "seats": s.seats,
             "currency": s.currency_id, "current_period_end": s.current_period_end,
             "cancel_at_period_end": s.cancel_at_period_end} for s in qs.select_related("plan").order_by("-created_at")]  # fmt: skip


@router.post("/subscriptions", response=SubscribeOut, auth=session_auth)
def subscribe(request, body: SubscribeIn):
    org_id = _billing_owner(request)
    plan = get_object_or_404(Plan, pk=body.plan_id, is_active=True)
    r = services.start_subscription(user=request.user, plan=plan, currency=body.currency.upper(), seats=body.seats,
                                    org_id=org_id, promo_code=body.promo_code)  # fmt: skip
    if org_id:
        audit_request(request, "billing.subscribe", "subscription", r["subscription"].id, {"plan": plan.code})
    return {"subscription_id": r["subscription"].id, "checkout_url": r["checkout_url"]}


@router.post("/subscriptions/{subscription_id}/cancel", response=CancelOut, auth=session_auth)
def cancel(request, subscription_id: str):
    org_id = _billing_owner(request)
    qs = Subscription.objects.filter(org_id=org_id) if org_id else Subscription.objects.filter(user=request.user,
                                                                                                org__isnull=True)  # fmt: skip
    sub = get_object_or_404(qs, pk=subscription_id)
    services.cancel_subscription(subscription=sub)
    if org_id:
        audit_request(request, "billing.cancel", "subscription", sub.id)
    return {"cancel_at_period_end": True, "access_until": sub.current_period_end}


@router.post("/addons", response=AddonOut, auth=session_auth)
def buy_addon(request, body: AddonIn):
    org_id = _billing_owner(request)
    addon = get_object_or_404(Addon, code=body.addon, is_active=True)
    r = services.start_addon(user=request.user, addon=addon, currency=body.currency.upper(), interval=body.interval,
                             org_id=org_id)  # fmt: skip
    return {"addon_subscription_id": r["addon_subscription"].id, "checkout_url": r["checkout_url"]}


@router.post("/billing-portal", response=UrlOut, auth=session_auth)
def billing_portal(request):
    org_id = _billing_owner(request)
    customer = services._customer_id(request.user, org_id)
    if not customer:
        raise ServiceError("no_billing", "There is no billing account yet.", status=404)
    back = f"{settings.FRONTEND_URL}{'/business/billing' if org_id else '/account/billing'}"
    return {"url": gateway.billing_portal(customer=customer, return_url=back)}


@router.get("/invoices", response=list[InvoiceOut], auth=session_auth)
def invoices(request):
    org_id = _billing_owner(request)
    qs = (
        Invoice.objects.filter(org_id=org_id)
        if org_id
        else Invoice.objects.filter(user=request.user, org__isnull=True)
    )
    return list(qs.order_by("-issued_at").values("id", "number", "currency", "amount_minor", "status", "hosted_url",
                                                 "pdf_url", "issued_at")[:200])  # fmt: skip


# ---------------------------------------------------------------- Stripe
@router.post("/webhooks/stripe", auth=None, throttle=[], include_in_schema=False)
def stripe_webhook(request):
    """No session, no CSRF: authenticity comes from Stripe's signature on the raw body."""
    status = webhooks.handle(request.body, request.headers.get("Stripe-Signature", ""))
    return {"received": True, "status": status}
