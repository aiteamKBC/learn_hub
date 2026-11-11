"""Console > Corporate Live Training: request pool, cohorts, sessions, tutors."""

from datetime import datetime
from uuid import UUID

from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.corporate.models import (
    CohortCompany,
    LiveCohort,
    Session,
    TrainingRequest,
    Tutor,
    TutorAssignment,
)
from apps.corporate import live as live_svc
from apps.corporate import scheduling as sched_svc

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, clamp, router, staff


# ---- Schemas ----

class ConsoleTrainingRequestOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    course_id: UUID
    course_title: str
    requester_email: str
    requested_seats: int
    preferred_intake: str
    preferred_delivery_mode: str
    status: str
    admin_notes: str
    status_label: str
    created_at: datetime


class ConsoleRequestPatch(Schema):
    status: str | None = None
    admin_notes: str | None = None
    status_label: str | None = None


class ConsoleCohortIn(Schema):
    course_id: UUID
    delivery_mode: str = Field(..., pattern=r"^(online|in_person|hybrid)$")
    max_learners: int = Field(..., ge=1)
    min_learners: int = Field(1, ge=1)
    intake: str = ""
    title: str = ""
    notes: str = ""


class ConsoleCohortOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    title: str
    intake: str
    status: str
    delivery_mode: str
    min_learners: int
    max_learners: int
    current_seats: int
    scheduled_start: str | None = None
    scheduled_end: str | None = None
    notes: str
    created_at: datetime


class ConsoleCohortPatch(Schema):
    title: str | None = None
    intake: str | None = None
    delivery_mode: str | None = None
    min_learners: int | None = None
    max_learners: int | None = None
    scheduled_start: str | None = None
    scheduled_end: str | None = None
    notes: str | None = None
    status: str | None = None


class ConsoleAddCompanyIn(Schema):
    org_id: UUID
    seats: int = Field(..., ge=1)
    training_request_id: UUID | None = None


class ConsoleCohortCompanyOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    cohort_id: UUID
    approved_seats: int
    status: str
    payment_deadline: datetime | None = None


class ConsoleSessionIn(Schema):
    sequence: int = Field(..., ge=1)
    scheduled_at: datetime
    duration_min: int = Field(..., ge=1)
    delivery_mode: str | None = None
    title: str = ""
    location: str = ""


class ConsoleSessionOut(Schema):
    id: UUID
    cohort_id: UUID
    sequence: int
    title: str
    scheduled_at: datetime
    duration_min: int
    delivery_mode: str
    location: str
    status: str
    actual_start: datetime | None = None
    actual_end: datetime | None = None


class ConsoleSessionPatch(Schema):
    title: str | None = None
    scheduled_at: datetime | None = None
    duration_min: int | None = None
    delivery_mode: str | None = None
    location: str | None = None
    status: str | None = None
    reschedule_note: str | None = None


class ConsoleTutorIn(Schema):
    user_id: UUID
    type: str = Field(..., pattern=r"^(internal|external)$")
    bio: str = ""
    specializations: list[str] = []


class ConsoleTutorOut(Schema):
    id: UUID
    user_id: UUID
    user_email: str
    user_name: str
    type: str
    status: str
    bio: str
    specializations: list
    approved_at: datetime | None = None
    created_at: datetime


class ConsoleAssignTutorIn(Schema):
    cohort_id: UUID


# ---- Training Requests ----

@router.get("/corporate/requests", response=list[ConsoleTrainingRequestOut])
def list_requests(request, org_id: UUID | None = None, status: str | None = None,
                  course_id: UUID | None = None, limit: int = 50, offset: int = 0):
    staff(request)
    qs = TrainingRequest.objects.select_related("org", "course", "requester").order_by("-created_at")
    if org_id:
        qs = qs.filter(org_id=org_id)
    if status:
        qs = qs.filter(status=status)
    if course_id:
        qs = qs.filter(course_id=course_id)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": r.id, "org_id": r.org_id, "org_name": r.org.name,
            "course_id": r.course_id, "course_title": r.course.title,
            "requester_email": r.requester.email,
            "requested_seats": r.requested_seats,
            "preferred_intake": r.preferred_intake,
            "preferred_delivery_mode": r.preferred_delivery_mode,
            "status": r.status, "admin_notes": r.admin_notes,
            "status_label": r.status_label, "created_at": r.created_at,
        }
        for r in items
    ]


