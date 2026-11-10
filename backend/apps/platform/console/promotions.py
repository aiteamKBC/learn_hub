"""Console > Promotions (mockup 13, bottom): promo codes, campaigns, subscription and
first-purchase offers, with targets, limits, schedule, usage and revenue. Checkout
applies them (apps/commerce/promotions.py); instructor coupons stay as they were."""

from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Avg, Count, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.commerce import gateway
from apps.commerce import promotions as engine
from apps.commerce.models import Coupon, Promotion, PromotionRedemption, PromotionTarget
from apps.platform.models import AuditLog
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, ConsoleReasonIn, router, staff
from .sales import csv_response, order_number

KINDS = "^(promo_code|campaign|subscription|first_purchase)$"


class ConsolePromoTargetIn(Schema):
    target_type: str = Field(..., pattern="^(all|course|category|plan|user_segment)$")
    target_id: UUID | None = None
    segment: str = Field("", pattern="^(|new_users|no_purchases|learners|company_members)$")


class ConsolePromotionIn(Schema):
    name: str = Field(..., min_length=2, max_length=120)
    kind: str = Field("campaign", pattern=KINDS)
    code: str = Field("", max_length=40, pattern=r"^[A-Za-z0-9_-]*$")
    description: str = Field("", max_length=300)
    percent_off: int = Field(..., ge=1, le=95)
    starts_at: datetime
    ends_at: datetime
    max_redemptions: int | None = Field(None, ge=1, le=10**7)
    per_user_limit: int | None = Field(None, ge=1, le=1000)
    min_order_minor: int = Field(0, ge=0, le=10**8)
    draft: bool = False
    targets: list[ConsolePromoTargetIn] = Field(default_factory=list, max_length=200)


class ConsolePromoTargetOut(Schema):
    target_type: str
    target_id: UUID | None
    segment: str
    label: str


class ConsolePromotionOut(Schema):
    id: UUID
    name: str
    kind: str
    code: str
    description: str
    percent_off: int
    starts_at: datetime
    ends_at: datetime
    is_active: bool
    status: str  # draft / scheduled / active / ended
    max_redemptions: int | None
    per_user_limit: int | None
    min_order_minor: int
    redeemed_count: int
    target_summary: str
    targets: list[ConsolePromoTargetOut]
    revenue_gbp_minor: int
    created_at: datetime


def _labels(targets) -> dict:
    """Names for course / category / plan targets, in three queries at most."""
    from apps.catalog.models import Category, Course
    from apps.commerce.models import Plan

    ids = {
        t: {x.target_id for x in targets if x.target_type == t and x.target_id}
        for t in ("course", "category", "plan")
    }
    names = {}
    names.update(dict(Course.objects.filter(pk__in=ids["course"]).values_list("id", "title")))
    names.update(dict(Category.objects.filter(pk__in=ids["category"]).values_list("id", "name")))
    names.update(dict(Plan.objects.filter(pk__in=ids["plan"]).values_list("id", "name")))
    return names


SEGMENTS = dict(PromotionTarget.Segment.choices)


def _summary(p: Promotion, targets: list) -> str:
    if p.kind == Promotion.Kind.FIRST_PURCHASE and not targets:
        return "First purchase"
    by = {}
    for t in targets:
        by.setdefault(t.target_type, []).append(t)
    parts = []
    for kind, word in (("course", "course"), ("category", "category"), ("plan", "plan")):
        if by.get(kind):
            n = len(by[kind])
            parts.append(f"Selected {word}{'s' if n > 1 else ''} ({n})" if n > 1 else f"1 {word}")
    if by.get("user_segment"):
        parts.append(", ".join(SEGMENTS.get(t.segment, t.segment) for t in by["user_segment"]))
    if not parts:
        return "All subscription plans" if p.kind == Promotion.Kind.SUBSCRIPTION else "All courses"
    return " · ".join(parts)


