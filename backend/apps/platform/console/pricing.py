"""Console > Pricing (mockup 13, top): course prices in every currency, regional prices,
bulk updates, pricing rules (preview, then apply), currencies and rates, price tiers and
pricing settings. Money is always minor units; GBP is the base."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from django.db import connection, transaction
from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Course, CourseInstructor
from apps.commerce import pricing
from apps.commerce.models import (
    CoursePrice,
    Currency,
    PriceTier,
    PriceTierAmount,
    PricingRule,
    RegionalPrice,
)
from apps.platform import services as platform
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, clamp, router, staff
from .sales import csv_response

PRICING_SETTINGS = (
    "pricing.regional_enabled", "pricing.fx_auto_refresh", "payments.prices_include_tax",
    "payments.refund_window_days", "payments.allow_promotion_stacking", "general.default_currency",
)  # fmt: skip


# ---------------------------------------------------------------- currencies (existing)
class ConsoleCurrencyPatch(Schema):
    is_active: bool | None = None
    stripe_supported: bool | None = None


class ConsoleRateIn(Schema):
    code: str = Field(..., min_length=3, max_length=3)
    rate: Decimal = Field(..., gt=0, max_digits=20, decimal_places=10)


class ConsoleTierAmountIn(Schema):
    amount_minor: int = Field(..., ge=0, le=10**12)
    lock: bool = True


class ConsoleLatestRateOut(Schema):
    rate: str
    date: date
    source: str


class ConsoleCurrencyOut(Schema):
    code: str
    name: str
    exponent: int
    is_active: bool
    stripe_supported: bool
    rate_source: str
    latest: ConsoleLatestRateOut | None


class ConsoleRateDateOut(Schema):
    rate_date: date


class ConsoleRefreshOut(Schema):
    rates: int
    repriced: int


class ConsoleTierRowOut(Schema):
    id: UUID
    name: str
    gbp_minor: int
    is_active: bool
    amount_minor: int | None
    locked: bool
    courses: int


@router.get("/currencies", response=list[ConsoleCurrencyOut])
def currencies(request, active: bool | None = None):
    staff(request)
    qs = Currency.objects.order_by("code")
    if active is not None:
        qs = qs.filter(is_active=active)
    with connection.cursor() as cur:
        cur.execute("SELECT DISTINCT ON (currency) currency, rate, rate_date, source FROM commerce.fx_rates "
                    "ORDER BY currency, rate_date DESC")  # fmt: skip
        latest = {c: {"rate": str(r), "date": d, "source": s} for c, r, d, s in cur.fetchall()}
    return [{"code": c.code, "name": c.name, "exponent": c.exponent, "is_active": c.is_active,
             "stripe_supported": c.stripe_supported, "rate_source": c.rate_source, "latest": latest.get(c.code)}
            for c in qs]  # fmt: skip


@router.patch("/currencies/{code}", response=ConsoleOkOut)
def update_currency(request, code: str, body: ConsoleCurrencyPatch):
    staff(request)
    code = code.upper()[:3]
    get_object_or_404(Currency, code=code)
    changes = body.dict(exclude_unset=True)
    if code == "GBP" and changes.get("is_active") is False:
        raise ServiceError("base_currency", "GBP is the base currency and stays on.")
    if changes.get("is_active") and code != "GBP":
        if not pricing.FxRate.objects.filter(currency_id=code).exists():
            raise ServiceError("no_rate", "Add an exchange rate before turning this currency on.")
    Currency.objects.filter(code=code).update(**changes, updated_at=timezone.now())
    if changes.get("is_active"):
        pricing.refresh_tier_amounts()
    audit_request(request, "currency.update", "currency", code, changes)
    return {"ok": True}


@router.post("/fx-rates", response=ConsoleRateDateOut)
def manual_rate(request, body: ConsoleRateIn):
    staff(request)
    fx = pricing.set_manual_rate(code=body.code.upper(), rate=body.rate)
    audit_request(request, "fx.manual", "currency", body.code.upper(), {"rate": str(body.rate)})
    return {"rate_date": fx.rate_date}


@router.post("/fx-rates/refresh", response=ConsoleRefreshOut)
def refresh_rates(request):
    staff(request)
    try:
        stored = pricing.fetch_ecb()
    except Exception as exc:  # the ECB feed is down or changed: say so, don't 500
        raise ServiceError("fx_unavailable", "The exchange-rate feed could not be reached. Try again later.",
                           status=502) from exc  # fmt: skip
    repriced = pricing.refresh_tier_amounts()
    audit_request(request, "fx.refresh", "currency", "*", {"rates": stored, "repriced": repriced})
    return {"rates": stored, "repriced": repriced}


@router.get("/price-tiers", response=list[ConsoleTierRowOut])
def price_tiers(request, currency: str = "USD"):
    staff(request)
    code = currency.upper()
    rows = {a.tier_id: a for a in PriceTierAmount.objects.filter(currency_id=code)}
    used = dict(CoursePrice.objects.filter(tier__isnull=False).values_list("tier_id").annotate(n=Count("id")))
    return [{"id": t.id, "name": t.name, "gbp_minor": t.gbp_minor, "is_active": t.is_active,
             "amount_minor": t.gbp_minor if code == "GBP" else (rows[t.id].amount_minor if t.id in rows else None),
             "locked": bool(t.id in rows and rows[t.id].is_locked), "courses": used.get(t.id, 0)}
            for t in PriceTier.objects.order_by("sort_order", "gbp_minor")]  # fmt: skip


@router.put("/price-tiers/{tier_id}/amounts/{code}", response=ConsoleOkOut)
def set_tier_amount(request, tier_id: UUID, code: str, body: ConsoleTierAmountIn):
    staff(request)
    tier = get_object_or_404(PriceTier, pk=tier_id)
    get_object_or_404(Currency, code=code.upper())
    pricing.set_tier_amount(tier=tier, code=code.upper(), amount_minor=body.amount_minor, lock=body.lock)
    audit_request(request, "tier.amount", "price_tier", tier_id, {"currency": code.upper(), **body.dict()})
    return {"ok": True}


class ConsoleTierPatch(Schema):
    gbp_minor: int = Field(..., ge=99, le=10**7)


@router.patch("/price-tiers/{tier_id}", response=ConsoleOkOut)
@transaction.atomic
def update_tier(request, tier_id: UUID, body: ConsoleTierPatch):
    """New GBP base price: every course on the tier changes, and the tier's unlocked
    prices in other currencies are recalculated from the latest rates at once."""
    staff(request)
    tier = get_object_or_404(PriceTier, pk=tier_id)
    before = tier.gbp_minor
    tier.gbp_minor = body.gbp_minor
    tier.save(update_fields=["gbp_minor", "updated_at"])
    pricing.reprice_tier(tier)
    audit_request(request, "tier.update", "price_tier", tier_id, {"from": before, "to": body.gbp_minor})
    return {"ok": True}


# ---------------------------------------------------------------- overview
class ConsolePricingOverviewOut(Schema):
    courses_with_price: int
    average_price_gbp_minor: int
    active_currencies: list[str]
    regional_overrides: int
    active_rules: int
    free_courses: int


@router.get("/pricing/overview", response=ConsolePricingOverviewOut)
def pricing_overview(request):
    staff(request)
    live = CoursePrice.objects.filter(course__deleted_at__isnull=True, course__owner_org_id__isnull=True)
    paid = live.filter(is_free=False)
    avg = paid.aggregate(a=Avg("tier__gbp_minor"))["a"] or 0
    return {
        "courses_with_price": paid.count(),
        "average_price_gbp_minor": int(avg),
        "active_currencies": list(Currency.objects.filter(is_active=True).values_list("code", flat=True)),
        "regional_overrides": RegionalPrice.objects.filter(is_active=True).count(),
        "active_rules": PricingRule.objects.filter(is_active=True, applied_at__isnull=True).count(),
        "free_courses": live.filter(is_free=True).count(),
    }


# ---------------------------------------------------------------- course grid
class ConsoleCourseAmountOut(Schema):
    currency: str
    exponent: int
    amount_minor: int
    regional: bool  # a country price in this currency exists


class ConsoleCoursePriceRowOut(Schema):
    id: UUID
    title: str
    slug: str
    status: str
    category: str | None
    instructors: list[str]
    is_free: bool
    tier_id: UUID | None
    tier_name: str | None
    gbp_minor: int | None
    amounts: list[ConsoleCourseAmountOut]
    pricing_type: str  # standard (tier) / custom (has its own regional prices) / free / unpriced
    regional_count: int
    in_subscription: bool


class ConsoleCoursePricePageOut(Schema):
    items: list[ConsoleCoursePriceRowOut]
    next_cursor: str | None
    currencies: list[str]


def _grid_qs(q, category, status, kind):
    qs = Course.objects.filter(owner_org_id__isnull=True, deleted_at__isnull=True)
    if q:
        term = q.strip()[:100]
        qs = qs.filter(
            Q(title__icontains=term) | Q(instructor_links__user__full_name__icontains=term)
        ).distinct()
    if category:
        qs = qs.filter(category_id=category)
    if status:
        qs = qs.filter(status=status)
    if kind == "free":
        qs = qs.filter(price__is_free=True)
    elif kind == "unpriced":
        qs = qs.filter(price__isnull=True)
    elif kind == "custom":
        qs = qs.filter(
            id__in=RegionalPrice.objects.filter(course__isnull=False, is_active=True).values("course_id")
        )
    elif kind == "standard":
        qs = qs.filter(price__is_free=False).exclude(
            id__in=RegionalPrice.objects.filter(course__isnull=False, is_active=True).values("course_id")
        )
    return qs


def _grid_rows(courses: list[Course]) -> tuple[list[dict], list[str]]:
    ids = [c.id for c in courses]
    cur = list(Currency.objects.filter(is_active=True).values("code", "exponent").order_by("code"))
    codes = ["GBP"] + [c["code"] for c in cur if c["code"] != "GBP"]
    exp = {c["code"]: c["exponent"] for c in cur} | {"GBP": 2}
    prices = {p.course_id: p for p in CoursePrice.objects.filter(course_id__in=ids).select_related("tier")}
    tier_ids = {p.tier_id for p in prices.values() if p.tier_id}
    amounts = {(a.tier_id, a.currency_id): a.amount_minor
               for a in PriceTierAmount.objects.filter(tier_id__in=tier_ids, currency_id__in=codes)}  # fmt: skip
    regional = list(RegionalPrice.objects.filter(is_active=True).filter(Q(course_id__in=ids) | Q(tier_id__in=tier_ids))
                    .values("course_id", "tier_id", "currency_id"))  # fmt: skip
    names: dict = {}
    for link in (
        CourseInstructor.objects.filter(course_id__in=ids).select_related("user").order_by("position")
    ):
        names.setdefault(link.course_id, []).append(link.user.full_name or link.user.email)
    out = []
    for c in courses:
        p = prices.get(c.id)
        own = [r for r in regional if r["course_id"] == c.id]
        by_tier = [r for r in regional if p and p.tier_id and r["tier_id"] == p.tier_id]
        reg_currencies = {r["currency_id"] for r in own + by_tier}
        if p is None:
            kind = "unpriced"
        elif p.is_free:
            kind = "free"
        else:
            kind = "custom" if own else "standard"
        row_amounts = []
        if p and p.tier_id:
            for code in codes:
                v = p.tier.gbp_minor if code == "GBP" else amounts.get((p.tier_id, code))
                if v is not None:
                    row_amounts.append({"currency": code, "exponent": exp.get(code, 2), "amount_minor": v,
                                        "regional": code in reg_currencies})  # fmt: skip
        out.append({"id": c.id, "title": c.title, "slug": c.slug, "status": c.status,
                    "category": c.category.name if c.category_id else None, "instructors": names.get(c.id, []),
                    "is_free": bool(p and p.is_free), "tier_id": p.tier_id if p else None,
                    "tier_name": p.tier.name if p and p.tier_id else None,
                    "gbp_minor": p.tier.gbp_minor if p and p.tier_id else (0 if p and p.is_free else None),
                    "amounts": row_amounts, "pricing_type": kind, "regional_count": len(own) + len(by_tier),
                    "in_subscription": c.in_subscription})  # fmt: skip
    return out, codes


@router.get("/pricing/courses", response=ConsoleCoursePricePageOut)
def course_prices(
    request, q: str | None = None, category: UUID | None = None, status: str | None = None,
    kind: str | None = None, cursor: str | None = None, limit: int = 25,
):  # fmt: skip
    staff(request)
    limit = clamp(limit, 100)
    qs = _grid_qs(q, category, status, kind)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.select_related("category").order_by("-id")[: limit + 1])
    page = rows[:limit]
    items, codes = _grid_rows(page)
    return {"items": items, "currencies": codes,
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip


@router.get("/pricing/courses/export.csv", include_in_schema=False)
def course_prices_csv(request, q: str | None = None, category: UUID | None = None, status: str | None = None,
                      kind: str | None = None):  # fmt: skip
    staff(request)
    courses = list(_grid_qs(q, category, status, kind).select_related("category").order_by("title")[:5000])
    items, codes = _grid_rows(courses)
    audit_request(request, "pricing.export", "course", "*", {"rows": len(items)})
    header = [
        "Course",
        "Instructors",
        "Category",
        "Status",
        "Pricing type",
        "Tier",
        *codes,
        "Regional prices",
    ]

    def cell(row, code):
        a = next((x for x in row["amounts"] if x["currency"] == code), None)
        return "" if a is None else a["amount_minor"] / 10 ** a["exponent"]

    return csv_response("course-prices.csv", header, (
        [r["title"], ", ".join(r["instructors"]), r["category"] or "", r["status"], r["pricing_type"],
         r["tier_name"] or ("Free" if r["is_free"] else ""), *[cell(r, c) for c in codes], r["regional_count"]]
        for r in items
    ))  # fmt: skip


class ConsolePricingCoursePriceIn(Schema):
    tier_id: UUID | None = None
    is_free: bool = False


class ConsoleBulkPriceIn(ConsolePricingCoursePriceIn):
    course_ids: list[UUID] = Field(..., min_length=1, max_length=500)


class ConsoleBulkPriceOut(Schema):
    updated: int


def _set_course_price(course_ids, tier_id, is_free) -> int:
    if not is_free:
        if tier_id is None:
            raise ServiceError("tier_required", "Choose a price tier, or make the course free.")
        get_object_or_404(PriceTier, pk=tier_id, is_active=True)
    ids = list(
        Course.objects.filter(pk__in=course_ids, owner_org_id__isnull=True).values_list("id", flat=True)
    )
    for cid in ids:
        CoursePrice.objects.update_or_create(
            course_id=cid, defaults={"tier_id": None if is_free else tier_id, "is_free": is_free}
        )
    return len(ids)


@router.put("/pricing/courses/{course_id}", response=ConsoleOkOut)
def set_course_price(request, course_id: UUID, body: ConsolePricingCoursePriceIn):
    staff(request)
    if not _set_course_price([course_id], body.tier_id, body.is_free):
        raise ServiceError("not_found", "Course not found.", status=404)
    audit_request(request, "course.price", "course", course_id, body.dict())
    return {"ok": True}


@router.post("/pricing/bulk", response=ConsoleBulkPriceOut)
@transaction.atomic
def bulk_price(request, body: ConsoleBulkPriceIn):
    staff(request)
    n = _set_course_price(body.course_ids, body.tier_id, body.is_free)
    audit_request(request, "course.price_bulk", "course", "*",
                  {"courses": [str(c) for c in body.course_ids], "tier_id": str(body.tier_id), "free": body.is_free})  # fmt: skip
    return {"updated": n}


# ---------------------------------------------------------------- regional prices
class ConsoleRegionalOut(Schema):
    id: UUID
    course_id: UUID | None
    course_title: str | None
    tier_id: UUID | None
    tier_name: str | None
    country: str
    currency: str
    exponent: int
    amount_minor: int
    standard_minor: int | None  # the tier's price in that currency, for comparison
    is_active: bool
    updated_at: datetime


class ConsoleRegionalIn(Schema):
    course_id: UUID | None = None
    tier_id: UUID | None = None
    country: str = Field(..., pattern=r"^[A-Za-z]{2}$")
    currency: str = Field(..., min_length=3, max_length=3)
    amount_minor: int = Field(..., ge=1, le=10**9)


class ConsoleRegionalPatch(Schema):
    amount_minor: int | None = Field(None, ge=1, le=10**9)
    is_active: bool | None = None


@router.get("/pricing/regional", response=list[ConsoleRegionalOut])
def regional_prices(request, country: str | None = None, course: UUID | None = None):
    staff(request)
    qs = RegionalPrice.objects.select_related("course", "tier", "currency").order_by("country", "-updated_at")
    if country:
        qs = qs.filter(country=country.upper()[:2])
    if course:
        qs = qs.filter(course_id=course)
    rows = list(qs[:500])
    course_tiers = dict(CoursePrice.objects.filter(course_id__in=[r.course_id for r in rows if r.course_id])
                        .values_list("course_id", "tier_id"))  # fmt: skip
    std = {(a.tier_id, a.currency_id): a.amount_minor for a in PriceTierAmount.objects.filter(
        tier_id__in={r.tier_id for r in rows if r.tier_id} | set(course_tiers.values()))}  # fmt: skip
    return [{"id": r.id, "course_id": r.course_id, "course_title": r.course.title if r.course_id else None,
             "tier_id": r.tier_id, "tier_name": r.tier.name if r.tier_id else None, "country": r.country,
             "currency": r.currency_id, "exponent": r.currency.exponent, "amount_minor": r.amount_minor,
             "standard_minor": std.get((r.tier_id or course_tiers.get(r.course_id), r.currency_id)),
             "is_active": r.is_active, "updated_at": r.updated_at} for r in rows]  # fmt: skip


@router.post("/pricing/regional", response=ConsoleIdOut)
def create_regional(request, body: ConsoleRegionalIn):
    staff(request)
    if (body.course_id is None) == (body.tier_id is None):
        raise ServiceError("bad_target", "Choose a course or a price tier.")
    code, country = body.currency.upper(), body.country.upper()
    if not Currency.objects.filter(code=code, is_active=True).exists():
        raise ServiceError("bad_currency", f"Turn {code} on before adding prices in it.")
    if body.course_id:
        get_object_or_404(Course, pk=body.course_id, owner_org_id__isnull=True)
    else:
        get_object_or_404(PriceTier, pk=body.tier_id)
    target = {"course_id": body.course_id} if body.course_id else {"tier_id": body.tier_id}
    row, _ = RegionalPrice.objects.update_or_create(
        **target,
        country=country,
        defaults={"currency_id": code, "amount_minor": body.amount_minor, "is_active": True},
    )
    audit_request(request, "pricing.regional", "regional_price", row.id,
                  {"country": country, "currency": code, "amount_minor": body.amount_minor,
                   **{k: str(v) for k, v in target.items()}})  # fmt: skip
    return {"id": row.id}


@router.patch("/pricing/regional/{regional_id}", response=ConsoleOkOut)
def update_regional(request, regional_id: UUID, body: ConsoleRegionalPatch):
    """Change the amount, or switch it off (rows are kept: past orders refer to them)."""
    staff(request)
    row = get_object_or_404(RegionalPrice, pk=regional_id)
    changes = body.dict(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(row, k, v)
    row.save(update_fields=[*changes, "updated_at"])
    audit_request(request, "pricing.regional_update", "regional_price", regional_id, changes)
    return {"ok": True}


# ---------------------------------------------------------------- pricing rules
class ConsoleRuleIn(Schema):
    name: str = Field(..., min_length=2, max_length=120)
    scope: str = Field("all", pattern="^(all|category|instructor)$")
    target_id: UUID | None = None
    action: str = Field(..., pattern="^(set_tier|percent)$")
    tier_id: UUID | None = None
    percent: int | None = Field(None, ge=-90, le=500)
    rounding: str = Field("nearest", pattern="^(nearest|up|down)$")


class ConsoleRuleOut(Schema):
    id: UUID
    name: str
    scope: str
    target_id: UUID | None
    target_name: str | None
    action: str
    tier_id: UUID | None
    tier_name: str | None
    percent: int | None
    rounding: str
    is_active: bool
    applied_at: datetime | None
    applied_count: int
    created_at: datetime


class ConsoleRuleChangeOut(Schema):
    course_id: UUID
    title: str
    from_tier: str | None
    from_gbp_minor: int | None
    to_tier: str
    to_gbp_minor: int


class ConsoleRulePreviewOut(Schema):
    changes: list[ConsoleRuleChangeOut]
    unchanged: int


def _target_name(rule) -> str | None:
    if rule.scope == "category" and rule.target_id:
        from apps.catalog.models import Category

        return Category.objects.filter(pk=rule.target_id).values_list("name", flat=True).first()
    if rule.scope == "instructor" and rule.target_id:
        from apps.identity.models import User

        u = User.objects.filter(pk=rule.target_id).values("full_name", "email").first()
        return (u["full_name"] or u["email"]) if u else None
    return None


def _rule_out(r: PricingRule) -> dict:
    return {"id": r.id, "name": r.name, "scope": r.scope, "target_id": r.target_id, "target_name": _target_name(r),
            "action": r.action, "tier_id": r.tier_id, "tier_name": r.tier.name if r.tier_id else None,
            "percent": r.percent, "rounding": r.rounding, "is_active": r.is_active, "applied_at": r.applied_at,
            "applied_count": r.applied_count, "created_at": r.created_at}  # fmt: skip


def pick_tier(target_gbp: int, tiers: list[PriceTier], rounding: str) -> PriceTier:
    """The tier for a GBP amount: nearest (ties go up), the one at or above, or at or below."""
    tiers = sorted(tiers, key=lambda t: t.gbp_minor)
    if rounding == "up":
        return next((t for t in tiers if t.gbp_minor >= target_gbp), tiers[-1])
    if rounding == "down":
        return next((t for t in reversed(tiers) if t.gbp_minor <= target_gbp), tiers[0])
    return min(tiers, key=lambda t: (abs(t.gbp_minor - target_gbp), -t.gbp_minor))


def rule_changes(rule: PricingRule) -> tuple[list[dict], int]:
    qs = CoursePrice.objects.filter(
        is_free=False, course__deleted_at__isnull=True, course__owner_org_id__isnull=True
    ).select_related("course", "tier")
    if rule.scope == "category":
        qs = qs.filter(course__category_id=rule.target_id)
    elif rule.scope == "instructor":
        qs = qs.filter(course__instructor_links__user_id=rule.target_id).distinct()
    tiers = list(PriceTier.objects.filter(is_active=True))
    if not tiers:
        raise ServiceError("no_tiers", "There are no active price tiers.")
    changes, unchanged = [], 0
    for p in qs.order_by("course__title")[:2000]:
        if rule.action == "set_tier":
            new = rule.tier
        else:
            target = p.tier.gbp_minor * (100 + (rule.percent or 0)) // 100
            new = pick_tier(target, tiers, rule.rounding)
        if new.id == p.tier_id:
            unchanged += 1
            continue
        changes.append({"course_id": p.course_id, "title": p.course.title, "from_tier": p.tier.name,
                        "from_gbp_minor": p.tier.gbp_minor, "to_tier": new.name, "to_gbp_minor": new.gbp_minor})  # fmt: skip
    return changes, unchanged


@router.get("/pricing/rules", response=list[ConsoleRuleOut])
def rules(request):
    staff(request)
    return [_rule_out(r) for r in PricingRule.objects.select_related("tier").order_by("-created_at")[:200]]


@router.post("/pricing/rules", response=ConsoleIdOut)
def create_rule(request, body: ConsoleRuleIn):
    staff(request)
    if body.scope != "all" and body.target_id is None:
        raise ServiceError("target_required", "Choose the category or instructor.")
    if body.action == "set_tier" and body.tier_id is None:
        raise ServiceError("tier_required", "Choose the price tier.")
    if body.action == "percent" and not body.percent:
        raise ServiceError("percent_required", "Enter the percentage change.")
    if body.tier_id:
        get_object_or_404(PriceTier, pk=body.tier_id, is_active=True)
    r = PricingRule.objects.create(
        name=html.plain(body.name, 120), scope=body.scope, target_id=body.target_id if body.scope != "all" else None,
        action=body.action, tier_id=body.tier_id if body.action == "set_tier" else None,
        percent=body.percent if body.action == "percent" else None, rounding=body.rounding, created_by=request.user,
    )  # fmt: skip
    audit_request(request, "pricing_rule.create", "pricing_rule", r.id, body.dict())
    return {"id": r.id}


@router.get("/pricing/rules/{rule_id}/preview", response=ConsoleRulePreviewOut)
def preview_rule(request, rule_id: UUID):
    staff(request)
    rule = get_object_or_404(PricingRule.objects.select_related("tier"), pk=rule_id)
    changes, unchanged = rule_changes(rule)
    return {"changes": changes, "unchanged": unchanged}


@router.post("/pricing/rules/{rule_id}/apply", response=ConsoleBulkPriceOut)
@transaction.atomic
def apply_rule(request, rule_id: UUID):
    """Writes the new course prices once; the rule stays as a record of what was done."""
    staff(request)
    rule = get_object_or_404(PricingRule.objects.select_for_update(), pk=rule_id)
    if rule.applied_at:
        raise ServiceError("already_applied", "This rule has already been applied.")
    if not rule.is_active:
        raise ServiceError("rule_off", "This rule is switched off.")
    changes, _ = rule_changes(rule)
    tiers = {t.name: t.id for t in PriceTier.objects.all()}
    for c in changes:
        CoursePrice.objects.filter(course_id=c["course_id"]).update(
            tier_id=tiers[c["to_tier"]], updated_at=timezone.now()
        )
    rule.applied_at, rule.applied_count = timezone.now(), len(changes)
    rule.save(update_fields=["applied_at", "applied_count", "updated_at"])
    audit_request(request, "pricing_rule.apply", "pricing_rule", rule_id,
                  {"courses": len(changes), "changes": [[str(c["course_id"]), c["from_tier"], c["to_tier"]]
                                                        for c in changes[:200]]})  # fmt: skip
    return {"updated": len(changes)}


@router.post("/pricing/rules/{rule_id}/off", response=ConsoleOkOut)
def switch_off_rule(request, rule_id: UUID):
    staff(request)
    PricingRule.objects.filter(pk=rule_id).update(is_active=False, updated_at=timezone.now())
    audit_request(request, "pricing_rule.off", "pricing_rule", rule_id)
    return {"ok": True}


# ---------------------------------------------------------------- settings
class ConsolePricingSettingOut(Schema):
    key: str
    label: str
    kind: str
    value: bool | int | str
    choices: list[str]


@router.get("/pricing/settings", response=list[ConsolePricingSettingOut])
def pricing_settings(request):
    """The pricing and promotion switches (saved through PUT /console/settings/{key})."""
    staff(request)
    from apps.platform import registry

    out = []
    for key in PRICING_SETTINGS:
        d = registry.BY_KEY[key]
        out.append({"key": key, "label": d.label, "kind": d.kind, "value": platform.get_setting(key),
                    "choices": list(d.choices or [])})  # fmt: skip
    return out