@router.patch("/corporate/requests/{request_id}", response=ConsoleOkOut)
def update_request(request, request_id: UUID, body: ConsoleRequestPatch):
    staff(request)
    tr = get_object_or_404(TrainingRequest, pk=request_id)
    fields = []
    if body.status is not None:
        tr.status = body.status
        fields.append("status")
    if body.admin_notes is not None:
        tr.admin_notes = body.admin_notes
        fields.append("admin_notes")
    if body.status_label is not None:
        tr.status_label = body.status_label
        fields.append("status_label")
    if fields:
        fields.append("updated_at")
        tr.save(update_fields=fields)
    audit_request(request, "request_updated", "training_request", tr.id, body.dict(exclude_none=True))
    return {"ok": True}


# ---- Cohorts ----

@router.get("/corporate/cohorts", response=list[ConsoleCohortOut])
def list_cohorts(request, status: str | None = None, course_id: UUID | None = None,
                 limit: int = 50, offset: int = 0):
    staff(request)
    qs = LiveCohort.objects.select_related("course").order_by("-created_at")
    if status:
        qs = qs.filter(status=status)
    if course_id:
        qs = qs.filter(course_id=course_id)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": c.id, "course_id": c.course_id, "course_title": c.course.title,
            "title": c.title, "intake": c.intake, "status": c.status,
            "delivery_mode": c.delivery_mode, "min_learners": c.min_learners,
            "max_learners": c.max_learners, "current_seats": c.current_seats,
            "scheduled_start": str(c.scheduled_start) if c.scheduled_start else None,
            "scheduled_end": str(c.scheduled_end) if c.scheduled_end else None,
            "notes": c.notes, "created_at": c.created_at,
        }
        for c in items
    ]


@router.post("/corporate/cohorts", response=ConsoleIdOut)
def create_cohort(request, body: ConsoleCohortIn):
    staff(request)
    cohort = live_svc.create_cohort(
        request, course_id=body.course_id, delivery_mode=body.delivery_mode,
        max_learners=body.max_learners, min_learners=body.min_learners,
        intake=body.intake, title=body.title, notes=body.notes,
    )
    return {"id": cohort.id}


@router.patch("/corporate/cohorts/{cohort_id}", response=ConsoleOkOut)
def update_cohort(request, cohort_id: UUID, body: ConsoleCohortPatch):
    staff(request)
    cohort = get_object_or_404(LiveCohort, pk=cohort_id)
    fields = []
    for k in ("title", "intake", "delivery_mode", "min_learners", "max_learners",
              "scheduled_start", "scheduled_end", "notes", "status"):
        v = getattr(body, k, None)
        if v is not None:
            setattr(cohort, k, v)
            fields.append(k)
    if fields:
        fields.append("updated_at")
        cohort.save(update_fields=fields)
    audit_request(request, "cohort_updated", "live_cohort", cohort.id, body.dict(exclude_none=True))
    return {"ok": True}


@router.post("/corporate/cohorts/{cohort_id}/confirm", response=ConsoleOkOut)
def confirm_cohort(request, cohort_id: UUID):
    staff(request)
    live_svc.confirm_cohort(request, cohort_id)
    return {"ok": True}


@router.post("/corporate/cohorts/{cohort_id}/companies", response=ConsoleIdOut)
def add_company(request, cohort_id: UUID, body: ConsoleAddCompanyIn):
    staff(request)
    cc = live_svc.add_company_to_cohort(
        request, cohort_id, body.org_id, body.seats, body.training_request_id,
    )
    return {"id": cc.id}


@router.delete("/corporate/cohorts/{cohort_id}/companies/{org_id}", response=ConsoleOkOut)
def remove_company(request, cohort_id: UUID, org_id: UUID):
    staff(request)
    live_svc.remove_company_from_cohort(request, cohort_id, org_id)
    return {"ok": True}


