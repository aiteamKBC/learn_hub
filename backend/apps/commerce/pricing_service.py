"""B2C-03 (M8 / M13) — Token pricing service.

Public mutation functions for the new token-pricing surface (TokenPack, TokenRate,
TopUpPolicy, BonusCampaign, Lecture/Material/Course token columns).

Invariant
---------
Price changes affect FUTURE purchases only. Existing `ContentEntitlement` rows and
`PriceSnapshot` rows are never modified or deleted by this module (A06).

Audit backend
-------------
We reuse the existing `apps.platform.services.audit()` helper (writes to the
partitioned, append-only `platform.audit_logs` table). No parallel `PricingAuditLog`
is defined — `audit()` already captures actor/target/when/data+reason and is
schema-registered. When a request is available we also run `audit_request()` for IP /
request_id enrichment; otherwise we call `audit()` directly (actor_id = actor.id).

Permissions
-----------
Every mutating function requires `actor.is_staff`. Non-staff → `PermissionDenied`.

BLOCKED (do not change without owner sign-off)
----------------------------------------------
* C05 default auto-distribution weights — no defaults invented here; callers must pass
  a `weights_config`.
* F02 bonus campaign funding model — `is_active=True` is rejected; draft config may be
  saved.
* T03 default grant expiry duration — this service doesn't grant tokens (that's M-wallet);
  mentioned only so callers know downstream.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.platform.services import audit, audit_request

UNSET = object()


class ConfigurationBlocked(Exception):
    """Raised when a decision owner hasn't signed off the knob being set."""


# ---------------------------------------------------------------- helpers
def _require_staff(actor) -> None:
    if actor is None or not getattr(actor, "is_staff", False):
        raise PermissionDenied("Staff only.")


def _actor_id(actor):
    return getattr(actor, "id", None) if actor is not None else None


def _audit(action: str, target_type: str, target_id, *, actor, reason: str, data: dict,
           request=None) -> None:
    payload = {"reason": reason, **data}
    if request is not None:
        audit_request(request, action, target_type, str(target_id), payload)
    else:
        audit(action, target_type, str(target_id), actor_id=_actor_id(actor), data=payload)


# ---------------------------------------------------------------- course / lecture / material prices
@transaction.atomic
def set_course_price(
    course,
    *,
    price_tier=UNSET,
    full_course_token_price=UNSET,
    mode=UNSET,
    actor,
    reason: str,
    request=None,
):
    """Set the cash tier, full-course token price, and pricing mode on a course.

    `UNSET` means "leave as-is"; `None` means "clear" (SQL NULL). This lets callers
    distinguish between the two, matching the brief.
    """
    _require_staff(actor)
    before = {
        "cash_price_tier_id": course.cash_price_tier_id,
        "full_course_token_price": course.full_course_token_price,
        "token_pricing_mode": course.token_pricing_mode,
    }
    changed = {}
    if price_tier is not UNSET:
        course.cash_price_tier = price_tier
        changed["cash_price_tier_id"] = getattr(price_tier, "id", None)
    if full_course_token_price is not UNSET:
        if full_course_token_price is not None and full_course_token_price < 0:
            raise ValidationError("full_course_token_price must be >= 0")
        # Manual-mode floor: must not undercut sum of per-lecture token prices (if any).
        if (
            full_course_token_price is not None
            and (mode if mode is not UNSET else course.token_pricing_mode) == "manual"
        ):
            # Lectures reachable via the live version
            live_version = course.live_version
            if live_version is not None:
                from apps.catalog.models import Lecture

                lecture_sum = (
                    Lecture.objects.filter(
                        version=live_version, token_price__isnull=False
                    ).values_list("token_price", flat=True)
                )
                conflicting = [t for t in lecture_sum if t is not None]
                total = sum(conflicting)
                if total > full_course_token_price:
                    raise ValidationError(
                        f"full_course_token_price ({full_course_token_price}) is below the "
                        f"sum of individual lecture token prices ({total}) in manual mode."
                    )
        course.full_course_token_price = full_course_token_price
        changed["full_course_token_price"] = full_course_token_price
    if mode is not UNSET:
        valid = {c[0] for c in course.TokenPricingMode.choices}
        if mode not in valid:
            raise ValidationError(f"Unknown pricing mode: {mode}")
        course.token_pricing_mode = mode
        changed["token_pricing_mode"] = mode
    if not changed:
        return course
    update_fields = []
    if "cash_price_tier_id" in changed:
        update_fields.append("cash_price_tier")
    if "full_course_token_price" in changed:
        update_fields.append("full_course_token_price")
    if "token_pricing_mode" in changed:
        update_fields.append("token_pricing_mode")
    course.save(update_fields=update_fields)
    _audit(
        "course.price.update",
        "course",
        course.id,
        actor=actor,
        reason=reason,
        data={"before": before, "after": changed},
        request=request,
    )
    return course


