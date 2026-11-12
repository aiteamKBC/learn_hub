"""B2B-07: Employee departure: recorded, never an early end to paid access.

Business rule (2026-11-11): access a company has already paid for runs until it
expires on its own (Enrollment.access_expires_at, the same mechanism subscriptions
use; NULL = no end date). Leaving the company does not cut it short, does not free
the seat for someone else, and does not refund or move the credit. What stops is
renewal: automatic renewals (compliance.open_renewals) already skip members with
removed_at set, and the company simply gives no new seats.

So apply_departure only records that the person left and reports when each paid
course ends. The stored policy (revoke_all / preserve_completed / admin_decides) is
kept for reference but no longer revokes anything. Progress, results and
certificates are always kept.
"""

from __future__ import annotations

import logging

from django.db import transaction

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import DeparturePolicy, SeatAllocation

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
        raise ServiceError(
            "still_member",
            "Remove this person from the company first, then record the departure.",
            status=400,
        )

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
    policy_action = get_or_default_policy(org_id)
    audit_request(
        request, "departure_recorded", "org_member", member.id,
        data={"org_id": str(org_id), "user_id": str(user_id), "left_at": member.removed_at,
              "paid_courses_kept": len(courses)},
    )  # fmt: skip
    log.info("departure recorded for member %s: %s paid courses kept", member.id, len(courses))
    return {
        "action": policy_action,
        "left_at": member.removed_at,
        "revoked": 0,
        "preserved": len(courses),
        "courses": courses,
    }
