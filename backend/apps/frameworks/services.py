"""Write-side operations for Frameworks.

Each service wraps one logical change in `transaction.atomic`. Business rules
(workflow transitions, clone semantics, campaign windows) live here; schemas only
validate shape. All writes run under the request's RLS context.
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.org.models import OrgMember
from core.errors import ServiceError

from .models import (
    Competency,
    CourseCompetency,
    MaturityCampaign,
    MaturityResponse,
    MaturityVersion,
    RoleFramework,
    RoleFrameworkHistory,
    RoleFrameworkVersion,
    RoleRequirement,
)
from .scoring import score_campaign

# transitions allowed while a version is still editable
_EDITABLE = {RoleFrameworkVersion.Status.DRAFT, RoleFrameworkVersion.Status.CHANGES_REQUESTED}


# ---------------------------------------------------------------- competencies
@transaction.atomic
def create_competency(
    *, org_id: UUID, code: str, name: str, kind: str, description: str = "", sort_order: int = 0
) -> Competency:
    code = code.strip()
    if Competency.objects.filter(owner_org_id=org_id, code=code).exists():
        raise ServiceError("duplicate_code", "A competency with this code already exists.", status=409)
    return Competency.objects.create(
        owner_org_id=org_id,
        code=code,
        name=name.strip(),
        kind=kind,
        description=description.strip(),
        sort_order=sort_order,
    )


@transaction.atomic
def clone_competency(*, org_id: UUID, source: Competency) -> Competency:
    """Create an editable own-org copy of a platform (or other visible) competency.
    The clone keeps the source code and records `cloned_from`."""
    if source.owner_org_id == org_id:
        raise ServiceError("already_owned", "This competency already belongs to your company.", status=409)
    if Competency.objects.filter(owner_org_id=org_id, code=source.code).exists():
        raise ServiceError(
            "duplicate_code", "Your company already has a competency with this code.", status=409
        )
    return Competency.objects.create(
        owner_org_id=org_id,
        code=source.code,
        name=source.name,
        kind=source.kind,
        description=source.description,
        sort_order=source.sort_order,
        cloned_from=source,
    )


@transaction.atomic
def update_competency(*, competency: Competency, patch: dict) -> Competency:
    if competency.owner_org_id is None:
        raise ServiceError("platform_readonly", "Platform competencies cannot be edited.", status=403)
    for field in ("name", "description", "sort_order"):
        if field in patch and patch[field] is not None:
            setattr(competency, field, patch[field])
    competency.save()
    return competency


# ---------------------------------------------------------------- content tagging
@transaction.atomic
def tag_course(
    *, org_id: UUID, course_id: UUID, competency: Competency, target_level: int = 3, weight: int = 5
) -> CourseCompetency:
    row, created = CourseCompetency.objects.get_or_create(
        course_id=course_id,
        competency=competency,
        defaults={"owner_org_id": org_id, "target_level": target_level, "weight": weight},
    )
    if not created:
        row.target_level = target_level
        row.weight = weight
        row.save(update_fields=["target_level", "weight"])
    return row


# ---------------------------------------------------------------- role frameworks
@transaction.atomic
def create_role_framework(
    *,
    org_id: UUID,
    job_role_id: UUID,
    title: str,
    level: int,
    unit_id: UUID | None = None,
    step: int = 1,
    track: str = "",
) -> tuple[RoleFramework, RoleFrameworkVersion]:
    fw = RoleFramework.objects.create(
        org_id=org_id,
        job_role_id=job_role_id,
        unit_id=unit_id,
        title=title.strip(),
        level=level,
        step=step,
        track=track.strip(),
    )
    version = RoleFrameworkVersion.objects.create(
        org_id=org_id, framework=fw, number=1, status=RoleFrameworkVersion.Status.DRAFT
    )
    return fw, version


@transaction.atomic
def start_new_version(*, org_id: UUID, framework: RoleFramework) -> RoleFrameworkVersion:
    """Return the current editable draft, or open a new one based on the approved
    version. Refuses while a version is awaiting approval."""
    rows = RoleFrameworkVersion.objects.filter(org_id=org_id, framework=framework)
    latest = rows.order_by("-number").first()
    if latest and latest.status in _EDITABLE:
        return latest
    if latest and latest.status == RoleFrameworkVersion.Status.SUBMITTED:
        raise ServiceError("awaiting_approval", "A version is awaiting approval.", status=409)
    based_on = rows.filter(status=RoleFrameworkVersion.Status.APPROVED).order_by("-number").first()
    next_number = (rows.aggregate(m=Max("number"))["m"] or 0) + 1
    new = RoleFrameworkVersion.objects.create(
        org_id=org_id,
        framework=framework,
        number=next_number,
        status=RoleFrameworkVersion.Status.DRAFT,
        based_on=based_on,
    )
    if based_on:
        # Carry requirements forward so the editor starts from the approved spec.
        for req in RoleRequirement.objects.filter(org_id=org_id, version=based_on):
            RoleRequirement.objects.create(
                org_id=org_id,
                version=new,
                kind=req.kind,
                text=req.text,
                competency_id=req.competency_id,
                level=req.level,
                priority=req.priority,
                weight=req.weight,
                source=req.source,
                sort_order=req.sort_order,
            )
        new.job_description = based_on.job_description
        new.person_spec = based_on.person_spec
        new.required_hours = based_on.required_hours
        new.recommended_hours = based_on.recommended_hours
        new.cpd_period = based_on.cpd_period
        new.required_qualification_ids = list(based_on.required_qualification_ids or [])
        new.recommended_qualification_ids = list(based_on.recommended_qualification_ids or [])
        new.save()
    return new


def _require_editable(version: RoleFrameworkVersion) -> None:
    if version.status not in _EDITABLE:
        raise ServiceError("not_editable", f"A {version.status} version cannot be edited.", status=409)


@transaction.atomic
def update_version(*, version: RoleFrameworkVersion, patch: dict) -> RoleFrameworkVersion:
    _require_editable(version)
    for field in (
        "job_description",
        "person_spec",
        "required_hours",
        "recommended_hours",
        "cpd_period",
        "required_qualification_ids",
        "recommended_qualification_ids",
    ):
        if field in patch and patch[field] is not None:
            setattr(version, field, patch[field])
    version.save()
    return version


@transaction.atomic
def add_requirement(*, org_id: UUID, version: RoleFrameworkVersion, data: dict) -> RoleRequirement:
    _require_editable(version)
    competency_id = data.get("competency_id")
    if competency_id is not None:
        if not Competency.objects.filter(id=competency_id).exists():
            raise ServiceError("competency_not_found", "Competency not visible to this company.", status=404)
    next_sort = (
        RoleRequirement.objects.filter(org_id=org_id, version=version).aggregate(m=Max("sort_order"))["m"]
        or 0
    ) + 1
    return RoleRequirement.objects.create(
        org_id=org_id,
        version=version,
        kind=data["kind"],
        text=data["text"].strip(),
        competency_id=competency_id,
        level=data["level"],
        priority=data["priority"],
        weight=data.get("weight", 5),
        source=(data.get("source") or "").strip(),
        sort_order=next_sort,
    )


def _log(*, version: RoleFrameworkVersion, by_user_id: UUID | None, action: str, comment: str) -> None:
    RoleFrameworkHistory.objects.create(
        org_id=version.org_id,
        framework_id=version.framework_id,
        version_number=version.number,
        at=timezone.now(),
        by_id=by_user_id,
        action=action,
        comment=(comment or "").strip(),
    )


@transaction.atomic
def submit_version(
    *, version: RoleFrameworkVersion, by_user_id: UUID, comment: str = ""
) -> RoleFrameworkVersion:
    if version.status not in _EDITABLE:
        raise ServiceError("not_submittable", "Only a draft version can be submitted.", status=409)
    if not RoleRequirement.objects.filter(org_id=version.org_id, version=version).exists():
        raise ServiceError("empty_version", "Add at least one requirement before submitting.", status=400)
    version.status = RoleFrameworkVersion.Status.SUBMITTED
    version.submitted_by_id = by_user_id
    version.submitted_at = timezone.now()
    version.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
    _log(version=version, by_user_id=by_user_id, action="submitted", comment=comment)
    return version


@transaction.atomic
def approve_version(
    *, version: RoleFrameworkVersion, by_user_id: UUID, comment: str = ""
) -> RoleFrameworkVersion:
    if version.status != RoleFrameworkVersion.Status.SUBMITTED:
        raise ServiceError("not_approvable", "Only a submitted version can be approved.", status=409)
    # Supersede any currently approved version of the same framework, atomically.
    RoleFrameworkVersion.objects.filter(
        org_id=version.org_id,
        framework_id=version.framework_id,
        status=RoleFrameworkVersion.Status.APPROVED,
    ).update(status=RoleFrameworkVersion.Status.SUPERSEDED)
    version.status = RoleFrameworkVersion.Status.APPROVED
    version.approved_by_id = by_user_id
    version.approved_at = timezone.now()
    version.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    _log(version=version, by_user_id=by_user_id, action="approved", comment=comment)
    return version


@transaction.atomic
def request_changes(
    *, version: RoleFrameworkVersion, by_user_id: UUID, comment: str = ""
) -> RoleFrameworkVersion:
    if version.status != RoleFrameworkVersion.Status.SUBMITTED:
        raise ServiceError("not_reviewable", "Only a submitted version can be reviewed.", status=409)
    version.status = RoleFrameworkVersion.Status.CHANGES_REQUESTED
    version.save(update_fields=["status", "updated_at"])
    _log(version=version, by_user_id=by_user_id, action="changes_requested", comment=comment)
    return version


# ---------------------------------------------------------------- maturity
@transaction.atomic
def create_campaign(
    *,
    org_id: UUID,
    framework_version: MaturityVersion,
    dept: str,
    quarter_year: int,
    quarter: int,
    starts_at,
    ends_at,
    created_by_id: UUID,
) -> MaturityCampaign:
    if ends_at <= starts_at:
        raise ServiceError("bad_window", "Campaign end must be after its start.", status=400)
    return MaturityCampaign.objects.create(
        org_id=org_id,
        framework_version=framework_version,
        dept=dept.strip(),
        quarter_year=quarter_year,
        quarter=quarter,
        starts_at=starts_at,
        ends_at=ends_at,
        created_by_id=created_by_id,
    )


@transaction.atomic
def submit_response(
    *, org_id: UUID, campaign: MaturityCampaign, member: OrgMember, answers: dict, reflections: dict
) -> MaturityResponse:
    if campaign.closed_at is not None:
        raise ServiceError("campaign_closed", "This campaign is closed.", status=409)
    row, _ = MaturityResponse.objects.update_or_create(
        org_id=org_id,
        campaign=campaign,
        member=member,
        defaults={
            "answers": answers or {},
            "reflections": reflections or {},
            "submitted_at": timezone.now(),
        },
    )
    return row


@transaction.atomic
def close_campaign(*, org_id: UUID, campaign: MaturityCampaign) -> dict:
    """Close a campaign and snapshot its scores onto the framework version."""
    if campaign.closed_at is not None:
        raise ServiceError("already_closed", "This campaign is already closed.", status=409)
    scores = score_campaign(org_id=org_id, campaign=campaign)
    campaign.closed_at = timezone.now()
    campaign.save(update_fields=["closed_at", "updated_at"])
    # Snapshot onto the version (decision D5: scored on close, not recomputed on read).
    version = campaign.framework_version
    snapshot = dict(version.last_scores or {})
    snapshot[str(campaign.id)] = {
        "dept": campaign.dept,
        "quarter_year": campaign.quarter_year,
        "quarter": campaign.quarter,
        "closed_at": campaign.closed_at.isoformat(),
        **scores,
    }
    version.last_scores = snapshot
    version.save(update_fields=["last_scores", "updated_at"])
    return scores