@transaction.atomic
def set_lecture_token_price(lecture, amount, *, actor, reason: str, request=None):
    _require_staff(actor)
    if amount is not None and amount < 0:
        raise ValidationError("amount must be >= 0 or None")
    before = lecture.token_price
    if before == amount:
        return lecture
    lecture.token_price = amount
    lecture.save(update_fields=["token_price"])
    _audit(
        "lecture.token_price.update",
        "lecture",
        lecture.id,
        actor=actor,
        reason=reason,
        data={"before": before, "after": amount},
        request=request,
    )
    return lecture


@transaction.atomic
def set_material_token_price(material, amount, *, actor, reason: str, request=None):
    """`material` is a `catalog.LectureResource` row."""
    _require_staff(actor)
    if amount is not None and amount < 0:
        raise ValidationError("amount must be >= 0 or None")
    before = material.token_price
    if before == amount:
        return material
    material.token_price = amount
    material.save(update_fields=["token_price"])
    _audit(
        "material.token_price.update",
        "material",
        material.id,
        actor=actor,
        reason=reason,
        data={"before": before, "after": amount},
        request=request,
    )
    return material


@transaction.atomic
def set_preview_flag(target, is_free_preview: bool, *, actor, reason: str,
                     confirm: bool = False, request=None):
    """Toggle `is_free_preview` on a Lecture or Material.

    Guard: enabling preview on a Material whose parent Lecture is NOT preview would make the
    material publicly accessible while its lecture is paid. Caller must pass `confirm=True`.
    """
    _require_staff(actor)
    from apps.catalog.models import Lecture, LectureResource

    if isinstance(target, LectureResource) and is_free_preview and not confirm:
        parent = target.lecture
        if not parent.is_free_preview and not parent.is_preview:
            raise ValidationError(
                "Material would be publicly accessible while its lecture is paid; "
                "pass confirm=True to proceed."
            )
    before = target.is_free_preview
    if before == is_free_preview:
        return target
    target.is_free_preview = is_free_preview
    target.save(update_fields=["is_free_preview"])
    kind = "lecture" if isinstance(target, Lecture) else "material"
    _audit(
        f"{kind}.preview.update",
        kind,
        target.id,
        actor=actor,
        reason=reason,
        data={"before": before, "after": is_free_preview, "confirm": confirm},
        request=request,
    )
    return target


# ---------------------------------------------------------------- course token distribution (C05)
def _hamilton_allocate(raw_weights: list[float], total: int) -> list[int]:
    """Largest-Remainder-Method allocation. Deterministic tiebreak by original index.

    Precondition: total > 0, sum(raw_weights) > 0, all weights >= 0. Returns a list of
    non-negative ints that sum to exactly `total`.
    """
    s = sum(raw_weights)
    if s <= 0:
        raise ValidationError("Cannot distribute: sum of raw weights is zero.")
    quotas = [total * w / s for w in raw_weights]
    floors = [int(q) for q in quotas]
    remainder = total - sum(floors)
    # (fractional_part, -index) sorted desc so largest fractions win; ties -> smaller index first.
    order = sorted(
        range(len(raw_weights)),
        key=lambda i: (-(quotas[i] - floors[i]), i),
    )
    allocated = list(floors)
    for i in order[: max(0, remainder)]:
        allocated[i] += 1
    assert sum(allocated) == total, (
        f"Hamilton allocation broken: sum(allocated)={sum(allocated)} != total={total}"
    )
    return allocated