@router.get("/corporate/cohorts/{cohort_id}/companies", response=list[ConsoleCohortCompanyOut])
def list_cohort_companies(request, cohort_id: UUID):
    staff(request)
    qs = CohortCompany.objects.filter(cohort_id=cohort_id).select_related("org")
    return [
        {
            "id": cc.id, "org_id": cc.org_id, "org_name": cc.org.name,
            "cohort_id": cc.cohort_id, "approved_seats": cc.approved_seats,
            "status": cc.status, "payment_deadline": cc.payment_deadline,
        }
        for cc in qs
    ]


# ---- Sessions ----

@router.get("/corporate/cohorts/{cohort_id}/sessions", response=list[ConsoleSessionOut])
def list_sessions(request, cohort_id: UUID):
    staff(request)
    qs = Session.objects.filter(cohort_id=cohort_id).order_by("sequence")
    return [
        {
            "id": s.id, "cohort_id": s.cohort_id, "sequence": s.sequence,
            "title": s.title, "scheduled_at": s.scheduled_at,
            "duration_min": s.duration_min, "delivery_mode": s.delivery_mode,
            "location": s.location, "status": s.status,
            "actual_start": s.actual_start, "actual_end": s.actual_end,
        }
        for s in qs
    ]


@router.post("/corporate/cohorts/{cohort_id}/sessions", response=ConsoleIdOut)
def add_session(request, cohort_id: UUID, body: ConsoleSessionIn):
    staff(request)
    session = sched_svc.add_session(
        request, cohort_id, sequence=body.sequence, scheduled_at=body.scheduled_at,
        duration_min=body.duration_min, delivery_mode=body.delivery_mode,
        title=body.title, location=body.location,
    )
    return {"id": session.id}


@router.patch("/corporate/sessions/{session_id}", response=ConsoleOkOut)
def update_session(request, session_id: UUID, body: ConsoleSessionPatch):
    staff(request)
    sched_svc.update_session(request, session_id, **body.dict(exclude_none=True))
    return {"ok": True}


@router.delete("/corporate/sessions/{session_id}", response=ConsoleOkOut)
def cancel_session(request, session_id: UUID):
    staff(request)
    sched_svc.cancel_session(request, session_id)
    return {"ok": True}


# ---- Tutors ----

@router.get("/corporate/tutors", response=list[ConsoleTutorOut])
def list_tutors(request, status: str | None = None, limit: int = 50, offset: int = 0):
    staff(request)
    qs = Tutor.objects.select_related("user").order_by("-created_at")
    if status:
        qs = qs.filter(status=status)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": t.id, "user_id": t.user_id,
            "user_email": t.user.email,
            "user_name": getattr(t.user, "full_name", t.user.email),
            "type": t.type, "status": t.status, "bio": t.bio,
            "specializations": t.specializations,
            "approved_at": t.approved_at, "created_at": t.created_at,
        }
        for t in items
    ]


@router.post("/corporate/tutors", response=ConsoleIdOut)
def create_tutor(request, body: ConsoleTutorIn):
    staff(request)
    tutor = sched_svc.register_tutor(
        request, body.user_id, body.type, bio=body.bio, specializations=body.specializations,
    )
    return {"id": tutor.id}


@router.patch("/corporate/tutors/{tutor_id}/approve", response=ConsoleOkOut)
def approve_tutor(request, tutor_id: UUID):
    staff(request)
    sched_svc.approve_tutor(request, tutor_id)
    return {"ok": True}


@router.patch("/corporate/tutors/{tutor_id}/suspend", response=ConsoleOkOut)
def suspend_tutor(request, tutor_id: UUID):
    staff(request)
    sched_svc.suspend_tutor(request, tutor_id)
    return {"ok": True}


@router.post("/corporate/tutors/{tutor_id}/assign", response=ConsoleIdOut)
def assign_tutor(request, tutor_id: UUID, body: ConsoleAssignTutorIn):
    staff(request)
    assignment = sched_svc.assign_tutor(request, tutor_id, body.cohort_id)
    return {"id": assignment.id}
