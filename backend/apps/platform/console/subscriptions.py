"""Console > Subscriptions (mockup 20): overview, plans (with included courses and prices
per currency), subscribers, payments, plan changes and revenue."""

from datetime import date, datetime, timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Course
from apps.commerce import gateway
from apps.commerce import services as shop
from apps.commerce.models import (
    Currency,
    Invoice,
    Plan,
    PlanCourse,
    PlanPrice,
    Subscription,
    SubscriptionEvent,
)
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from ..services import audit_request
from . import metrics
from .common import (
    ConsoleIdOut,
    ConsoleKpiOut,
    ConsoleOkOut,
    ConsolePointOut,
    ConsoleRangeOut,
    ConsoleReasonIn,
    clamp,
    kpi,
    parse_range,
    router,
    staff,
)
from .sales import ConsoleInvoicePageOut, invoice_rows

LIVE = ("trialing", "active", "past_due")


# ---------------------------------------------------------------- overview
class ConsoleSubsKpisOut(Schema):
    subscribers: ConsoleKpiOut  # every subscription that ever started
    active: ConsoleKpiOut
    renewals: ConsoleKpiOut
    revenue: ConsoleKpiOut


class ConsoleSubsByPlanOut(Schema):
    plan_id: UUID
    name: str
    active: int
    revenue_gbp_minor: int


class ConsoleSubsOverviewOut(Schema):
    range: ConsoleRangeOut
    kpis: ConsoleSubsKpisOut
    series: list[ConsolePointOut]
    by_plan: list[ConsoleSubsByPlanOut]


def _plan_revenue(start=None, end=None) -> dict:
    qs = Invoice.objects.filter(subscription__isnull=False).exclude(
        status__in=("void", "uncollectible", "draft")
    )
    if start:
        qs = qs.filter(issued_at__gte=start, issued_at__lt=end)
    rows = qs.values_list("subscription__plan_id", "currency_id").annotate(minor=Sum("amount_minor"))
    per_plan: dict = {}
    cache: dict = {}
    for plan_id, code, minor in rows:
        per_plan[plan_id] = per_plan.get(plan_id, 0) + metrics._to_gbp([(code, minor)], cache)
    return per_plan


@router.get("/subscriptions/overview", response=ConsoleSubsOverviewOut)
def subscriptions_overview(request, range: str = "30d", start: date | None = None, end: date | None = None):
    staff(request)
    r = parse_range(range, start, end)
    started = Subscription.objects.exclude(status="incomplete")

    def counts(s, e):
        return {
            "subscribers": started.filter(created_at__lt=e).count(),
            "active": started.filter(created_at__lt=e)
            .filter(Q(status__in=LIVE) | Q(status="canceled", canceled_at__gte=e))
            .count(),
            "renewals": SubscriptionEvent.objects.filter(kind="renewed", at__gte=s, at__lt=e).count(),
            "revenue": metrics.subscription_revenue_gbp(s, e),
        }

    now, before = counts(r.start, r.end), counts(r.previous_start, r.previous_end)
    active = dict(Subscription.objects.filter(status__in=LIVE).values_list("plan_id").annotate(n=Count("id")))
    revenue = _plan_revenue(r.start, r.end)
    return {
        "range": r.out(),
        "kpis": {k: kpi(now[k], before[k]) for k in now},
        "series": metrics.subscription_series(r.start, r.end),
        "by_plan": [
            {
                "plan_id": p.id,
                "name": p.name,
                "active": active.get(p.id, 0),
                "revenue_gbp_minor": revenue.get(p.id, 0),
            }
            for p in Plan.objects.order_by("audience", "interval", "name")
        ],  # fmt: skip
    }


# ---------------------------------------------------------------- plans
class ConsolePlanPriceIn(Schema):
    currency: str = Field(..., min_length=3, max_length=3)
    amount_minor: int = Field(..., ge=0, le=10**9)
    stripe_price_id: str = Field("", max_length=64, pattern=r"^(price_[A-Za-z0-9_]+)?$")
    create_stripe_price: bool = False  # make a new Stripe test price for this amount


class ConsolePlanPriceOut(Schema):
    currency: str
    exponent: int
    amount_minor: int
    stripe_price_id: str


class ConsolePlanOut(Schema):
    id: UUID
    code: str
    name: str
    description: str
    audience: str
    interval: str
    trial_days: int
    min_seats: int
    renewal: str
    is_active: bool
    prices: list[ConsolePlanPriceOut]
    included_courses: int | None  # None = every course marked "in subscription"
    all_courses: int  # how many that is today
    subscribers: int
    revenue_gbp_minor: int
    created_at: datetime


