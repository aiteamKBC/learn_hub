"""Compliance endpoints for HR and managers (dashboard, matrix, people, requirements,
actions, exports) and for learners (my required training).

Managers see and act on people in their own units only; requirement rules are
admin-only. Every action is recorded in the company's audit trail.
"""

import csv
from datetime import datetime

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from ninja import Router

from apps.catalog.models import Course
from apps.identity.schemas import OkOut
from apps.org.models import OrgUnit
from apps.platform.services import audit_request
from core import cursor as keyset
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, Scope, org_scope, require_org

from . import selectors, services
from .models import CompletionRecord, Exemption, MemberStatus, Requirement
from .schemas import (
    CompliancePersonOut,
    DashboardOut,
    ExemptIn,
    ExemptionCreatedOut,
    ExtendIn,
    ExtendOut,
    ManualIn,
    MatrixOut,
    MyRequirement,
    RecordCreatedOut,
    ReminderOut,
    RequirementIn,
    RequirementOut,
    RequirementPatch,
    RequirementSummaryOut,
    VoidIn,
)

router = Router(tags=["compliance"], auth=session_auth)


def _unit(scope: Scope, unit_id):
    if not unit_id:
        return None
    unit = get_object_or_404(OrgUnit, pk=unit_id, org_id=scope.org_id, archived_at__isnull=True)
    scope.check_unit(unit)
    return unit


def _status_in_scope(scope: Scope, status_id) -> MemberStatus:
    members = selectors.scoped_members(scope).values("id")
    return get_object_or_404(
        MemberStatus.objects.select_related("requirement"),
        pk=status_id,
        org_id=scope.org_id,
        member_id__in=members,
    )


# ---------------------------------------------------------------- read
@router.get("/dashboard", response=DashboardOut)
def dashboard(request):
    return selectors.dashboard(org_scope(request, OrgRole.MANAGER))


@router.get("/summary", response=list[RequirementSummaryOut])
def summary(request, unit_id: str | None = None):
    scope = org_scope(request, OrgRole.MANAGER)
    return selectors.summary(scope, unit=_unit(scope, unit_id))


@router.get("/matrix", response=MatrixOut)
def matrix(request, unit_id: str | None = None, job_role_id: str | None = None, q: str | None = None,
           status: str | None = None, requirement_id: str | None = None, cursor: str | None = None,
           limit: int = 50):  # fmt: skip
    scope = org_scope(request, OrgRole.MANAGER)
    if status and status not in MemberStatus.Status.values:
        raise ServiceError("bad_status", "Unknown status.")
    after = keyset.decode(cursor, 2)
    data = selectors.matrix(scope, unit=_unit(scope, unit_id), q=q, job_role_id=job_role_id, status=status,
                            requirement_id=requirement_id, after=after, limit=limit)  # fmt: skip
    return {
        "requirements": [{"id": str(r["id"]), "name": r["name"]} for r in data["requirements"]],
        "rows": [{"member_id": r["id"], "name": r["user__full_name"], "email": r["user__email"],
                  "job_title": r["job_title"], "employee_ref": r["employee_ref"], "cells": r["cells"]}
                 for r in data["rows"]],
        "next_cursor": keyset.encode(*data["next"]) if data["next"] else None,
    }  # fmt: skip


@router.get("/people/{member_id}", response=CompliancePersonOut)
def person(request, member_id: str):
    scope = org_scope(request, OrgRole.MANAGER)
    p = selectors.person(scope, member_id)
    m = p["member"]
    from apps.learning.models import Certificate, Enrollment

    return {
        "member_id": m.id, "name": m.user.full_name, "email": m.user.email, "role": m.role, "job_title": m.job_title,
        "employee_ref": m.employee_ref, "joined_at": m.joined_at,
        "units": [{"id": u.unit_id, "name": u.unit.name} for u in p["units"]],
        "job_roles": [{"id": r.job_role_id, "name": r.job_role.name} for r in p["job_roles"]],
        "requirements": [
            {"status_id": s.id, "requirement_id": s.requirement_id, "name": s.requirement.name,
             "course_title": s.requirement.course.title, "status": s.status, "due_at": s.due_at,
             "completed_at": s.completed_at, "expires_at": s.expires_at, "due_override_at": s.due_override_at}
            for s in p["statuses"]
        ],
        "records": [
            {"id": r.id, "requirement_id": r.requirement_id, "requirement": r.requirement.name, "source": r.source, "completed_at": r.completed_at,
             "expires_at": r.expires_at, "note": r.note, "voided": r.voided_at is not None,
             "void_reason": r.void_reason, "recorded_by": r.recorded_by.full_name if r.recorded_by else None}
            for r in p["records"]
        ],
        "exemptions": [
            {"id": x.id, "requirement_id": x.requirement_id, "requirement": x.requirement.name, "reason": x.reason, "starts_at": x.starts_at,
             "ends_at": x.ends_at, "revoked_at": x.revoked_at, "granted_by": x.granted_by.full_name}
            for x in p["exemptions"]
        ],
        "courses": [
            {"course_title": e.course.title, "status": e.status, "progress_pct": float(e.progress_pct),
             "enrolled_at": e.enrolled_at, "completed_at": e.completed_at}
            for e in Enrollment.objects.filter(org_id=scope.org_id, user_id=m.user_id).exclude(status="superseded")
            .select_related("course").order_by("-enrolled_at")[:200]
        ],
        "certificates": [
            {"id": c.id, "course_title": c.course_title, "issued_at": c.issued_at, "code": c.verification_code}
            for c in Certificate.objects.filter(org_id=scope.org_id, user_id=m.user_id, revoked_at__isnull=True)
            .order_by("-issued_at")[:200]
        ],
    }  # fmt: skip


