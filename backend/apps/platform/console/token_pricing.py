"""Console > Token pricing (B2C-03 / M13 — PR 2).

Mounts under /api/v1/console/pricing/token/* alongside the existing cash pricing
console (`pricing.py`). Business logic lives in `apps.commerce.pricing_service`; this
module only translates HTTP into service calls and errors into the shared
ServiceError shape.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DjValidationError
from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.catalog.models import Course, Lecture, LectureResource, Section
from apps.commerce import pricing_service
from apps.commerce.models import (
    BonusCampaign,
    PriceTier,
    TokenPack,
    TokenRate,
    TopUpPolicy,
)
from core.errors import ServiceError

from .common import ConsoleOkOut, clamp, router, staff

# A pydantic default that we can distinguish from "client sent null".
_UNSET = "__UNSET__"


def _unset(v):
    """Translate the pydantic placeholder to the service-layer UNSET sentinel."""
    return pricing_service.UNSET if v == _UNSET else v


# ---------------------------------------------------------------- error mapping
def _map_service_exc(exc):
    """Translate service-layer exceptions into ServiceError (the console's shape)."""
    if isinstance(exc, PermissionDenied):
        raise ServiceError("forbidden", "Staff only.", status=403)
    if isinstance(exc, pricing_service.ConfigurationBlocked):
        s = str(exc)
        code = "F02_BLOCKED" if "F02" in s else "C05_BLOCKED" if "C05" in s else "BLOCKED"
        raise ServiceError(code, s, status=409)
    if isinstance(exc, DjValidationError):
        msg = getattr(exc, "message", None) or (
            exc.messages[0] if getattr(exc, "messages", None) else str(exc)
        )
        code = "RATE_EFFECTIVE_FROM_PAST" if "effective_from" in msg and "future" in msg else "VALIDATION"
        raise ServiceError(code, msg, status=400)
    raise exc


# ============================================================================
# Schemas
# ============================================================================
class ConsoleReasonBody(Schema):
    reason: str = Field(..., min_length=3, max_length=500)


# ---------------------------------------------------------------- courses list / detail
class ConsoleCourseTokenRow(Schema):
    id: UUID
    title: str
    slug: str
    cash_price_tier_id: UUID | None
    full_course_token_price: int | None
    token_pricing_mode: str
    lectures_priced_count: int
    materials_priced_count: int
    updated_at: datetime


class ConsoleCourseTokenPage(Schema):
    items: list[ConsoleCourseTokenRow]
    total: int
    page: int
    page_size: int


class ConsoleMaterialTokenOut(Schema):
    id: UUID
    title: str
    position: int
    token_price: int | None
    is_free_preview: bool


class ConsoleLectureTokenOut(Schema):
    id: UUID
    title: str
    kind: str
    position: int
    duration_min: int
    token_price: int | None
    is_free_preview: bool
    is_preview: bool
    materials: list[ConsoleMaterialTokenOut]


class ConsoleSectionTokenOut(Schema):
    id: UUID
    title: str
    position: int
    lectures: list[ConsoleLectureTokenOut]


class ConsoleCourseTokenDetail(Schema):
    id: UUID
    title: str
    slug: str
    cash_price_tier_id: UUID | None
    full_course_token_price: int | None
    token_pricing_mode: str
    live_version_id: UUID | None
    sections: list[ConsoleSectionTokenOut]


# ---------------------------------------------------------------- PATCH bodies (UNSET-aware)
class ConsoleCourseTokenPatch(Schema):
    """UNSET vs null:

    A field left out of the request body stays at its current value (UNSET sentinel).
    A field sent explicitly as JSON `null` clears the column. A field sent with a
    value sets the column.
    """

    price_tier_id: Any = _UNSET  # UUID | None
    full_course_token_price: Any = _UNSET  # int | None
    token_pricing_mode: Any = _UNSET  # str
    reason: str = Field(..., min_length=3, max_length=500)


class ConsoleLectureTokenPatch(Schema):
    token_price: Any = _UNSET
    is_free_preview: Any = _UNSET
    confirm: bool = False
    reason: str = Field(..., min_length=3, max_length=500)


class ConsoleMaterialTokenPatch(ConsoleLectureTokenPatch):
    pass


# ---------------------------------------------------------------- distribute
class ConsoleDistributeWeightsIn(Schema):
    lecture_types: dict[str, float]
    use_duration: bool = False


class ConsoleDistributeIn(Schema):
    total_tokens: int = Field(..., ge=0)
    weights_config: ConsoleDistributeWeightsIn | None = None
    dry_run: bool = True
    reason: str = Field(..., min_length=3, max_length=500)


class ConsoleDistributeRow(Schema):
    lecture_id: UUID
    title: str
    kind: str
    duration_min: int
    current_price: int | None
    allocated_price: int


class ConsoleDistributePreviewOut(Schema):
    allocation: list[ConsoleDistributeRow]
    applied: bool


# ---------------------------------------------------------------- bulk
class ConsoleBulkCourseTokenPatch(Schema):
    price_tier_id: Any = _UNSET
    full_course_token_price: Any = _UNSET
    token_pricing_mode: Any = _UNSET


class ConsoleBulkCourseIn(Schema):
    course_ids: list[UUID] = Field(..., min_length=1, max_length=500)
    patch: ConsoleBulkCourseTokenPatch
    reason: str = Field(..., min_length=3, max_length=500)


class ConsoleBulkCourseRow(Schema):
    course_id: UUID
    ok: bool
    error: str | None


class ConsoleBulkCourseResult(Schema):
    results: list[ConsoleBulkCourseRow]


# ---------------------------------------------------------------- token packs
class ConsoleTokenPackOut(Schema):
    id: UUID
    name: str
    token_amount: int
    price_gbp_minor: int
    is_active: bool
    sort_order: int


class ConsoleTokenPackIn(Schema):
    name: str = Field(..., min_length=1, max_length=120)
    token_amount: int = Field(..., gt=0)
    price_gbp_minor: int = Field(..., gt=0)
    is_active: bool = True
    sort_order: int = 0
    reason: str = Field(..., min_length=3, max_length=500)


# ---------------------------------------------------------------- token rates
class ConsoleTokenRateOut(Schema):
    id: UUID
    tokens_per_gbp_minor: str
    effective_from: datetime
    effective_to: datetime | None
    notes: str
    is_current: bool


class ConsoleTokenRateIn(Schema):
    tokens_per_gbp_minor: Decimal = Field(..., gt=0)
    effective_from: datetime | None = None
    apply_immediately: bool = False
    notes: str = ""
    reason: str = Field(..., min_length=3, max_length=500)


# ---------------------------------------------------------------- top-up policies
class ConsoleTopUpPolicyOut(Schema):
    id: UUID
    currency: str
    min_minor: int
    max_minor: int
    is_active: bool


class ConsoleTopUpPolicyIn(Schema):
    min_minor: int = Field(..., ge=0)
    max_minor: int = Field(..., ge=0)
    is_active: bool = True
    reason: str = Field(..., min_length=3, max_length=500)


# ---------------------------------------------------------------- bonus campaigns
class ConsoleBonusCampaignOut(Schema):
    id: UUID
    name: str
    condition_type: str
    condition_value: dict
    bonus_tokens: int | None
    bonus_percent: str | None
    bonus_expiry_days: int | None
    starts_at: datetime
    ends_at: datetime
    is_active: bool


class ConsoleBonusCampaignIn(Schema):
    name: str = Field(..., min_length=1, max_length=120)
    condition_type: str
    condition_value: dict = {}
    bonus_tokens: int | None = None
    bonus_percent: Decimal | None = None
    bonus_expiry_days: int | None = None
    starts_at: datetime
    ends_at: datetime
    is_active: bool = False
    reason: str = Field(..., min_length=3, max_length=500)


# ---------------------------------------------------------------- audit
class ConsoleTokenAuditRow(Schema):
    id: int
    created_at: datetime
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    target_name: str
    data: dict


class ConsoleTokenAuditPage(Schema):
    items: list[ConsoleTokenAuditRow]
    total: int
    page: int
    page_size: int


# ============================================================================
# Helpers
# ============================================================================
TOKEN_AUDIT_TARGETS = (
    "course", "lecture", "material", "token_pack", "token_rate",
    "bonus_campaign", "topup_policy",
)  # fmt: skip


def _course_row(c: Course, lectures_priced=0, materials_priced=0) -> dict:
    return {
        "id": c.id,
        "title": c.title,
        "slug": c.slug,
        "cash_price_tier_id": c.cash_price_tier_id,
        "full_course_token_price": c.full_course_token_price,
        "token_pricing_mode": c.token_pricing_mode,
        "lectures_priced_count": lectures_priced,
        "materials_priced_count": materials_priced,
        "updated_at": c.updated_at,
    }


def _resolve_course_patch(payload) -> dict:
    """Pull PATCH fields into kwargs understood by `set_course_price`.

    exclude_unset distinguishes "absent" from "null". Absent → UNSET; explicit null
    → None; value → value. `price_tier_id` is translated into the related object."""
    sent = payload.dict(exclude_unset=True)
    kwargs: dict = {}
    if "price_tier_id" in sent:
        v = sent["price_tier_id"]
        if v is None:
            kwargs["price_tier"] = None
        else:
            kwargs["price_tier"] = get_object_or_404(PriceTier, pk=v)
    if "full_course_token_price" in sent:
        kwargs["full_course_token_price"] = sent["full_course_token_price"]
    if "token_pricing_mode" in sent:
        kwargs["mode"] = sent["token_pricing_mode"]
    return kwargs


# ============================================================================
# COURSES
# ============================================================================
@router.get("/pricing/token/courses", response=ConsoleCourseTokenPage)
def list_token_courses(request, search: str = "", page: int = 1, page_size: int = 25):
    staff(request)
    page = max(1, page)
    page_size = clamp(page_size, 200)
    qs = Course.objects.filter(owner_org_id__isnull=True, deleted_at__isnull=True)
    if search:
        qs = qs.filter(title__icontains=search.strip()[:100])
    total = qs.count()
    rows = list(qs.order_by("-updated_at")[(page - 1) * page_size : page * page_size])
    # Per-course counts of priced lectures/materials (via live version)
    lec_counts: dict = {}
    mat_counts: dict = {}
    for c in rows:
        if not c.live_version_id:
            continue
        lec_counts[c.id] = Lecture.objects.filter(
            version_id=c.live_version_id, token_price__isnull=False
        ).count()
        mat_counts[c.id] = LectureResource.objects.filter(
            lecture__version_id=c.live_version_id, token_price__isnull=False
        ).count()
    return {
        "items": [_course_row(c, lec_counts.get(c.id, 0), mat_counts.get(c.id, 0)) for c in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/pricing/token/courses/{course_id}", response=ConsoleCourseTokenDetail)
def get_token_course(request, course_id: UUID):
    staff(request)
    c = get_object_or_404(Course, pk=course_id)
    sections: list[dict] = []
    if c.live_version_id:
        secs = list(Section.objects.filter(version_id=c.live_version_id).order_by("position"))
        lectures_by_sec: dict = {}
        for lec in Lecture.objects.filter(version_id=c.live_version_id).order_by("position"):
            lectures_by_sec.setdefault(lec.section_id, []).append(lec)
        mats_by_lec: dict = {}
        all_lec_ids = [lecture.id for section in secs for lecture in lectures_by_sec.get(section.id, [])]
        for m in LectureResource.objects.filter(lecture_id__in=all_lec_ids).order_by("position"):
            mats_by_lec.setdefault(m.lecture_id, []).append(m)
        for s in secs:
            sections.append(
                {
                    "id": s.id,
                    "title": s.title,
                    "position": s.position,
                    "lectures": [
                        {
                            "id": lecture.id,
                            "title": lecture.title,
                            "kind": lecture.kind,
                            "position": lecture.position,
                            "duration_min": (lecture.duration_sec or 0) // 60,
                            "token_price": lecture.token_price,
                            "is_free_preview": lecture.is_free_preview,
                            "is_preview": lecture.is_preview,
                            "materials": [
                                {
                                    "id": m.id,
                                    "title": m.title,
                                    "position": m.position,
                                    "token_price": m.token_price,
                                    "is_free_preview": m.is_free_preview,
                                }
                                for m in mats_by_lec.get(lecture.id, [])
                            ],
                        }
                        for lecture in lectures_by_sec.get(s.id, [])
                    ],
                }
            )
    return {
        "id": c.id,
        "title": c.title,
        "slug": c.slug,
        "cash_price_tier_id": c.cash_price_tier_id,
        "full_course_token_price": c.full_course_token_price,
        "token_pricing_mode": c.token_pricing_mode,
        "live_version_id": c.live_version_id,
        "sections": sections,
    }


@router.patch("/pricing/token/courses/{course_id}", response=ConsoleOkOut)
def patch_token_course(request, course_id: UUID, payload: ConsoleCourseTokenPatch):
    staff(request)
    c = get_object_or_404(Course, pk=course_id)
    try:
        pricing_service.set_course_price(
            c,
            **_resolve_course_patch(payload),
            actor=request.user,
            reason=payload.reason,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return {"ok": True}


# Server-authoritative quotes: any per-lecture amounts supplied by the client are ignored;
# the returned allocation is computed on the server from the weights_config.
@router.post("/pricing/token/courses/{course_id}/distribute-tokens", response=ConsoleDistributePreviewOut)
def distribute_tokens(request, course_id: UUID, payload: ConsoleDistributeIn):
    staff(request)
    c = get_object_or_404(Course, pk=course_id)
    weights = payload.weights_config.dict() if payload.weights_config else None
    try:
        rows = pricing_service.distribute_course_token_price(
            c,
            payload.total_tokens,
            weights_config=weights,
            actor=request.user,
            reason=payload.reason,
            dry_run=payload.dry_run,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    lectures = {
        lecture.id: lecture
        for lecture in Lecture.objects.filter(id__in=[r["lecture_id"] for r in rows])
    }
    return {
        "allocation": [
            {
                "lecture_id": r["lecture_id"],
                "title": lectures.get(r["lecture_id"]).title if r["lecture_id"] in lectures else "",
                "kind": lectures.get(r["lecture_id"]).kind if r["lecture_id"] in lectures else "",
                "duration_min": (lectures.get(r["lecture_id"]).duration_sec or 0) // 60 if r["lecture_id"] in lectures else 0,
                "current_price": r["current_price"],
                "allocated_price": r["allocated_price"],
            }
            for r in rows
        ],
        "applied": not payload.dry_run,
    }


# ============================================================================
# LECTURES / MATERIALS
# ============================================================================
@router.patch("/pricing/token/lectures/{lecture_id}", response=ConsoleOkOut)
def patch_token_lecture(request, lecture_id: UUID, payload: ConsoleLectureTokenPatch):
    staff(request)
    lec = get_object_or_404(Lecture, pk=lecture_id)
    sent = payload.dict(exclude_unset=True)
    try:
        if "token_price" in sent:
            pricing_service.set_lecture_token_price(
                lec,
                sent["token_price"],
                actor=request.user,
                reason=payload.reason,
                request=request,
            )
        if "is_free_preview" in sent:
            pricing_service.set_preview_flag(
                lec,
                sent["is_free_preview"],
                actor=request.user,
                reason=payload.reason,
                confirm=payload.confirm,
                request=request,
            )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return {"ok": True}


@router.patch("/pricing/token/materials/{material_id}", response=ConsoleOkOut)
def patch_token_material(request, material_id: UUID, payload: ConsoleMaterialTokenPatch):
    staff(request)
    mat = get_object_or_404(LectureResource, pk=material_id)
    sent = payload.dict(exclude_unset=True)
    try:
        if "token_price" in sent:
            pricing_service.set_material_token_price(
                mat,
                sent["token_price"],
                actor=request.user,
                reason=payload.reason,
                request=request,
            )
        if "is_free_preview" in sent:
            pricing_service.set_preview_flag(
                mat,
                sent["is_free_preview"],
                actor=request.user,
                reason=payload.reason,
                confirm=payload.confirm,
                request=request,
            )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return {"ok": True}


# ============================================================================
# BULK
# ============================================================================
@router.post("/pricing/token/courses-bulk", response=ConsoleBulkCourseResult)
def bulk_patch_courses(request, payload: ConsoleBulkCourseIn):
    staff(request)
    # Pull once at the outer scope so the sentinel semantics match the per-course PATCH.
    patch_sent = payload.patch.dict(exclude_unset=True)
    tier = None
    if "price_tier_id" in patch_sent and patch_sent["price_tier_id"] is not None:
        tier = get_object_or_404(PriceTier, pk=patch_sent["price_tier_id"])
    results = []
    for cid in payload.course_ids:
        try:
            c = Course.objects.get(pk=cid)
            kwargs: dict = {}
            if "price_tier_id" in patch_sent:
                kwargs["price_tier"] = tier if patch_sent["price_tier_id"] is not None else None
            if "full_course_token_price" in patch_sent:
                kwargs["full_course_token_price"] = patch_sent["full_course_token_price"]
            if "token_pricing_mode" in patch_sent:
                kwargs["mode"] = patch_sent["token_pricing_mode"]
            pricing_service.set_course_price(
                c,
                **kwargs,
                actor=request.user,
                reason=payload.reason,
                request=request,
            )
            results.append({"course_id": cid, "ok": True, "error": None})
        except Course.DoesNotExist:
            results.append({"course_id": cid, "ok": False, "error": "not_found"})
        except (PermissionDenied, pricing_service.ConfigurationBlocked, DjValidationError) as e:
            results.append({"course_id": cid, "ok": False, "error": str(e)})
    return {"results": results}


# ============================================================================
# TOKEN PACKS
# ============================================================================
def _token_pack_price_tier(gbp_minor: int) -> PriceTier:
    """Resolve an admin-entered GBP price to a reusable tier and its FX amounts."""
    tier = PriceTier.objects.filter(gbp_minor=gbp_minor, is_active=True).order_by("sort_order", "name").first()
    if tier:
        return tier

    pounds, pence = divmod(gbp_minor, 100)
    name = f"Tokens £{pounds}.{pence:02d}"
    named_tier = PriceTier.objects.filter(name=name).first()
    if named_tier:
        # Never rewrite a shared tier: courses or other packages may already use it.
        name = f"Tokens £{pounds}.{pence:02d} {uuid4().hex[:6]}"
    tier, _ = PriceTier.objects.get_or_create(
        name=name,
        defaults={"gbp_minor": gbp_minor, "is_active": True},
    )

    # Currency amounts are derived from this GBP base using the existing FX catalogue.
    from apps.commerce.pricing import reprice_tier

    reprice_tier(tier)
    return tier


def _pack_out(p: TokenPack) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "token_amount": p.token_amount,
        "price_gbp_minor": p.price_tier.gbp_minor,
        "is_active": p.is_active,
        "sort_order": p.sort_order,
    }


@router.get("/pricing/token/packs", response=list[ConsoleTokenPackOut])
def list_token_packs(request, include_inactive: bool = False):
    staff(request)
    qs = TokenPack.objects.select_related("price_tier").all()
    if not include_inactive:
        qs = qs.filter(is_active=True)
    return [_pack_out(p) for p in qs.order_by("sort_order", "name")]


@router.post("/pricing/token/packs", response=ConsoleTokenPackOut)
def create_token_pack(request, payload: ConsoleTokenPackIn):
    staff(request)
    try:
        with transaction.atomic():
            tier = _token_pack_price_tier(payload.price_gbp_minor)
            pack = pricing_service.upsert_token_pack(
                name=payload.name,
                token_amount=payload.token_amount,
                price_tier=tier,
                is_active=payload.is_active,
                sort_order=payload.sort_order,
                actor=request.user,
                reason=payload.reason,
                request=request,
            )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return _pack_out(pack)


@router.patch("/pricing/token/packs/{pack_id}", response=ConsoleTokenPackOut)
def update_token_pack(request, pack_id: UUID, payload: ConsoleTokenPackIn):
    staff(request)
    try:
        with transaction.atomic():
            tier = _token_pack_price_tier(payload.price_gbp_minor)
            pack = pricing_service.upsert_token_pack(
                pack_id=pack_id,
                name=payload.name,
                token_amount=payload.token_amount,
                price_tier=tier,
                is_active=payload.is_active,
                sort_order=payload.sort_order,
                actor=request.user,
                reason=payload.reason,
                request=request,
            )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return _pack_out(pack)


class ConsoleDeleteBody(Schema):
    reason: str = Field("soft-delete", min_length=3, max_length=500)


@router.delete("/pricing/token/packs/{pack_id}", response=ConsoleOkOut)
def delete_token_pack(request, pack_id: UUID):
    staff(request)
    pack = get_object_or_404(TokenPack, pk=pack_id)
    try:
        pricing_service.upsert_token_pack(
            pack_id=pack.id,
            name=pack.name,
            token_amount=pack.token_amount,
            price_tier=pack.price_tier,
            is_active=False,
            sort_order=pack.sort_order,
            actor=request.user,
            reason="soft-delete",
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return {"ok": True}


# ============================================================================
# TOKEN RATES
# ============================================================================
@router.get("/pricing/token/rates", response=list[ConsoleTokenRateOut])
def list_token_rates(request):
    staff(request)
    current = TokenRate.current()
    cur_id = current.id if current else None
    return [
        {
            "id": r.id,
            "tokens_per_gbp_minor": str(r.tokens_per_gbp_minor),
            "effective_from": r.effective_from,
            "effective_to": r.effective_to,
            "notes": r.notes,
            "is_current": r.id == cur_id,
        }
        for r in TokenRate.objects.order_by("-effective_from")
    ]


@router.post("/pricing/token/rates", response=ConsoleTokenRateOut)
def create_token_rate(request, payload: ConsoleTokenRateIn):
    staff(request)
    try:
        r = pricing_service.upsert_token_rate(
            tokens_per_gbp_minor=payload.tokens_per_gbp_minor,
            effective_from=payload.effective_from,
            apply_immediately=payload.apply_immediately,
            notes=payload.notes,
            actor=request.user,
            reason=payload.reason,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return {
        "id": r.id,
        "tokens_per_gbp_minor": str(r.tokens_per_gbp_minor),
        "effective_from": r.effective_from,
        "effective_to": r.effective_to,
        "notes": r.notes,
        "is_current": True,
    }


# ============================================================================
# TOP-UP POLICIES
# ============================================================================
def _policy_out(p: TopUpPolicy) -> dict:
    return {
        "id": p.id,
        "currency": p.currency,
        "min_minor": p.min_minor,
        "max_minor": p.max_minor,
        "is_active": p.is_active,
    }


@router.get("/pricing/token/topup-policies", response=list[ConsoleTopUpPolicyOut])
def list_topup_policies(request):
    staff(request)
    latest_by_currency = {}
    for policy in TopUpPolicy.objects.order_by("currency", "-created_at"):
        latest_by_currency.setdefault(policy.currency, policy)
    return [_policy_out(p) for p in latest_by_currency.values()]


@router.put("/pricing/token/topup-policies/{currency}", response=ConsoleTopUpPolicyOut)
def upsert_topup_policy(request, currency: str, payload: ConsoleTopUpPolicyIn):
    staff(request)
    code = currency.upper()[:3]
    # Idempotent short-circuit: identical active row → no new audit, no new row.
    existing = TopUpPolicy.objects.filter(
        currency=code,
        is_active=True,
        min_minor=payload.min_minor,
        max_minor=payload.max_minor,
    ).first()
    if existing and payload.is_active:
        return _policy_out(existing)
    try:
        p = pricing_service.upsert_topup_policy(
            currency=code,
            min_minor=payload.min_minor,
            max_minor=payload.max_minor,
            is_active=payload.is_active,
            actor=request.user,
            reason=payload.reason,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return _policy_out(p)


# ============================================================================
# BONUS CAMPAIGNS
# ============================================================================
def _camp_out(c: BonusCampaign) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "condition_type": c.condition_type,
        "condition_value": c.condition_value or {},
        "bonus_tokens": c.bonus_tokens,
        "bonus_percent": str(c.bonus_percent) if c.bonus_percent is not None else None,
        "bonus_expiry_days": c.bonus_expiry_days,
        "starts_at": c.starts_at,
        "ends_at": c.ends_at,
        "is_active": c.is_active,
    }


@router.get("/pricing/token/bonus-campaigns", response=list[ConsoleBonusCampaignOut])
def list_bonus_campaigns(request, include_inactive: bool = True):
    staff(request)
    qs = BonusCampaign.objects.all()
    if not include_inactive:
        qs = qs.filter(is_active=True)
    return [_camp_out(c) for c in qs.order_by("-starts_at")]


@router.post("/pricing/token/bonus-campaigns", response=ConsoleBonusCampaignOut)
def create_bonus_campaign(request, payload: ConsoleBonusCampaignIn):
    staff(request)
    try:
        camp = pricing_service.upsert_bonus_campaign(
            name=payload.name,
            condition_type=payload.condition_type,
            condition_value=payload.condition_value,
            bonus_tokens=payload.bonus_tokens,
            bonus_percent=payload.bonus_percent,
            bonus_expiry_days=payload.bonus_expiry_days,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            is_active=payload.is_active,
            actor=request.user,
            reason=payload.reason,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return _camp_out(camp)


@router.patch("/pricing/token/bonus-campaigns/{campaign_id}", response=ConsoleBonusCampaignOut)
def update_bonus_campaign(request, campaign_id: UUID, payload: ConsoleBonusCampaignIn):
    staff(request)
    try:
        camp = pricing_service.upsert_bonus_campaign(
            campaign_id=campaign_id,
            name=payload.name,
            condition_type=payload.condition_type,
            condition_value=payload.condition_value,
            bonus_tokens=payload.bonus_tokens,
            bonus_percent=payload.bonus_percent,
            bonus_expiry_days=payload.bonus_expiry_days,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            is_active=payload.is_active,
            actor=request.user,
            reason=payload.reason,
            request=request,
        )
    except Exception as e:  # noqa: BLE001 - centralized mapper converts service-layer errors
        _map_service_exc(e)
    return _camp_out(camp)


# ============================================================================
# AUDIT (scoped to token-pricing targets)
# ============================================================================
@router.get("/pricing/token/audit", response=ConsoleTokenAuditPage)
def token_audit(
    request,
    entity_type: str | None = None,
    entity_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    page: int = 1,
    page_size: int = 50,
):
    staff(request)
    page = max(1, page)
    page_size = clamp(page_size, 200)
    where = ["a.target_type = ANY(%s)"]
    params: list = [list(TOKEN_AUDIT_TARGETS)]
    if entity_type:
        if entity_type not in TOKEN_AUDIT_TARGETS:
            raise ServiceError("bad_entity_type", "Unknown entity_type.", status=400)
        where = ["a.target_type = %s"]
        params = [entity_type]
    if entity_id:
        where.append("a.target_id = %s")
        params.append(str(entity_id))
    if from_date:
        where.append("a.created_at >= %s")
        params.append(from_date)
    if to_date:
        where.append("a.created_at < %s")
        params.append(to_date)
    base = "FROM platform.audit_logs a WHERE " + " AND ".join(where)
    with connection.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) {base}", params)
        total = cur.fetchone()[0]
        cur.execute(
            f"SELECT a.id, a.created_at, a.actor_id, a.action, a.target_type, a.target_id, a.data "
            f"{base} ORDER BY a.created_at DESC, a.id DESC LIMIT %s OFFSET %s",
            [*params, page_size, (page - 1) * page_size],
        )
        rows = cur.fetchall()
    import json

    # Resolve internal IDs to names before returning the audit page. Keep this batched
    # (one query per entity type) so the richer display does not add an N+1 query.
    ids_by_type: dict[str, set[str]] = {}
    for row in rows:
        ids_by_type.setdefault(row[4], set()).add(str(row[5]))
    names: dict[tuple[str, str], str] = {}
    course_ids = ids_by_type.get("course", set())
    if course_ids:
        for obj in Course.objects.filter(id__in=course_ids).only("id", "title"):
            names[("course", str(obj.id))] = obj.title
    lecture_ids = ids_by_type.get("lecture", set())
    if lecture_ids:
        for obj in Lecture.objects.filter(id__in=lecture_ids).select_related("version__course").only("id", "title", "version__course__title"):
            names[("lecture", str(obj.id))] = f"{obj.version.course.title} · {obj.title}"
    material_ids = ids_by_type.get("material", set())
    if material_ids:
        for obj in LectureResource.objects.filter(id__in=material_ids).select_related("lecture__version__course").only("id", "title", "lecture__title", "lecture__version__course__title"):
            names[("material", str(obj.id))] = f"{obj.lecture.version.course.title} · {obj.title}"
    pack_ids = ids_by_type.get("token_pack", set())
    if pack_ids:
        for obj in TokenPack.objects.filter(id__in=pack_ids).only("id", "name"):
            names[("token_pack", str(obj.id))] = obj.name
    for row in rows:
        entity_type, entity_id = row[4], str(row[5])
        names.setdefault((entity_type, entity_id), {
            "token_rate": "Token value",
            "topup_policy": "Top-up policy",
            "bonus_campaign": "Bonus campaign",
        }.get(entity_type, "Pricing setting"))

    return {
        "items": [
            {
                "id": r[0],
                "created_at": r[1],
                "actor_id": r[2],
                "action": r[3],
                "target_type": r[4],
                "target_id": r[5],
                "target_name": names[(r[4], str(r[5]))],
                "data": r[6] if isinstance(r[6], dict) else json.loads(r[6] or "{}"),
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
