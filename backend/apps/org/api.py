"""Business (company) endpoints: company profile and branding, the unit tree, job roles,
people, invites, assigning training, the company library and the audit trail.

Every endpoint needs X-Org-Id (verified by TenantMiddleware) and a role:
    learner  -> none of these (their own learning lives under /learning)
    manager  -> read people and structure inside the units they manage
    admin    -> everything in the company; owners also manage admins and owners
Changes are written to the company's audit trail.
"""

import json
import uuid
from datetime import timedelta

from django.db import connection, transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router

from apps.catalog.models import Course
from apps.identity.schemas import OkOut
from apps.learning import services as learning
from apps.learning.models import Enrollment
from apps.platform.services import audit_request, has_feature
from core import cursor as keyset
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, Scope, org_scope

from . import services
from .models import (
    Invite,
    JobRole,
    MemberJobRole,
    MemberUnit,
    Organization,
    OrgBranding,
    OrgMember,
    OrgRoleAssignment,
    OrgUnit,
)
from .schemas import (
    AssignIn,
    AssignmentRow,
    AssignOut,
    AuditPage,
    BrandingIn,
    BulkRemindOut,
    InvitationOut,
    InviteAcceptOut,
    InviteIn,
    InviteOut,
    JobRoleIn,
    JobRoleOut,
    LibraryCourse,
    LogoConfirmIn,
    LogoOut,
    LogoUploadIn,
    LogoUploadOut,
    ManagersIn,
    MemberIdsIn,
    MemberPatch,
    MoveIn,
    MoveOut,
    OrgOut,
    OrgResponsibilitiesIn,
    OrgResponsibilitiesOut,
    OrgRoleCapabilitiesOut,
    PersonPage,
    PersonRowsOut,
    UnitIn,
    UnitOut,
    UnitPatch,
)

router = Router(tags=["business"], auth=session_auth)


# ---------------------------------------------------------------- company
@router.get("/company", response=OrgOut)
def company(request):
    scope = org_scope(request, OrgRole.MANAGER)
    org = Organization.objects.get(pk=scope.org_id)
    brand = OrgBranding.objects.filter(org=org).first()
    used = OrgMember.objects.filter(org=org, removed_at__isnull=True).count()
    return {"id": org.id, "name": org.name, "slug": org.slug, "status": org.status, "seat_limit": org.seat_limit,
            "seats_used": used, "retention_months": org.retention_months, "my_role": scope.role.value,
            "logo_url": brand.logo_url if brand else "", "primary_color": brand.primary_color if brand else "",
            "accent_color": brand.accent_color if brand else ""}  # fmt: skip


@router.put("/company/branding", response=OkOut)
def set_branding(request, body: BrandingIn):
    """Logo: an https:// link (as before) or a logo this company uploaded."""
    from . import logos

    scope = org_scope(request, OrgRole.ADMIN)
    url = body.logo_url.strip()
    if url and not (url.startswith("https://") or logos.is_own_logo(scope.org_id, url)):
        raise ServiceError("bad_url", "The logo must be an https:// link or an uploaded image.")
    old = OrgBranding.objects.filter(org_id=scope.org_id).values_list("logo_url", flat=True).first() or ""
    OrgBranding.objects.update_or_create(org_id=scope.org_id, defaults={**body.dict(), "logo_url": url})
    audit_request(request, "company.branding", "organization", scope.org_id, {**body.dict(), "logo_url": url})
    transaction.on_commit(lambda: logos.forget(scope.org_id, old, url))  # the replaced upload, if any
    return {"ok": True}


@router.post("/company/logo/upload", response=LogoUploadOut)
def logo_upload(request, body: LogoUploadIn):
    """Step 1: a 15-minute write-only link to put the image in private storage."""
    from . import logos

    scope = org_scope(request, OrgRole.ADMIN)
    return logos.start_upload(org_id=scope.org_id, filename=body.filename, size_bytes=body.size_bytes)


@router.post("/company/logo/confirm", response=LogoOut)
def logo_confirm(request, body: LogoConfirmIn):
    """Step 2: check what arrived (size, real image content, safe SVG). Returns the path to
    preview and to save with the branding; nothing is live until the branding is saved."""
    from . import logos

    scope = org_scope(request, OrgRole.ADMIN)
    url = logos.confirm(org_id=scope.org_id, name=body.key)
    audit_request(request, "company.logo_upload", "organization", scope.org_id, {"url": url})
    return {"url": url}


