"""B2B-05: Attendance identity matching and normalization.

Processes Zoom participant events → matches to enrolled learners → creates/updates
SessionAttendance records. Unresolved identities queued for admin review.
"""

from __future__ import annotations

import logging
from datetime import datetime

from django.utils import timezone

from apps.identity.models import User

from .models import (
    CohortCompany,
    Session,
    SessionAttendance,
    ZoomEvent,
)

log = logging.getLogger(__name__)


def process_participant_event(zoom_event: ZoomEvent, data: dict) -> None:
    payload_obj = data.get("payload", {}).get("object", {})
    participant = payload_obj.get("participant", {})
    meeting_id = str(payload_obj.get("id", ""))
    event_type = data.get("event", "")

    email = (participant.get("email") or "").strip().lower()
    display_name = participant.get("user_name") or participant.get("display_name") or ""
    join_time = participant.get("join_time")
    leave_time = participant.get("leave_time")

    session = Session.objects.filter(zoom_meeting_id=meeting_id).first()
    if session is None:
        log.info("No session linked to Zoom meeting %s", meeting_id)
        return

    companies = list(
        CohortCompany.objects.filter(cohort=session.cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .values_list("org_id", flat=True)
    )

    user = None
    org_id = None
    match_status = SessionAttendance.MatchStatus.UNRESOLVED

    if email:
        user = User.objects.filter(email__iexact=email).first()
        if user:
            # Membership alone is not attendance eligibility.  A company can buy
            # more places than it names, so an employee must be an active attendee
            # on this cohort before an automatic Zoom match can be trusted.
            from .models import LiveAttendee

            named_attendee = LiveAttendee.objects.filter(
                cohort=session.cohort, user=user, status=LiveAttendee.Status.ACTIVE
            ).first()
            if named_attendee is None:
                match_status = SessionAttendance.MatchStatus.UNRESOLVED
            else:
                org_id = named_attendee.org_id
                match_status = SessionAttendance.MatchStatus.VERIFIED
        if user and org_id is None:
            from apps.org.models import OrgMember

            membership = OrgMember.objects.filter(
                user=user, org_id__in=companies, removed_at__isnull=True
            ).first()
            if membership:
                org_id = membership.org_id
            else:
                match_status = SessionAttendance.MatchStatus.UNRESOLVED

    if user is None:
        log.info("Cannot match Zoom participant %s (%s) to a user", display_name, email)
        return

    if org_id is None:
        from apps.org.models import OrgMember

        any_membership = OrgMember.objects.filter(user=user, removed_at__isnull=True).first()
        org_id = any_membership.org_id if any_membership else companies[0] if companies else None

    if org_id is None:
        return

    now = timezone.now()
    join_dt = _parse_dt(join_time) or now
    leave_dt = _parse_dt(leave_time)

    if event_type == "meeting.participant_joined":
        existing = SessionAttendance.objects.filter(
            session=session,
            user=user,
            leave_at__isnull=True,
        ).first()
        if existing:
            return

        SessionAttendance.objects.create(
            session=session,
            user=user,
            org_id=org_id,
            source=SessionAttendance.Source.ZOOM_WEBHOOK,
            match_status=match_status,
            join_at=join_dt,
            zoom_event=zoom_event,
            zoom_participant_email=email,
            zoom_display_name=display_name,
        )

    elif event_type == "meeting.participant_left":
        att = (
            SessionAttendance.objects.filter(
                session=session,
                user=user,
                leave_at__isnull=True,
            )
            .order_by("-join_at")
            .first()
        )
        if att:
            att.leave_at = leave_dt or now
            att.duration_seconds = max(0, int((att.leave_at - att.join_at).total_seconds()))
            att.save(update_fields=["leave_at", "duration_seconds", "updated_at"])
        else:
            SessionAttendance.objects.create(
                session=session,
                user=user,
                org_id=org_id,
                source=SessionAttendance.Source.ZOOM_WEBHOOK,
                match_status=match_status,
                join_at=join_dt,
                leave_at=leave_dt or now,
                duration_seconds=int(((leave_dt or now) - join_dt).total_seconds()) if leave_dt else 0,
                zoom_event=zoom_event,
                zoom_participant_email=email,
                zoom_display_name=display_name,
            )


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def verify_attendance(request, attendance_id) -> SessionAttendance:
    att = SessionAttendance.objects.filter(pk=attendance_id).first()
    if att is None:
        from core.errors import ServiceError

        raise ServiceError("not_found", "Attendance record not found.", status=404)

    att.is_verified = True
    att.verified_by = request.user
    att.match_status = SessionAttendance.MatchStatus.VERIFIED
    att.save(update_fields=["is_verified", "verified_by", "match_status", "updated_at"])
    return att


def reject_attendance(request, attendance_id) -> SessionAttendance:
    att = SessionAttendance.objects.filter(pk=attendance_id).first()
    if att is None:
        from core.errors import ServiceError

        raise ServiceError("not_found", "Attendance record not found.", status=404)

    att.match_status = SessionAttendance.MatchStatus.REJECTED
    att.save(update_fields=["match_status", "updated_at"])
    return att
