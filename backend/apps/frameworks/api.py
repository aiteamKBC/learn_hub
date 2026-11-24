"""Frameworks endpoints: competency catalogue, role ladders (with HR approval
workflow), competence/readiness scoring, recommendations and department maturity.

Mounted at /api/v1/frameworks/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
Definition endpoints (create/edit/approve) require a company admin (decision D3);
self-service reads (/me/…) and maturity responses are open to any member.
"""

from __future__ import annotations

from uuid import UUID

from ninja import Router

from apps.org.models import OrgMember
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import require_org

from . import permissions as perms
from . import recommender, scoring, selectors, services
from .models import Competency, MaturityVersion, RoleFramework, RoleFrameworkVersion
from .schemas import (
    FwCampaignIn,
    FwCampaignOut,
    FwCampaignScoresOut,
    FwCompetenceOut,
    FwCompetencyIn,
    FwCompetencyOut,
    FwCompetencyPatch,
    FwCourseTagIn,
    FwCourseTagOut,
    FwHistoryOut,
    FwMaturityFrameworkOut,
    FwMaturityVersionOut,
    FwOk,
    FwReadinessOut,
    FwRecommendationOut,
    FwRequirementIn,
    FwResponseIn,
    FwResponseOut,
    FwRoleIn,
    FwRoleOut,
    FwTransitionIn,
    FwVersionOut,
    FwVersionPatch,
)

router = Router(tags=["frameworks"], auth=session_auth)


# ---------------------------------------------------------------- helpers
def _active_member(request) -> OrgMember:
    org_id = require_org(request)
    member_id = perms.active_member_id(request)
    member = OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()
    if member is None:
        raise ServiceError("not_a_member", "You are not a member of this company.", status=403)
    return member


def _competency(request, competency_id: UUID) -> Competency:
    c = selectors.competency_by_id(competency_id)
    if c is None:
        raise ServiceError("not_found", "Competency not found.", status=404)
    return c


def _role(request, framework_id: UUID) -> RoleFramework:
    org_id = require_org(request)
    fw = selectors.role_framework(org_id=org_id, framework_id=framework_id)
    if fw is None:
        raise ServiceError("not_found", "Role framework not found.", status=404)
    return fw


def _version(request, version_id: UUID) -> RoleFrameworkVersion:
    org_id = require_org(request)
    v = selectors.version(org_id=org_id, version_id=version_id)
    if v is None:
        raise ServiceError("not_found", "Role version not found.", status=404)
    return v


# ---------------------------------------------------------------- competencies
@router.get("/competencies", response=list[FwCompetencyOut])
def list_competencies(request, kind: str | None = None, include_archived: bool = False):
    require_org(request)
    return [
        selectors.competency_payload(c)
        for c in selectors.competency_catalogue(kind=kind, include_archived=include_archived)
    ]


@router.post("/competencies", response=FwCompetencyOut)
def create_competency(request, data: FwCompetencyIn):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    # In a platform-admin view (staff inspecting a company) new competencies go to the
    # shared platform library; a company admin's go to their own company.
    platform = bool(getattr(request, "platform_staff", False))
    c = services.create_competency(
        owner_org_id=None if platform else org_id,
        code=data.code,
        name=data.name,
        kind=data.kind,
        description=data.description,
        sort_order=data.sort_order,
    )
    return selectors.competency_payload(c)


@router.patch("/competencies/{competency_id}", response=FwCompetencyOut)
def update_competency(request, competency_id: UUID, data: FwCompetencyPatch):
    require_org(request)
    perms.require_framework_admin(request)
    allow_platform = bool(getattr(request, "platform_staff", False))
    c = services.update_competency(
        competency=_competency(request, competency_id), patch=data.dict(), allow_platform=allow_platform
    )
    return selectors.competency_payload(c)


@router.post("/competencies/{competency_id}/clone", response=FwCompetencyOut)
def clone_competency(request, competency_id: UUID):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    c = services.clone_competency(org_id=org_id, source=_competency(request, competency_id))
    return selectors.competency_payload(c)


# ---------------------------------------------------------------- content tagging
@router.get("/courses/{course_id}/competencies", response=list[FwCourseTagOut])
def list_course_tags(request, course_id: UUID):
    require_org(request)
    return [
        {
            "id": t.id,
            "competency_id": t.competency_id,
            "competency_code": t.competency.code,
            "competency_name": t.competency.name,
            "target_level": t.target_level,
            "weight": t.weight,
        }
        for t in selectors.course_tags(course_id=course_id)
    ]


