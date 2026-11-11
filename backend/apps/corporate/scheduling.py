"""B2B-03: Session scheduling + tutor management services."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import LiveCohort, Session, Tutor, TutorAssignment


@transaction.atomic
def add_session(request, cohort_id, *, sequence, scheduled_at, duration_min,
                delivery_mode=None, title="", location="") -> Session:
    cohort = LiveCohort.objects.filter(pk=cohort_id).first()
    if cohort is None:
        raise ServiceError("cohort_not_found", "Cohort not found.", status=404)
    if cohort.status not in (LiveCohort.Status.FORMING, LiveCohort.Status.CONFIRMED):
        raise ServiceError("cohort_locked", "Cannot add sessions to this cohort.", status=400)

    if Session.objects.filter(cohort=cohort, sequence=sequence).exists():
        raise ServiceError("duplicate_sequence", f"Session #{sequence} already exists.", status=409)

    session = Session.objects.create(
        cohort=cohort,
        sequence=sequence,
        title=title,
        scheduled_at=scheduled_at,
        duration_min=duration_min,
        delivery_mode=delivery_mode or cohort.delivery_mode,
        location=location,
    )

    audit_request(
        request, "session_added", "session", session.id,
        data={"cohort_id": str(cohort_id), "sequence": sequence},
    )
    return session


def update_session(request, session_id, **fields) -> Session:
    session = Session.objects.filter(pk=session_id).first()
    if session is None:
        raise ServiceError("not_found", "Session not found.", status=404)

    allowed = {"title", "scheduled_at", "duration_min", "delivery_mode", "location",
               "status", "reschedule_note", "actual_start", "actual_end"}
    updates = []
    for k, v in fields.items():
        if k in allowed and v is not None:
            setattr(session, k, v)
            updates.append(k)
    if updates:
        updates.append("updated_at")
        session.save(update_fields=updates)

    audit_request(request, "session_updated", "session", session.id, data=fields)
    return session


def cancel_session(request, session_id) -> Session:
    session = Session.objects.filter(pk=session_id).first()
    if session is None:
        raise ServiceError("not_found", "Session not found.", status=404)
    if session.status == Session.Status.COMPLETED:
        raise ServiceError("already_completed", "Cannot cancel a completed session.", status=400)

    session.status = Session.Status.CANCELLED
    session.save(update_fields=["status", "updated_at"])

    audit_request(request, "session_cancelled", "session", session.id)
    return session


@transaction.atomic
def register_tutor(request, user_id, tutor_type, bio="", specializations=None) -> Tutor:
    if Tutor.objects.filter(user_id=user_id).exists():
        raise ServiceError("already_registered", "This user is already registered as a tutor.", status=409)

    tutor = Tutor.objects.create(
        user_id=user_id,
        type=tutor_type,
        bio=bio,
        specializations=specializations or [],
    )

    audit_request(
        request, "tutor_registered", "tutor", tutor.id,
        data={"user_id": str(user_id), "type": tutor_type},
    )
    return tutor


def approve_tutor(request, tutor_id) -> Tutor:
    tutor = Tutor.objects.filter(pk=tutor_id).first()
    if tutor is None:
        raise ServiceError("not_found", "Tutor not found.", status=404)
    if tutor.status != Tutor.Status.PENDING:
        raise ServiceError("not_pending", "Only pending tutors can be approved.", status=400)

    tutor.status = Tutor.Status.APPROVED
    tutor.approved_by = request.user
    tutor.approved_at = timezone.now()
    tutor.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

    audit_request(request, "tutor_approved", "tutor", tutor.id)
    return tutor


def suspend_tutor(request, tutor_id) -> Tutor:
    tutor = Tutor.objects.filter(pk=tutor_id).first()
    if tutor is None:
        raise ServiceError("not_found", "Tutor not found.", status=404)

    tutor.status = Tutor.Status.SUSPENDED
    tutor.save(update_fields=["status", "updated_at"])

    audit_request(request, "tutor_suspended", "tutor", tutor.id)
    return tutor


@transaction.atomic
def assign_tutor(request, tutor_id, cohort_id) -> TutorAssignment:
    tutor = Tutor.objects.filter(pk=tutor_id, status=Tutor.Status.APPROVED).first()
    if tutor is None:
        raise ServiceError("tutor_not_found", "Approved tutor not found.", status=404)

    cohort = LiveCohort.objects.filter(pk=cohort_id).first()
    if cohort is None:
        raise ServiceError("cohort_not_found", "Cohort not found.", status=404)

    if TutorAssignment.objects.filter(tutor=tutor, cohort=cohort).exists():
        raise ServiceError("already_assigned", "Tutor is already assigned to this cohort.", status=409)

    assignment = TutorAssignment.objects.create(
        tutor=tutor,
        cohort=cohort,
        assigned_by=request.user,
    )

    audit_request(
        request, "tutor_assigned", "tutor_assignment", assignment.id,
        data={"tutor_id": str(tutor_id), "cohort_id": str(cohort_id)},
    )
    return assignment
