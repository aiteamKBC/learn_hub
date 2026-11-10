"""Console > Commissions (mockup 33, top): the default rate, the subscription revenue pool,
per-instructor rates, commission rules and the discount setting.

Rates here are what the INSTRUCTOR keeps (70% = the platform takes 30%), except the
legacy `platform-fee` endpoints, which speak in the platform's cut. Every rate is copied
onto each earning when the sale happens, so no change here rewrites past earnings."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from django.db.models import Count, F, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Category, Course, CourseInstructor
from apps.engagement.notify import notify
from apps.identity.models import InstructorProfile, User
from apps.payouts import selectors as ledger
from apps.payouts import services as payouts
from apps.payouts.models import CommissionRule, Earning, RevenueShare
from core import cursor as keyset
from core.errors import ServiceError

from .. import services as platform
from ..services import audit_request
from .common import ConsoleKpiOut, clamp, kpi, pct, router, staff

C = RevenueShare.Channel


def _keeps(bps: int | None) -> float | None:
    return pct(bps)


def _rates() -> dict:
    return dict(RevenueShare.objects.values_list("channel", "instructor_bps"))


def _commission_changed(user_ids, keeps_pct: float) -> None:
    notify(list(user_ids), "commission_changed", {"rate": f"{keeps_pct:g}%"}, url="/studio/payouts")


# ---------------------------------------------------------------- legacy: the platform's cut
class ConsoleFeeOut(Schema):
    default_fee_pct: float


class ConsoleFeeIn(Schema):
    fee_pct: float = Field(ge=0, le=100)


class ConsoleInstructorFeeIn(Schema):
    fee_pct: float | None = Field(None, ge=0, le=100)  # None = follow the default


class ConsoleInstructorFeeOut(Schema):
    user_id: UUID
    platform_fee_pct: float
    fee_is_custom: bool


@router.get("/platform-fee", response=ConsoleFeeOut)
def platform_fee(request):
    staff(request)
    return {"default_fee_pct": pct(payouts.default_fee_bps())}


@router.put("/platform-fee", response=ConsoleFeeOut)
def set_platform_fee(request, body: ConsoleFeeIn):
    """The cut new instructors get on approval. Instructors already approved keep theirs."""
    staff(request)
    payouts.set_default_fee(fee_bps=round(body.fee_pct * 100))
    audit_request(request, "payouts.default_fee", "revenue_share", "marketplace", {"fee_pct": body.fee_pct})
    return {"default_fee_pct": pct(payouts.default_fee_bps())}


@router.put("/instructors/{user_id}/fee", response=ConsoleInstructorFeeOut)
def set_instructor_fee(request, user_id: str, body: ConsoleInstructorFeeIn):
    staff(request)
    bps = None if body.fee_pct is None else round(body.fee_pct * 100)
    payouts.set_instructor_fee(user_id=user_id, fee_bps=bps)
    audit_request(request, "payouts.instructor_fee", "user", user_id, {"fee_pct": body.fee_pct})
    fee = bps if bps is not None else payouts.default_fee_bps()
    _commission_changed([user_id], pct(10000 - fee))
    return {"user_id": user_id, "platform_fee_pct": pct(fee), "fee_is_custom": bps is not None}


# ---------------------------------------------------------------- overview and settings
class ConsoleCommissionOverviewOut(Schema):
    default_keeps_pct: float
    default_fee_pct: float
    pool_pct: float
    coupon_keeps_pct: float
    discount_reduces_commission: bool
    commissions_month: ConsoleKpiOut  # the platform's cut of marketplace sales, this month
    pool_month: ConsoleKpiOut  # instructors' share of subscription revenue, last settled month
    active_instructors: int
    active_rules: int


class ConsoleCommissionSettingsIn(Schema):
    default_keeps_pct: float | None = Field(None, ge=0, le=100)
    pool_pct: float | None = Field(None, ge=0, le=100)
    coupon_keeps_pct: float | None = Field(None, ge=0, le=100)
    discount_reduces_commission: bool | None = None


def _month_start(d):
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@router.get("/commissions/overview", response=ConsoleCommissionOverviewOut)
def commission_overview(request):
    staff(request)
    now = timezone.now()
    month = _month_start(now)
    last = _month_start(month - timezone.timedelta(days=1))
    sales = Earning.objects.filter(kind__in=["sale", "refund"])
    cut = F("gross_gbp_minor") - F("amount_gbp_minor")
    agg = sales.aggregate(
        now=Sum(cut, filter=Q(earned_at__gte=month), default=0),
        before=Sum(cut, filter=Q(earned_at__gte=last, earned_at__lt=month), default=0),
    )
    periods = list(
        Earning.objects.filter(kind="subscription")
        .values("period").annotate(t=Sum("amount_gbp_minor")).order_by("-period")[:2]
    )  # fmt: skip
    rates = _rates()
    return {
        "default_keeps_pct": pct(rates.get(C.MARKETPLACE, 10000)),
        "default_fee_pct": pct(10000 - rates.get(C.MARKETPLACE, 10000)),
        "pool_pct": pct(rates.get(C.SUBSCRIPTION_POOL, 0)),
        "coupon_keeps_pct": pct(rates.get(C.INSTRUCTOR_COUPON, 10000)),
        "discount_reduces_commission": bool(platform.get_setting("payments.discount_reduces_commission")),
        "commissions_month": kpi(agg["now"], agg["before"]),
        "pool_month": kpi(periods[0]["t"] if periods else 0, periods[1]["t"] if len(periods) > 1 else 0),
        "active_instructors": InstructorProfile.objects.filter(status="approved").count(),
        "active_rules": CommissionRule.objects.filter(is_active=True).count(),
    }


@router.put("/commissions/settings", response=ConsoleCommissionOverviewOut)
def set_commission_settings(request, body: ConsoleCommissionSettingsIn):
    """Client questions 1 and 16. Instructors already approved keep their own rate."""
    staff(request)
    changes = body.dict(exclude_none=True)
    if not changes:
        raise ServiceError("nothing_to_save", "Change something first.")
    channels = {"default_keeps_pct": C.MARKETPLACE, "pool_pct": C.SUBSCRIPTION_POOL,
                "coupon_keeps_pct": C.INSTRUCTOR_COUPON}  # fmt: skip
    for field, channel in channels.items():
        if field in changes:
            RevenueShare.objects.update_or_create(
                channel=channel, defaults={"instructor_bps": round(changes[field] * 100)}
            )
    if "discount_reduces_commission" in changes:
        platform.set_setting(key="payments.discount_reduces_commission",
                             value=changes["discount_reduces_commission"], by=request.user)  # fmt: skip
    audit_request(request, "commissions.settings", "revenue_share", "all", changes)
    return commission_overview(request)


# ---------------------------------------------------------------- instructor commissions
class ConsoleInstructorCommissionOut(Schema):
    user_id: UUID
    name: str
    email: str
    status: str
    courses: int
    keeps_pct: float
    fee_is_custom: bool
    rule_name: str | None
    rule_keeps_pct: float | None
    pool_share_pct: float | None
    earnings_gbp_minor: int


class ConsoleInstructorCommissionPageOut(Schema):
    items: list[ConsoleInstructorCommissionOut]
    next_cursor: str | None


@router.get("/commissions/instructors", response=ConsoleInstructorCommissionPageOut)
def instructor_commissions(
    request, q: str = "", status: str = "", cursor: str | None = None, limit: int = 25
):
    staff(request)
    limit = clamp(limit)
    qs = InstructorProfile.objects.select_related("user").exclude(status__in=["pending", "rejected"])
    if status:
        qs = qs.filter(status=status)
    if q.strip():
        qs = qs.filter(
            Q(user__full_name__icontains=q.strip()[:100]) | Q(user__email__icontains=q.strip()[:100])
        )
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    ids = [p.user_id for p in page]
    courses = dict(
        CourseInstructor.objects.filter(user_id__in=ids, course__deleted_at__isnull=True)
        .values("user_id").annotate(n=Count("course_id", distinct=True)).values_list("user_id", "n")
    )  # fmt: skip
    totals = ledger.totals_by_user(ids)
    latest = (
        Earning.objects.filter(kind="subscription")
        .order_by("-period")
        .values_list("period", flat=True)
        .first()
    )
    pool, pool_total = {}, 0
    if latest:
        pool = dict(
            Earning.objects.filter(kind="subscription", period=latest)
            .values("user_id").annotate(t=Sum("amount_gbp_minor")).values_list("user_id", "t")
        )  # fmt: skip
        pool_total = sum(pool.values())
    rules = {r.target_id: r for r in payouts.active_rules(timezone.now()) if r.scope == "instructor"}
    default = payouts.default_fee_bps()
    items = []
    for p in page:
        fee = p.platform_fee_bps if p.platform_fee_bps is not None else default
        rule = rules.get(p.user_id)
        items.append({
            "user_id": p.user_id, "name": p.user.full_name, "email": p.user.email, "status": p.status,
            "courses": courses.get(p.user_id, 0), "keeps_pct": pct(10000 - fee),
            "fee_is_custom": p.platform_fee_bps is not None, "rule_name": (rule.name or "Instructor rule") if rule else None,
            "rule_keeps_pct": pct(rule.instructor_bps) if rule else None,
            "pool_share_pct": round(pool.get(p.user_id, 0) * 100 / pool_total, 1) if pool_total else None,
            "earnings_gbp_minor": totals.get(p.user_id) or 0,
        })  # fmt: skip
    return {"items": items, "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}


class ConsoleInstructorKeepsIn(Schema):
    keeps_pct: float | None = Field(None, ge=0, le=100)  # None = follow the default


@router.put("/commissions/instructors/{user_id}", response=ConsoleInstructorFeeOut)
def set_instructor_keeps(request, user_id: UUID, body: ConsoleInstructorKeepsIn):
    """Same as the fee endpoint, in the instructor's terms (what they keep)."""
    fee = None if body.keeps_pct is None else round(100 - body.keeps_pct, 2)
    return set_instructor_fee(request, str(user_id), ConsoleInstructorFeeIn(fee_pct=fee))