@router.post("/courses/{course_id}/competencies", response=FwCourseTagOut)
def tag_course(request, course_id: UUID, data: FwCourseTagIn):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    t = services.tag_course(
        org_id=org_id,
        course_id=course_id,
        competency=_competency(request, data.competency_id),
        target_level=data.target_level,
        weight=data.weight,
    )
    return {
        "id": t.id,
        "competency_id": t.competency_id,
        "competency_code": t.competency.code,
        "competency_name": t.competency.name,
        "target_level": t.target_level,
        "weight": t.weight,
    }


# ---------------------------------------------------------------- role frameworks
@router.get("/roles", response=list[FwRoleOut])
def list_roles(request, include_archived: bool = False):
    org_id = require_org(request)
    return [
        selectors.role_payload(fw)
        for fw in selectors.role_frameworks(org_id=org_id, include_archived=include_archived)
    ]


@router.post("/roles", response=FwRoleOut)
def create_role(request, data: FwRoleIn):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    fw, _ = services.create_role_framework(
        org_id=org_id,
        job_role_id=data.job_role_id,
        title=data.title,
        level=data.level,
        unit_id=data.unit_id,
        step=data.step,
        track=data.track,
    )
    return selectors.role_payload(fw)


@router.get("/roles/{framework_id}", response=FwRoleOut)
def get_role(request, framework_id: UUID):
    return selectors.role_payload(_role(request, framework_id))


@router.get("/roles/{framework_id}/history", response=list[FwHistoryOut])
def role_history(request, framework_id: UUID):
    org_id = require_org(request)
    _role(request, framework_id)
    return [
        {"version_number": h.version_number, "at": h.at, "action": h.action, "comment": h.comment}
        for h in selectors.framework_history(org_id=org_id, framework_id=framework_id)
    ]


@router.post("/roles/{framework_id}/versions", response=FwVersionOut)
def start_version(request, framework_id: UUID):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    v = services.start_new_version(org_id=org_id, framework=_role(request, framework_id))
    return selectors.version_payload(v)


@router.get("/versions/{version_id}", response=FwVersionOut)
def get_version(request, version_id: UUID):
    return selectors.version_payload(_version(request, version_id))


@router.patch("/versions/{version_id}", response=FwVersionOut)
def update_version(request, version_id: UUID, data: FwVersionPatch):
    require_org(request)
    perms.require_framework_admin(request)
    v = services.update_version(version=_version(request, version_id), patch=data.dict(exclude_unset=True))
    return selectors.version_payload(v)


@router.post("/versions/{version_id}/requirements", response=FwVersionOut)
def add_requirement(request, version_id: UUID, data: FwRequirementIn):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    v = _version(request, version_id)
    services.add_requirement(org_id=org_id, version=v, data=data.dict())
    return selectors.version_payload(v)


@router.post("/versions/{version_id}/submit", response=FwVersionOut)
def submit_version(request, version_id: UUID, data: FwTransitionIn):
    require_org(request)
    perms.require_framework_admin(request)
    v = services.submit_version(
        version=_version(request, version_id), by_user_id=request.user.id, comment=data.comment
    )
    return selectors.version_payload(v)


@router.post("/versions/{version_id}/approve", response=FwVersionOut)
def approve_version(request, version_id: UUID, data: FwTransitionIn):
    require_org(request)
    perms.require_framework_admin(request)
    v = services.approve_version(
        version=_version(request, version_id), by_user_id=request.user.id, comment=data.comment
    )
    return selectors.version_payload(v)


@router.post("/versions/{version_id}/request-changes", response=FwVersionOut)
def request_changes(request, version_id: UUID, data: FwTransitionIn):
    require_org(request)
    perms.require_framework_admin(request)
    v = services.request_changes(
        version=_version(request, version_id), by_user_id=request.user.id, comment=data.comment
    )
    return selectors.version_payload(v)


# ---------------------------------------------------------------- scoring / readiness
@router.get("/me/competence", response=FwCompetenceOut)
def my_competence(request):
    org_id = require_org(request)
    member = _active_member(request)
    levels = scoring.evidenced_levels(org_id=org_id, user_id=member.user_id)
    comps = {str(c.id): c for c in selectors.competency_catalogue(include_archived=True)}
    items = []
    for cid, level in levels.items():
        c = comps.get(cid)
        if c is None:
            continue
        items.append(
            {
                "competency_id": c.id,
                "code": c.code,
                "name": c.name,
                "kind": c.kind,
                "evidenced_level": level,
            }
        )
    items.sort(key=lambda i: i["code"])
    return {"member_id": member.id, "items": items, "computed_at": None}