def _out(promos: list[Promotion], now=None) -> list[dict]:
    now = now or timezone.now()
    targets: dict = {}
    for t in PromotionTarget.objects.filter(promotion__in=promos):
        targets.setdefault(t.promotion_id, []).append(t)
    names = _labels([t for ts in targets.values() for t in ts])
    revenue = dict(
        PromotionRedemption.objects.filter(promotion__in=promos)
        .values_list("promotion_id")
        .annotate(v=Sum("order__gbp_total_minor"))
    )
    out = []
    for p in promos:
        ts = targets.get(p.id, [])
        out.append({
            "id": p.id, "name": p.name, "kind": p.kind, "code": p.code, "description": p.description,
            "percent_off": p.percent_off, "starts_at": p.starts_at, "ends_at": p.ends_at, "is_active": p.is_active,
            "status": engine.display_status(p, now), "max_redemptions": p.max_redemptions,
            "per_user_limit": p.per_user_limit, "min_order_minor": p.min_order_minor,
            "redeemed_count": p.redeemed_count, "target_summary": _summary(p, ts),
            "targets": [{"target_type": t.target_type, "target_id": t.target_id, "segment": t.segment,
                         "label": SEGMENTS.get(t.segment, "") if t.target_type == "user_segment"
                         else names.get(t.target_id, "Everything")} for t in ts],
            "revenue_gbp_minor": revenue.get(p.id) or 0, "created_at": p.created_at,
        })  # fmt: skip
    return out


# ---------------------------------------------------------------- overview & list
class ConsolePromoOverviewOut(Schema):
    active: int
    scheduled: int
    redemptions: int
    revenue_gbp_minor: int
    discount_gbp_minor: int
    average_discount_pct: float


@router.get("/promotions/overview", response=ConsolePromoOverviewOut)
def promotions_overview(request):
    staff(request)
    now = timezone.now()
    live = Promotion.objects.filter(is_active=True).exclude(status__in=["draft", "ended"])
    used = PromotionRedemption.objects.aggregate(
        n=Count("id"), revenue=Sum("order__gbp_total_minor"), discount=Sum("gbp_discount_minor")
    )
    avg = live.filter(starts_at__lte=now, ends_at__gt=now).aggregate(a=Avg("percent_off"))["a"]
    return {
        "active": live.filter(starts_at__lte=now, ends_at__gt=now).count(),
        "scheduled": live.filter(starts_at__gt=now).count(),
        "redemptions": used["n"] or 0,
        "revenue_gbp_minor": used["revenue"] or 0,
        "discount_gbp_minor": used["discount"] or 0,
        "average_discount_pct": round(float(avg or 0), 1),
    }


def _filtered(q, kind, status, target):
    qs = Promotion.objects.all()
    if q:
        term = q.strip()[:100]
        from django.db.models import Q

        qs = qs.filter(Q(name__icontains=term) | Q(code__icontains=term) | Q(description__icontains=term))
    if kind:
        qs = qs.filter(kind=kind)
    if target:
        qs = (
            qs.filter(targets__isnull=True)
            if target == "all"
            else qs.filter(targets__target_type=target).distinct()
        )
    rows = list(qs.order_by("-starts_at")[:500])
    if status:
        now = timezone.now()
        rows = [p for p in rows if engine.display_status(p, now) == status]
    return rows


@router.get("/promotions", response=list[ConsolePromotionOut])
def promotions(
    request,
    q: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    target: str | None = None,
):
    staff(request)
    return _out(_filtered(q, kind, status, target))


@router.get("/promotions/export.csv", include_in_schema=False)
def promotions_csv(request, q: str | None = None, kind: str | None = None, status: str | None = None,
                   target: str | None = None):  # fmt: skip
    staff(request)
    rows = _out(_filtered(q, kind, status, target))
    audit_request(request, "promotions.export", "promotion", "*", {"rows": len(rows)})
    header = ["Name", "Code", "Type", "Discount %", "Target", "Used", "Limit", "Per person", "Minimum order (GBP)",
              "Starts", "Ends", "Status", "Revenue (GBP)"]  # fmt: skip
    return csv_response("promotions.csv", header, (
        [r["name"], r["code"], r["kind"], r["percent_off"], r["target_summary"], r["redeemed_count"],
         r["max_redemptions"] or "", r["per_user_limit"] or "", r["min_order_minor"] / 100,
         r["starts_at"].isoformat(), r["ends_at"].isoformat(), r["status"], r["revenue_gbp_minor"] / 100]
        for r in rows
    ))  # fmt: skip


# ---------------------------------------------------------------- detail
class ConsolePromoUseOut(Schema):
    order_id: UUID
    order_number: str
    email: str
    discount_minor: int
    currency: str
    exponent: int
    total_minor: int
    at: datetime


class ConsolePromoActivityOut(Schema):
    action: str
    at: datetime
    data: dict