# ---------------------------------------------------------------- rules
Scope = Literal["course", "instructor", "category", "price_band"]


class ConsoleCommissionRuleOut(Schema):
    id: UUID
    name: str
    scope: str
    target_id: UUID | None
    target_label: str
    band_min_gbp_minor: int | None
    band_max_gbp_minor: int | None
    keeps_pct: float
    priority: int
    is_active: bool
    is_live: bool  # active and inside its dates now
    starts_at: datetime | None
    ends_at: datetime | None
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class ConsoleCommissionRuleIn(Schema):
    name: str = Field("", max_length=120)
    scope: Scope
    target_id: UUID | None = None
    band_min_gbp_minor: int | None = Field(None, ge=0)
    band_max_gbp_minor: int | None = Field(None, ge=1)
    keeps_pct: float = Field(..., ge=0, le=100)
    priority: int = Field(0, ge=-100, le=100)
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None


def _labels(rules) -> dict:
    ids = {r.target_id for r in rules if r.target_id}
    out = dict(Course.objects.filter(pk__in=ids).values_list("id", "title"))
    out |= dict(User.objects.filter(pk__in=ids).values_list("id", "full_name"))
    out |= dict(Category.objects.filter(pk__in=ids).values_list("id", "name"))
    return out


def _band(r) -> str:
    from apps.commerce.pricing import gbp_money

    low = gbp_money(r.band_min_gbp_minor or 0)
    return f"{low} and up" if r.band_max_gbp_minor is None else f"{low} to {gbp_money(r.band_max_gbp_minor)}"


