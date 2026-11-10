"""Cart, checkout, fulfilment, refunds, subscriptions and add-ons (commerce).

Money rules:
  * every amount is computed HERE from the database: the browser sends course ids,
    a currency and an optional coupon code, never a price;
  * an order is paid only when Stripe's signed webhook says so (webhooks.py), and the
    amount and currency Stripe reports must match the order exactly;
  * fulfilment is idempotent: a webhook delivered twice enrols once.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.db.models import Case, F, PositiveIntegerField, Q, When
from django.utils import timezone

from apps.catalog.models import Course, CourseInstructor
from apps.learning import services as learning
from apps.learning.models import Enrollment
from core.errors import ServiceError

from . import gateway, pricing, promotions
from .models import (
    Addon,
    AddonPrice,
    AddonSubscription,
    CartItem,
    Coupon,
    CouponRedemption,
    Currency,
    Order,
    OrderItem,
    Payment,
    Plan,
    PlanCourse,
    PlanPrice,
    Promotion,
    PromotionRedemption,
    Refund,
    Subscription,
    SubscriptionEvent,
    WishlistItem,
)
from .signals import notify_item_refunded, notify_order_paid

log = logging.getLogger(__name__)

PAID_ACCESS = (Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED)


# ---------------------------------------------------------------- cart & wishlist
def _sellable(course_id) -> Course:
    course = Course.objects.filter(
        pk=course_id, live_version__isnull=False, owner_org_id__isnull=True
    ).first()
    if course is None:
        raise ServiceError("not_for_sale", "This course is not available.")
    return course


def add_to_cart(*, user, course_id) -> CartItem:
    course = _sellable(course_id)
    if _owns(user, [course.id]):
        raise ServiceError("already_owned", "You already have this course.")
    item, _ = CartItem.objects.get_or_create(user=user, course=course)
    WishlistItem.objects.filter(user=user, course=course).delete()  # moved from wishlist
    return item


def remove_from_cart(*, user, course_id) -> None:
    CartItem.objects.filter(user=user, course_id=course_id).delete()


def toggle_wishlist(*, user, course_id) -> bool:
    """Returns True if the course is now on the wishlist."""
    deleted, _ = WishlistItem.objects.filter(user=user, course_id=course_id).delete()
    if deleted:
        return False
    WishlistItem.objects.create(user=user, course=_sellable(course_id))
    return True


def _owns(user, course_ids) -> set:
    taught = set(
        CourseInstructor.objects.filter(user=user, course_id__in=course_ids).values_list(
            "course_id", flat=True
        )
    )
    enrolled = set(
        Enrollment.objects.filter(
            user=user, org__isnull=True, course_id__in=course_ids, status__in=PAID_ACCESS
        ).values_list("course_id", flat=True)
    )
    return taught | enrolled


# ---------------------------------------------------------------- checkout
def _coupon(code: str | None, now) -> Coupon | None:
    """An instructor or staff coupon. None when no coupon has this code (it may be a
    platform promo code instead); an expired or used-up coupon is refused."""
    if not code:
        return None
    if not Coupon.objects.filter(code__iexact=code.strip()).exists():
        return None
    c = Coupon.objects.filter(code__iexact=code.strip(), is_active=True, starts_at__lte=now).first()
    if c is None or (c.ends_at and c.ends_at <= now):
        raise ServiceError("bad_coupon", "This coupon is not valid.")
    if c.max_redemptions is not None and c.redeemed_count >= c.max_redemptions:
        raise ServiceError("coupon_used_up", "This coupon has been fully redeemed.")
    return c


def price_cart(*, user, course_ids: list, currency: str, coupon_code: str | None = None, now=None) -> dict:
    """The ONE place a basket is priced: the cart page and checkout call the same code,
    so what the learner sees is exactly what they are charged. The code box takes an
    instructor coupon or a platform promo code; platform promotions (promotions.py) and
    regional prices (pricing.py) apply here too."""
    now = now or timezone.now()
    ids = list(dict.fromkeys(course_ids))  # de-duplicate, keep order
    if not ids or len(ids) > 50:
        raise ServiceError("bad_cart", "Choose between 1 and 50 courses.")
    cur = Currency.objects.filter(code=currency, is_active=True, stripe_supported=True).first()
    if cur is None:
        raise ServiceError("bad_currency", f"Payments in {currency} are not available.")
    courses = {
        c.id: c
        for c in Course.objects.filter(pk__in=ids, live_version__isnull=False, owner_org_id__isnull=True)
    }
    if len(courses) != len(ids):
        raise ServiceError("not_for_sale", "One of these courses is not available.")
    if owned := _owns(user, ids):
        raise ServiceError(
            "already_owned", "You already have some of these courses.", details=[str(i) for i in owned]
        )
    country = pricing.buyer_country()
    quotes = pricing.quote(ids, currency, now, country=country)
    if len(quotes) != len(ids):
        raise ServiceError("not_for_sale", "One of these courses has no price.")
    code = (coupon_code or "").strip()
    coupon = _coupon(code, now)
    code_promo = None if coupon or not code else promotions.find_code(code, now)
    if code and coupon is None and code_promo is None:
        raise ServiceError("bad_coupon", "This coupon is not valid.")
    if coupon and coupon.course_id and coupon.course_id not in courses:
        raise ServiceError("bad_coupon", "This coupon is for a different course.")

    subtotal = sum(quotes[cid]["list_minor"] for cid in ids)
    rate = pricing.latest_rate(currency)
    gbp_subtotal = pricing.gbp_equivalent(subtotal, cur.exponent, rate)
    priced = [(cid, courses[cid].category_id, quotes[cid]["list_minor"]) for cid in ids]
    if code_promo is not None:
        promotions.check_code(code_promo, user=user, lines=priced, gbp_subtotal=gbp_subtotal, now=now)
    from apps.platform.services import get_setting

    promotion, prices = promotions.best_for_cart(
        user=user, lines=priced, exponent=cur.exponent, gbp_subtotal=gbp_subtotal, coupon=coupon,
        code_promo=code_promo, stack=bool(get_setting("payments.allow_promotion_stacking")), now=now,
    )  # fmt: skip
    if code_promo is not None and promotion is None:  # the typed code saved nothing over what applies anyway
        raise ServiceError("bad_coupon", "This code gives no extra discount on these courses.")
    if code_promo is not None and promotion is not None and promotion.pk != code_promo.promo.pk:
        raise ServiceError("bad_coupon", "A better offer already applies to these courses.")
    lines = [(cid, lst, prices[cid]) for cid, _, lst in priced]
    regional = any(quotes[cid].get("regional") for cid in ids)
    return {
        "currency": cur,
        "courses": courses,
        "coupon": coupon,
        "promotion": promotion,
        "promo_code": code_promo.promo.code if code_promo is not None else None,
        "country": country if regional else "",
        "rate": rate,
        "lines": lines,
        "quotes": quotes,
        "subtotal": subtotal,
        "total": sum(p for _, _, p in lines),
    }


@transaction.atomic
def create_order(*, user, course_ids: list, currency: str, coupon_code: str | None = None) -> dict:
    """Personal purchase of one or more courses. Returns {"order", "checkout_url"}
    (checkout_url is None when the total is zero: the order is fulfilled at once)."""
    priced = price_cart(user=user, course_ids=course_ids, currency=currency, coupon_code=coupon_code)
    cur, courses, coupon, lines = priced["currency"], priced["courses"], priced["coupon"], priced["lines"]
    subtotal, total, rate = priced["subtotal"], priced["total"], priced["rate"]
    order = Order.objects.create(
        user=user,
        currency=cur,
        subtotal_minor=subtotal,
        discount_minor=subtotal - total,
        total_minor=total,
        fx_rate=rate,
        gbp_total_minor=pricing.gbp_equivalent(total, cur.exponent, rate),
        coupon=coupon,
        promotion=priced["promotion"],
        country=priced["country"],
    )
    OrderItem.objects.bulk_create(
        [
            OrderItem(
                order=order,
                user=user,
                course_id=cid,
                list_minor=lst,
                discount_minor=lst - price,
                gross_minor=price,
                gbp_gross_minor=pricing.gbp_equivalent(price, cur.exponent, rate),
            )
            for cid, lst, price in lines
        ]
    )
    if total == 0:
        fulfil_order(order_id=order.id)
        order.refresh_from_db()
        return {"order": order, "checkout_url": None}

    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": currency.lower(),
                    "unit_amount": gateway.to_stripe_amount(price, currency, cur.exponent),
                    "product_data": {"name": courses[cid].title[:250]},
                },
            }
            for cid, _, price in lines
            if price > 0
        ],
        metadata={"kind": "order", "id": str(order.id)},
        customer_email=user.email,
        success_url=f"{settings.FRONTEND_URL}/checkout/success?order={order.id}",
        cancel_url=f"{settings.FRONTEND_URL}/cart",
        idempotency_key=f"order-{order.id}",
    )
    Order.objects.filter(pk=order.pk).update(stripe_session_id=session["id"])
    order.stripe_session_id = session["id"]
    return {"order": order, "checkout_url": session["url"]}


@transaction.atomic
def fulfil_order(
    *, order_id, payment_intent: str = "", amount_minor: int | None = None, currency: str = ""
) -> Order:
    """Mark paid and enrol. Safe to call twice. A mismatch between what Stripe charged and
    what the order says is refused (and surfaces as a webhook error to investigate)."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.status == Order.Status.PAID:
        return order
    if order.status != Order.Status.PENDING:
        raise ServiceError("not_pending", f"Order is {order.status}.")
    if order.total_minor > 0:
        cur = order.currency
        expected = gateway.to_stripe_amount(order.total_minor, cur.code, cur.exponent)
        if amount_minor != expected or currency.upper() != cur.code:
            raise ServiceError("amount_mismatch", "Paid amount does not match the order.")
        Payment.objects.create(
            order=order, user_id=order.user_id, provider_ref=payment_intent, amount_minor=order.total_minor,
            currency=cur, status="succeeded", payment_method_type=order.payment_method_type,
            card_brand=order.card_brand, card_last4=order.card_last4,
        )  # fmt: skip
    now = timezone.now()
    order.status, order.paid_at, order.stripe_payment_intent_id = Order.Status.PAID, now, payment_intent
    order.save(update_fields=["status", "paid_at", "stripe_payment_intent_id", "updated_at"])
    if order.coupon_id:
        CouponRedemption.objects.create(coupon_id=order.coupon_id, order=order, user_id=order.user_id)
        # count it even if a parallel checkout raced past the limit: the money is already taken
        Coupon.objects.filter(pk=order.coupon_id).update(
            redeemed_count=F("redeemed_count") + 1, max_redemptions=_raise_limit_if_needed()
        )
    if order.promotion_id:
        promo_part = _promotion_discount(order)
        PromotionRedemption.objects.create(
            promotion_id=order.promotion_id, order=order, user_id=order.user_id, org_id=order.org_id,
            discount_minor=promo_part,
            gbp_discount_minor=pricing.gbp_equivalent(promo_part, order.currency.exponent, order.fx_rate),
        )  # fmt: skip
        Promotion.objects.filter(pk=order.promotion_id).update(redeemed_count=F("redeemed_count") + 1)
    user = order.user
    for item in order.items.select_related("course"):
        source = (
            Enrollment.Source.FREE
            if item.gross_minor == 0 and item.list_minor == 0
            else Enrollment.Source.PURCHASE
        )
        e = learning.enrol(user=user, course=item.course, source=source, source_ref=item.id)
        if e.status == Enrollment.Status.REVOKED:  # bought again after a refund
            Enrollment.objects.filter(pk=e.pk).update(status=Enrollment.Status.ACTIVE, source_ref=item.id)
        OrderItem.objects.filter(pk=item.pk).update(enrollment=e)
    CartItem.objects.filter(user_id=order.user_id, course_id__in=order.items.values("course_id")).delete()
    notify_order_paid(order.id)
    _receipt(order)
    return order


