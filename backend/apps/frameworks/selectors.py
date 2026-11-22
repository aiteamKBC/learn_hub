"""Optimised READ queries for Frameworks. All run under RLS.

Competency and MaturityFramework reads rely on `scoped_content` RLS: platform rows
(owner_org NULL) and the caller's own-org rows are both visible without an explicit
filter, so these selectors never hand-roll the hybrid visibility rule.
"""

from __future__ import annotations

from uuid import UUID

from django.db.models import Count

from .models import (
    Competency,
    CourseCompetency,
    MaturityCampaign,
    MaturityFramework,
    MaturityResponse,
    MaturityVersion,
    RoleFramework,
    RoleFrameworkHistory,
    RoleFrameworkVersion,
)


# ---------------------------------------------------------------- competencies
def competency_catalogue(*, kind: str | None = None, include_archived: bool = False):
    qs = Competency.objects.all()
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    if kind:
        qs = qs.filter(kind=kind)
    return qs.order_by("sort_order", "code")


def competency_payload(c: Competency) -> dict:
    return {
        "id": c.id,
        "owner_org_id": c.owner_org_id,
        "code": c.code,
        "name": c.name,
        "description": c.description,
        "kind": c.kind,
        "sort_order": c.sort_order,
        "is_platform": c.owner_org_id is None,
        "cloned_from_id": c.cloned_from_id,
        "archived": c.archived_at is not None,
    }


def competency_by_id(competency_id: UUID) -> Competency | None:
    return Competency.objects.filter(id=competency_id).first()


# ---------------------------------------------------------------- content tags
def course_tags(*, course_id: UUID):
    return (
        CourseCompetency.objects.filter(course_id=course_id)
        .select_related("competency")
        .order_by("competency__sort_order", "competency__code")
    )


# ---------------------------------------------------------------- role frameworks
def role_frameworks(*, org_id: UUID, include_archived: bool = False):
    qs = RoleFramework.objects.filter(org_id=org_id)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    return qs.order_by("job_role_id", "level", "step")


def role_framework(*, org_id: UUID, framework_id: UUID) -> RoleFramework | None:
    return RoleFramework.objects.filter(org_id=org_id, id=framework_id).first()


def version_numbers(*, org_id: UUID, framework_id: UUID) -> dict:
    """Return {'approved': n|None, 'latest': n|None} for a framework."""
    rows = RoleFrameworkVersion.objects.filter(org_id=org_id, framework_id=framework_id)
    approved = (
        rows.filter(status=RoleFrameworkVersion.Status.APPROVED)
        .order_by("-number")
        .values_list("number", flat=True)
        .first()
    )
    latest = rows.order_by("-number").values_list("number", flat=True).first()
    return {"approved": approved, "latest": latest}


def role_payload(fw: RoleFramework) -> dict:
    nums = version_numbers(org_id=fw.org_id, framework_id=fw.id)
    versions = RoleFrameworkVersion.objects.filter(org_id=fw.org_id, framework_id=fw.id)
    return {
        "id": fw.id,
        "job_role_id": fw.job_role_id,
        "unit_id": fw.unit_id,
        "title": fw.title,
        "level": fw.level,
        "step": fw.step,
        "track": fw.track,
        "archived": fw.archived_at is not None,
        "approved_version_number": nums["approved"],
        "latest_version_number": nums["latest"],
        "approved_version_id": versions.filter(number=nums["approved"]).values_list("id", flat=True).first(),
        "latest_version_id": versions.filter(number=nums["latest"]).values_list("id", flat=True).first(),
    }


def version(*, org_id: UUID, version_id: UUID) -> RoleFrameworkVersion | None:
    return (
        RoleFrameworkVersion.objects.filter(org_id=org_id, id=version_id).select_related("framework").first()
    )


