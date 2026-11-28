"""Write-side operations for HCM. Services wrap single logical changes in
`transaction.atomic`; validation of business rules lives here (schemas validate
shape only). All writes run under the request's RLS context."""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.org.models import OrgMember
from core.errors import ServiceError

from .models import CpdEntry, MemberProfile, MemberQualification, Qualification, WellbeingSurvey


# ---------------------------------------------------------------- profile
@transaction.atomic
def ensure_profile(*, org_id: UUID, member_id: UUID) -> MemberProfile:
    member = OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()
    if member is None:
        raise ServiceError("not_found", "Member not found.", status=404)
    profile, _ = MemberProfile.objects.get_or_create(org_id=org_id, member=member)
    return profile


MY_FIELDS = ("aspiration", "adjustments")
HR_FIELDS = (
    "track",
    "level",
    "aspiration",
    "location",
    "start_date",
    "termination_date",
    "adjustments",
)


@transaction.atomic
def update_my_profile(*, profile: MemberProfile, patch: dict) -> MemberProfile:
    _apply(profile, patch, MY_FIELDS)
    profile.save()
    return profile


@transaction.atomic
def update_hr_profile(*, profile: MemberProfile, patch: dict, org_id: UUID) -> MemberProfile:
    """HR-side profile edit. Line manager, if given, must be a member of the same
    org and not the profile's own member (the DB check also forbids self-managing,
    but we fail early here with a readable message)."""
    _apply(profile, patch, HR_FIELDS)
    if "line_manager_id" in patch:
        lm_id = patch["line_manager_id"]
        if lm_id is None:
            profile.line_manager = None
        else:
            if lm_id == profile.member_id:
                raise ServiceError("self_manager", "A member cannot be their own line manager.", status=400)
            lm = OrgMember.objects.filter(org_id=org_id, id=lm_id, removed_at__isnull=True).first()
            if lm is None:
                raise ServiceError("line_manager_not_found", "Line manager not found.", status=404)
            profile.line_manager = lm
    profile.save()
    return profile


def _apply(obj, patch: dict, fields: tuple[str, ...]) -> None:
    for name in fields:
        if name in patch and patch[name] is not None:
            setattr(obj, name, patch[name])


# ---------------------------------------------------------------- qualifications
@transaction.atomic
def create_qualification(*, org_id: UUID, name: str, code: str = "") -> Qualification:
    return Qualification.objects.create(org_id=org_id, name=name.strip(), code=code.strip())


@transaction.atomic
def award_qualification(
    *,
    org_id: UUID,
    member: OrgMember,
    qualification: Qualification,
    awarded_on=None,
    expires_on=None,
    evidence_asset=None,
) -> MemberQualification:
    """Award a qualification to a member. A second award of the same qualification
    updates the dates and (if a new certificate is given) replaces the evidence file."""
    if qualification.org_id != org_id:
        raise ServiceError("cross_org", "Qualification is not in this company.", status=400)
    row, created = MemberQualification.objects.get_or_create(
        org_id=org_id,
        member=member,
        qualification=qualification,
        defaults={"awarded_on": awarded_on, "expires_on": expires_on, "evidence_asset": evidence_asset},
    )
    if not created:
        fields = []
        if awarded_on is not None and row.awarded_on != awarded_on:
            row.awarded_on = awarded_on
            fields.append("awarded_on")
        if expires_on is not None and row.expires_on != expires_on:
            row.expires_on = expires_on
            fields.append("expires_on")
        if evidence_asset is not None and row.evidence_asset_id != evidence_asset.id:
            row.evidence_asset = evidence_asset
            fields.append("evidence_asset")
        if fields:
            row.save(update_fields=fields)
    return row


# ---------------------------------------------------------------- CPD
@transaction.atomic
def record_external_cpd(
    *,
    org_id: UUID,
    member: OrgMember,
    title: str,
    provider: str,
    completed_on,
    hours,
) -> CpdEntry:
    entry = CpdEntry.objects.create(
        org_id=org_id,
        member=member,
        kind=CpdEntry.Kind.EXTERNAL,
        title=title.strip(),
        provider=provider.strip(),
        completed_on=completed_on,
        hours=hours,
    )
    _bump_cpd_cache(org_id=org_id, member_id=member.id)
    return entry


def _bump_cpd_cache(*, org_id: UUID, member_id: UUID) -> None:
    """Refresh the `MemberProfile.cpd_hours_cached` rollup for one member. The
    nightly task recomputes everyone; this keeps an immediate view after a write
    consistent."""
    from django.db.models import Sum

    total = CpdEntry.objects.filter(org_id=org_id, member_id=member_id).aggregate(s=Sum("hours"))["s"] or 0
    MemberProfile.objects.filter(org_id=org_id, member_id=member_id).update(
        cpd_hours_cached=total, cpd_cached_at=timezone.now()
    )


# ---------------------------------------------------------------- wellbeing
def _clean_answers(raw: dict | None) -> dict[str, int]:
    """Keep only sane 1..5 integer answers; drop anything malformed."""
    out: dict[str, int] = {}
    for key, value in (raw or {}).items():
        try:
            v = int(value)
        except (TypeError, ValueError):
            continue
        if 1 <= v <= 5 and isinstance(key, str) and len(key) <= 16:
            out[key] = v
    return out


@transaction.atomic
def submit_wellbeing(*, org_id: UUID, member: OrgMember, data: dict) -> WellbeingSurvey:
    survey = WellbeingSurvey.objects.create(
        org_id=org_id,
        member=member,
        submitted_at=timezone.now(),
        hope=data["hope"],
        efficacy=data["efficacy"],
        resilience=data["resilience"],
        optimism=data["optimism"],
        overall=data["overall"],
        stay_intent=data.get("stay_intent"),
        satisfaction=data.get("satisfaction"),
        note=(data.get("note") or "").strip(),
        answers=_clean_answers(data.get("answers")),
    )
    # Mirror the latest scalars onto the profile so dashboards don't need a join.
    updates = {}
    if data.get("stay_intent") is not None:
        updates["stay_intent"] = data["stay_intent"]
    if data.get("satisfaction") is not None:
        updates["satisfaction"] = data["satisfaction"]
    if updates:
        MemberProfile.objects.filter(org_id=org_id, member_id=member.id).update(**updates)
    return survey