def _promotion_discount(order: Order) -> int:
    """The part of an order's discount that came from its platform promotion (the rest
    is the instructor coupon's), worked out from the stored lines."""
    coupon = order.coupon
    total = 0
    for item in order.items.all():
        alone = item.list_minor
        if coupon and coupon.course_id in (None, item.course_id):
            alone = min(alone, promotions.coupon_price(item.list_minor, coupon.percent_off))
        total += max(0, alone - item.gross_minor)
    return total


def _receipt(order: Order) -> None:
    from apps.engagement.notify import notify

    titles = list(order.items.values_list("course__title", flat=True))
    items = titles[0] if len(titles) == 1 else f"{titles[0]} and {len(titles) - 1} more"
    cur = order.currency
    notify([order.user_id], "order_receipt",
           {"items": items, "amount": pricing.format_money(order.total_minor, cur.code, cur.exponent)},
           url="/account/orders", dedupe=f"receipt:{order.id}")  # fmt: skip


def sync_order_from_stripe(order: Order) -> bool:
    """The thank-you page's fallback when the webhook is late or can't reach us (e.g. a
    laptop without the Stripe CLI): ask Stripe about the order's Checkout Session and
    fulfil it if it's paid. Same checks as the webhook; at most once per 5 s per order."""
    if order.status != Order.Status.PENDING or not order.stripe_session_id:
        return False
    if not cache.add(f"order-sync:{order.id}", 1, timeout=5):
        return False
    try:
        s = gateway.retrieve_checkout_session(order.stripe_session_id)
    except Exception:  # Stripe down or not configured: the webhook still completes it later
        log.warning("order %s: could not check its Checkout Session", order.id, exc_info=True)
        return False
    meta = s.get("metadata") or {}
    if s.get("payment_status") != "paid" or meta.get("kind") != "order" or meta.get("id") != str(order.id):
        return False
    from core.tenancy import tenant_context

    try:
        with tenant_context(staff=True):  # the same platform context the webhook uses
            fulfil_order(order_id=order.id, payment_intent=s.get("payment_intent") or "",
                         amount_minor=s.get("amount_total"), currency=s.get("currency") or "")  # fmt: skip
    except ServiceError:  # e.g. an amount mismatch: left for the webhook's error log to surface
        log.warning("order %s: paid session refused", order.id, exc_info=True)
        return False
    return True