@router.get("/logos/{org_id}/{name}", auth=None, include_in_schema=False)
def logo_file(request, org_id: uuid.UUID, name: str):
    """An uploaded company logo, for <img> tags: a 1-hour signed link to the private file."""
    from django.http import HttpResponseRedirect

    from . import logos

    resp = HttpResponseRedirect(logos.signed(org_id, name))
    resp["Cache-Control"] = "private, max-age=600"
    return resp


# ---------------------------------------------------------------- units
@router.get("/units", response=list[UnitOut])
def units(request):
    """The tree in 2 queries: the whole company for admins, only the units they manage
    (and everything below) for managers."""
    scope = org_scope(request, OrgRole.MANAGER)
    rows = OrgUnit.objects.filter(org_id=scope.org_id, archived_at__isnull=True)
    if scope.unit_paths is not None:
        rows = rows.filter(path__descendant_of_any=list(scope.unit_paths))
    rows = (
        rows.annotate(
            people=Count(
                "member_links", filter=Q(member_links__member__removed_at__isnull=True), distinct=True
            )
        )
        .prefetch_related(Prefetch("manager_links__member__user"))
        .order_by("path")
    )
    return [{"id": u.id, "parent_id": u.parent_id, "kind": u.kind, "name": u.name, "code": u.code, "depth": u.depth,
             "people": u.people, "managers": [m.member.user.full_name for m in u.manager_links.all()],
             "manager_ids": [m.member_id for m in u.manager_links.all()]}
            for u in rows]  # fmt: skip


@router.post("/units", response=UnitOut)
def create_unit(request, body: UnitIn):
    scope = org_scope(request, OrgRole.ADMIN)
    parent = get_object_or_404(OrgUnit, pk=body.parent_id, org_id=scope.org_id, archived_at__isnull=True)
    if body.kind not in OrgUnit.Kind.values or body.kind == "company":
        raise ServiceError("bad_kind", "Choose region, site, department or team.")
    u = services.create_unit(parent=parent, kind=body.kind, name=body.name.strip(), code=body.code.strip())
    audit_request(request, "unit.create", "unit", u.id, {"name": u.name})
    return {**u.__dict__, "people": 0, "managers": [], "manager_ids": []}


@router.patch("/units/{unit_id}", response=OkOut)
def update_unit(request, unit_id: str, body: UnitPatch):
    scope = org_scope(request, OrgRole.ADMIN)
    unit = get_object_or_404(OrgUnit, pk=unit_id, org_id=scope.org_id, archived_at__isnull=True)
    if body.name is not None or body.code is not None:
        services.rename_unit(unit=unit, name=body.name or unit.name, code=body.code)
    if body.parent_id and body.parent_id != unit.parent_id:
        parent = get_object_or_404(OrgUnit, pk=body.parent_id, org_id=scope.org_id, archived_at__isnull=True)
        services.move_unit(unit=unit, new_parent=parent)
    audit_request(request, "unit.update", "unit", unit.id, body.dict(exclude_none=True))
    return {"ok": True}


@router.delete("/units/{unit_id}", response=OkOut)
def archive_unit(request, unit_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    unit = get_object_or_404(OrgUnit, pk=unit_id, org_id=scope.org_id, archived_at__isnull=True)
    if MemberUnit.objects.filter(unit__path__descendant_of=unit.path, member__removed_at__isnull=True,
                                 unit__org_id=scope.org_id).exists():  # fmt: skip
        raise ServiceError("not_empty", "Move the people in this unit (or below it) first.")
    services.archive_unit(unit=unit)
    audit_request(request, "unit.archive", "unit", unit.id)
    return {"ok": True}


@router.put("/units/{unit_id}/managers", response=OkOut)
def set_managers(request, unit_id: str, body: ManagersIn):
    scope = org_scope(request, OrgRole.ADMIN)
    unit = get_object_or_404(OrgUnit, pk=unit_id, org_id=scope.org_id, archived_at__isnull=True)
    members = list(
        OrgMember.objects.filter(org_id=scope.org_id, id__in=body.member_ids, removed_at__isnull=True)
    )
    if len(members) != len(set(body.member_ids)):
        raise ServiceError("bad_member", "One of these people is not an active member.")
    services.set_unit_managers(unit=unit, members=members)
    audit_request(request, "unit.managers", "unit", unit.id, {"members": [str(m) for m in body.member_ids]})
    return {"ok": True}


# ---------------------------------------------------------------- job roles
@router.get("/job-roles", response=list[JobRoleOut])
def job_roles(request):
    scope = org_scope(request, OrgRole.MANAGER)
    return (
        JobRole.objects.filter(org_id=scope.org_id, archived_at__isnull=True)
        .annotate(people=Count("member_links", filter=Q(member_links__member__removed_at__isnull=True)))
        .order_by("name")
    )


@router.post("/job-roles", response=JobRoleOut)
def create_job_role(request, body: JobRoleIn):
    scope = org_scope(request, OrgRole.ADMIN)
    if JobRole.objects.filter(org_id=scope.org_id, name__iexact=body.name.strip()).exists():
        raise ServiceError("duplicate", "A job role with this name exists.")
    r = JobRole.objects.create(org_id=scope.org_id, name=body.name.strip(), code=body.code.strip())
    audit_request(request, "job_role.create", "job_role", r.id, {"name": r.name})
    return {**r.__dict__, "people": 0}


@router.patch("/job-roles/{role_id}", response=OkOut)
def rename_job_role(request, role_id: str, body: JobRoleIn):
    scope = org_scope(request, OrgRole.ADMIN)
    JobRole.objects.filter(pk=role_id, org_id=scope.org_id).update(name=body.name.strip(), code=body.code.strip(),
                                                                    updated_at=timezone.now())  # fmt: skip
    return {"ok": True}


@router.delete("/job-roles/{role_id}", response=OkOut)
def archive_job_role(request, role_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    role = get_object_or_404(JobRole, pk=role_id, org_id=scope.org_id, archived_at__isnull=True)
    if role.member_links.exists():
        raise ServiceError("in_use", "Remove this role from people first.")
    JobRole.objects.filter(pk=role.pk).update(archived_at=timezone.now())
    audit_request(request, "job_role.archive", "job_role", role.id)
    return {"ok": True}


# ---------------------------------------------------------------- people
@router.get("/people", response=PersonPage)
def people(request, q: str | None = None, unit_id: str | None = None, job_role_id: str | None = None,
           role: str | None = None, direct: bool = False, cursor: str | None = None, limit: int = 50):  # fmt: skip
    """People in scope with their compliance counts: 4 queries for any page size.
    With a unit: everyone in it and in the teams inside it; with direct=true only the
    people placed in that exact unit."""
    from apps.compliance.selectors import after_name, scoped_members

    scope = _people_scope(request)
    limit = max(1, min(limit, 200))
    unit = _unit_or_404(scope, unit_id)
    qs = scoped_members(scope, unit=unit, q=q, job_role_id=job_role_id).select_related("user")
    if unit is not None and direct:
        qs = qs.filter(unit_links__unit=unit)
    if role:
        qs = qs.filter(role=role)
    qs = after_name(qs.order_by("user__full_name", "id"), keyset.decode(cursor, 2))  # alphabetical
    rows = list(qs[: limit + 1])
    page = rows[:limit]
    return {
        "items": _person_rows(page),
        "next_cursor": keyset.encode(page[-1].user.full_name, page[-1].id) if len(rows) > limit else None,
    }


def _unit_or_404(scope, unit_id):
    if not unit_id:
        return None
    try:
        return get_object_or_404(OrgUnit, pk=uuid.UUID(str(unit_id)), org_id=scope.org_id)
    except ValueError:
        raise ServiceError("bad_unit", "This location or team does not exist.", status=404) from None


def _people_scope(request, *, admin: bool = False):
    """HR assignments may administer company people without granting platform/company admin."""
    from core.permissions import require_org

    org_id = require_org(request)
    if getattr(request, "platform_staff", False):
        return Scope(org_id, OrgRole.OWNER, uuid.UUID(int=0), None)
    member_id = getattr(request, "member_id", None)
    role = getattr(request, "org_role", None)
    if member_id is None or role is None:
        raise ServiceError("forbidden", "Join this company to view its people.", status=403)
    is_hr = OrgRoleAssignment.objects.filter(
        org_id=org_id, member_id=member_id, code=OrgRoleAssignment.Code.HR_ADMIN,
        unit__isnull=True, revoked_at__isnull=True,
    ).exists()
    if is_hr:
        return Scope(org_id, OrgRole.ADMIN, member_id, None)
    return org_scope(request, OrgRole.ADMIN if admin else OrgRole.MANAGER)


def _person_rows(page: list) -> list[dict]:
    """Rows for members (user loaded): units (primary first), job roles, compliance counts. 3 queries."""
    from apps.compliance.models import MemberStatus

    ids = [m.id for m in page]
    units, roles = {}, {}
    for mid, name in (
        MemberUnit.objects.filter(member_id__in=ids)
        .order_by("-is_primary")
        .values_list("member_id", "unit__name")
    ):
        units.setdefault(mid, []).append(name)
    for mid, name in MemberJobRole.objects.filter(member_id__in=ids).values_list(
        "member_id", "job_role__name"
    ):
        roles.setdefault(mid, []).append(name)
    counts = {
        r["member_id"]: r
        for r in MemberStatus.objects.filter(member_id__in=ids, requirement__archived_at__isnull=True)
        .values("member_id")
        .annotate(
            total=Count("id"),
            overdue=Count("id", filter=Q(status__in=["overdue", "expired"])),
            expiring=Count("id", filter=Q(status="expiring_soon")),
            compliant=Count("id", filter=Q(status__in=["compliant", "expiring_soon", "exempt"])),
        )
    }
    items = [
        {"member_id": m.id, "user_id": m.user_id, "name": m.user.full_name, "email": m.user.email, "role": m.role,
         "job_title": m.job_title, "employee_ref": m.employee_ref, "joined_at": m.joined_at,
         "units": units.get(m.id, []), "job_roles": roles.get(m.id, []),
         **{k: counts.get(m.id, {}).get(k, 0) for k in ("overdue", "expiring", "compliant", "total")}}
        for m in page
    ]  # fmt: skip
    return items


def _selected(scope, member_ids) -> list:
    """The selected people, every id checked against the caller's scope (the company, and
    a manager's own units). One id outside it and nothing happens."""
    wanted = set(member_ids)
    found = list(
        scope.members(OrgMember.objects.filter(removed_at__isnull=True, pk__in=wanted)).select_related("user")
    )
    if len(found) != len(wanted):
        raise ServiceError("bad_member", "Some of these people are not in your company.", status=404)
    return found


@router.post("/people/rows", response=PersonRowsOut)
def people_rows(request, body: MemberIdsIn):
    """The selected people as rows (for "Export selected"), only people the caller may see."""
    scope = _people_scope(request)
    found = sorted(_selected(scope, body.member_ids), key=lambda m: (m.user.full_name.lower(), str(m.id)))
    audit_request(request, "member.export", "org", scope.org_id, {"people": len(found)})
    return {"items": _person_rows(found)}


@router.post("/people/move", response=MoveOut)
def move_people(request, body: MoveIn):
    """Move people's primary location or team. Other units, role, account and training
    history are kept."""
    scope = _people_scope(request, admin=True)
    members = _selected(scope, body.member_ids)
    unit = get_object_or_404(OrgUnit, pk=body.unit_id, org_id=scope.org_id, archived_at__isnull=True)
    moved, unchanged = services.move_members(org_id=scope.org_id, members=members, unit=unit)
    audit_request(request, "member.move", "unit", unit.id, {"name": unit.name, "people": moved})
    return {"moved": moved, "unchanged": unchanged}


@router.post("/people/remind", response=BulkRemindOut)
def remind_people(request, body: MemberIdsIn):
    """Remind the selected people about every required training still due (the matrix
    reminder, at most once a day per training)."""
    from apps.compliance.services import remind_members

    scope = org_scope(request, OrgRole.MANAGER)
    members = _selected(scope, body.member_ids)
    out = remind_members(org_id=scope.org_id, member_ids=[m.id for m in members], sent_by=request.user)
    audit_request(
        request, "compliance.remind", "org", scope.org_id, {"people": len(members), "sent": out["sent"]}
    )
    return out


@router.patch("/people/{member_id}", response=OkOut)
@transaction.atomic
def update_person(request, member_id: str, body: MemberPatch):
    scope = _people_scope(request, admin=True)
    member = get_object_or_404(OrgMember, pk=member_id, org_id=scope.org_id, removed_at__isnull=True)
    if body.role and body.role != member.role:
        services.change_role(member=member, role=body.role, by_role=scope.role.value)
    fields = {
        k: v.strip()
        for k, v in (("job_title", body.job_title), ("employee_ref", body.employee_ref))
        if v is not None
    }
    if fields:
        OrgMember.objects.filter(pk=member.pk).update(**fields, updated_at=timezone.now())
    if body.unit_ids is not None:
        units = {
            u.id: u
            for u in OrgUnit.objects.filter(
                org_id=scope.org_id, id__in=body.unit_ids, archived_at__isnull=True
            )
        }
        if len(units) != len(set(body.unit_ids)):
            raise ServiceError("bad_unit", "One of these units does not exist.")
        MemberUnit.objects.filter(member=member).exclude(unit_id__in=units).delete()
        for i, uid in enumerate(body.unit_ids):
            services.add_member_to_unit(member=member, unit=units[uid], primary=(i == 0))
    if body.job_role_ids is not None:
        roles = list(
            JobRole.objects.filter(org_id=scope.org_id, id__in=body.job_role_ids, archived_at__isnull=True)
        )
        if len(roles) != len(set(body.job_role_ids)):
            raise ServiceError("bad_job_role", "One of these job roles does not exist.")
        services.set_job_roles(member=member, job_roles=roles)
    audit_request(request, "member.update", "member", member.id, body.dict(exclude_none=True))
    return {"ok": True}


def _can_manage_responsibilities(request, scope) -> bool:
    if getattr(request, "platform_staff", False) or scope.role in (OrgRole.ADMIN, OrgRole.OWNER):
        return True
    member_id = getattr(request, "member_id", None)
    return bool(member_id and OrgRoleAssignment.objects.filter(
        org_id=scope.org_id, member_id=member_id, code=OrgRoleAssignment.Code.HR_ADMIN,
        revoked_at__isnull=True, unit__isnull=True,
    ).exists())


def _responsibility_scope(request):
    from core.permissions import require_org

    org_id = require_org(request)
    role = getattr(request, "org_role", None)
    member_id = getattr(request, "member_id", None)
    if getattr(request, "platform_staff", False):
        return Scope(org_id, OrgRole.OWNER, uuid.UUID(int=0), None)
    if role is None or member_id is None:
        raise ServiceError("forbidden", "Join this company before managing responsibilities.", status=403)
    scope = org_scope(request, OrgRole.LEARNER) if role in (OrgRole.ADMIN, OrgRole.OWNER) else Scope(org_id, OrgRole(role), member_id, ())
    if not _can_manage_responsibilities(request, scope):
        raise ServiceError("forbidden", "Only the company owner, HR or platform admin can manage responsibilities.", status=403)
    return scope


@router.get("/role-capabilities", response=OrgRoleCapabilitiesOut)
def role_capabilities(request):
    if getattr(request, "platform_staff", False):
        return {"can_manage_responsibilities": True, "responsibilities": []}
    member_id = getattr(request, "member_id", None)
    if member_id is None:
        return {"can_manage_responsibilities": False, "responsibilities": []}
    role = getattr(request, "org_role", None)
    rows = list(OrgRoleAssignment.objects.filter(
        org_id=request.org_id, member_id=member_id, revoked_at__isnull=True,
    ).select_related("unit").order_by("code", "unit__name"))
    allowed = role in (OrgRole.ADMIN, OrgRole.OWNER) or any(
        row.code == OrgRoleAssignment.Code.HR_ADMIN and row.unit_id is None for row in rows
    )
    return {
        "can_manage_responsibilities": bool(allowed),
        "responsibilities": [
            {"code": row.code, "unit_id": row.unit_id, "unit_name": row.unit.name if row.unit_id else None}
            for row in rows
        ],
    }


@router.get("/people/{member_id}/responsibilities", response=OrgResponsibilitiesOut)
def person_responsibilities(request, member_id: str):
    scope = _responsibility_scope(request)
    member = get_object_or_404(OrgMember, pk=member_id, org_id=scope.org_id, removed_at__isnull=True)
    rows = OrgRoleAssignment.objects.filter(org_id=scope.org_id, member=member, revoked_at__isnull=True).select_related("unit")
    return {"assignments": [
        {"code": row.code, "unit_id": row.unit_id, "unit_name": row.unit.name if row.unit_id else None}
        for row in rows.order_by("code", "unit__name")
    ]}


@router.put("/people/{member_id}/responsibilities", response=OrgResponsibilitiesOut)
@transaction.atomic
def set_person_responsibilities(request, member_id: str, body: OrgResponsibilitiesIn):
    scope = _responsibility_scope(request)
    member = get_object_or_404(OrgMember, pk=member_id, org_id=scope.org_id, removed_at__isnull=True)
    valid_codes = {choice for choice, _label in OrgRoleAssignment.Code.choices}
    requested = []
    seen = set()
    unit_ids = {item.unit_id for item in body.assignments if item.unit_id is not None}
    units = {unit.id: unit for unit in OrgUnit.objects.filter(org_id=scope.org_id, id__in=unit_ids, archived_at__isnull=True)}
    if len(units) != len(unit_ids):
        raise ServiceError("bad_unit", "One of these departments or teams does not exist.")
    for item in body.assignments:
        if item.code not in valid_codes:
            raise ServiceError("bad_responsibility", "Choose a valid company responsibility.")
        if item.code in (OrgRoleAssignment.Code.DEPARTMENT_HEAD, OrgRoleAssignment.Code.LINE_MANAGER) and item.unit_id is None:
            raise ServiceError("unit_required", "Choose a department or team for this responsibility.")
        if item.code in (OrgRoleAssignment.Code.EXECUTIVE, OrgRoleAssignment.Code.HR_ADMIN, OrgRoleAssignment.Code.ACADEMY_MARKETING) and item.unit_id is not None:
            raise ServiceError("unit_not_allowed", "This responsibility applies to the whole company.")
        if item.code == OrgRoleAssignment.Code.DEPARTMENT_HEAD and units[item.unit_id].kind != OrgUnit.Kind.DEPARTMENT:
            raise ServiceError("department_required", "Head of Department must be assigned to a department.")
        key = (item.code, item.unit_id)
        if key in seen:
            raise ServiceError("duplicate_responsibility", "Each responsibility can be assigned once per scope.")
        seen.add(key)
        requested.append(key)
    OrgRoleAssignment.objects.filter(org_id=scope.org_id, member=member, revoked_at__isnull=True).update(revoked_at=timezone.now())
    active = []
    for code, unit_id in requested:
        row = OrgRoleAssignment.objects.create(
            org_id=scope.org_id, member=member, code=code, unit_id=unit_id, assigned_by=request.user,
        )
        active.append({"code": row.code, "unit_id": row.unit_id, "unit_name": units[unit_id].name if unit_id else None})
    audit_request(request, "member.responsibilities", "member", member.id, {"assignments": [{"code": c, "unit_id": str(u) if u else None} for c, u in requested]})
    return {"assignments": active}


@router.delete("/people/{member_id}", response=OkOut)
def remove_person(request, member_id: str):
    scope = _people_scope(request, admin=True)
    member = get_object_or_404(OrgMember, pk=member_id, org_id=scope.org_id, removed_at__isnull=True)
    if member.user_id == request.user.id:
        raise ServiceError("self", "You cannot remove yourself.")
    services.remove_member(member=member, by_role=scope.role.value)
    audit_request(request, "member.remove", "member", member.id)
    return {"ok": True}


# ---------------------------------------------------------------- invites
@router.get("/invites", response=list[InviteOut])
def invites(request, status: str = "pending"):
    """pending (default, as before) | expired | accepted | revoked | history (all but pending)."""
    scope = org_scope(request, OrgRole.ADMIN)
    now = timezone.now()
    open_ = Q(accepted_at__isnull=True, revoked_at__isnull=True)
    rules = {
        "pending": open_ & Q(expires_at__gt=now),
        "expired": open_ & Q(expires_at__lte=now),
        "accepted": Q(accepted_at__isnull=False),
        "revoked": Q(revoked_at__isnull=False, accepted_at__isnull=True),
        "history": ~(open_ & Q(expires_at__gt=now)),
    }
    if status not in rules:
        raise ServiceError("bad_status", "Unknown invitation status.")
    return (
        Invite.objects.filter(rules[status], org_id=scope.org_id)
        .select_related("unit", "job_role")
        .order_by("-created_at")[:500]
    )


RESEND_GAP = timedelta(minutes=5)


@router.post("/invites/{invite_id}/resend", response=InviteOut)
@transaction.atomic
def resend_invite(request, invite_id: str):
    """Send a pending or expired invitation again. A fresh link replaces the old one (the
    old link stops working) and is valid for the usual 7 days. Accepted or cancelled
    invitations cannot be resent, nor one to someone who has already joined."""
    from .tasks import send_invite_task

    scope = org_scope(request, OrgRole.ADMIN)
    old = get_object_or_404(Invite.objects.select_for_update(), pk=invite_id, org_id=scope.org_id)
    if old.accepted_at:
        raise ServiceError("invite_accepted", "This invitation was already accepted.", status=409)
    if old.revoked_at:
        raise ServiceError(
            "invite_revoked", "This invitation was cancelled. Send a new one instead.", status=409
        )
    if old.created_at > timezone.now() - RESEND_GAP:
        raise ServiceError(
            "too_soon", "This invitation was sent a moment ago. Try again in a few minutes.", status=429
        )
    inv, token = services.invite(org_id=scope.org_id, email=old.email, role=old.role, invited_by=request.user,
                                 by_role=scope.role.value, unit=old.unit, job_role=old.job_role)  # fmt: skip
    org_name = Organization.objects.filter(pk=scope.org_id).values_list("name", flat=True).first()
    inviter = request.user.full_name or request.user.email
    transaction.on_commit(lambda: send_invite_task.delay(inv.email, org_name, inviter, token))
    audit_request(request, "invite.resend", "invite", inv.id, {"email": inv.email, "role": inv.role})
    return inv


@router.post("/invites", response=InviteOut)
def create_invite(request, body: InviteIn):
    from email_validator import EmailNotValidError, validate_email

    from .tasks import send_invite_task

    scope = org_scope(request, OrgRole.ADMIN)
    try:
        email = validate_email(body.email, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ServiceError("bad_email", "Enter a valid email address.") from exc
    unit = get_object_or_404(OrgUnit, pk=body.unit_id, org_id=scope.org_id) if body.unit_id else None
    role = get_object_or_404(JobRole, pk=body.job_role_id, org_id=scope.org_id) if body.job_role_id else None
    inv, token = services.invite(org_id=scope.org_id, email=email, role=body.role, invited_by=request.user,
                                 by_role=scope.role.value, unit=unit, job_role=role)  # fmt: skip
    org_name = Organization.objects.filter(pk=scope.org_id).values_list("name", flat=True).first()
    inviter = request.user.full_name or request.user.email
    transaction.on_commit(lambda: send_invite_task.delay(inv.email, org_name, inviter, token))
    audit_request(request, "invite.create", "invite", inv.id, {"email": inv.email, "role": inv.role})
    return inv


@router.delete("/invites/{invite_id}", response=OkOut)
def revoke_invite(request, invite_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    services.revoke_invite(invite=get_object_or_404(Invite, pk=invite_id, org_id=scope.org_id))
    audit_request(request, "invite.revoke", "invite", invite_id)
    return {"ok": True}


@router.get("/invitations/{token}", auth=None, response=InvitationOut)
def invitation(request, token: str):
    """The accept page, before signing in: which company invited you (nothing else)."""
    info = services.invite_preview(token[:100])
    if info is None:
        raise ServiceError("invite_invalid", "This invitation is no longer valid.", status=404)
    return {"org_name": info["org_name"], "role": info["role"]}


@router.post("/invitations/{token}/accept", response=InviteAcceptOut)
def accept(request, token: str):
    member = services.accept_invite(token=token[:100], user=request.user)
    return {"org_id": member.org_id}


# ---------------------------------------------------------------- library & assigning training
def _library(org_id):
    """Courses this company can assign: its own, the platform library, and marketplace
    courses included in business plans when the company has one."""
    business = has_feature("business", org_id=org_id, exclude_source="subscription")
    rule = Q(owner_org_id=org_id) | Q(owner_org_id__isnull=True, ownership="platform")
    if business:
        rule |= Q(owner_org_id__isnull=True, in_business=True)
    return Course.objects.filter(
        rule, status="published", live_version__isnull=False, deleted_at__isnull=True
    )


@router.get("/library", response=list[LibraryCourse])
def library(request, q: str | None = None, source: str | None = None):
    scope = org_scope(request, OrgRole.MANAGER)
    qs = _library(scope.org_id)
    if source == "company":
        qs = qs.filter(owner_org_id=scope.org_id)
    elif source == "platform":
        qs = qs.filter(owner_org_id__isnull=True)
    if q:
        qs = qs.filter(title__icontains=q.strip()[:100])
    qs = qs.annotate(
        assigned=Count("enrollments", filter=Q(enrollments__org_id=scope.org_id), distinct=True),
        completed=Count("enrollments", filter=Q(enrollments__org_id=scope.org_id, enrollments__status="completed"),
                        distinct=True),
    ).order_by("-owner_org_id", "title")[:300]  # fmt: skip
    return [{"id": c.id, "slug": c.slug, "title": c.title, "subtitle": c.subtitle, "thumbnail_url": c.thumbnail_url,
             "ownership": c.ownership, "cpd_hours": float(c.cpd_hours) if c.cpd_hours else None,
             "lecture_count": c.lecture_count, "total_duration_sec": c.total_duration_sec,
             "assigned": c.assigned, "completed": c.completed} for c in qs]  # fmt: skip


@router.post("/assign", response=AssignOut)
def assign(request, body: AssignIn):
    """Give a course to people and/or whole units (including sub-units). Managers can
    assign inside their own units; admins anywhere."""
    from apps.compliance.selectors import scoped_members
    from apps.engagement import notify

    scope = org_scope(request, OrgRole.MANAGER)
    course = _library(scope.org_id).filter(pk=body.course_id).first()
    if course is None:
        raise ServiceError("not_in_library", "This course is not available to your company.", status=404)
    user_ids = set()
    if body.member_ids:  # only people inside the caller's scope count; others are ignored
        user_ids = set(scoped_members(scope).filter(id__in=body.member_ids).values_list("user_id", flat=True))
    for uid in body.unit_ids:
        unit = get_object_or_404(OrgUnit, pk=uid, org_id=scope.org_id, archived_at__isnull=True)
        user_ids |= set(scoped_members(scope, unit=unit).values_list("user_id", flat=True))
    if not user_ids:
        raise ServiceError("nobody", "Choose at least one person or unit.")
    had = set(
        Enrollment.objects.filter(org_id=scope.org_id, course=course, user_id__in=user_ids)
        .exclude(status="superseded")
        .values_list("user_id", flat=True)
    )
    fresh = [u for u in user_ids if u not in had]
    from apps.corporate.assign import assign_with_seats, seat_check  # late: corporate sits above org

    seats = seat_check(scope.org_id, course.id, len(fresh))  # None: not sold per seat, stays free
    if body.dry_run:  # the confirm step: exact counts, nothing written
        return {"enrolled": len(fresh), "already_had_it": len(had), "seats": seats}
    if seats is not None:
        new = assign_with_seats(request, scope, seats, fresh)
    else:
        new = learning.assign_to_members(
            org_id=scope.org_id, course=course, user_ids=list(user_ids), assigned_by=request.user
        )
    if new:
        org_name = Organization.objects.filter(pk=scope.org_id).values_list("name", flat=True).first()
        notify.notify(new, "course_assigned", {"course": course.title, "company": org_name},
                      url=f"/learn/{course.slug}", dedupe=f"assign:{course.id}:{scope.org_id}")  # fmt: skip
    audit_request(
        request, "training.assign", "course", course.id,
        {"people": len(user_ids), "new": len(new), "seats_used": len(new) if seats else 0},
    )  # fmt: skip
    return {"enrolled": len(new), "already_had_it": len(user_ids) - len(new), "seats": seats}


@router.get("/assignments", response=list[AssignmentRow])
def assignments(request, course_id: str):
    """Who has this company course and how far they are (manager scope applies)."""
    from apps.compliance.selectors import scoped_members

    scope = org_scope(request, OrgRole.MANAGER)
    users = scoped_members(scope).values("user_id")
    rows = (
        Enrollment.objects.filter(org_id=scope.org_id, course_id=course_id, user_id__in=users)
        .exclude(status="superseded")
        .select_related("user")
        .order_by("user__full_name")[:2000]
    )
    return [{"enrollment_id": e.id, "name": e.user.full_name, "email": e.user.email, "status": e.status,
             "progress_pct": float(e.progress_pct), "enrolled_at": e.enrolled_at, "completed_at": e.completed_at,
             "last_accessed_at": e.last_accessed_at} for e in rows]  # fmt: skip


# ---------------------------------------------------------------- audit trail
def _json(value) -> dict:
    """jsonb arrives as text on raw cursors (Django leaves decoding to the ORM)."""
    if isinstance(value, dict):
        return value
    return json.loads(value) if value else {}


@router.get("/audit", response=AuditPage)
def audit(request, action: str | None = None, cursor: str | None = None, limit: int = 50):
    """The company's own trail (RLS limits it to this company). Newest first."""
    scope = org_scope(request, OrgRole.ADMIN)
    limit = max(1, min(limit, 200))
    after = keyset.decode(cursor, 2)
    sql = ["SELECT a.id, a.created_at, a.actor_id, u.full_name, a.action, a.target_type, a.target_id, a.data",
           "FROM platform.audit_logs a LEFT JOIN identity.users u ON u.id = a.actor_id WHERE a.org_id = %s"]  # fmt: skip
    params: list = [scope.org_id]
    if action:
        sql.append("AND a.action LIKE %s")
        params.append(action.replace("%", "") + "%")
    if after:
        sql.append("AND (a.created_at, a.id) < (%s::timestamptz, %s::bigint)")
        params += after
    sql.append("ORDER BY a.created_at DESC, a.id DESC LIMIT %s")
    params.append(limit + 1)
    with connection.cursor() as cur:
        cur.execute(" ".join(sql), params)
        rows = cur.fetchall()
    page = rows[:limit]
    items = [{"id": r[0], "created_at": r[1], "actor_id": r[2], "actor_name": r[3], "action": r[4],
              "target_type": r[5], "target_id": r[6], "data": _json(r[7])} for r in page]  # fmt: skip
    nxt = keyset.encode(page[-1][1].isoformat(), page[-1][0]) if len(rows) > limit else None
    return {"items": items, "next_cursor": nxt}
