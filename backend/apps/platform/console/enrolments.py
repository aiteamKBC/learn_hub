"""Console > Enrolments: every personal and company course registration."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Course
from apps.identity.models import User
from apps.learning import services as learning
from apps.learning.models import Enrollment
from apps.org.models import Organization, OrgMember
from core import cursor as keyset
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleOkOut, clamp, router, staff


class ConsoleEnrolmentKpisOut(Schema):
    total: int
    active: int
    completed: int
    personal: int
    company: int
    cancelled: int


class ConsoleEnrolmentRowOut(Schema):
    id: UUID
    user_id: UUID
    student: str
    email: str
    course_id: UUID
    course: str
    company_id: UUID | None
    company: str | None
    scope: str
    source: str
    source_label: str
    status: str
    progress_pct: float
    enrolled_at: datetime
    last_accessed_at: datetime | None
    completed_at: datetime | None


class ConsoleEnrolmentPageOut(Schema):
    items: list[ConsoleEnrolmentRowOut]
    next_cursor: str | None


class ConsoleEnrolmentOptionOut(Schema):
    id: UUID
    label: str
    detail: str = ""


class ConsoleEnrolmentOptionsOut(Schema):
    students: list[ConsoleEnrolmentOptionOut]
    courses: list[ConsoleEnrolmentOptionOut]
    companies: list[ConsoleEnrolmentOptionOut]


class ConsoleEnrolmentCreateIn(Schema):
    user_id: UUID
    course_id: UUID
    company_id: UUID | None = None


class ConsoleEnrolmentCreatedOut(Schema):
    id: UUID


class ConsoleEnrolmentPatchIn(Schema):
    status: Literal["active", "completed", "expired", "revoked"]
    progress_pct: float = Field(..., ge=0, le=100)


def _filtered(q: str, status: str, scope: str, source: str, course: UUID | None, company: UUID | None):
    rows = Enrollment.objects.select_related("user", "course", "org").exclude(
        status=Enrollment.Status.SUPERSEDED
    )
    term = q.strip()
    if term:
        rows = rows.filter(
            Q(user__full_name__icontains=term)
            | Q(user__email__icontains=term)
            | Q(course__title__icontains=term)
            | Q(org__name__icontains=term)
        )
    if status:
        if status not in {choice for choice, _ in Enrollment.Status.choices} - {Enrollment.Status.SUPERSEDED}:
            raise ServiceError("bad_status", "Choose a valid enrolment status.")
        rows = rows.filter(status=status)
    if scope == "personal":
        rows = rows.filter(org__isnull=True)
    elif scope == "company":
        rows = rows.filter(org__isnull=False)
    elif scope:
        raise ServiceError("bad_scope", "Choose personal or company enrolments.")
    if source:
        if source not in {choice for choice, _ in Enrollment.Source.choices}:
            raise ServiceError("bad_source", "Choose a valid enrolment source.")
        rows = rows.filter(source=source)
    if course:
        rows = rows.filter(course_id=course)
    if company:
        rows = rows.filter(org_id=company)
    return rows


def _row(enrolment: Enrollment) -> dict:
    return {
        "id": enrolment.id,
        "user_id": enrolment.user_id,
        "student": enrolment.user.full_name or enrolment.user.email,
        "email": enrolment.user.email,
        "course_id": enrolment.course_id,
        "course": enrolment.course.title,
        "company_id": enrolment.org_id,
        "company": enrolment.org.name if enrolment.org_id else None,
        "scope": "company" if enrolment.org_id else "personal",
        "source": enrolment.source,
        "source_label": enrolment.get_source_display(),
        "status": enrolment.status,
        "progress_pct": float(enrolment.progress_pct),
        "enrolled_at": enrolment.enrolled_at,
        "last_accessed_at": enrolment.last_accessed_at,
        "completed_at": enrolment.completed_at,
    }


@router.get("/enrolments/kpis", response=ConsoleEnrolmentKpisOut)
def enrolment_kpis(request):
    staff(request)
    rows = Enrollment.objects.exclude(status=Enrollment.Status.SUPERSEDED).aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status=Enrollment.Status.ACTIVE)),
        completed=Count("id", filter=Q(status=Enrollment.Status.COMPLETED)),
        personal=Count("id", filter=Q(org__isnull=True)),
        company=Count("id", filter=Q(org__isnull=False)),
        cancelled=Count("id", filter=Q(status__in=(Enrollment.Status.REVOKED, Enrollment.Status.EXPIRED))),
    )
    return rows


@router.get("/enrolments", response=ConsoleEnrolmentPageOut)
def enrolment_list(
    request,
    q: str = "",
    status: str = "",
    scope: str = "",
    source: str = "",
    course: UUID | None = None,
    company: UUID | None = None,
    cursor: str | None = None,
    limit: int = 25,
):
    staff(request)
    limit = clamp(limit)
    rows = _filtered(q, status, scope, source, course, company)
    after = keyset.decode(cursor, 1)
    if after:
        rows = rows.filter(id__lt=after[0])
    found = list(rows.order_by("-id")[: limit + 1])
    page = found[:limit]
    return {
        "items": [_row(item) for item in page],
        "next_cursor": keyset.encode(page[-1].id) if len(found) > limit else None,
    }


@router.get("/enrolments/options", response=ConsoleEnrolmentOptionsOut)
def enrolment_options(request):
    staff(request)
    students = User.objects.filter(is_staff=False, is_active=True, anonymized_at__isnull=True).order_by(
        "full_name", "email"
    )[:2000]
    courses = Course.objects.filter(status="published", deleted_at__isnull=True).order_by("title")[:2000]
    companies = Organization.objects.exclude(status=Organization.Status.CANCELLED).order_by("name")[:1000]
    return {
        "students": [
            {"id": user.id, "label": user.full_name or user.email, "detail": user.email} for user in students
        ],
        "courses": [{"id": course.id, "label": course.title, "detail": "Published"} for course in courses],
        "companies": [
            {"id": org.id, "label": org.name, "detail": org.get_status_display()} for org in companies
        ],
    }


@router.post("/enrolments", response=ConsoleEnrolmentCreatedOut)
@transaction.atomic
def create_enrolment(request, body: ConsoleEnrolmentCreateIn):
    staff(request)
    user = get_object_or_404(
        User, pk=body.user_id, is_staff=False, is_active=True, anonymized_at__isnull=True
    )
    course = get_object_or_404(Course, pk=body.course_id, status="published", deleted_at__isnull=True)
    org = None
    if body.company_id:
        org = get_object_or_404(Organization, pk=body.company_id)
        if not OrgMember.objects.filter(org=org, user=user, removed_at__isnull=True).exists():
            raise ServiceError("not_company_member", "This student is not an active member of that company.")
    existing = (
        Enrollment.objects.filter(user=user, course=course, org=org)
        .exclude(status=Enrollment.Status.SUPERSEDED)
        .first()
    )
    if existing and existing.status not in (Enrollment.Status.REVOKED, Enrollment.Status.EXPIRED):
        raise ServiceError(
            "already_enrolled", "This student is already enrolled on that course in this workspace."
        )
    if existing:
        existing.status = Enrollment.Status.ACTIVE
        existing.access_expires_at = None
        existing.completed_at = None
        existing.completed_version = None
        existing.save(
            update_fields=["status", "access_expires_at", "completed_at", "completed_version", "updated_at"]
        )
        enrolment = existing
    else:
        enrolment = learning.enrol(
            user=user,
            course=course,
            source=Enrollment.Source.ORGANIZATION if org else Enrollment.Source.ADMIN_GRANT,
            org_id=org.id if org else None,
        )
    audit_request(
        request,
        "enrolment.create",
        "enrollment",
        str(enrolment.id),
        {"user_id": str(user.id), "course_id": str(course.id), "company_id": str(org.id) if org else None},
    )
    return {"id": enrolment.id}


@router.patch("/enrolments/{enrolment_id}", response=ConsoleOkOut)
@transaction.atomic
def update_enrolment(request, enrolment_id: UUID, body: ConsoleEnrolmentPatchIn):
    staff(request)
    enrolment = get_object_or_404(Enrollment.objects.select_related("course"), pk=enrolment_id)
    progress = Decimal(str(body.progress_pct)).quantize(Decimal("0.01"))
    enrolment.status = body.status
    enrolment.progress_pct = Decimal("100.00") if body.status == Enrollment.Status.COMPLETED else progress
    if body.status == Enrollment.Status.COMPLETED:
        enrolment.completed_at = enrolment.completed_at or timezone.now()
        enrolment.completed_version_id = enrolment.completed_version_id or enrolment.course.live_version_id
    elif body.status == Enrollment.Status.ACTIVE:
        enrolment.completed_at = None
        enrolment.completed_version = None
    enrolment.save(
        update_fields=["status", "progress_pct", "completed_at", "completed_version", "updated_at"]
    )
    audit_request(
        request,
        "enrolment.update",
        "enrollment",
        str(enrolment.id),
        {"status": body.status, "progress_pct": float(enrolment.progress_pct)},
    )
    return {"ok": True}