def _raise_limit_if_needed():
    return Case(
        When(
            Q(max_redemptions__isnull=False) & Q(redeemed_count__gte=F("max_redemptions")),
            then=F("redeemed_count") + 1,
        ),
        default=F("max_redemptions"),
        output_field=PositiveIntegerField(),
    )


def expire_order(*, order_id) -> None:
    Order.objects.filter(pk=order_id, status=Order.Status.PENDING).update(
        status=Order.Status.EXPIRED, updated_at=timezone.now()
    )


def fail_order(*, order_id) -> bool:
    """A delayed payment (e.g. a bank debit) failed after checkout: the order is closed
    and the buyer is told. Only a pending order changes; a repeat does nothing."""
    from apps.engagement.notify import notify

    if not Order.objects.filter(pk=order_id, status=Order.Status.PENDING).update(
        status=Order.Status.FAILED, updated_at=timezone.now()
    ):
        return False
    order = Order.objects.get(pk=order_id)
    titles = list(order.items.values_list("course__title", flat=True))
    items = (
        (titles[0] if len(titles) == 1 else f"{titles[0]} and {len(titles) - 1} more")
        if titles
        else "your order"
    )
    notify([order.user_id], "order_payment_failed", {"items": items}, url="/account/orders",
           dedupe=f"order-failed:{order.id}")  # fmt: skip
    return True


