"""Admin configuration and existing-learner eligibility for B2C fixed instalments."""

from datetime import date
from uuid import UUID

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog.models import Lecture
from apps.commerce import instalments
from apps.commerce.models import CourseInstalmentEligibility, CourseInstalmentPlan
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.platform.console.common import ConsoleOkOut, router, staff
from core.errors import ServiceError

from ..services import audit_request
from .courses import _course


class ConsoleB2CStageIn(Schema):
    title: str = Field(..., min_length=1, max_length=120)
    release_month: int = Field(..., ge=1, le=120)
    lecture_keys: list[UUID] = Field(..., min_length=1, max_length=1000)
    instalment_numbers: list[int] = Field(..., min_length=1, max_length=120)


class ConsoleB2CCoursePlanIn(Schema):
    enabled: bool
    currency: str = Field(..., min_length=3, max_length=3)
    total_minor: int = Field(..., gt=0)
    instalment_count: int = Field(..., ge=1, le=120)
    schedule_start: date
    early_release: str
    retry_count: int | None = Field(None, ge=0, le=30)
    retry_interval_days: int | None = Field(None, ge=1, le=365)
    stages: list[ConsoleB2CStageIn] = Field(..., min_length=1, max_length=120)


class ConsoleB2CLearnerEligibilityIn(Schema):
    enabled: bool
    schedule_start: date | None = None


class ConsoleB2CStageOut(Schema):
    id: UUID
    title: str
    position: int
    release_month: int
    lecture_keys: list[str]
    instalment_numbers: list[int]


class ConsoleB2CCoursePlanOut(Schema):
    enabled: bool
    currency: str | None = None
    total_minor: int | None = None
    instalment_count: int | None = None
    schedule_start: date | None = None
    early_release: str | None = None
    retry_count: int | None = None
    retry_interval_days: int | None = None
    stages: list[ConsoleB2CStageOut]


class ConsoleB2CLectureOut(Schema):
    lecture_key: UUID
    title: str
    section: str
    kind: str
    position: int


class ConsoleB2CLearnerOut(Schema):
    user_id: UUID
    full_name: str
    email: str
    eligible: bool
    schedule_start: date | None


@router.get("/courses/{uuid:course_id}/instalments", response=ConsoleB2CCoursePlanOut)
def course_instalments(request, course_id: UUID):
    staff(request)
    plan = CourseInstalmentPlan.objects.filter(course_id=course_id, is_current=True).first()
    return instalments.plan_payload(plan) if plan else {"enabled": False, "stages": []}


@router.get("/courses/{uuid:course_id}/instalments/content", response=list[ConsoleB2CLectureOut])
def course_instalment_content(request, course_id: UUID):
    staff(request)
    course = _course(course_id)
    if not course.live_version_id:
        return []
    rows = (
        Lecture.objects.filter(version_id=course.live_version_id)
        .select_related("section")
        .order_by("section__position", "position")
    )
    return [
        {
            "lecture_key": row.lecture_key,
            "title": row.title,
            "section": row.section.title,
            "kind": row.kind,
            "position": row.position,
        }
        for row in rows
    ]


@router.get("/courses/{uuid:course_id}/instalments/learners", response=list[ConsoleB2CLearnerOut])
def course_instalment_learners(request, course_id: UUID, q: str = ""):
    staff(request)
    course = _course(course_id)
    eligible = {row.user_id: row for row in CourseInstalmentEligibility.objects.filter(course=course)}
    if q.strip():
        users = (
            User.objects.filter(is_staff=False)
            .filter(Q(email__icontains=q.strip()[:120]) | Q(full_name__icontains=q.strip()[:120]))
            .order_by("email")[:100]
        )
    else:
        user_ids = (
            Enrollment.objects.filter(course=course, org__isnull=True)
            .exclude(status__in=[Enrollment.Status.REVOKED, Enrollment.Status.SUPERSEDED])
            .values_list("user_id", flat=True)
            .distinct()[:500]
        )
        users = User.objects.filter(pk__in=user_ids).order_by("email")
    return [
        {
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "eligible": eligible.get(user.id).enabled if user.id in eligible else False,
            "schedule_start": eligible.get(user.id).schedule_start if user.id in eligible else None,
        }
        for user in users
    ]


@router.put("/courses/{uuid:course_id}/instalments", response=ConsoleB2CCoursePlanOut)
def save_course_instalments(request, course_id: UUID, body: ConsoleB2CCoursePlanIn):
    staff(request)
    course = _course(course_id)
    plan = instalments.configure_plan(
        course=course,
        currency=body.currency.upper(),
        total_minor=body.total_minor,
        count=body.instalment_count,
        schedule_start=body.schedule_start,
        early_release=body.early_release,
        retry_count=body.retry_count,
        retry_interval_days=body.retry_interval_days,
        stages=[stage.dict() for stage in body.stages],
        enabled=body.enabled,
    )
    audit_request(
        request,
        "course.instalments.configure",
        "course",
        course.id,
        {"plan": str(plan.id), "enabled": body.enabled, "count": body.instalment_count},
    )
    return instalments.plan_payload(plan)


@router.put("/courses/{uuid:course_id}/instalments/learners/{uuid:user_id}", response=ConsoleOkOut)
def set_learner_eligibility(request, course_id: UUID, user_id: UUID, body: ConsoleB2CLearnerEligibilityIn):
    staff(request)
    course = _course(course_id)
    learner = get_object_or_404(User, pk=user_id, is_staff=False)
    plan = CourseInstalmentPlan.objects.filter(course=course, is_current=True, enabled=True).first()
    if body.enabled and plan and plan.schedule_start < timezone.localdate() and body.schedule_start is None:
        raise ServiceError(
            "schedule_start_required", "Set a learner-specific start date for this late entrant."
        )
    row, _ = CourseInstalmentEligibility.objects.update_or_create(
        user=learner,
        course=course,
        org=None,
        defaults={"enabled": body.enabled, "schedule_start": body.schedule_start},
    )
    audit_request(
        request,
        "course.instalments.learner",
        "user",
        learner.id,
        {"course": str(course.id), "enabled": row.enabled, "schedule_start": str(row.schedule_start or "")},
    )
    return {"ok": True}