@transaction.atomic
def distribute_course_token_price(
    course,
    total_tokens: int,
    *,
    weights_config=None,
    actor,
    reason: str,
    dry_run: bool = False,
    request=None,
):
    """Distribute `total_tokens` across the live-version lectures of `course`.

    `weights_config` shape:
        {"lecture_types": {"video": 1.0, "article": 0.5, ...}, "use_duration": True}

    No defaults — if `weights_config` is None we raise `ConfigurationBlocked("C05")`.

    Allocation is Hamilton's largest-remainder method; determinism is preserved by tying on
    the lecture's primary key (ascending).

    Returns a list of dicts: `{"lecture_id", "current_price", "allocated_price"}`. When
    `dry_run=False`, each change also goes through `set_lecture_token_price` so audit coverage
    is identical to a per-lecture edit.
    """
    _require_staff(actor)
    if weights_config is None:
        raise ConfigurationBlocked(
            "C05 default weights not approved — pass an explicit weights_config."
        )
    if total_tokens < 0:
        raise ValidationError("total_tokens must be >= 0")

    live_version = course.live_version
    if live_version is None:
        raise ValidationError("Course has no live version to distribute across.")

    from apps.catalog.models import Lecture

    lectures = list(
        Lecture.objects.filter(version=live_version).order_by("id")
    )
    if not lectures:
        raise ValidationError("Course has no lectures to distribute across.")

    type_weights = weights_config.get("lecture_types") or {}
    use_duration = bool(weights_config.get("use_duration", False))
    missing_types = sorted({lec.kind for lec in lectures if lec.kind not in type_weights})
    if missing_types:
        raise ValidationError(
            f"Missing weight for lecture types: {missing_types}"
        )

    raw = []
    for lec in lectures:
        tw = float(type_weights[lec.kind])
        if use_duration:
            dur_min = max(1, int(round((lec.duration_sec or 0) / 60)))
            raw.append(tw * dur_min)
        else:
            raw.append(tw)

    allocated = _hamilton_allocate(raw, total_tokens)

    result = [
        {
            "lecture_id": lec.id,
            "current_price": lec.token_price,
            "allocated_price": alloc,
        }
        for lec, alloc in zip(lectures, allocated)
    ]
    if dry_run:
        return result

    for lec, alloc in zip(lectures, allocated):
        if lec.token_price != alloc:
            set_lecture_token_price(
                lec, alloc, actor=actor, reason=f"{reason} [auto-distribute]", request=request
            )
    _audit(
        "course.token_distribution.apply",
        "course",
        course.id,
        actor=actor,
        reason=reason,
        data={"total_tokens": total_tokens, "lectures": len(lectures),
              "use_duration": use_duration},
        request=request,
    )
    return result


# ---------------------------------------------------------------- token packs
@transaction.atomic
def upsert_token_pack(
    *,
    pack_id=None,
    name: str,
    token_amount: int,
    price_tier,
    is_active: bool,
    sort_order: int,
    actor,
    reason: str,
    request=None,
):
    """Create or update a TokenPack. Soft delete via `is_active=False`."""
    _require_staff(actor)
    if token_amount <= 0:
        raise ValidationError("token_amount must be > 0")
    from apps.commerce.models import TokenPack

    if pack_id:
        pack = TokenPack.objects.select_for_update().get(pk=pack_id)
        before = {
            "name": pack.name, "token_amount": pack.token_amount,
            "price_tier_id": pack.price_tier_id, "is_active": pack.is_active,
            "sort_order": pack.sort_order,
        }
        pack.name = name
        pack.token_amount = token_amount
        pack.price_tier = price_tier
        pack.is_active = is_active
        pack.sort_order = sort_order
        pack.save()
        action = "token_pack.update"
    else:
        pack = TokenPack.objects.create(
            name=name,
            token_amount=token_amount,
            price_tier=price_tier,
            is_active=is_active,
            sort_order=sort_order,
            created_by=actor,
        )
        before = None
        action = "token_pack.create"
    _audit(action, "token_pack", pack.id, actor=actor, reason=reason,
           data={"before": before,
                 "after": {"name": name, "token_amount": token_amount,
                           "price_tier_id": getattr(price_tier, "id", None),
                           "is_active": is_active, "sort_order": sort_order}},
           request=request)
    return pack