# ---------------------------------------------------------------- requirements (admin)
def _requirement_out(r: Requirement, stats: dict | None = None) -> dict:
    stats = stats or {}
    return {
        "id": r.id, "name": r.name, "description": r.description, "course_id": r.course_id,
        "course_title": r.course.title, "renewal_months": r.renewal_months, "due_days": r.due_days,
        "expiring_soon_days": r.expiring_soon_days, "reminder_days": r.reminder_days,
        "overdue_every_days": r.overdue_every_days,
        "targets": [{"unit_id": t.unit_id, "unit_name": t.unit.name if t.unit_id else None,
                     "job_role_id": t.job_role_id, "job_role_name": t.job_role.name if t.job_role_id else None,
                     "include_subunits": t.include_subunits} for t in r.targets.all()],
        "total": stats.get("total", 0), "compliance_pct": stats.get("compliance_pct", 100.0),
        "overdue": stats.get("overdue", 0) + stats.get("expired", 0),
    }  # fmt: skip


@router.get("/requirements", response=list[RequirementOut])
def requirements(request):
    scope = org_scope(request, OrgRole.MANAGER)
    stats = {s["requirement_id"]: s for s in selectors.summary(scope)}
    rows = (
        Requirement.objects.filter(org_id=scope.org_id, archived_at__isnull=True)
        .select_related("course")
        .prefetch_related("targets__unit", "targets__job_role")
        .order_by("name")
    )
    return [_requirement_out(r, stats.get(r.id)) for r in rows]


def _assignable_course(org_id, course_id) -> Course:
    from apps.org.api import _library

    course = _library(org_id).filter(pk=course_id).first()
    if course is None:
        raise ServiceError("not_in_library", "This course is not available to your company.", status=404)
    return course


@router.post("/requirements", response=RequirementOut)
def create_requirement(request, body: RequirementIn):
    scope = org_scope(request, OrgRole.ADMIN)
    course = _assignable_course(scope.org_id, body.course_id)
    r = services.create_requirement(
        org_id=scope.org_id, course=course, name=body.name.strip(), created_by=request.user,
        targets=[t.dict() for t in body.targets], renewal_months=body.renewal_months, due_days=body.due_days,
        expiring_soon_days=body.expiring_soon_days, reminder_days=body.reminder_days,
        overdue_every_days=body.overdue_every_days, description=body.description,
    )  # fmt: skip
    audit_request(
        request, "requirement.create", "requirement", r.id, {"name": r.name, "course": str(course.id)}
    )
    return _requirement_out(Requirement.objects.select_related("course").get(pk=r.pk))


@router.patch("/requirements/{requirement_id}", response=RequirementOut)
def update_requirement(request, requirement_id: str, body: RequirementPatch):
    scope = org_scope(request, OrgRole.ADMIN)
    r = get_object_or_404(Requirement, pk=requirement_id, org_id=scope.org_id, archived_at__isnull=True)
    changes = body.dict(exclude_unset=True, exclude={"targets"})
    if changes:
        services.update_requirement(requirement=r, **changes)
    if body.targets is not None:
        services.set_targets(requirement=r, targets=[t.dict() for t in body.targets])
    audit_request(request, "requirement.update", "requirement", r.id, body.dict(exclude_unset=True))
    return _requirement_out(Requirement.objects.select_related("course").get(pk=r.pk))