def _rule_rows(rules) -> list[dict]:
    labels, now = _labels(rules), timezone.now()
    names = dict(User.objects.filter(pk__in={r.created_by_id for r in rules if r.created_by_id})
                 .values_list("id", "full_name"))  # fmt: skip
    return [{
        "id": r.id, "name": r.name, "scope": r.scope, "target_id": r.target_id,
        "target_label": _band(r) if r.scope == "price_band" else labels.get(r.target_id, "Removed"),
        "band_min_gbp_minor": r.band_min_gbp_minor, "band_max_gbp_minor": r.band_max_gbp_minor,
        "keeps_pct": pct(r.instructor_bps), "priority": r.priority, "is_active": r.is_active,
        "is_live": r.is_active and (r.starts_at is None or r.starts_at <= now) and (r.ends_at is None or r.ends_at > now),
        "starts_at": r.starts_at, "ends_at": r.ends_at, "created_by": names.get(r.created_by_id),
        "created_at": r.created_at, "updated_at": r.updated_at,
    } for r in rules]  # fmt: skip


def _validate(body: ConsoleCommissionRuleIn) -> dict:
    data = body.dict()
    if body.scope == "price_band":
        data["target_id"] = None
        if body.band_min_gbp_minor is None and body.band_max_gbp_minor is None:
            raise ServiceError("band_required", "Enter the lowest or highest price of the band.")
        if body.band_max_gbp_minor is not None and body.band_max_gbp_minor <= (body.band_min_gbp_minor or 0):
            raise ServiceError("bad_band", "The highest price must be above the lowest.")
    else:
        data["band_min_gbp_minor"] = data["band_max_gbp_minor"] = None
        model = {"course": Course, "instructor": User, "category": Category}[body.scope]
        if body.target_id is None or not model.objects.filter(pk=body.target_id).exists():
            raise ServiceError("target_required", f"Choose the {body.scope} this rule is for.")
        if (
            body.scope == "instructor"
            and not InstructorProfile.objects.filter(user_id=body.target_id).exists()
        ):
            raise ServiceError("target_required", "Choose an instructor.")
        if (
            body.scope == "course"
            and not Course.objects.filter(pk=body.target_id, ownership="instructor").exists()
        ):
            raise ServiceError("not_marketplace", "Commission rules apply to marketplace courses only.")
    if body.starts_at and body.ends_at and body.ends_at <= body.starts_at:
        raise ServiceError("bad_dates", "The end date must be after the start date.")
    data["name"] = data["name"].strip()
    data["instructor_bps"] = round(data.pop("keeps_pct") * 100)
    return data