def _plans_out(plans) -> list[dict]:
    ids = [p.id for p in plans]
    included = dict(PlanCourse.objects.filter(plan_id__in=ids).values_list("plan_id").annotate(n=Count("id")))
    subs = dict(
        Subscription.objects.filter(plan_id__in=ids, status__in=LIVE)
        .values_list("plan_id")
        .annotate(n=Count("id"))
    )
    revenue = _plan_revenue()
    exp = dict(Currency.objects.values_list("code", "exponent"))
    in_sub = Course.objects.filter(in_subscription=True, live_version__isnull=False, deleted_at__isnull=True,
                                   owner_org_id__isnull=True).count()  # fmt: skip
    return [{"id": p.id, "code": p.code, "name": p.name, "description": p.description, "audience": p.audience,
             "interval": p.interval, "trial_days": p.trial_days, "min_seats": p.min_seats, "renewal": p.renewal,
             "is_active": p.is_active,
             "prices": [{"currency": x.currency_id, "exponent": exp.get(x.currency_id, 2), "amount_minor": x.amount_minor,
                         "stripe_price_id": x.stripe_price_id} for x in p.prices.all()],
             "included_courses": included.get(p.id), "all_courses": in_sub, "subscribers": subs.get(p.id, 0),
             "revenue_gbp_minor": revenue.get(p.id, 0), "created_at": p.created_at} for p in plans]  # fmt: skip


@router.get("/plans", response=list[ConsolePlanOut])
def plans(request, q: str | None = None, status: str | None = None, currency: str | None = None):
    staff(request)
    qs = Plan.objects.prefetch_related("prices").order_by("audience", "interval", "name")
    if q:
        qs = qs.filter(name__icontains=q.strip()[:80])
    if status in ("active", "inactive"):
        qs = qs.filter(is_active=status == "active")
    if currency:
        qs = qs.filter(prices__currency_id=currency.upper()[:3]).distinct()
    return _plans_out(list(qs))


class ConsolePlanIn(Schema):
    name: str = Field(..., min_length=2, max_length=80)
    code: str = Field(..., min_length=2, max_length=40, pattern=r"^[a-z0-9-]+$")
    description: str = Field("", max_length=300)
    audience: str = Field("personal", pattern="^(personal|team)$")
    interval: str = Field("month", pattern="^(month|year)$")
    trial_days: int = Field(0, ge=0, le=90)
    min_seats: int = Field(1, ge=1, le=10000)
    renewal: str = Field("automatic", pattern="^(automatic|manual)$")
    prices: list[ConsolePlanPriceIn] = Field(default_factory=list, max_length=40)
    course_ids: list[UUID] = Field(default_factory=list, max_length=2000)


class ConsolePlanPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=80)
    description: str | None = Field(None, max_length=300)
    trial_days: int | None = Field(None, ge=0, le=90)
    min_seats: int | None = Field(None, ge=1, le=10000)
    renewal: str | None = Field(None, pattern="^(automatic|manual)$")


def _stripe_price(plan: Plan, code: str, amount_minor: int) -> str:
    cur = get_object_or_404(Currency, code=code)
    return gateway.create_price(
        product_name=plan.name, product_key=plan.code, currency=code,
        unit_amount=gateway.to_stripe_amount(amount_minor, code, cur.exponent), interval=plan.interval,
        idempotency_key=f"plan-price-{plan.id}-{code}-{amount_minor}",
    )  # fmt: skip


def _set_price(plan: Plan, p: ConsolePlanPriceIn) -> None:
    code = p.currency.upper()
    if not Currency.objects.filter(code=code).exists():
        raise ServiceError("bad_currency", f"{code} is not a known currency.")
    price_id = p.stripe_price_id
    if p.create_stripe_price and not price_id:
        price_id = _stripe_price(plan, code, p.amount_minor)
    PlanPrice.objects.update_or_create(
        plan=plan, currency_id=code, defaults={"amount_minor": p.amount_minor, "stripe_price_id": price_id}
    )


def _set_courses(plan: Plan, course_ids: list) -> int:
    ids = set(
        Course.objects.filter(
            pk__in=course_ids, owner_org_id__isnull=True, deleted_at__isnull=True
        ).values_list("id", flat=True)
    )
    PlanCourse.objects.filter(plan=plan).exclude(course_id__in=ids).delete()
    have = set(PlanCourse.objects.filter(plan=plan).values_list("course_id", flat=True))
    PlanCourse.objects.bulk_create([PlanCourse(plan=plan, course_id=c) for c in ids - have])
    return len(ids)