def refund_window_days() -> int:
    """Client decision (refund policy): the setting, else the code default (30 days)."""
    from apps.platform.services import get_setting

    value = get_setting("payments.refund_window_days")
    return settings.REFUND_WINDOW_DAYS if value is None else int(value)


@transaction.atomic
def request_refund(*, item: OrderItem, by, reason: str = "") -> Refund:
    """Learner refund within the refund window: money back and access removed. Platform
    staff may refund at any time (console > Sales, always with a reason)."""
    order = Order.objects.select_for_update().get(pk=item.order_id)
    item = OrderItem.objects.get(pk=item.pk)  # re-read under the order lock: no double refunds
    if order.status not in (Order.Status.PAID, Order.Status.PARTIALLY_REFUNDED) or item.refunded_at:
        raise ServiceError("not_refundable", "This purchase cannot be refunded.")
    days = refund_window_days()
    if not by.is_staff and order.paid_at < timezone.now() - timedelta(days=days):
        raise ServiceError("refund_window", f"Refunds are available for {days} days.")
    refund = Refund.objects.create(
        item=item, user_id=item.user_id, amount_minor=item.gross_minor, reason=reason[:300], requested_by=by
    )
    if item.gross_minor > 0:
        cur = order.currency
        refund.provider_ref = gateway.refund(
            payment_intent=order.stripe_payment_intent_id,
            amount=gateway.to_stripe_amount(item.gross_minor, cur.code, cur.exponent),
            idempotency_key=f"refund-{refund.id}",
        )
    refund.status = Refund.Status.SUCCEEDED
    refund.save(update_fields=["provider_ref", "status", "updated_at"])
    now = timezone.now()
    OrderItem.objects.filter(pk=item.pk).update(refunded_at=now, updated_at=now)
    if item.enrollment_id:
        Enrollment.objects.filter(pk=item.enrollment_id).update(
            status=Enrollment.Status.REVOKED, updated_at=now
        )
    remaining = order.items.filter(refunded_at__isnull=True).exists()
    order.status = Order.Status.PARTIALLY_REFUNDED if remaining else Order.Status.REFUNDED
    order.save(update_fields=["status", "updated_at"])
    notify_item_refunded(item.id)
    _refund_notices(order, item, by)
    return refund


