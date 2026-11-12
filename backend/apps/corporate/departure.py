"""B2B-07: Employer departure policy — applied when an employee is removed from an org.

Policy options:
  - revoke_all: revoke all active corporate enrollments
  - preserve_completed: keep completed enrollments/certificates, revoke active
  - admin_decides: do nothing automatically, flag for admin review

Certificates are NEVER deleted. Historical training evidence is preserved.
Company-paid training never transfers to personal ownership.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

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
    policy_action = get_or_default_policy(org_id)

    active_allocs = list(
        SeatAllocation.objects.select_for_update().filter(
            org_id=org_id, user_id=user_id, status__in=["allocated", "active"]
        )
    )

    if not active_allocs:
        return {"action": policy_action, "revoked": 0, "preserved": 0}

    revoked = 0
    preserved = 0

    for alloc in active_allocs:
        if policy_action == DeparturePolicy.Action.REVOKE_ALL:
            _revoke_allocation(alloc, request)
            revoked += 1

        elif policy_action == DeparturePolicy.Action.PRESERVE_COMPLETED:
            if alloc.enrollment_id:
                from apps.learning.models import Enrollment

                enrollment = Enrollment.objects.filter(pk=alloc.enrollment_id).first()
                if enrollment and enrollment.status == "completed":
                    preserved += 1
                    continue
            _revoke_allocation(alloc, request)
            revoked += 1

        else:
            preserved += 1

    audit_request(
        request,
        "departure_applied",
        "org_member",
        None,
        data={
            "org_id": str(org_id),
            "user_id": str(user_id),
            "policy": policy_action,
            "revoked": revoked,
            "preserved": preserved,
        },
    )

    return {"action": policy_action, "revoked": revoked, "preserved": preserved}


def _revoke_allocation(alloc: SeatAllocation, request) -> None:
    now = timezone.now()

    if alloc.enrollment_id:
        from apps.learning.models import Enrollment

        Enrollment.objects.filter(pk=alloc.enrollment_id).update(status="revoked")

    alloc.status = SeatAllocation.Status.REVOKED
    alloc.released_at = now
    alloc.released_by = request.user if hasattr(request, "user") else None
    alloc.release_reason = "Employee departure policy"
    alloc.save(update_fields=["status", "released_at", "released_by", "release_reason", "updated_at"])

    from .models import AllocationEvent

    AllocationEvent.objects.create(
        org_id=alloc.org_id,
        allocation=alloc,
        action=AllocationEvent.Action.REVOKED,
        actor=request.user if hasattr(request, "user") else alloc.released_by,
        target_user_id=alloc.user_id,
        note="Employee departure policy",
    )
