"""Console > Students and Instructors (mockup 05)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from django.db import transaction
from django.db.models import Avg, Count, Exists, OuterRef, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Course, CourseInstructor, InstructorPermission
from apps.catalog.permissions import for_user as instructor_permissions
from apps.engagement.notify import notify
from apps.identity import invites
from apps.identity import services as identity
from apps.identity.models import InstructorInvite, InstructorProfile, User
from apps.payouts import selectors as ledger
from apps.payouts import services as payouts
from apps.payouts.models import Payout, PayoutRequest
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from .. import services as platform
from ..services import audit_request
from .common import (
    ConsoleKpiOut,
    ConsoleOkOut,
    ConsoleReasonIn,
    ConsoleStatusOut,
    clamp,
    kpi,
    pct,
    router,
    staff,
)


def _is_seeded_demo(user: User) -> bool:
    """Accounts made by seed_demo (all on example.com) are never deleted from the console."""
    return bool(platform.get_setting("demo.seeded")) and (
        user.email.endswith(".example.com") or user.email.endswith("@example.com")
    )


def _not_self(request, user: User, what: str) -> None:
    if user.pk == request.user.pk:
        raise ServiceError("self", f"You can't {what} your own account.")


# ---------------------------------------------------------------- applications (M4, kept)
class ConsoleInstructorOut(Schema):
    user_id: UUID
    name: str
    email: str
    headline: str
    bio: str
    website_url: str
    status: str
    applied_at: datetime
    platform_fee_pct: float | None
    fee_is_custom: bool


class ConsoleDecisionIn(Schema):
    approve: bool
    reason: str = Field("", max_length=300)  # required to reject


@router.get("/instructors", response=list[ConsoleInstructorOut])
def instructors(request, status: str = "pending"):
    staff(request)
    rows = InstructorProfile.objects.filter(status=status).select_related("user").order_by("created_at")[:200]
    default = payouts.default_fee_bps()
    return [{"user_id": p.user_id, "name": p.user.full_name, "email": p.user.email, "headline": p.headline,
             "bio": p.bio, "website_url": p.website_url, "status": p.status, "applied_at": p.created_at,
             "platform_fee_pct": pct(p.platform_fee_bps if p.platform_fee_bps is not None else default),
             "fee_is_custom": p.platform_fee_bps is not None} for p in rows]  # fmt: skip


@router.post("/instructors/{user_id}/decision", response=ConsoleStatusOut)
def decide_instructor(request, user_id: str, body: ConsoleDecisionIn):
    staff(request)
    reason = html.plain(body.reason, 300).strip()
    if not body.approve and len(reason) < 3:
        raise ServiceError("reason_required", "Give a reason so the applicant knows what to change.")
    p = get_object_or_404(InstructorProfile, user_id=user_id)
    p.status = "approved" if body.approve else "rejected"
    p.approved_at = timezone.now() if body.approve else None
    p.public_slug = p.public_slug or f"i-{p.user_id.hex[-12:]}"
    if body.approve and p.platform_fee_bps is None:
        p.platform_fee_bps = payouts.default_fee_bps()  # the default at approval time is theirs to keep
    p.save(update_fields=["status", "approved_at", "public_slug", "platform_fee_bps", "updated_at"])
    audit_request(
        request, "instructor.decision", "user", user_id, {"approved": body.approve, "reason": reason}
    )
    if body.approve:
        notify(
            [p.user_id], "instructor_approved", {}, url="/studio", dedupe=f"instructor-approved:{p.user_id}"
        )
    else:
        notify([p.user_id], "instructor_rejected", {"reason": reason}, url="/teach")
    return {"status": p.status}


# ---------------------------------------------------------------- users (M4, kept)
class ConsoleUserRowOut(Schema):
    id: UUID
    email: str
    full_name: str
    is_active: bool
    is_staff: bool
    created_at: datetime
    last_login: datetime | None
    anonymized_at: datetime | None


class ConsoleUserPageOut(Schema):
    items: list[ConsoleUserRowOut]
    next_cursor: str | None


class ConsoleMembershipOut(Schema):
    org_id: UUID
    org__name: str
    role: str
    removed_at: datetime | None


class ConsoleUserOrderOut(Schema):
    id: UUID
    status: str
    currency: str
    total_minor: int
    created_at: datetime


class ConsoleUserEnrollmentOut(Schema):
    id: UUID
    course__title: str
    org__name: str | None
    status: str
    progress_pct: Decimal
    enrolled_at: datetime


class ConsoleUserDetailOut(ConsoleUserRowOut):
    memberships: list[ConsoleMembershipOut]
    orders: list[ConsoleUserOrderOut]
    enrollments: list[ConsoleUserEnrollmentOut]


class ConsoleUserPatch(Schema):
    is_active: bool


@router.get("/users", response=ConsoleUserPageOut)
def users(request, q: str | None = None, cursor: str | None = None, limit: int = 50):
    staff(request)
    limit = clamp(limit)
    qs = User.objects.all()
    if q:
        qs = qs.filter(Q(email__icontains=q.strip()[:100]) | Q(full_name__icontains=q.strip()[:100]))
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id").values("id", "email", "full_name", "is_active", "is_staff", "created_at",
                                          "last_login", "anonymized_at")[: limit + 1])  # fmt: skip
    page = rows[:limit]
    return {"items": page, "next_cursor": keyset.encode(page[-1]["id"]) if len(rows) > limit else None}


@router.get("/users/{user_id}", response=ConsoleUserDetailOut)
def user_detail(request, user_id: str):
    from apps.commerce.models import Order
    from apps.learning.models import Enrollment
    from apps.org.models import OrgMember

    staff(request)
    u = get_object_or_404(User, pk=user_id)
    return {
        "id": u.id, "email": u.email, "full_name": u.full_name, "is_active": u.is_active, "is_staff": u.is_staff,
        "created_at": u.created_at, "last_login": u.last_login, "anonymized_at": u.anonymized_at,
        "memberships": list(OrgMember.objects.filter(user=u).values("org_id", "org__name", "role", "removed_at")),
        "orders": list(Order.objects.filter(user=u).order_by("-created_at").values(
            "id", "status", "currency", "total_minor", "created_at")[:50]),
        "enrollments": list(Enrollment.objects.filter(user=u).order_by("-enrolled_at").values(
            "id", "course__title", "org__name", "status", "progress_pct", "enrolled_at")[:100]),
    }  # fmt: skip


@router.patch("/users/{user_id}", response=ConsoleOkOut)
def update_user(request, user_id: str, body: ConsoleUserPatch):
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    if not body.is_active:
        _not_self(request, user, "suspend")
    identity.set_active(user=user, active=body.is_active)
    audit_request(request, "user.active", "user", user_id, {"is_active": body.is_active})
    return {"ok": True}


@router.post("/users/{user_id}/anonymize", response=ConsoleOkOut)
def anonymize(request, user_id: str):
    """Delete = anonymise (irreversible; the UI asks for a typed phrase first). Never
    yourself, never staff, never a seeded demo account."""
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    _not_self(request, user, "delete")
    if _is_seeded_demo(user):
        raise ServiceError("demo_account", "Demo accounts can't be deleted. Suspend it instead.")
    identity.anonymize(user=user)
    audit_request(request, "user.anonymize", "user", user_id)
    return {"ok": True}


# ---------------------------------------------------------------- shared account actions
class ConsoleAccountPatch(Schema):
    full_name: str | None = Field(None, min_length=1, max_length=200)
    email: str | None = Field(None, min_length=3, max_length=320)


@router.patch("/people/accounts/{user_id}", response=ConsoleOkOut)
@transaction.atomic
def edit_account(request, user_id: UUID, body: ConsoleAccountPatch):
    """Edit name and sign-in email. A new email is marked verified (staff checked it)."""
    from allauth.account.models import EmailAddress

    staff(request)
    user = get_object_or_404(User, pk=user_id)
    if user.anonymized_at:
        raise ServiceError("deleted", "This account was deleted.")
    changes = {}
    if body.full_name is not None:
        name = html.plain(body.full_name, 200).strip()
        if not name:
            raise ServiceError("name_required", "Enter a name.")
        changes["full_name"] = name
    if body.email is not None:
        email = body.email.strip().lower()
        if "@" not in email or " " in email:
            raise ServiceError("bad_email", "Enter a valid email address.")
        if email != user.email and User.objects.filter(email__iexact=email).exists():
            raise ServiceError("email_taken", "Another account uses that email.")
        if email != user.email:
            changes["email"] = email
            EmailAddress.objects.filter(user=user).delete()
            EmailAddress.objects.create(user=user, email=email, verified=True, primary=True)
    if changes:
        User.objects.filter(pk=user.pk).update(**changes, updated_at=timezone.now())
        audit_request(request, "user.edit", "user", str(user_id), changes)
    return {"ok": True}


@router.post("/people/accounts/{user_id}/suspend", response=ConsoleOkOut)
def suspend_account(request, user_id: UUID, body: ConsoleReasonIn):
    """The person can no longer sign in (every session ends). Their records stay."""
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    _not_self(request, user, "suspend")
    if user.is_staff:
        raise ServiceError("staff", "Remove staff rights before suspending this account.")
    notify([user.id], "account_suspended", {}, url="/")  # before: inactive accounts get no messages
    identity.set_active(user=user, active=False)
    audit_request(request, "user.suspend", "user", str(user_id), {"reason": body.reason})
    return {"ok": True}


@router.post("/people/accounts/{user_id}/reactivate", response=ConsoleOkOut)
def reactivate_account(request, user_id: UUID):
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    if user.anonymized_at:
        raise ServiceError("deleted", "A deleted account can't be reactivated.")
    identity.set_active(user=user, active=True)
    audit_request(request, "user.reactivate", "user", str(user_id))
    notify([user.id], "account_reactivated", {}, url="/learn")
    return {"ok": True}


# ---------------------------------------------------------------- students
StudentStatus = Literal["", "active", "suspended", "deleted"]
EnrolmentFilter = Literal["", "none", "any", "active", "completed"]


class ConsoleStudentKpisOut(Schema):
    total: int
    active: int
    suspended: int
    new_30d: ConsoleKpiOut


class ConsoleStudentRowOut(Schema):
    id: UUID
    name: str
    email: str
    status: str  # active / suspended / deleted
    enrolments: int
    avg_progress: float
    joined: datetime
    last_login: datetime | None
    is_instructor: bool


class ConsoleStudentPageOut(Schema):
    items: list[ConsoleStudentRowOut]
    next_cursor: str | None


def _status(u) -> str:
    return "deleted" if u.anonymized_at else "active" if u.is_active else "suspended"


def _students(q: str, status: str, enrolment: str):
    from apps.learning.models import Enrollment

    qs = User.objects.filter(is_staff=False)
    q = q.strip()[:100]
    if q:
        qs = qs.filter(Q(email__icontains=q) | Q(full_name__icontains=q))
    if status == "active":
        qs = qs.filter(is_active=True, anonymized_at__isnull=True)
    elif status == "suspended":
        qs = qs.filter(is_active=False, anonymized_at__isnull=True)
    elif status == "deleted":
        qs = qs.filter(anonymized_at__isnull=False)
    mine = Enrollment.objects.filter(user=OuterRef("pk"))
    if enrolment == "none":
        qs = qs.exclude(Exists(mine))
    elif enrolment == "any":
        qs = qs.filter(Exists(mine))
    elif enrolment in ("active", "completed"):
        qs = qs.filter(Exists(mine.filter(status=enrolment)))
    return qs


def _student_rows(users: list[User]) -> list[dict]:
    from apps.learning.models import Enrollment

    stats = {
        r["user_id"]: r
        for r in Enrollment.objects.filter(user_id__in=[u.id for u in users])
        .exclude(status__in=["revoked", "superseded"])
        .values("user_id").annotate(n=Count("id"), avg=Avg("progress_pct"))
    }  # fmt: skip
    teaching = set(InstructorProfile.objects.filter(user_id__in=[u.id for u in users], status="approved")
                   .values_list("user_id", flat=True))  # fmt: skip
    return [{"id": u.id, "name": u.full_name, "email": u.email, "status": _status(u),
             "enrolments": stats.get(u.id, {}).get("n", 0),
             "avg_progress": round(float(stats.get(u.id, {}).get("avg") or 0), 1),
             "joined": u.created_at, "last_login": u.last_login, "is_instructor": u.id in teaching}
            for u in users]  # fmt: skip


@router.get("/people/students/kpis", response=ConsoleStudentKpisOut)
def student_kpis(request):
    staff(request)
    now = timezone.now()
    d30, d60 = now - timezone.timedelta(days=30), now - timezone.timedelta(days=60)
    agg = User.objects.filter(is_staff=False, anonymized_at__isnull=True).aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(is_active=True)),
        suspended=Count("id", filter=Q(is_active=False)),
        new=Count("id", filter=Q(created_at__gte=d30)),
        before=Count("id", filter=Q(created_at__gte=d60, created_at__lt=d30)),
    )
    return {"total": agg["total"], "active": agg["active"], "suspended": agg["suspended"],
            "new_30d": kpi(agg["new"], agg["before"])}  # fmt: skip


@router.get("/people/students", response=ConsoleStudentPageOut)
def students(
    request, q: str = "", status: StudentStatus = "", enrolment: EnrolmentFilter = "",
    cursor: str | None = None, limit: int = 25,
):  # fmt: skip
    staff(request)
    limit = clamp(limit)
    qs = _students(q, status, enrolment)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": _student_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


@router.get("/people/students/export", response=list[ConsoleStudentRowOut])
def export_students(request, q: str = "", status: StudentStatus = "", enrolment: EnrolmentFilter = ""):
    """Up to 5,000 rows with the current filters (the browser builds the CSV)."""
    staff(request)
    audit_request(
        request, "people.export", "user", "students", {"q": q, "status": status, "enrolment": enrolment}
    )
    return _student_rows(list(_students(q, status, enrolment).order_by("-id")[:5000]))


class ConsoleStudentEnrolmentOut(Schema):
    id: UUID
    course_id: UUID
    course: str
    company: str | None
    source: str
    status: str
    progress_pct: float
    enrolled_at: datetime
    last_accessed_at: datetime | None
    completed_at: datetime | None
    certificate_code: str | None


class ConsoleActivityOut(Schema):
    kind: str
    title: str
    at: datetime
    url: str


class ConsoleStudentDetailOut(Schema):
    id: UUID
    name: str
    email: str
    status: str
    is_staff: bool
    is_instructor: bool
    joined: datetime
    last_login: datetime | None
    enrolments: int
    completed: int
    avg_progress: float
    certificates: int
    orders: int
    spent_gbp_minor: int
    can_delete: bool
    companies: list[str]
    enrolment_list: list[ConsoleStudentEnrolmentOut]
    activity: list[ConsoleActivityOut]


@router.get("/people/students/{user_id}", response=ConsoleStudentDetailOut)
def student_detail(request, user_id: UUID):
    from apps.commerce.models import Order
    from apps.learning.models import Certificate, Enrollment
    from apps.org.models import OrgMember

    staff(request)
    u = get_object_or_404(User, pk=user_id)
    enrols = list(
        Enrollment.objects.filter(user=u)
        .select_related("course", "org", "certificate")
        .order_by("-enrolled_at")[:200]
    )
    live = [e for e in enrols if e.status not in ("revoked", "superseded")]
    certs = list(
        Certificate.objects.filter(user=u).order_by("-issued_at").values("course_title", "issued_at")[:20]
    )
    orders = list(Order.objects.filter(user=u).order_by("-created_at")[:20])
    spent = sum(o.gbp_total_minor for o in orders if o.status in ("paid", "partially_refunded"))
    activity = (
        [{"kind": "enrolled", "title": f"Enrolled in {e.course.title}", "at": e.enrolled_at,
          "url": f"/console/courses?course={e.course_id}"} for e in enrols[:20]]
        + [{"kind": "completed", "title": f"Completed {e.course.title}", "at": e.completed_at,
            "url": f"/console/courses?course={e.course_id}"} for e in enrols if e.completed_at][:20]
        + [{"kind": "certificate", "title": f"Certificate for {c['course_title']}", "at": c["issued_at"],
            "url": "/console/certificates"} for c in certs]
        + [{"kind": "order", "title": f"Order {o.status.replace('_', ' ')}", "at": o.paid_at or o.created_at,
            "url": f"/console/sales?order={o.id}"} for o in orders]
    )  # fmt: skip
    if u.last_login:
        activity.append({"kind": "login", "title": "Signed in", "at": u.last_login, "url": ""})
    activity.sort(key=lambda a: a["at"], reverse=True)
    return {
        "id": u.id, "name": u.full_name, "email": u.email, "status": _status(u), "is_staff": u.is_staff,
        "is_instructor": InstructorProfile.objects.filter(user=u, status="approved").exists(),
        "joined": u.created_at, "last_login": u.last_login, "enrolments": len(live),
        "completed": sum(1 for e in live if e.status == "completed"),
        "avg_progress": round(sum(float(e.progress_pct) for e in live) / len(live), 1) if live else 0.0,
        "certificates": Certificate.objects.filter(user=u, revoked_at__isnull=True).count(),
        "orders": Order.objects.filter(user=u).count(), "spent_gbp_minor": spent,
        "can_delete": not (u.is_staff or u.anonymized_at or u.pk == request.user.pk or _is_seeded_demo(u)),
        "companies": list(OrgMember.objects.filter(user=u, removed_at__isnull=True).values_list("org__name", flat=True)),
        "enrolment_list": [{
            "id": e.id, "course_id": e.course_id, "course": e.course.title, "company": e.org.name if e.org else None,
            "source": e.get_source_display(), "status": e.status, "progress_pct": float(e.progress_pct),
            "enrolled_at": e.enrolled_at, "last_accessed_at": e.last_accessed_at, "completed_at": e.completed_at,
            "certificate_code": getattr(getattr(e, "certificate", None), "verification_code", None),
        } for e in enrols],
        "activity": activity[:30],
    }  # fmt: skip


# ---------------------------------------------------------------- instructors
PermissionFilter = Literal["", "publish_without_review", "no_coupons", "drm", "course_limit", "custom"]


class ConsoleInstructorKpisOut(Schema):
    total: int
    active: int
    suspended: int
    pending_applications: int
    total_earnings_gbp_minor: int


class ConsoleInstructorRowOut(Schema):
    user_id: UUID
    name: str
    email: str
    status: str
    courses: int
    students: int
    earnings_gbp_minor: int
    keeps_pct: float
    fee_is_custom: bool
    applied_at: datetime
    approved_at: datetime | None


class ConsoleInstructorPageOut(Schema):
    items: list[ConsoleInstructorRowOut]
    next_cursor: str | None


def _instructors(q: str, status: str, permission: str):
    qs = InstructorProfile.objects.select_related("user")
    if status:
        qs = qs.filter(status=status)
    q = q.strip()[:100]
    if q:
        qs = qs.filter(Q(user__full_name__icontains=q) | Q(user__email__icontains=q))
    perms = InstructorPermission.objects.filter(user_id=OuterRef("user_id"))
    if permission == "publish_without_review":
        qs = qs.filter(Exists(perms.filter(can_publish_without_review=True)))
    elif permission == "no_coupons":
        qs = qs.filter(Exists(perms.filter(can_create_coupons=False)))
    elif permission == "drm":
        qs = qs.filter(Exists(perms.filter(can_use_drm=True)))
    elif permission == "course_limit":
        qs = qs.filter(Exists(perms.filter(max_courses__isnull=False)))
    elif permission == "custom":
        qs = qs.filter(Exists(perms))
    return qs


def _instructor_rows(profiles) -> list[dict]:
    ids = [p.user_id for p in profiles]
    stats = {
        r["user_id"]: r
        for r in CourseInstructor.objects.filter(user_id__in=ids, course__deleted_at__isnull=True)
        .values("user_id").annotate(n=Count("course_id", distinct=True), s=Sum("course__student_count"))
    }  # fmt: skip
    totals, default = ledger.totals_by_user(ids), payouts.default_fee_bps()
    return [{"user_id": p.user_id, "name": p.user.full_name, "email": p.user.email, "status": p.status,
             "courses": stats.get(p.user_id, {}).get("n", 0), "students": stats.get(p.user_id, {}).get("s") or 0,
             "earnings_gbp_minor": totals.get(p.user_id) or 0,
             "keeps_pct": pct(10000 - (p.platform_fee_bps if p.platform_fee_bps is not None else default)),
             "fee_is_custom": p.platform_fee_bps is not None, "applied_at": p.created_at,
             "approved_at": p.approved_at} for p in profiles]  # fmt: skip


@router.get("/people/instructors/kpis", response=ConsoleInstructorKpisOut)
def instructor_kpis(request):
    from apps.payouts.models import Earning

    staff(request)
    agg = InstructorProfile.objects.aggregate(
        active=Count("id", filter=Q(status="approved")),
        suspended=Count("id", filter=Q(status="suspended")),
        pending=Count("id", filter=Q(status="pending")),
    )
    return {"total": agg["active"] + agg["suspended"], "active": agg["active"], "suspended": agg["suspended"],
            "pending_applications": agg["pending"],
            "total_earnings_gbp_minor": Earning.objects.aggregate(t=Sum("amount_gbp_minor", default=0))["t"]}  # fmt: skip


class ConsoleInviteIn(Schema):
    email: str = Field(..., min_length=3, max_length=320)
    name: str = Field("", max_length=200)


class ConsoleInviteOut(Schema):
    email: str
    expires_days: int


@router.post("/people/instructors/invite", response=ConsoleInviteOut)
@transaction.atomic
def invite_instructor(request, body: ConsoleInviteIn):
    """Emails a 7-day link; the person becomes an instructor when they accept it."""
    staff(request)
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise ServiceError("bad_email", "Enter a valid email address.")
    invites.send_invite(email=email, name=html.plain(body.name, 200), invited_by=request.user)
    audit_request(request, "instructor.invite", "user", email, {"email": email})
    return {"email": email, "expires_days": 7}


class ConsoleInstructorInviteOut(Schema):
    id: UUID
    email: str
    name: str
    invited_by: str
    sent_at: datetime
    expires_at: datetime
    send_count: int
    expired: bool


def _invite_out(i) -> dict:
    return {"id": i.id, "email": i.email, "name": i.name, "invited_by": i.invited_by.full_name if i.invited_by else "",
            "sent_at": i.sent_at, "expires_at": i.expires_at, "send_count": i.send_count,
            "expired": i.expires_at <= timezone.now()}  # fmt: skip


def _pending_invite(invite_id):
    return get_object_or_404(InstructorInvite.objects.select_related("invited_by"), pk=invite_id,
                             accepted_at__isnull=True, cancelled_at__isnull=True)  # fmt: skip


@router.get("/people/instructors/invites", response=list[ConsoleInstructorInviteOut])
def pending_invites(request):
    """Invitations not yet accepted or cancelled, newest first (expired ones too, so they
    can be resent)."""
    staff(request)
    rows = (
        InstructorInvite.objects.filter(accepted_at__isnull=True, cancelled_at__isnull=True)
        .select_related("invited_by")
        .order_by("-sent_at")[:100]
    )
    return [_invite_out(i) for i in rows]


@router.post("/people/instructors/invites/{invite_id}/resend", response=ConsoleInstructorInviteOut)
@transaction.atomic
def resend_invite(request, invite_id: UUID):
    staff(request)
    invite = invites.resend(invite=_pending_invite(invite_id), by=request.user)
    audit_request(request, "instructor.invite_resend", "user", invite.email, {"email": invite.email})
    return _invite_out(invite)


@router.post("/people/instructors/invites/{invite_id}/cancel", response=ConsoleOkOut)
@transaction.atomic
def cancel_invite(request, invite_id: UUID):
    staff(request)
    invite = invites.cancel(invite=_pending_invite(invite_id))
    audit_request(request, "instructor.invite_cancel", "user", invite.email, {"email": invite.email})
    return {"ok": True}


@router.get("/people/instructors", response=ConsoleInstructorPageOut)
def instructor_list(
    request, q: str = "", status: str = "", permission: PermissionFilter = "", cursor: str | None = None,
    limit: int = 25,
):  # fmt: skip
    staff(request)
    limit = clamp(limit)
    qs = _instructors(q, status, permission)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": _instructor_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


@router.get("/people/instructors/export", response=list[ConsoleInstructorRowOut])
def export_instructors(request, q: str = "", status: str = "", permission: PermissionFilter = ""):
    staff(request)
    audit_request(
        request, "people.export", "user", "instructors", {"q": q, "status": status, "permission": permission}
    )
    return _instructor_rows(list(_instructors(q, status, permission).order_by("-id")[:5000]))


class ConsoleInstructorPermissionsOut(Schema):
    can_publish_without_review: bool
    can_create_coupons: bool
    can_use_drm: bool
    can_issue_certificates: bool
    max_courses: int | None
    is_custom: bool


class ConsoleInstructorPermissionsIn(Schema):
    can_publish_without_review: bool
    can_create_coupons: bool
    can_use_drm: bool
    can_issue_certificates: bool
    max_courses: int | None = Field(None, ge=0, le=1000)


class ConsoleInstructorCourseOut(Schema):
    id: UUID
    title: str
    status: str
    students: int
    rating_avg: float
    rating_count: int
    earned_gbp_minor: int


class ConsoleInstructorMonthOut(Schema):
    month: date
    amount: int


class ConsoleInstructorBalanceOut(Schema):
    available: int
    pending: int
    paid: int
    in_payout: int


class ConsoleInstructorPayoutOut(Schema):
    id: UUID
    kind: str  # request / payout
    reference: str
    amount_gbp_minor: int
    method: str
    status: str
    at: datetime
    reason: str


class ConsoleInstructorRuleOut(Schema):
    name: str
    scope: str
    keeps_pct: float
    target: str


class ConsoleInstructorDetailOut(Schema):
    user_id: UUID
    name: str
    email: str
    status: str
    account_active: bool
    headline: str
    bio: str
    website_url: str
    applied_at: datetime
    approved_at: datetime | None
    courses: int
    students: int
    earnings_gbp_minor: int
    keeps_pct: float
    fee_is_custom: bool
    default_keeps_pct: float
    rules: list[ConsoleInstructorRuleOut]
    permissions: ConsoleInstructorPermissionsOut
    course_list: list[ConsoleInstructorCourseOut]
    balance: ConsoleInstructorBalanceOut
    by_month: list[ConsoleInstructorMonthOut]
    payouts: list[ConsoleInstructorPayoutOut]
    payout_method: str | None
    payout_verified: bool


@router.get("/people/instructors/{user_id}", response=ConsoleInstructorDetailOut)
def instructor_detail(request, user_id: UUID):
    from django.db.models.functions import TruncMonth

    from apps.payouts.models import Earning, PayoutAccount

    staff(request)
    p = get_object_or_404(InstructorProfile.objects.select_related("user"), user_id=user_id)
    course_ids = list(CourseInstructor.objects.filter(user_id=user_id).values_list("course_id", flat=True))
    courses = list(
        Course.objects.filter(pk__in=course_ids, deleted_at__isnull=True).order_by("-student_count")
    )
    earned = dict(
        Earning.objects.filter(user_id=user_id).values("course_id").annotate(t=Sum("amount_gbp_minor"))
        .values_list("course_id", "t")
    )  # fmt: skip
    since = timezone.now() - timezone.timedelta(days=365)
    months = list(
        Earning.objects.filter(user_id=user_id, earned_at__gte=since).annotate(month=TruncMonth("earned_at"))
        .values("month").annotate(amount=Sum("amount_gbp_minor")).order_by("month")
    )  # fmt: skip
    reqs = list(PayoutRequest.objects.filter(user_id=user_id).order_by("-created_at")[:20])
    runs = list(Payout.objects.filter(user_id=user_id).order_by("-created_at")[:20])
    history = [
        {
            "id": r.id,
            "kind": "request",
            "reference": payouts.reference(r),
            "amount_gbp_minor": r.amount_gbp_minor,
            "method": r.method,
            "status": r.status,
            "at": r.created_at,
            "reason": r.reason,
        }
        for r in reqs
    ]
    history += [{"id": r.id, "kind": "payout", "reference": f"Payout {r.period_end:%d %b %Y}",
                 "amount_gbp_minor": r.amount_gbp_minor, "method": r.method, "status": r.status, "at": r.created_at,
                 "reason": r.failure_reason} for r in runs]  # fmt: skip
    history.sort(key=lambda h: h["at"], reverse=True)
    rules = [r for r in payouts.active_rules(timezone.now())
             if (r.scope == "instructor" and r.target_id == p.user_id) or (r.scope == "course" and r.target_id in course_ids)]  # fmt: skip
    titles = {c.id: c.title for c in courses}
    default = payouts.default_fee_bps()
    account = PayoutAccount.objects.filter(user_id=user_id).first()
    perms = instructor_permissions(user_id)
    return {
        "user_id": p.user_id, "name": p.user.full_name, "email": p.user.email, "status": p.status,
        "account_active": p.user.is_active, "headline": p.headline, "bio": p.bio, "website_url": p.website_url,
        "applied_at": p.created_at, "approved_at": p.approved_at, "courses": len(courses),
        "students": sum(c.student_count for c in courses), "earnings_gbp_minor": sum(v or 0 for v in earned.values()),
        "keeps_pct": pct(10000 - (p.platform_fee_bps if p.platform_fee_bps is not None else default)),
        "fee_is_custom": p.platform_fee_bps is not None, "default_keeps_pct": pct(10000 - default),
        "rules": [{"name": r.name or r.get_scope_display(), "scope": r.scope, "keeps_pct": pct(r.instructor_bps),
                   "target": titles.get(r.target_id, p.user.full_name)} for r in rules],
        "permissions": perms,
        "course_list": [{"id": c.id, "title": c.title, "status": c.status, "students": c.student_count,
                         "rating_avg": float(c.rating_avg), "rating_count": c.rating_count,
                         "earned_gbp_minor": earned.get(c.id) or 0} for c in courses],
        "balance": ledger.balance(user_id=user_id), "by_month": months, "payouts": history[:30],
        "payout_method": account.method if account else None,
        "payout_verified": bool(account and account.verified_at),
    }  # fmt: skip


@router.put("/people/instructors/{user_id}/permissions", response=ConsoleInstructorPermissionsOut)
def set_permissions(request, user_id: UUID, body: ConsoleInstructorPermissionsIn):
    """Enforced by the studio (apps.catalog.permissions), not just shown."""
    staff(request)
    get_object_or_404(InstructorProfile, user_id=user_id)
    InstructorPermission.objects.update_or_create(
        user_id=user_id, defaults={**body.dict(), "updated_by": request.user}
    )
    audit_request(request, "instructor.permissions", "user", str(user_id), body.dict())
    notify([user_id], "permissions_changed", {}, url="/studio")
    return instructor_permissions(user_id)


class ConsoleInstructorPatch(Schema):
    full_name: str | None = Field(None, min_length=1, max_length=200)
    headline: str | None = Field(None, max_length=160)
    bio: str | None = Field(None, max_length=5000)
    website_url: str | None = Field(None, max_length=500)


@router.patch("/people/instructors/{user_id}", response=ConsoleOkOut)
def edit_instructor(request, user_id: UUID, body: ConsoleInstructorPatch):
    staff(request)
    p = get_object_or_404(InstructorProfile, user_id=user_id)
    changes = {}
    if body.headline is not None:
        changes["headline"] = html.plain(body.headline, 160).strip()
    if body.bio is not None:
        changes["bio"] = html.plain(body.bio, 5000).strip()
    if body.website_url is not None:
        url = body.website_url.strip()
        if url and not url.startswith("https://"):
            raise ServiceError("bad_url", "Use an https:// link.")
        changes["website_url"] = url
    if changes:
        InstructorProfile.objects.filter(pk=p.pk).update(**changes, updated_at=timezone.now())
    if body.full_name is not None:
        name = html.plain(body.full_name, 200).strip()
        if not name:
            raise ServiceError("name_required", "Enter a name.")
        User.objects.filter(pk=user_id).update(full_name=name, updated_at=timezone.now())
        changes["full_name"] = name
    audit_request(request, "instructor.edit", "user", str(user_id), changes)
    return {"ok": True}


@router.post("/people/instructors/{user_id}/suspend", response=ConsoleStatusOut)
def suspend_instructor(request, user_id: UUID, body: ConsoleReasonIn):
    """Studio access off; courses stay live and learners keep them."""
    staff(request)
    p = get_object_or_404(InstructorProfile, user_id=user_id, status="approved")
    InstructorProfile.objects.filter(pk=p.pk).update(status="suspended", updated_at=timezone.now())
    audit_request(request, "instructor.suspend", "user", str(user_id), {"reason": body.reason})
    notify([user_id], "instructor_suspended", {"reason": body.reason}, url="/")
    return {"status": "suspended"}


@router.post("/people/instructors/{user_id}/reactivate", response=ConsoleStatusOut)
def reactivate_instructor(request, user_id: UUID):
    staff(request)
    p = get_object_or_404(InstructorProfile, user_id=user_id, status="suspended")
    InstructorProfile.objects.filter(pk=p.pk).update(status="approved", updated_at=timezone.now())
    audit_request(request, "instructor.reactivate", "user", str(user_id))
    notify([user_id], "instructor_reactivated", {}, url="/studio")
    return {"status": "approved"}