class ConsolePromotionDetailOut(Schema):
    promotion: ConsolePromotionOut
    uses: list[ConsolePromoUseOut]
    activity: list[ConsolePromoActivityOut]
    discount_gbp_minor: int


@router.get("/promotions/{promotion_id}", response=ConsolePromotionDetailOut)
def promotion_detail(request, promotion_id: UUID):
    staff(request)
    p = get_object_or_404(Promotion, pk=promotion_id)
    uses = list(
        PromotionRedemption.objects.filter(promotion=p)
        .select_related("order__currency", "user")
        .order_by("-created_at")[:50]
    )
    activity = AuditLog.objects.filter(target_type="promotion", target_id=str(p.id)).order_by("-created_at")[
        :30
    ]
    return {
        "promotion": _out([p])[0],
        "uses": [
            {
                "order_id": u.order_id,
                "order_number": order_number(u.order_id),
                "email": u.user.email,
                "discount_minor": u.discount_minor,
                "currency": u.order.currency_id,
                "exponent": u.order.currency.exponent,
                "total_minor": u.order.total_minor,
                "at": u.created_at,
            }
            for u in uses
        ],  # fmt: skip
        "activity": [{"action": a.action, "at": a.created_at, "data": a.data or {}} for a in activity],
        "discount_gbp_minor": PromotionRedemption.objects.filter(promotion=p).aggregate(
            v=Sum("gbp_discount_minor")
        )["v"]
        or 0,
    }


# ---------------------------------------------------------------- writes
def _validate(body: ConsolePromotionIn, exclude=None) -> str:
    if body.ends_at <= body.starts_at:
        raise ServiceError("bad_dates", "The end must be after the start.")
    code = body.code.strip()
    if body.kind == "promo_code" and not code:
        raise ServiceError("code_required", "A promo code needs a code buyers can type.")
    if code:
        clash = Promotion.objects.filter(code__iexact=code)
        if exclude:
            clash = clash.exclude(pk=exclude)
        if clash.exists() or Coupon.objects.filter(code__iexact=code).exists():
            raise ServiceError("code_taken", "Another promotion or coupon already uses this code.")
    for t in body.targets:
        if t.target_type in ("course", "category", "plan") and t.target_id is None:
            raise ServiceError("bad_target", "Choose what the promotion applies to.")
        if t.target_type == "user_segment" and not t.segment:
            raise ServiceError("bad_target", "Choose the group of people.")
        if t.target_type == "plan" and body.kind != "subscription":
            raise ServiceError("bad_target", "Only subscription promotions can target plans.")
    return code.upper()


def _save_targets(p: Promotion, targets: list[ConsolePromoTargetIn]) -> None:
    p.targets.all().delete()  # the targets are part of the promotion's definition
    PromotionTarget.objects.bulk_create([
        PromotionTarget(promotion=p, target_type=t.target_type,
                        target_id=t.target_id if t.target_type in ("course", "category", "plan") else None,
                        segment=t.segment if t.target_type == "user_segment" else "")
        for t in targets if t.target_type != "all"
    ])  # fmt: skip


def _stripe_coupon(p: Promotion) -> None:
    """Subscription promotions work through a Stripe coupon (made once per percentage)."""
    if p.kind != Promotion.Kind.SUBSCRIPTION:
        return
    p.stripe_coupon_id = gateway.create_coupon(
        percent_off=p.percent_off, name=p.name, idempotency_key=f"promo-{p.id}-{p.percent_off}"
    )
    p.save(update_fields=["stripe_coupon_id", "updated_at"])


@router.post("/promotions", response=ConsoleIdOut)
@transaction.atomic
def create_promotion(request, body: ConsolePromotionIn):
    staff(request)
    code = _validate(body)
    p = Promotion.objects.create(
        name=html.plain(body.name, 120), kind=body.kind, code=code, description=html.plain(body.description, 300),
        percent_off=body.percent_off, starts_at=body.starts_at, ends_at=body.ends_at,
        max_redemptions=body.max_redemptions, per_user_limit=body.per_user_limit,
        min_order_minor=body.min_order_minor, status="draft" if body.draft else "active",
    )  # fmt: skip
    _save_targets(p, body.targets)
    _stripe_coupon(p)
    audit_request(request, "promotion.create", "promotion", p.id, body.dict() | {"code": code})
    return {"id": p.id}