@router.post("/plans", response=ConsoleIdOut)
@transaction.atomic
def create_plan(request, body: ConsolePlanIn):
    staff(request)
    if Plan.objects.filter(code=body.code).exists():
        raise ServiceError("code_taken", "Another plan already uses this code.")
    plan = Plan.objects.create(
        code=body.code, name=html.plain(body.name, 80), description=html.plain(body.description, 300),
        audience=body.audience, interval=body.interval, trial_days=body.trial_days, min_seats=body.min_seats,
        renewal=body.renewal,
    )  # fmt: skip
    for p in body.prices:
        _set_price(plan, p)
    _set_courses(plan, body.course_ids)
    audit_request(request, "plan.create", "plan", plan.id, body.dict() | {"course_ids": len(body.course_ids)})
    return {"id": plan.id}


@router.patch("/plans/{plan_id}", response=ConsoleOkOut)
def update_plan(request, plan_id: UUID, body: ConsolePlanPatch):
    staff(request)
    plan = get_object_or_404(Plan, pk=plan_id)
    changes = body.dict(exclude_unset=True, exclude_none=True)
    for k in ("name", "description"):
        if k in changes:
            changes[k] = html.plain(changes[k], 80 if k == "name" else 300)
    for k, v in changes.items():
        setattr(plan, k, v)
    plan.save(update_fields=[*changes, "updated_at"])
    audit_request(request, "plan.update", "plan", plan_id, changes)
    return {"ok": True}


class ConsolePlanStatusIn(Schema):
    is_active: bool
    reason: str = Field("", max_length=300)


@router.post("/plans/{plan_id}/status", response=ConsoleOkOut)
def plan_status(request, plan_id: UUID, body: ConsolePlanStatusIn):
    """Deactivate (reason required: no new subscribers; current ones keep their plan) or reactivate."""
    staff(request)
    plan = get_object_or_404(Plan, pk=plan_id)
    if not body.is_active and len(body.reason.strip()) < 3:
        raise ServiceError("reason_required", "Say why the plan is being deactivated.")
    if body.is_active and not plan.prices.exclude(stripe_price_id="").exists():
        raise ServiceError("no_price", "Add a price with a Stripe price before activating this plan.")
    Plan.objects.filter(pk=plan.pk).update(is_active=body.is_active, updated_at=timezone.now())
    audit_request(request, "plan.activate" if body.is_active else "plan.deactivate", "plan", plan_id,
                  {"reason": html.plain(body.reason, 300)})  # fmt: skip
    return {"ok": True}


@router.post("/plans/{plan_id}/duplicate", response=ConsoleIdOut)
@transaction.atomic
def duplicate_plan(request, plan_id: UUID):
    """A switched-off copy: same settings, included courses and amounts (Stripe prices are
    made when staff save each price, so the copy can be priced differently first)."""
    staff(request)
    src = get_object_or_404(Plan, pk=plan_id)
    code, n = f"{src.code}-copy"[:40], 2
    while Plan.objects.filter(code=code).exists():
        code, n = f"{src.code}-copy-{n}"[:40], n + 1
    plan = Plan.objects.create(
        code=code, name=f"{src.name} (copy)"[:80], description=src.description, audience=src.audience,
        interval=src.interval, trial_days=src.trial_days, min_seats=src.min_seats, renewal=src.renewal,
        is_active=False,
    )  # fmt: skip
    PlanPrice.objects.bulk_create(
        [
            PlanPrice(plan=plan, currency_id=p.currency_id, amount_minor=p.amount_minor)
            for p in src.prices.all()
        ]
    )
    PlanCourse.objects.bulk_create(
        [PlanCourse(plan=plan, course_id=c) for c in src.course_links.values_list("course_id", flat=True)]
    )
    audit_request(request, "plan.duplicate", "plan", plan.id, {"from": str(src.id)})
    return {"id": plan.id}


@router.put("/plans/{plan_id}/prices", response=ConsoleOkOut)
def set_plan_price(request, plan_id: UUID, body: ConsolePlanPriceIn):
    staff(request)
    plan = get_object_or_404(Plan, pk=plan_id)
    _set_price(plan, body)
    audit_request(request, "plan.price", "plan", plan_id, body.dict())
    return {"ok": True}


class ConsolePlanCourseOut(Schema):
    id: UUID
    title: str
    in_subscription: bool


class ConsolePlanCoursesOut(Schema):
    mode: str  # "listed" (only these) / "all_marked" (every course marked for plans)
    courses: list[ConsolePlanCourseOut]


class ConsolePlanCoursesIn(Schema):
    course_ids: list[UUID] = Field(..., max_length=2000)


@router.get("/plans/{plan_id}/courses", response=ConsolePlanCoursesOut)
def plan_courses(request, plan_id: UUID):
    staff(request)
    plan = get_object_or_404(Plan, pk=plan_id)
    ids = list(plan.course_links.values_list("course_id", flat=True))
    qs = Course.objects.filter(pk__in=ids) if ids else Course.objects.filter(
        in_subscription=True, live_version__isnull=False, deleted_at__isnull=True, owner_org_id__isnull=True)  # fmt: skip
    return {"mode": "listed" if ids else "all_marked",
            "courses": [{"id": c.id, "title": c.title, "in_subscription": c.in_subscription}
                        for c in qs.order_by("title")[:2000]]}  # fmt: skip