@router.delete("/requirements/{requirement_id}", response=OkOut)
def archive_requirement(request, requirement_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    r = get_object_or_404(Requirement, pk=requirement_id, org_id=scope.org_id, archived_at__isnull=True)
    services.archive_requirement(requirement=r)
    audit_request(request, "requirement.archive", "requirement", r.id, {"name": r.name})
    return {"ok": True}


# ---------------------------------------------------------------- actions on one person
@router.post("/statuses/{status_id}/extend", response=ExtendOut)
def extend(request, status_id: str, body: ExtendIn):
    scope = org_scope(request, OrgRole.ADMIN)
    s = services.extend_deadline(status=_status_in_scope(scope, status_id), due_at=body.due_at)
    audit_request(request, "compliance.extend", "member_status", s.id, {"due_at": body.due_at})
    return {"status": s.status, "due_at": s.due_at}


@router.post("/statuses/{status_id}/exempt", response=ExemptionCreatedOut)
def exempt(request, status_id: str, body: ExemptIn):
    scope = org_scope(request, OrgRole.ADMIN)
    x = services.grant_exemption(status=_status_in_scope(scope, status_id), reason=body.reason,
                                 granted_by=request.user, ends_at=body.ends_at)  # fmt: skip
    audit_request(request, "compliance.exempt", "member_status", status_id, {"reason": body.reason})
    return {"exemption_id": x.id}


@router.delete("/exemptions/{exemption_id}", response=OkOut)
def revoke_exemption(request, exemption_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    services.revoke_exemption(exemption=get_object_or_404(Exemption, pk=exemption_id, org_id=scope.org_id))
    audit_request(request, "compliance.exemption_revoke", "exemption", exemption_id)
    return {"ok": True}


@router.post("/statuses/{status_id}/records", response=RecordCreatedOut)
def record_completion(request, status_id: str, body: ManualIn):
    scope = org_scope(request, OrgRole.ADMIN)
    rec = services.record_manual_completion(status=_status_in_scope(scope, status_id), completed_at=body.completed_at,
                                            recorded_by=request.user, note=body.note,
                                            evidence_asset_id=body.evidence_asset_id)  # fmt: skip
    audit_request(request, "compliance.record", "completion_record", rec.id, {"note": body.note})
    return {"record_id": rec.id}


@router.post("/records/{record_id}/void", response=OkOut)
def void(request, record_id: str, body: VoidIn):
    scope = org_scope(request, OrgRole.ADMIN)
    services.void_record(record=get_object_or_404(CompletionRecord, pk=record_id, org_id=scope.org_id),
                         reason=body.reason)  # fmt: skip
    audit_request(request, "compliance.void", "completion_record", record_id, {"reason": body.reason})
    return {"ok": True}


@router.post("/statuses/{status_id}/remind", response=ReminderOut)
def remind(request, status_id: str):
    """Managers may nudge their own people (once per person, requirement and day)."""
    scope = org_scope(request, OrgRole.MANAGER)
    r = services.send_reminder(status=_status_in_scope(scope, status_id), sent_by=request.user)
    audit_request(request, "compliance.remind", "member_status", status_id)
    return {"reminder_id": r.id}


# ---------------------------------------------------------------- export
_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def _cell(value) -> str:
    """CSV injection guard: a cell starting like a formula is prefixed so Excel shows
    it as text instead of running it."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M UTC")
    text = str(value)
    return "'" + text if text.startswith(_FORMULA) else text


class _Echo:
    def write(self, value):
        return value


@router.get("/export.csv")
def export(request, unit_id: str | None = None):
    """Audited (who exported what). Rows are read INSIDE the request: a streamed body runs
    after the tenant middleware has closed the transaction (and its RLS context), so a
    lazy query there would see nothing. 50,000 rows is a few MB; the output still streams."""
    scope = org_scope(request, OrgRole.MANAGER)
    unit = _unit(scope, unit_id)
    data = list(selectors.export_rows(scope, unit=unit))
    writer = csv.writer(_Echo())
    header = ["Name", "Email", "Employee ref", "Requirement", "Status", "Due (UTC)", "Completed", "Expires"]

    def rows():
        yield writer.writerow(header)
        for row in data:
            yield writer.writerow([_cell(v) for v in row])

    audit_request(request, "compliance.export", "organization", scope.org_id, {"unit": unit_id})
    response = StreamingHttpResponse(rows(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="compliance.csv"'
    response["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------- learner
@router.get("/my", response=list[MyRequirement])
def my_requirements(request):
    """The signed-in learner's required training in the current company."""
    org_id = require_org(request)
    return [
        {"status_id": s.id, "requirement": s.requirement.name, "course_id": s.requirement.course_id,
         "course_slug": s.requirement.course.slug, "course_title": s.requirement.course.title, "status": s.status,
         "due_at": s.due_at, "expires_at": s.expires_at, "completed_at": s.completed_at}
        for s in selectors.my_required(org_id=org_id, user_id=request.user.id)
    ]  # fmt: skip