@router.put("/promotions/{promotion_id}", response=ConsoleOkOut)
@transaction.atomic
def update_promotion(request, promotion_id: UUID, body: ConsolePromotionIn):
    staff(request)
    p = get_object_or_404(Promotion.objects.select_for_update(), pk=promotion_id)
    code = _validate(body, exclude=p.pk)
    if p.redeemed_count and body.kind != p.kind:
        raise ServiceError(
            "in_use", "This promotion has been used; its type can't change. Duplicate it instead."
        )
    old_pct = p.percent_off
    p.name, p.kind, p.code = html.plain(body.name, 120), body.kind, code
    p.description, p.percent_off = html.plain(body.description, 300), body.percent_off
    p.starts_at, p.ends_at = body.starts_at, body.ends_at
    p.max_redemptions, p.per_user_limit, p.min_order_minor = (
        body.max_redemptions,
        body.per_user_limit,
        body.min_order_minor,
    )
    if body.draft and not p.redeemed_count:
        p.status = "draft"
    elif p.status == "draft":
        p.status = "active"
    p.save()
    _save_targets(p, body.targets)
    if p.kind == Promotion.Kind.SUBSCRIPTION and (old_pct != p.percent_off or not p.stripe_coupon_id):
        _stripe_coupon(p)
    audit_request(request, "promotion.update", "promotion", p.id, body.dict() | {"code": code})
    return {"ok": True}


@router.post("/promotions/{promotion_id}/duplicate", response=ConsoleIdOut)
@transaction.atomic
def duplicate_promotion(request, promotion_id: UUID):
    """A draft copy (no code: codes are unique; staff give it one before it goes live)."""
    staff(request)
    src = get_object_or_404(Promotion, pk=promotion_id)
    p = Promotion.objects.create(
        name=f"{src.name} (copy)"[:120], kind=src.kind, code="", description=src.description,
        percent_off=src.percent_off, starts_at=src.starts_at, ends_at=src.ends_at,
        max_redemptions=src.max_redemptions, per_user_limit=src.per_user_limit,
        min_order_minor=src.min_order_minor, status="draft",
    )  # fmt: skip
    PromotionTarget.objects.bulk_create([
        PromotionTarget(promotion=p, target_type=t.target_type, target_id=t.target_id, segment=t.segment)
        for t in src.targets.all()
    ])  # fmt: skip
    audit_request(request, "promotion.duplicate", "promotion", p.id, {"from": str(src.id)})
    return {"id": p.id}


@router.post("/promotions/{promotion_id}/deactivate", response=ConsoleOkOut)
def deactivate_promotion(request, promotion_id: UUID, body: ConsoleReasonIn):
    """Ends it now (checkout stops applying it at once). Kept for usage history."""
    staff(request)
    get_object_or_404(Promotion, pk=promotion_id)
    Promotion.objects.filter(pk=promotion_id).update(
        is_active=False, status="ended", updated_at=timezone.now()
    )
    audit_request(request, "promotion.deactivate", "promotion", promotion_id, {"reason": body.reason})
    return {"ok": True}


@router.delete("/coupons/{coupon_id}", response=ConsoleOkOut)
def stop_coupon(request, coupon_id: UUID):
    staff(request)
    Coupon.objects.filter(pk=coupon_id).update(is_active=False, updated_at=timezone.now())
    audit_request(request, "coupon.stop", "coupon", coupon_id)
    return {"ok": True}


# ---------------------------------------------------------------- pickers
class ConsolePromoOptionOut(Schema):
    id: UUID
    label: str


class ConsolePromoOptionsOut(Schema):
    courses: list[ConsolePromoOptionOut]
    categories: list[ConsolePromoOptionOut]
    plans: list[ConsolePromoOptionOut]


@router.get("/promotions-options", response=ConsolePromoOptionsOut)
def promotion_options(request, q: str = ""):
    """Courses (search), categories and plans for the target picker."""
    staff(request)
    from apps.catalog.models import Category, Course
    from apps.commerce.models import Plan

    courses = Course.objects.filter(owner_org_id__isnull=True, deleted_at__isnull=True)
    if q:
        courses = courses.filter(title__icontains=q.strip()[:100])
    return {
        "courses": [
            {"id": i, "label": t} for i, t in courses.order_by("title").values_list("id", "title")[:50]
        ],
        "categories": [
            {"id": i, "label": n} for i, n in Category.objects.order_by("name").values_list("id", "name")
        ],
        "plans": [{"id": i, "label": n} for i, n in Plan.objects.order_by("name").values_list("id", "name")],
    }