@router.put("/plans/{plan_id}/courses", response=ConsoleOkOut)
def set_plan_courses(request, plan_id: UUID, body: ConsolePlanCoursesIn):
    """An empty list = every course marked "in subscription" (the behaviour before M5)."""
    staff(request)
    plan = get_object_or_404(Plan, pk=plan_id)
    n = _set_courses(plan, body.course_ids)
    audit_request(request, "plan.courses", "plan", plan_id, {"courses": n})
    return {"ok": True}


# ---------------------------------------------------------------- subscribers
class ConsoleSubscriberOut(Schema):
    id: UUID
    user_id: UUID
    name: str
    email: str
    company: str
    plan_id: UUID
    plan: str
    status: str
    seats: int
    currency: str
    current_period_end: datetime | None
    cancel_at_period_end: bool
    started_at: datetime


class ConsoleSubscriberPageOut(Schema):
    items: list[ConsoleSubscriberOut]
    next_cursor: str | None


@router.get("/subscribers", response=ConsoleSubscriberPageOut)
def subscribers(
    request, q: str | None = None, plan: UUID | None = None, status: str | None = None,
    cursor: str | None = None, limit: int = 25,
):  # fmt: skip
    staff(request)
    limit = clamp(limit, 100)
    qs = Subscription.objects.exclude(status="incomplete").select_related("user", "plan", "org")
    if q:
        term = q.strip()[:100]
        qs = qs.filter(
            Q(user__email__icontains=term) | Q(user__full_name__icontains=term) | Q(org__name__icontains=term)
        )
    if plan:
        qs = qs.filter(plan_id=plan)
    if status:
        qs = qs.filter(status=status)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {"items": [{"id": s.id, "user_id": s.user_id, "name": s.user.full_name, "email": s.user.email,
                       "company": s.org.name if s.org_id else "", "plan_id": s.plan_id, "plan": s.plan.name,
                       "status": s.status, "seats": s.seats, "currency": s.currency_id,
                       "current_period_end": s.current_period_end, "cancel_at_period_end": s.cancel_at_period_end,
                       "started_at": s.created_at} for s in page],
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip


@router.post("/subscribers/{subscription_id}/cancel", response=ConsoleOkOut)
def cancel_subscriber(request, subscription_id: UUID, body: ConsoleReasonIn):
    """Cancel at the end of the paid period (access continues until then)."""
    staff(request)
    sub = get_object_or_404(Subscription.objects.select_related("plan"), pk=subscription_id)
    if sub.status not in LIVE:
        raise ServiceError("not_active", "This subscription is not active.")
    shop.cancel_subscription(subscription=sub)
    audit_request(request, "subscription.cancel", "subscription", subscription_id, {"reason": body.reason})
    return {"ok": True}


# ---------------------------------------------------------------- payments & plan changes
@router.get("/subscription-payments", response=ConsoleInvoicePageOut)
def subscription_payments(request, q: str | None = None, cursor: str | None = None, limit: int = 25):
    staff(request)
    limit = clamp(limit, 100)
    qs = Invoice.objects.filter(subscription__isnull=False).select_related("user", "currency")
    if q:
        qs = qs.filter(user__email__icontains=q.strip()[:100])
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": invoice_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


class ConsoleSubEventOut(Schema):
    id: UUID
    subscription_id: UUID
    name: str
    email: str
    plan: str
    kind: str
    from_value: str
    to_value: str
    amount_minor: int | None
    currency: str
    at: datetime


class ConsoleSubEventPageOut(Schema):
    items: list[ConsoleSubEventOut]
    next_cursor: str | None


@router.get("/subscription-events", response=ConsoleSubEventPageOut)
def subscription_events(
    request, kind: str | None = None, days: int | None = None, cursor: str | None = None, limit: int = 25
):
    staff(request)
    limit = clamp(limit, 100)
    qs = SubscriptionEvent.objects.select_related("subscription__plan", "user", "subscription")
    if kind:
        qs = qs.filter(kind=kind)
    if days:
        qs = qs.filter(at__gte=timezone.now() - timedelta(days=min(days, 3650)))
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {"items": [{"id": e.id, "subscription_id": e.subscription_id, "name": e.user.full_name,
                       "email": e.user.email, "plan": e.subscription.plan.name, "kind": e.kind,
                       "from_value": e.from_value, "to_value": e.to_value, "amount_minor": e.amount_minor,
                       "currency": e.subscription.currency_id, "at": e.at} for e in page],
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip
