"""Business (company) endpoints: company profile and branding, the unit tree, job roles,
people, invites, assigning training, the company library and the audit trail.

Every endpoint needs X-Org-Id (verified by TenantMiddleware) and a role:
    learner  -> none of these (their own learning lives under /learning)
    manager  -> read people and structure inside the units they manage
    admin    -> everything in the company; owners also manage admins and owners
Changes are written to the company's audit trail.
"""

import json

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
from core.permissions import OrgRole, org_scope

from . import services
from .models import Invite, JobRole, MemberJobRole, MemberUnit, Organization, OrgBranding, OrgMember, OrgUnit
from .schemas import (
    AssignIn,
    AssignmentRow,
    AssignOut,
    AuditPage,
    BrandingIn,
    InvitationOut,
    InviteAcceptOut,
    InviteIn,
    InviteOut,
    JobRoleIn,
    JobRoleOut,
    LibraryCourse,
    ManagersIn,
    MemberPatch,
    OrgOut,
    PersonPage,
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
    scope = org_scope(request, OrgRole.ADMIN)
    if body.logo_url and not body.logo_url.startswith("https://"):
        raise ServiceError("bad_url", "The logo must be an https:// link.")
    OrgBranding.objects.update_or_create(org_id=scope.org_id, defaults=body.dict())
    audit_request(request, "company.branding", "organization", scope.org_id, body.dict())
    return {"ok": True}


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
           role: str | None = None, cursor: str | None = None, limit: int = 50):  # fmt: skip
    """People in scope with their compliance counts: 4 queries for any page size."""
    from apps.compliance.models import MemberStatus
    from apps.compliance.selectors import after_name, scoped_members

    scope = org_scope(request, OrgRole.MANAGER)
    limit = max(1, min(limit, 200))
    unit = get_object_or_404(OrgUnit, pk=unit_id, org_id=scope.org_id) if unit_id else None
    qs = scoped_members(scope, unit=unit, q=q, job_role_id=job_role_id).select_related("user")
    if role:
        qs = qs.filter(role=role)
    qs = after_name(qs.order_by("user__full_name", "id"), keyset.decode(cursor, 2))  # alphabetical
    rows = list(qs[: limit + 1])
    page = rows[:limit]
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
    return {
        "items": items,
        "next_cursor": keyset.encode(page[-1].user.full_name, page[-1].id) if len(rows) > limit else None,
    }


@router.patch("/people/{member_id}", response=OkOut)
@transaction.atomic
def update_person(request, member_id: str, body: MemberPatch):
    scope = org_scope(request, OrgRole.ADMIN)
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


@router.delete("/people/{member_id}", response=OkOut)
def remove_person(request, member_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    member = get_object_or_404(OrgMember, pk=member_id, org_id=scope.org_id, removed_at__isnull=True)
    if member.user_id == request.user.id:
        raise ServiceError("self", "You cannot remove yourself.")
    services.remove_member(member=member, by_role=scope.role.value)
    audit_request(request, "member.remove", "member", member.id)
    return {"ok": True}


# ---------------------------------------------------------------- invites
@router.get("/invites", response=list[InviteOut])
def invites(request):
    scope = org_scope(request, OrgRole.ADMIN)
    return Invite.objects.filter(org_id=scope.org_id, accepted_at__isnull=True, revoked_at__isnull=True,
                                 expires_at__gt=timezone.now()).order_by("-created_at")[:500]  # fmt: skip


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
    business = has_feature("business", org_id=org_id)
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
    if body.dry_run:  # the confirm step: exact counts, nothing written
        had = (
            Enrollment.objects.filter(org_id=scope.org_id, course=course, user_id__in=user_ids)
            .exclude(status="superseded")
            .values("user_id")
            .distinct()
            .count()
        )
        return {"enrolled": len(user_ids) - had, "already_had_it": had}
    new = learning.assign_to_members(
        org_id=scope.org_id, course=course, user_ids=list(user_ids), assigned_by=request.user
    )
    if new:
        org_name = Organization.objects.filter(pk=scope.org_id).values_list("name", flat=True).first()
        notify.notify(new, "course_assigned", {"course": course.title, "company": org_name},
                      url=f"/learn/{course.slug}", dedupe=f"assign:{course.id}:{scope.org_id}")  # fmt: skip
    audit_request(request, "training.assign", "course", course.id, {"people": len(user_ids), "new": len(new)})
    return {"enrolled": len(new), "already_had_it": len(user_ids) - len(new)}


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
