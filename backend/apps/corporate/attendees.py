"""Who attends a live cohort, and what each person may see of its schedule.

Rules (permissions matrix + state machines, section 5):
  * after paying, the company admin names employees, up to the paid places;
  * an employee sees the FIRST session only until it has ended, then the full schedule;
  * the join link appears from JOIN_OPENS_BEFORE before a session until it ends, and
    only to a named attendee (never to employers, managers or other companies).
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.org.models import OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CohortCompany, LiveAttendee, LiveCohort, Session

JOIN_OPENS_BEFORE = timedelta(minutes=15)
NAMEABLE = (CohortCompany.Status.PAID, CohortCompany.Status.ACTIVE)
CHANGEABLE_COHORT = (LiveCohort.Status.CONFIRMED, LiveCohort.Status.PENDING_PAY)


def session_ended(s: Session, now=None) -> bool:
    now = now or timezone.now()
    if s.status == Session.Status.COMPLETED:
        return True
    if s.actual_end and s.actual_end <= now:
        return True
    return s.scheduled_at + timedelta(minutes=s.duration_min) <= now


def visible_sessions(sessions: list[Session], *, full: bool, now=None) -> list[Session]:
    """`sessions` ordered by sequence, cancelled ones already removed."""
    if not sessions or full:
        return sessions
    return sessions if session_ended(sessions[0], now) else sessions[:1]


def join_url(s: Session, now=None) -> str | None:
    now = now or timezone.now()
    if not s.zoom_join_url or s.status == Session.Status.CANCELLED:
        return None
    end = s.scheduled_at + timedelta(minutes=s.duration_min)
    if s.scheduled_at - JOIN_OPENS_BEFORE <= now < end:
        return s.zoom_join_url
    return None


@transaction.atomic
def add_attendee(request, *, org_id, cohort_company_id, user_id) -> LiveAttendee:
    cc = (
        CohortCompany.objects.select_for_update()  # no join: it would lock and RLS-filter the joined table
        .filter(pk=cohort_company_id, org_id=org_id)
        .first()
    )
    if cc is None:
        raise ServiceError("not_found", "Booking not found.", status=404)
    if cc.status not in NAMEABLE:
        raise ServiceError("not_paid", "You can name attendees once the booking is paid.", status=400)
    if cc.cohort.status not in (*CHANGEABLE_COHORT, LiveCohort.Status.FORMING):
        raise ServiceError(
            "cohort_started", "This training has started or ended. Ask us to make changes.", status=400
        )
    if not OrgMember.objects.filter(org_id=org_id, user_id=user_id, removed_at__isnull=True).exists():
        raise ServiceError("not_a_member", "This person is not an active member of your company.", status=400)
    active = LiveAttendee.objects.filter(cohort_company=cc, status=LiveAttendee.Status.ACTIVE)
    if active.filter(user_id=user_id).exists():
        raise ServiceError("already_attending", "This person is already attending.", status=409)
    if active.count() >= cc.approved_seats:
        raise ServiceError("no_places_left", "All paid places are taken.", status=409)
    if LiveAttendee.objects.filter(
        cohort=cc.cohort, user_id=user_id, status=LiveAttendee.Status.ACTIVE
    ).exists():
        raise ServiceError("already_attending", "This person is already attending.", status=409)

    attendee = LiveAttendee.objects.create(
        org_id=org_id, cohort_company=cc, cohort=cc.cohort, user_id=user_id, added_by=request.user
    )
    audit_request(
        request, "live_attendee_added", "live_attendee", attendee.id,
        data={"cohort_id": str(cc.cohort_id), "user_id": str(user_id)},
    )  # fmt: skip
    return attendee


@transaction.atomic
def remove_attendee(request, *, org_id, cohort_company_id, attendee_id) -> LiveAttendee:
    attendee = (
        LiveAttendee.objects.select_for_update()  # no join: it would lock and RLS-filter the joined table
        .filter(pk=attendee_id, cohort_company_id=cohort_company_id, org_id=org_id)
        .first()
    )
    if attendee is None or attendee.status != LiveAttendee.Status.ACTIVE:
        raise ServiceError("not_found", "Attendee not found.", status=404)
    if attendee.cohort.status not in (*CHANGEABLE_COHORT, LiveCohort.Status.FORMING):
        raise ServiceError(
            "cohort_started", "This training has started or ended. Ask us to make changes.", status=400
        )
    attendee.status = LiveAttendee.Status.REMOVED
    attendee.removed_at = timezone.now()
    attendee.save(update_fields=["status", "removed_at", "updated_at"])
    audit_request(
        request, "live_attendee_removed", "live_attendee", attendee.id,
        data={"cohort_id": str(attendee.cohort_id), "user_id": str(attendee.user_id)},
    )  # fmt: skip
    return attendee


def my_live_training(user_id, now=None) -> list[dict]:
    """The signed-in employee's live cohorts, with only the sessions they may see."""
    now = now or timezone.now()
    rows = list(
        LiveAttendee.objects.filter(user_id=user_id, status=LiveAttendee.Status.ACTIVE)
        .exclude(cohort__status=LiveCohort.Status.CANCELLED)
        .select_related("cohort__course", "org")
        .order_by("-created_at")[:50]
    )
    by_cohort: dict = {}
    for s in (
        Session.objects.filter(cohort_id__in=[r.cohort_id for r in rows])
        .exclude(status=Session.Status.CANCELLED)
        .order_by("cohort_id", "sequence")
    ):
        by_cohort.setdefault(s.cohort_id, []).append(s)

    from .programme import live_programme

    out = []
    for r in rows:
        sessions = by_cohort.get(r.cohort_id, [])
        visible = visible_sessions(sessions, full=False, now=now)
        first = min((s.scheduled_at for s in sessions), default=None)
        prog = live_programme(user_id, r, first)
        ended = prog["programme_status"] == "ended"
        out.append({
            **prog,
            "cohort_id": r.cohort_id,
            "course_title": r.cohort.course.title,
            "course_slug": r.cohort.course.slug,
            "company_name": r.org.name,
            "delivery_mode": r.cohort.delivery_mode,
            "cohort_status": r.cohort.status,
            "sessions": [
                {
                    "sequence": s.sequence,
                    "title": s.title or f"Session {s.sequence}",
                    "scheduled_at": s.scheduled_at,
                    "duration_min": s.duration_min,
                    "delivery_mode": s.delivery_mode,
                    "location": s.location,
                    "status": s.status,
                    "join_url": None if ended else join_url(s, now),  # ended: no new sessions
                }
                for s in visible
            ],
            "more_sessions_hidden": len(visible) < len(sessions),
        })  # fmt: skip
    return out