def version_requirements_qs(*, org_id: UUID, version_id: UUID):
    from .models import RoleRequirement

    return (
        RoleRequirement.objects.filter(org_id=org_id, version_id=version_id)
        .select_related("competency")
        .order_by("sort_order", "id")
    )


def version_payload(v: RoleFrameworkVersion) -> dict:
    reqs = [
        {
            "id": r.id,
            "kind": r.kind,
            "text": r.text,
            "competency_id": r.competency_id,
            "competency_code": r.competency.code if r.competency_id else None,
            "level": r.level,
            "priority": r.priority,
            "weight": r.weight,
            "sort_order": r.sort_order,
        }
        for r in version_requirements_qs(org_id=v.org_id, version_id=v.id)
    ]
    return {
        "id": v.id,
        "framework_id": v.framework_id,
        "number": v.number,
        "status": v.status,
        "job_description": v.job_description,
        "person_spec": v.person_spec,
        "required_hours": v.required_hours,
        "recommended_hours": v.recommended_hours,
        "cpd_period": v.cpd_period,
        "required_qualification_ids": list(v.required_qualification_ids or []),
        "recommended_qualification_ids": list(v.recommended_qualification_ids or []),
        "submitted_at": v.submitted_at,
        "approved_at": v.approved_at,
        "requirements": reqs,
    }


def framework_history(*, org_id: UUID, framework_id: UUID):
    return RoleFrameworkHistory.objects.filter(org_id=org_id, framework_id=framework_id).order_by("-at")


# ---------------------------------------------------------------- maturity
def maturity_frameworks(*, kind: str | None = None):
    qs = MaturityFramework.objects.all()
    if kind:
        qs = qs.filter(kind=kind)
    return qs.order_by("dept", "code")


def maturity_framework_payload(f: MaturityFramework) -> dict:
    return {
        "id": f.id,
        "owner_org_id": f.owner_org_id,
        "code": f.code,
        "kind": f.kind,
        "dept": f.dept,
        "title": f.title,
        "is_platform": f.owner_org_id is None,
        "published_version_id": f.versions.filter(status=MaturityVersion.Status.PUBLISHED)
        .order_by("-number")
        .values_list("id", flat=True)
        .first(),
    }


def maturity_version_payload(v: MaturityVersion) -> dict:
    return {
        "id": v.id,
        "framework_id": v.framework_id,
        "number": v.number,
        "status": v.status,
        "title": v.framework.title,
        "dimensions": [
            {
                "id": d.id,
                "name": d.name,
                "target_level": d.target_level,
                "weight": d.weight,
                "action_hint": d.action_hint,
                "criteria": [
                    {
                        "id": c.id,
                        "practice": c.practice,
                        "question": c.question,
                        "evidence": c.evidence,
                        "weight": c.weight,
                        "anchors": list(c.anchors or []),
                    }
                    for c in d.criteria.all()
                ],
            }
            for d in v.dimensions.all()
        ],
    }


def campaigns(*, org_id: UUID, dept: str | None = None):
    qs = MaturityCampaign.objects.filter(org_id=org_id).annotate(n=Count("responses"))
    if dept:
        qs = qs.filter(dept=dept)
    return qs.order_by("-quarter_year", "-quarter", "dept")


def campaign(*, org_id: UUID, campaign_id: UUID) -> MaturityCampaign | None:
    return MaturityCampaign.objects.filter(org_id=org_id, id=campaign_id).first()


def campaign_payload(c: MaturityCampaign) -> dict:
    n = getattr(c, "n", None)
    if n is None:
        n = MaturityResponse.objects.filter(org_id=c.org_id, campaign_id=c.id).count()
    return {
        "id": c.id,
        "framework_version_id": c.framework_version_id,
        "dept": c.dept,
        "quarter_year": c.quarter_year,
        "quarter": c.quarter,
        "starts_at": c.starts_at,
        "ends_at": c.ends_at,
        "closed_at": c.closed_at,
        "response_count": n,
    }
