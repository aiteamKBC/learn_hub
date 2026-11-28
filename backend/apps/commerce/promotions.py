"""Platform promotions (console > Promotions): which one applies, to what and for whom.

    campaign         automatic for its targets during its dates (a sale)
    promo_code       when the buyer enters its code (in the cart's coupon box)
    first_purchase   automatic on a buyer's first paid order
    subscription     plan checkout only, through a Stripe coupon

A promotion applies only while it is live (switched on, not a draft, inside its dates),
under its limits (total and per person) and when the order reaches its minimum (GBP
value of the list prices). Targets narrow it: course and category targets pick the
lines, plan targets pick plans, segment targets pick the buyers. No targets = everything.

One platform promotion per order: the one that saves the buyer most. Instructor coupons
keep working; the better of coupon and promotion wins on each line, unless the setting
`payments.allow_promotion_stacking` is on, then the promotion also applies on top of the
couponed price.
"""

from dataclasses import dataclass, field
from datetime import timedelta

from django.contrib.postgres.aggregates import ArrayAgg
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.platform.models import AuditLog
from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import Order, Promotion, PromotionRedemption, PromotionTarget, Subscription

LINE_TYPES = {"course", "category", "plan"}
PAID_ORDERS = (Order.Status.PAID, Order.Status.PARTIALLY_REFUNDED, Order.Status.REFUNDED)
SNAPSHOT_ACTION = "promotion.checkout_snapshot"
REDEEMED_ACTION = "promotion.checkout_redeemed"


def display_status(p: Promotion, now=None) -> str:
    """draft / scheduled / active / ended, from the stored status, the switch and the dates."""
    now = now or timezone.now()
    if p.status == Promotion.Status.DRAFT:
        return "draft"
    if not p.is_active or p.status == Promotion.Status.ENDED or p.ends_at <= now:
        return "ended"
    if p.starts_at > now:
        return "scheduled"
    return "active"


@dataclass
class Live:
    """A live promotion with its targets folded in (one query for all of them)."""

    promo: Promotion
    courses: set = field(default_factory=set)
    categories: set = field(default_factory=set)
    plans: set = field(default_factory=set)
    segments: set = field(default_factory=set)
    everything: bool = True  # no course / category / plan target (or an "all" one)

    @property
    def pct(self) -> int:
        return self.promo.percent_off

    def covers_course(self, course_id, category_id) -> bool:
        if self.everything:
            return True
        return course_id in self.courses or (category_id is not None and category_id in self.categories)

    def covers_plan(self, plan_id) -> bool:
        return self.everything or plan_id in self.plans

    @property
    def public(self) -> bool:
        """Shown on course cards to everyone: no buyer conditions."""
        return not self.segments and not self.promo.min_order_minor and self.promo.per_user_limit is None


def live(kinds, now=None, code: str = "") -> list[Live]:
    """Live promotions of these kinds, under their total limit. One query."""
    now = now or timezone.now()
    qs = (
        Promotion.objects.filter(kind__in=kinds, is_active=True, starts_at__lte=now, ends_at__gt=now)
        .exclude(status__in=[Promotion.Status.DRAFT, Promotion.Status.ENDED])
        .filter(Q(max_redemptions__isnull=True) | Q(redeemed_count__lt=F("max_redemptions")))
        .annotate(
            t_types=ArrayAgg("targets__target_type", default=[]),
            t_ids=ArrayAgg("targets__target_id", default=[]),
            t_segments=ArrayAgg("targets__segment", default=[]),
        )
        .order_by("-percent_off", "id")
    )
    if code:
        qs = qs.filter(code__iexact=code)
    out = []
    for p in qs:
        lv = Live(promo=p)
        for kind, tid, seg in zip(p.t_types, p.t_ids, p.t_segments, strict=True):
            if kind is None:
                continue
            if kind == "course":
                lv.courses.add(tid)
            elif kind == "category":
                lv.categories.add(tid)
            elif kind == "plan":
                lv.plans.add(tid)
            elif kind == "user_segment" and seg:
                lv.segments.add(seg)
        types = {k for k in p.t_types if k}
        lv.everything = "all" in types or not (types & LINE_TYPES)
        out.append(lv)
    return out


