"""Operational B2B employee departures.

A corporate package belongs to the company, not permanently to the individual who
was first named on it.  Recording a departure is therefore one atomic operation:
the membership is closed, recorded-course seats are released for reassignment and
the person is removed from upcoming live training.  Learning history is retained,
but company-paid access is revoked so the company never pays for the same seat twice.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import DeparturePolicy, LiveAttendee, SeatAllocation

log = logging.getLogger(__name__)


def get_or_default_policy(org_id) -> str:
    policy = DeparturePolicy.objects.filter(org_id=org_id).first()
    if policy:
        return policy.action
    return DeparturePolicy.Action.ADMIN_DECIDES


def set_policy(request, org_id, action: str, notes: str = "") -> DeparturePolicy:
    if action not in DeparturePolicy.Action.values:
        raise ServiceError("invalid_action", f"Unknown departure action: {action}", status=400)

    policy, created = DeparturePolicy.objects.update_or_create(
        org_id=org_id,
        defaults={
            "action": action,
            "set_by": request.user,
            "notes": notes,
        },
    )
    audit_request(
        request,
        "departure_policy_set",
        "departure_policy",
        policy.id,
        data={"action": action, "org_id": str(org_id)},
    )
    return policy


@transaction.atomic
def apply_departure(request, org_id, user_id) -> dict:
    from apps.org.models import OrgMember

    member = OrgMember.objects.filter(org_id=org_id, user_id=user_id).order_by("-joined_at").first()
    if member is None:
        raise ServiceError("not_a_member", "This person never belonged to this company.", status=404)
    if member.removed_at is None:
        member.removed_at = timezone.now()
        member.save(update_fields=["removed_at", "updated_at"])

    allocations = list(
        SeatAllocation.objects.filter(org_id=org_id, user_id=user_id, status__in=["allocated", "active"])
        .select_related("seat_purchase__offering__course", "enrollment")
        .order_by("allocated_at")
    )
    courses = [
        {
            "course_title": a.seat_purchase.offering.course.title,
            "enrollment_status": a.enrollment.status if a.enrollment else "pending",
            "access_expires_at": a.enrollment.access_expires_at if a.enrollment else None,
        }
        for a in allocations
    ]
    # Reuse the single release path so enrolment revocation, the allocation ledger
    # and the audit trail cannot drift apart from a normal seat reassignment.
    from .services import release_seat

    for allocation in allocations:
        release_seat(request, allocation.id, reason="Employee left the company")

    removed_live = LiveAttendee.objects.filter(
        org_id=org_id,
        user_id=user_id,
        status=LiveAttendee.Status.ACTIVE,
    ).update(status=LiveAttendee.Status.REMOVED, removed_at=timezone.now(), updated_at=timezone.now())

    audit_request(
        request, "departure_recorded", "org_member", member.id,
        data={"org_id": str(org_id), "user_id": str(user_id), "left_at": member.removed_at,
              "released_seats": len(allocations), "removed_live_attendees": removed_live},
    )  # fmt: skip
    log.info("departure recorded for member %s: %s seats released", member.id, len(allocations))
    return {
        "action": "release_and_replace",
        "left_at": member.removed_at,
        "revoked": len(allocations),
        "preserved": 0,
        "removed_live_attendees": removed_live,
        "courses": courses,
    }