def _rule_changed(rule: CommissionRule) -> None:
    """Tell the instructors a course or instructor rule is about (category and band rules
    reach too many people to message one by one)."""
    if not rule.is_active:
        return
    if rule.scope == "instructor":
        users = [rule.target_id]
    elif rule.scope == "course":
        users = list(
            CourseInstructor.objects.filter(course_id=rule.target_id).values_list("user_id", flat=True)
        )
    else:
        return
    _commission_changed(users, pct(rule.instructor_bps))


@router.get("/commissions/rules", response=list[ConsoleCommissionRuleOut])
def commission_rules(request, scope: str = "", active: str = ""):
    staff(request)
    qs = CommissionRule.objects.all()
    if scope:
        qs = qs.filter(scope=scope)
    if active in ("true", "false"):
        qs = qs.filter(is_active=active == "true")
    return _rule_rows(list(qs.order_by("scope", "-priority", "-created_at")[:500]))


@router.post("/commissions/rules", response=ConsoleCommissionRuleOut)
def create_rule(request, body: ConsoleCommissionRuleIn):
    staff(request)
    rule = CommissionRule.objects.create(**_validate(body), created_by=request.user)
    audit_request(request, "commission_rule.create", "commission_rule", str(rule.id), body.dict() | {
        "target_id": str(body.target_id) if body.target_id else None})  # fmt: skip
    _rule_changed(rule)
    return _rule_rows([rule])[0]


@router.put("/commissions/rules/{rule_id}", response=ConsoleCommissionRuleOut)
def update_rule(request, rule_id: UUID, body: ConsoleCommissionRuleIn):
    """Edits apply to sales from now on; earnings already recorded keep their rate."""
    staff(request)
    rule = get_object_or_404(CommissionRule, pk=rule_id)
    before = rule.instructor_bps
    for k, v in _validate(body).items():
        setattr(rule, k, v)
    rule.save()
    audit_request(request, "commission_rule.update", "commission_rule", str(rule.id), body.dict() | {
        "target_id": str(body.target_id) if body.target_id else None, "previous_bps": before})  # fmt: skip
    _rule_changed(rule)
    return _rule_rows([rule])[0]


# ---------------------------------------------------------------- preview
class ConsoleCommissionPreviewOut(Schema):
    course_id: UUID
    course: str
    instructor: str | None
    price_gbp_minor: int
    keeps_pct: float
    source: str  # rule / instructor / default
    rule_id: UUID | None
    rule_name: str | None
    rule_scope: str | None


@router.get("/commissions/preview", response=ConsoleCommissionPreviewOut)
def commission_preview(request, course_id: UUID):
    """Which rate a sale of this course would use right now, and why."""
    staff(request)
    course = get_object_or_404(Course, pk=course_id, ownership="instructor")
    p = payouts.preview_rate(course_id=course.id)
    rule = p["rule"]
    name = User.objects.filter(pk=p["instructor_id"]).values_list("full_name", flat=True).first()
    return {"course_id": course.id, "course": course.title, "instructor": name,
            "price_gbp_minor": p["price_gbp_minor"], "keeps_pct": pct(p["instructor_bps"]), "source": p["source"],
            "rule_id": rule.id if rule else None, "rule_name": (rule.name or rule.get_scope_display()) if rule else None,
            "rule_scope": rule.scope if rule else None}  # fmt: skip