def _refund_notices(order: Order, item: OrderItem, by) -> None:
    from apps.engagement.notify import notify, notify_staff

    cur = order.currency
    amount = pricing.format_money(item.gross_minor, cur.code, cur.exponent)
    title = Course.objects.filter(pk=item.course_id).values_list("title", flat=True).first() or ""
    notify([item.user_id], "refund_issued", {"amount": amount, "course": title}, url="/account/orders",
           dedupe=f"refund:{item.id}")  # fmt: skip
    if by.pk == item.user_id:  # a learner refunded themselves: staff hear about it
        notify_staff("staff_self_refund", {"name": by.full_name or by.email, "course": title, "amount": amount},
                     url=f"/console/sales?order={order.id}", dedupe=f"self-refund:{item.id}")  # fmt: skip


# ---------------------------------------------------------------- subscriptions & add-ons
def _price_for(model, code: str, **filters):
    price = model.objects.filter(currency_id=code, **filters).exclude(stripe_price_id="").first()
    if price is None:
        raise ServiceError("bad_currency", f"Not available in {code}.")
    return price


@transaction.atomic
def start_subscription(
    *, user, plan: Plan, currency: str, seats: int = 1, org_id=None, promo_code: str = ""
) -> dict:
    """Personal plan (org_id None) or a company team plan (org_id set, seats >= min_seats).
    A subscription promotion for the plan (typed code or automatic) becomes a Stripe coupon."""
    if not plan.is_active:
        raise ServiceError("plan_unavailable", "This plan is not available.")
    if (plan.audience == Plan.Audience.TEAM) != (org_id is not None):
        raise ServiceError(
            "wrong_audience", "Team plans are bought by a company; personal plans by a person."
        )
    if seats < plan.min_seats:
        raise ServiceError("too_few_seats", f"This plan needs at least {plan.min_seats} seats.")
    live = Subscription.objects.filter(
        org_id=org_id, plan__audience=plan.audience, status__in=["trialing", "active", "past_due"]
    )
    live = live.filter(user=user) if org_id is None else live
    if live.exists():
        raise ServiceError("already_subscribed", "There is already an active subscription.")
    price = _price_for(PlanPrice, currency, plan=plan)
    promo = promotions.for_plan(user=user, plan=plan, code=(promo_code or "").strip())
    sub = Subscription.objects.create(user=user, org_id=org_id, plan=plan, currency_id=currency, seats=seats)
    meta = {"kind": "subscription", "id": str(sub.id), **({"promotion": str(promo.id)} if promo else {})}
    session = gateway.create_checkout_session(
        mode="subscription",
        line_items=[{"price": price.stripe_price_id, "quantity": seats}],
        metadata=meta,
        coupon=promo.stripe_coupon_id if promo else "",
        customer_email=user.email,
        success_url=f"{settings.FRONTEND_URL}/checkout/success?subscription={sub.id}",
        cancel_url=f"{settings.FRONTEND_URL}/plans",
        idempotency_key=f"sub-{sub.id}",
        trial_days=plan.trial_days,
        customer=_customer_id(user, org_id),
    )
    Subscription.objects.filter(pk=sub.pk).update(stripe_session_id=session["id"])
    return {"subscription": sub, "checkout_url": session["url"]}