# ---------------------------------------------------------------- token rate (versioned)
@transaction.atomic
def upsert_token_rate(
    *,
    tokens_per_gbp_minor,
    effective_from,
    actor,
    reason: str,
    notes: str = "",
    request=None,
):
    """Create a new TokenRate; closes the prior open rate at `effective_from`.

    `effective_from` MUST be strictly in the future (so a learner mid-transaction cannot have
    the rate change under them).
    """
    _require_staff(actor)
    rate = Decimal(tokens_per_gbp_minor)
    if rate <= 0:
        raise ValidationError("tokens_per_gbp_minor must be > 0")
    now = timezone.now()
    if effective_from <= now:
        raise ValidationError("effective_from must be strictly in the future")

    from apps.commerce.models import TokenRate

    # Close the currently-open rate (if any).
    TokenRate.objects.filter(effective_to__isnull=True).update(effective_to=effective_from)

    new_rate = TokenRate.objects.create(
        tokens_per_gbp_minor=rate,
        effective_from=effective_from,
        effective_to=None,
        created_by=actor,
        notes=notes,
    )
    _audit(
        "token_rate.create",
        "token_rate",
        new_rate.id,
        actor=actor,
        reason=reason,
        data={"tokens_per_gbp_minor": str(rate),
              "effective_from": effective_from.isoformat()},
        request=request,
    )
    return new_rate


# ---------------------------------------------------------------- top-up policy
@transaction.atomic
def upsert_topup_policy(
    *,
    currency: str,
    min_minor: int,
    max_minor: int,
    is_active: bool,
    actor,
    reason: str,
    request=None,
):
    _require_staff(actor)
    if min_minor < 0 or max_minor < 0:
        raise ValidationError("min_minor and max_minor must be >= 0")
    if min_minor > max_minor:
        raise ValidationError("min_minor must be <= max_minor")

    from apps.commerce.models import TopUpPolicy

    if is_active:
        TopUpPolicy.objects.filter(currency=currency, is_active=True).update(
            is_active=False, updated_by=actor
        )
    policy = TopUpPolicy.objects.create(
        currency=currency,
        min_minor=min_minor,
        max_minor=max_minor,
        is_active=is_active,
        updated_by=actor,
    )
    _audit(
        "topup_policy.create",
        "topup_policy",
        policy.id,
        actor=actor,
        reason=reason,
        data={"currency": currency, "min_minor": min_minor,
              "max_minor": max_minor, "is_active": is_active},
        request=request,
    )
    return policy


# ---------------------------------------------------------------- bonus campaign (GATED)
@transaction.atomic
def upsert_bonus_campaign(
    *,
    campaign_id=None,
    name: str,
    condition_type: str,
    condition_value,
    bonus_tokens=None,
    bonus_percent=None,
    bonus_expiry_days=None,
    starts_at,
    ends_at,
    is_active: bool,
    actor,
    reason: str,
    request=None,
):
    """Save or update a BonusCampaign draft. Activation is gated on F02.

    Raises `ConfigurationBlocked("F02 ...")` whenever `is_active=True`.
    """
    _require_staff(actor)
    if is_active:
        raise ConfigurationBlocked(
            "F02 bonus funding model not approved — campaigns may only be saved as draft "
            "(is_active=False) in PR 1."
        )
    if (bonus_tokens is None) == (bonus_percent is None):
        raise ValidationError(
            "Exactly one of bonus_tokens or bonus_percent must be provided."
        )
    if ends_at <= starts_at:
        raise ValidationError("ends_at must be after starts_at")

    from apps.commerce.models import BonusCampaign

    fields = dict(
        name=name,
        condition_type=condition_type,
        condition_value=condition_value or {},
        bonus_tokens=bonus_tokens,
        bonus_percent=bonus_percent,
        bonus_expiry_days=bonus_expiry_days,
        starts_at=starts_at,
        ends_at=ends_at,
        is_active=False,
    )
    if campaign_id:
        camp = BonusCampaign.objects.select_for_update().get(pk=campaign_id)
        for k, v in fields.items():
            setattr(camp, k, v)
        camp.save()
        action = "bonus_campaign.update"
    else:
        camp = BonusCampaign.objects.create(created_by=actor, **fields)
        action = "bonus_campaign.create"
    _audit(action, "bonus_campaign", camp.id, actor=actor, reason=reason,
           data={"name": name, "condition_type": condition_type,
                 "bonus_tokens": bonus_tokens,
                 "bonus_percent": str(bonus_percent) if bonus_percent is not None else None,
                 "starts_at": starts_at.isoformat(),
                 "ends_at": ends_at.isoformat()},
           request=request)
    return camp