# ---------------------------------------------------------------- buyer checks
def in_segment(user, segment: str, now=None) -> bool:
    now = now or timezone.now()
    if segment == PromotionTarget.Segment.NEW_USERS:
        return user.created_at >= now - timedelta(days=30)
    if segment == PromotionTarget.Segment.NO_PURCHASES:
        return not Order.objects.filter(user=user, status__in=PAID_ORDERS).exists()
    if segment == PromotionTarget.Segment.LEARNERS:
        return not user.is_staff
    if segment == PromotionTarget.Segment.COMPANY_MEMBERS:
        from apps.org.models import OrgMember
        from core.tenancy import tenant_context

        with tenant_context(staff=True):  # memberships live under each company's RLS
            return OrgMember.objects.filter(user=user, removed_at__isnull=True).exists()
    return False


def buyer_ok(lv: Live, user, now=None) -> bool:
    if lv.segments and not any(in_segment(user, s, now) for s in lv.segments):
        return False
    if (
        lv.promo.kind == Promotion.Kind.FIRST_PURCHASE
        and Order.objects.filter(user=user, status__in=PAID_ORDERS).exists()
    ):
        return False
    if lv.promo.per_user_limit is not None:
        used = PromotionRedemption.objects.filter(promotion=lv.promo, user=user).count()
        if used >= lv.promo.per_user_limit:
            return False
    return True


def subscription_snapshot(subscription_id) -> dict | None:
    """The immutable provider parameters for one personal Checkout attempt."""
    with tenant_context(staff=True):
        row = (
            AuditLog.objects.filter(
                action=SNAPSHOT_ACTION, target_type="subscription", target_id=str(subscription_id)
            )
            .order_by("-id")
            .first()
        )
    return row.data if row else None


def _pending_subscription_ids(promotion_id) -> set[str]:
    with tenant_context(staff=True):
        ids = list(
            AuditLog.objects.filter(
                action=SNAPSHOT_ACTION,
                target_type="subscription",
                data__promotion_id=str(promotion_id),
            ).values_list("target_id", flat=True)
        )
        redeemed = set(
            AuditLog.objects.filter(
                action=REDEEMED_ACTION, target_type="subscription", target_id__in=ids
            ).values_list("target_id", flat=True)
        )
        live = Subscription.objects.filter(
            pk__in=set(ids) - redeemed,
            org__isnull=True,
            status__in=("incomplete", "trialing", "active", "past_due"),
        ).values_list("id", flat=True)
        return {str(subscription_id) for subscription_id in live}


def capacity_available(promo: Promotion, user) -> bool:
    """Call while holding this Promotion row lock before creating a reservation."""
    if promo.max_redemptions is None and promo.per_user_limit is None:
        return True
    with tenant_context(staff=True):
        pending_orders = Order.objects.filter(promotion=promo, status=Order.Status.PENDING)
        pending_subs = _pending_subscription_ids(promo.id)
        if promo.max_redemptions is not None:
            if promo.redeemed_count + pending_orders.count() + len(pending_subs) >= promo.max_redemptions:
                return False
        if promo.per_user_limit is not None:
            completed_orders = PromotionRedemption.objects.filter(promotion=promo, user=user).count()
            completed_subs = AuditLog.objects.filter(
                action=REDEEMED_ACTION,
                target_type="subscription",
                actor_id=user.id,
                data__promotion_id=str(promo.id),
            ).count()
            user_pending_subs = Subscription.objects.filter(pk__in=pending_subs, user=user).count()
            if (
                completed_orders
                + completed_subs
                + pending_orders.filter(user=user).count()
                + user_pending_subs
                >= promo.per_user_limit
            ):
                return False
    return True


@transaction.atomic
def redeem_subscription(*, subscription_id, promotion_id) -> bool:
    """Count a completed personal Checkout once, even across distinct webhook events."""
    from apps.platform.services import audit

    with tenant_context(staff=True):
        snapshot = subscription_snapshot(subscription_id)
        if not snapshot or snapshot.get("promotion_id") != str(promotion_id):
            return False  # legacy checkout; its existing linked-session path remains in use
        promo = Promotion.objects.select_for_update().get(pk=promotion_id)
        if AuditLog.objects.filter(
            action=REDEEMED_ACTION, target_type="subscription", target_id=str(subscription_id)
        ).exists():
            return True
        sub = Subscription.objects.get(pk=subscription_id, org__isnull=True)
        Promotion.objects.filter(pk=promo.pk).update(redeemed_count=F("redeemed_count") + 1)
        audit(
            REDEEMED_ACTION,
            "subscription",
            str(sub.id),
            actor_id=sub.user_id,
            data={"promotion_id": str(promo.id)},
        )
        return True


# ---------------------------------------------------------------- prices
def discounted(amount_minor: int, pct: int, exponent: int) -> int:
    """`pct` off, rounded to a natural price like the catalogue shows (never above the input)."""
    from .pricing import natural_minor, to_major

    if amount_minor <= 0:
        return 0
    return min(amount_minor, natural_minor(to_major(amount_minor, exponent) * (100 - pct) / 100, exponent))