@transaction.atomic
def start_addon(*, user, addon: Addon, currency: str, interval: str = "month", org_id=None) -> dict:
    price = _price_for(AddonPrice, currency, addon=addon, interval=interval)
    sub = AddonSubscription.objects.create(user=user, org_id=org_id, addon=addon, currency_id=currency)
    session = gateway.create_checkout_session(
        mode="subscription",
        line_items=[{"price": price.stripe_price_id, "quantity": 1}],
        metadata={"kind": "addon", "id": str(sub.id)},
        customer_email=user.email,
        success_url=f"{settings.FRONTEND_URL}/checkout/success?addon={sub.id}",
        cancel_url=f"{settings.FRONTEND_URL}/studio/addons",
        idempotency_key=f"addon-{sub.id}",
        customer=_customer_id(user, org_id),
    )
    AddonSubscription.objects.filter(pk=sub.pk).update(stripe_session_id=session["id"])
    return {"addon_subscription": sub, "checkout_url": session["url"]}


def _customer_id(user, org_id) -> str:
    if org_id:
        from apps.org.models import Organization

        return (
            Organization.objects.filter(pk=org_id).values_list("stripe_customer_id", flat=True).first() or ""
        )
    return user.stripe_customer_id or ""


def remember_customer(*, kind: str, row_id, customer: str) -> None:
    """After the first checkout, the Stripe customer is reused (no duplicate customers)."""
    if not customer:
        return
    from apps.identity.models import User
    from apps.org.models import Organization

    model = Subscription if kind == "subscription" else AddonSubscription
    row = model.objects.filter(pk=row_id).values("org_id", "user_id").first()
    if row is None:
        return
    if row["org_id"]:
        Organization.objects.filter(pk=row["org_id"], stripe_customer_id="").update(
            stripe_customer_id=customer
        )
    else:
        User.objects.filter(pk=row["user_id"], stripe_customer_id="").update(stripe_customer_id=customer)


def cancel_subscription(*, subscription: Subscription) -> None:
    """Stops renewal; access continues to the end of the paid period. The plan-change log
    and the subscriber's notice are written here (the webhook that follows sees the flag
    already set and adds nothing)."""
    if subscription.cancel_at_period_end:
        return
    if subscription.stripe_subscription_id:
        gateway.cancel_at_period_end(subscription.stripe_subscription_id)
    Subscription.objects.filter(pk=subscription.pk).update(
        cancel_at_period_end=True, updated_at=timezone.now()
    )
    subscription_event(subscription, SubscriptionEvent.Kind.CANCELLED, from_value=subscription.plan.code)
    subscription_notice(subscription, "cancelled")