@router.get("/versions/{version_id}/readiness", response=FwReadinessOut)
def version_readiness(request, version_id: UUID):
    org_id = require_org(request)
    member = _active_member(request)
    v = _version(request, version_id)
    return scoring.readiness(org_id=org_id, member=member, version=v)


@router.get("/versions/{version_id}/recommendations", response=list[FwRecommendationOut])
def version_recommendations(request, version_id: UUID):
    org_id = require_org(request)
    member = _active_member(request)
    v = _version(request, version_id)
    return recommender.recommend_for_version(org_id=org_id, member=member, version=v)


# ---------------------------------------------------------------- maturity
@router.get("/maturity/versions/{version_id}", response=FwMaturityVersionOut)
def get_maturity_version(request, version_id: UUID):
    require_org(request)
    version = (
        MaturityVersion.objects.filter(id=version_id, status__in=["published", "superseded"])
        .select_related("framework")
        .prefetch_related("dimensions__criteria")
        .first()
    )
    if version is None:
        raise ServiceError("not_found", "Published framework version not found.", status=404)
    return selectors.maturity_version_payload(version)


@router.get("/maturity/frameworks", response=list[FwMaturityFrameworkOut])
def list_maturity_frameworks(request, kind: str | None = None):
    require_org(request)
    return [selectors.maturity_framework_payload(f) for f in selectors.maturity_frameworks(kind=kind)]


@router.get("/maturity/campaigns", response=list[FwCampaignOut])
def list_campaigns(request, dept: str | None = None):
    org_id = require_org(request)
    return [selectors.campaign_payload(c) for c in selectors.campaigns(org_id=org_id, dept=dept)]


@router.post("/maturity/campaigns", response=FwCampaignOut)
def create_campaign(request, data: FwCampaignIn):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    fv = MaturityVersion.objects.filter(id=data.framework_version_id).first()
    if fv is None:
        raise ServiceError("version_not_found", "Maturity framework version not found.", status=404)
    c = services.create_campaign(
        org_id=org_id,
        framework_version=fv,
        dept=data.dept,
        quarter_year=data.quarter_year,
        quarter=data.quarter,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        created_by_id=request.user.id,
    )
    return selectors.campaign_payload(c)


def _campaign(request, campaign_id: UUID):
    org_id = require_org(request)
    c = selectors.campaign(org_id=org_id, campaign_id=campaign_id)
    if c is None:
        raise ServiceError("not_found", "Campaign not found.", status=404)
    return c


@router.post("/maturity/campaigns/{campaign_id}/responses", response=FwResponseOut)
def submit_response(request, campaign_id: UUID, data: FwResponseIn):
    org_id = require_org(request)
    member = _active_member(request)
    c = _campaign(request, campaign_id)
    r = services.submit_response(
        org_id=org_id, campaign=c, member=member, answers=data.answers, reflections=data.reflections
    )
    return {"id": r.id, "campaign_id": c.id, "member_id": member.id, "submitted_at": r.submitted_at}


@router.post("/maturity/campaigns/{campaign_id}/close", response=FwCampaignScoresOut)
def close_campaign(request, campaign_id: UUID):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    c = _campaign(request, campaign_id)
    scores = services.close_campaign(org_id=org_id, campaign=c)
    return {
        "campaign_id": c.id,
        "closed_at": c.closed_at,
        "response_count": scores.get("n", 0),
        "scores": scores,
    }


@router.get("/maturity/campaigns/{campaign_id}/scores", response=FwCampaignScoresOut)
def campaign_scores(request, campaign_id: UUID):
    org_id = require_org(request)
    perms.require_framework_admin(request)
    c = _campaign(request, campaign_id)
    scores = scoring.score_campaign(org_id=org_id, campaign=c)
    return {
        "campaign_id": c.id,
        "closed_at": c.closed_at,
        "response_count": scores.get("n", 0),
        "scores": scores,
    }


# ---------------------------------------------------------------- misc
@router.get("/health", response=FwOk)
def health(request):
    require_org(request)
    return {"ok": True}