def coupon_price(list_minor: int, pct: int) -> int:
    return list_minor * (100 - pct) // 100  # instructor coupons: exactly as before M5


def best_for_cart(
    *,
    user,
    lines: list,
    exponent: int,
    gbp_subtotal: int,
    coupon,
    code_promo,
    stack: bool,
    now,
    excluded_promotion_ids=frozenset(),
):
    """lines = [(course_id, category_id, list_minor)]. Returns (promotion or None, {course_id: price})
    with the coupon already applied; the promotion is the one that saves most in total."""

    def prices_with(lv: Live | None) -> dict:
        out = {}
        for cid, cat, lst in lines:
            base = lst
            with_coupon = (
                coupon_price(lst, coupon.percent_off) if coupon and coupon.course_id in (None, cid) else None
            )
            covered = lv is not None and lv.covers_course(cid, cat)
            if covered and with_coupon is not None and stack:
                price = discounted(with_coupon, lv.pct, exponent)
            else:
                options = [base]
                if with_coupon is not None:
                    options.append(with_coupon)
                if covered:
                    options.append(discounted(lst, lv.pct, exponent))
                price = min(options)
            out[cid] = price
        return out

    plain = prices_with(None)
    candidates = live([Promotion.Kind.CAMPAIGN, Promotion.Kind.FIRST_PURCHASE], now)
    if code_promo is not None:
        candidates.append(code_promo)
    best, best_prices, best_total = None, plain, sum(plain.values())
    for lv in candidates:
        if lv.promo.id in excluded_promotion_ids:
            continue
        if not capacity_available(lv.promo, user):
            continue
        if lv.promo.min_order_minor and gbp_subtotal < lv.promo.min_order_minor:
            continue
        if not any(lv.covers_course(cid, cat) for cid, cat, _ in lines) or not buyer_ok(lv, user, now):
            continue
        prices = prices_with(lv)
        total = sum(prices.values())
        if total < best_total:
            best, best_prices, best_total = lv.promo, prices, total
    return best, best_prices


def check_code(lv: Live, *, user, lines: list, gbp_subtotal: int, now) -> None:
    """A promo code the buyer typed: say why it does not apply instead of ignoring it."""
    from .pricing import gbp_money

    if not any(lv.covers_course(cid, cat) for cid, cat, _ in lines):
        raise ServiceError("bad_coupon", "This code does not apply to these courses.")
    if lv.promo.min_order_minor and gbp_subtotal < lv.promo.min_order_minor:
        raise ServiceError(
            "bad_coupon", f"Spend at least {gbp_money(lv.promo.min_order_minor)} to use this code."
        )
    if not buyer_ok(lv, user, now):
        raise ServiceError("coupon_used_up", "This code is not available on your account.")
    if not capacity_available(lv.promo, user):
        raise ServiceError("coupon_used_up", "This code has reached its usage limit.")


def find_code(code: str, now) -> Live | None:
    """A live promo code (any case); None when no promotion has that code."""
    if not code:
        return None
    found = live([Promotion.Kind.PROMO_CODE], now, code=code)
    if found:
        return found[0]
    if Promotion.objects.filter(code__iexact=code, kind=Promotion.Kind.PROMO_CODE).exists():
        raise ServiceError("bad_coupon", "This code has expired or is used up.")
    return None


def for_plan(*, user, plan, code: str = "", now=None) -> Promotion | None:
    """The subscription promotion for this plan checkout: a typed code, or an automatic one."""
    now = now or timezone.now()
    options = [
        lv
        for lv in live([Promotion.Kind.SUBSCRIPTION], now)
        if lv.promo.stripe_coupon_id
        and lv.covers_plan(plan.id)
        and buyer_ok(lv, user, now)
        and capacity_available(lv.promo, user)
    ]
    if code:
        match = [lv for lv in options if lv.promo.code.lower() == code.lower()]
        if not match:
            known = Promotion.objects.filter(kind=Promotion.Kind.SUBSCRIPTION, code__iexact=code).first()
            if known and display_status(known, now) != "active":
                raise ServiceError("bad_coupon", "This subscription code has expired.")
            if known and not capacity_available(known, user):
                raise ServiceError("coupon_used_up", "This subscription code has reached its usage limit.")
            raise ServiceError("bad_coupon", "This code does not apply to this plan.")
        return match[0].promo
    auto = [lv for lv in options if not lv.promo.code]
    return auto[0].promo if auto else None