# ---------------------------------------------------------------- republish survival
def migrate_token_pricing_on_republish(old_version, new_version, *, actor=None,
                                       extra_key_map: dict | None = None) -> dict:
    """Copy `token_price` and `is_free_preview` from `old_version`'s lectures to
    `new_version`'s lectures, mapped by `lecture_key` (stable identifier).

    Call this AFTER the studio has cloned sections/lectures into the new draft (see
    `catalog.studio.new_draft` → `services.create_draft`). `extra_key_map` lets a caller
    override the lecture_key pairing when needed (e.g. a renamed/replaced lecture).

    Returns a report dict: {"copied": N, "skipped": [lecture_keys], "materials": M}.
    """
    from apps.catalog.models import Lecture, LectureResource

    extra_key_map = extra_key_map or {}
    old_lectures = {lec.lecture_key: lec for lec in Lecture.objects.filter(version=old_version)}
    new_lectures = list(Lecture.objects.filter(version=new_version))
    copied = 0
    skipped = []
    for new_lec in new_lectures:
        key = extra_key_map.get(new_lec.lecture_key, new_lec.lecture_key)
        old_lec = old_lectures.get(key)
        if old_lec is None:
            skipped.append(str(new_lec.lecture_key))
            continue
        changed = False
        if old_lec.token_price != new_lec.token_price:
            new_lec.token_price = old_lec.token_price
            changed = True
        if old_lec.is_free_preview != new_lec.is_free_preview:
            new_lec.is_free_preview = old_lec.is_free_preview
            changed = True
        if changed:
            new_lec.save(update_fields=["token_price", "is_free_preview"])
            copied += 1
            _audit(
                "lecture.token_price.republish_copy",
                "lecture",
                new_lec.id,
                actor=actor,
                reason="republish:system",
                data={"from_lecture": str(old_lec.id),
                      "token_price": old_lec.token_price,
                      "is_free_preview": old_lec.is_free_preview},
                request=None,
            )

    # Materials are keyed by (lecture_key, title+position) — pragmatic: same lecture_key AND
    # same ordinal position identifies the carried-forward resource.
    mats_copied = 0
    for new_lec in new_lectures:
        old_lec = old_lectures.get(new_lec.lecture_key)
        if old_lec is None:
            continue
        old_by_pos = {r.position: r for r in LectureResource.objects.filter(lecture=old_lec)}
        for new_mat in LectureResource.objects.filter(lecture=new_lec):
            old_mat = old_by_pos.get(new_mat.position)
            if old_mat is None:
                continue
            m_changed = False
            if old_mat.token_price != new_mat.token_price:
                new_mat.token_price = old_mat.token_price
                m_changed = True
            if old_mat.is_free_preview != new_mat.is_free_preview:
                new_mat.is_free_preview = old_mat.is_free_preview
                m_changed = True
            if m_changed:
                new_mat.save(update_fields=["token_price", "is_free_preview"])
                mats_copied += 1
                _audit(
                    "material.token_price.republish_copy",
                    "material",
                    new_mat.id,
                    actor=actor,
                    reason="republish:system",
                    data={"from_material": str(old_mat.id),
                          "token_price": old_mat.token_price,
                          "is_free_preview": old_mat.is_free_preview},
                    request=None,
                )

    return {"copied": copied, "skipped": skipped, "materials": mats_copied}