def subscription_event(
    sub: Subscription, kind: str, *, from_value="", to_value="", amount_minor=None, at=None
):
    return SubscriptionEvent.objects.create(
        subscription=sub, user_id=sub.user_id, org_id=sub.org_id, kind=kind, from_value=str(from_value)[:80],
        to_value=str(to_value)[:80], amount_minor=amount_minor, at=at or timezone.now(),
    )  # fmt: skip


def subscription_notice(sub: Subscription, what: str, *, date=None) -> None:
    """started / renewed / cancelled / payment_failed / paused / resumed / trial_ending,
    to the subscriber (and, for a company plan that failed to renew, to the company's
    admins). `date` overrides the period end shown (the trial's end)."""
    from apps.engagement.notify import notify

    plan = sub.plan
    end = date or sub.current_period_end
    date = f"{end.day} {end:%b %Y}" if end else ""
    ctx = {"plan": plan.name, "date": date}
    if sub.org_id:
        if what == "payment_failed":
            from apps.org.models import Organization, OrgMember
            from core.tenancy import tenant_context

            with tenant_context(staff=True):
                admins = list(OrgMember.objects.filter(
                    org_id=sub.org_id, removed_at__isnull=True, role__in=["owner", "admin"]
                ).values_list("user_id", flat=True))  # fmt: skip
                company = (
                    Organization.objects.filter(pk=sub.org_id).values_list("name", flat=True).first() or ""
                )
            notify(admins, "company_payment_failed", {"company": company, "plan": plan.name},
                   url="/business/billing", dedupe=f"sub-failed:{sub.id}:{timezone.now():%Y%m%d}")  # fmt: skip
        return
    stamp = f"{end or timezone.now():%Y%m%d}"
    dedupe = f"sub-started:{sub.id}" if what == "started" else f"sub-{what}:{sub.id}:{stamp}"
    notify([sub.user_id], f"subscription_{what}", ctx, url="/account", dedupe=dedupe)


def plan_courses(plan: Plan) -> set | None:
    """The course ids a plan includes; None = every course marked `in_subscription`."""
    ids = set(PlanCourse.objects.filter(plan=plan).values_list("course_id", flat=True))
    return ids or None


def plan_covers(plan: Plan, course: Course) -> bool:
    included = plan_courses(plan)
    return course.in_subscription if included is None else course.id in included


def enrol_with_plan(*, user, course: Course) -> Enrollment:
    """Personal-plan learners enrol without buying; access ends with the subscription."""
    sub = (
        Subscription.objects.filter(
            user=user,
            org__isnull=True,
            plan__audience=Plan.Audience.PERSONAL,
            status__in=["trialing", "active"],
        )
        .order_by("-current_period_end")
        .first()
    )
    if sub is None or not sub.current_period_end:
        raise ServiceError("no_plan", "Subscribe to a plan to enrol in this course.", status=402)
    if course.owner_org_id is not None or course.live_version_id is None:
        raise ServiceError("not_for_sale", "This course is not available.")
    if not plan_covers(sub.plan, course):
        raise ServiceError(
            "not_in_plan", "This course is not included in the plan; buy it instead.", status=402
        )
    return learning.enrol(
        user=user, course=course, source=Enrollment.Source.SUBSCRIPTION, source_ref=sub.id,
        access_expires_at=sub.current_period_end,
    )  # fmt: skip


def sync_subscription_access(sub_id, period_end) -> int:
    """Renewal or cancellation moves the access end of every plan enrolment in one UPDATE."""
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE learning.enrollments SET access_expires_at = %s, updated_at = now()
             WHERE source = 'subscription' AND source_ref = %s
            """,
            [period_end, sub_id],
        )
        return cur.rowcount
