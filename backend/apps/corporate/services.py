from __future__ import annotations

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.org.models import OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import (
    AllocationEvent,
    SeatAllocation,
    SeatPurchase,
)

ACTIVE_ALLOC = Q(status__in=[SeatAllocation.Status.ALLOCATED, SeatAllocation.Status.ACTIVE])


@transaction.atomic
def allocate_seat(request, seat_purchase_id, user_id) -> SeatAllocation:
    sp = (
        SeatPurchase.objects
        .select_for_update()
        .select_related("offering")
        .filter(pk=seat_purchase_id)
        .first()
    )
    if sp is None:
        raise ServiceError("purchase_not_found", "Seat purchase not found.", status=404)
    if sp.status != SeatPurchase.Status.PAID:
        raise ServiceError("purchase_not_paid", "Cannot allocate from an unpaid purchase.", status=400)

    used = sp.allocations.filter(ACTIVE_ALLOC).count()
    if used >= sp.quantity:
        raise ServiceError("no_seats_available", "All seats in this purchase are allocated.", status=409)

    member = (
        OrgMember.objects
        .filter(org_id=sp.org_id, user_id=user_id, removed_at__isnull=True)
        .first()
    )
    if member is None:
        raise ServiceError("not_a_member", "User is not an active member of this company.", status=400)

    existing = sp.allocations.filter(user_id=user_id).filter(ACTIVE_ALLOC).first()
    if existing is not None:
        raise ServiceError("already_allocated", "This user already has an active seat from this purchase.", status=409)

    allocation = SeatAllocation.objects.create(
        org_id=sp.org_id,
        seat_purchase=sp,
        user_id=user_id,
        status=SeatAllocation.Status.ALLOCATED,
    )

    from apps.catalog.models import Course
    from apps.learning.services import enrol

    course = Course.objects.get(pk=sp.offering.course_id)
    enrollment = enrol(
        user=member.user,
        course=course,
        source="organization",
        org_id=sp.org_id,
        source_ref=allocation.id,
    )

    now = timezone.now()
    allocation.status = SeatAllocation.Status.ACTIVE
    allocation.activated_at = now
    allocation.enrollment = enrollment
    allocation.save(update_fields=["status", "activated_at", "enrollment", "updated_at"])

    AllocationEvent.objects.create(
        org_id=sp.org_id,
        allocation=allocation,
        action=AllocationEvent.Action.ALLOCATED,
        actor=request.auth,
        target_user_id=user_id,
        note=f"Seat allocated from purchase {sp.id}",
    )

    audit_request(
        request, "seat_allocated", "seat_allocation", allocation.id,
        data={"purchase_id": str(sp.id), "user_id": str(user_id), "course_id": str(sp.offering.course_id)},
    )

    return allocation


@transaction.atomic
def release_seat(request, allocation_id, reason="") -> SeatAllocation:
    alloc = (
        SeatAllocation.objects
        .select_for_update()
        .filter(pk=allocation_id)
        .first()
    )
    if alloc is None:
        raise ServiceError("allocation_not_found", "Seat allocation not found.", status=404)
    if alloc.status not in (SeatAllocation.Status.ALLOCATED, SeatAllocation.Status.ACTIVE):
        raise ServiceError("not_releasable", "Only allocated or active seats can be released.", status=400)

    now = timezone.now()

    if alloc.enrollment_id is not None:
        from apps.learning.models import Enrollment
        Enrollment.objects.filter(pk=alloc.enrollment_id).update(status="revoked")

    alloc.status = SeatAllocation.Status.REVOKED
    alloc.released_at = now
    alloc.released_by = request.auth
    alloc.release_reason = reason
    alloc.save(update_fields=["status", "released_at", "released_by", "release_reason", "updated_at"])

    AllocationEvent.objects.create(
        org_id=alloc.org_id,
        allocation=alloc,
        action=AllocationEvent.Action.REVOKED,
        actor=request.auth,
        target_user_id=alloc.user_id,
        note=reason,
    )

    audit_request(
        request, "seat_released", "seat_allocation", alloc.id,
        data={"user_id": str(alloc.user_id), "reason": reason},
    )

    return alloc


@transaction.atomic
def reassign_seat(request, allocation_id, new_user_id, reason="") -> SeatAllocation:
    old_alloc = (
        SeatAllocation.objects
        .select_for_update()
        .select_related("seat_purchase__offering")
        .filter(pk=allocation_id)
        .first()
    )
    if old_alloc is None:
        raise ServiceError("allocation_not_found", "Seat allocation not found.", status=404)
    if old_alloc.status not in (SeatAllocation.Status.ALLOCATED, SeatAllocation.Status.ACTIVE):
        raise ServiceError("not_reassignable", "Only allocated or active seats can be reassigned.", status=400)

    sp = SeatPurchase.objects.select_for_update().get(pk=old_alloc.seat_purchase_id)
    now = timezone.now()
    old_user_id = old_alloc.user_id

    if old_alloc.enrollment_id is not None:
        from apps.learning.models import Enrollment
        Enrollment.objects.filter(pk=old_alloc.enrollment_id).update(status="revoked")

    old_alloc.status = SeatAllocation.Status.RELEASED
    old_alloc.released_at = now
    old_alloc.released_by = request.auth
    old_alloc.release_reason = reason or f"Reassigned to user {new_user_id}"
    old_alloc.save(update_fields=["status", "released_at", "released_by", "release_reason", "updated_at"])

    member = (
        OrgMember.objects
        .filter(org_id=sp.org_id, user_id=new_user_id, removed_at__isnull=True)
        .first()
    )
    if member is None:
        raise ServiceError("not_a_member", "New user is not an active member of this company.", status=400)

    existing = sp.allocations.filter(user_id=new_user_id).filter(ACTIVE_ALLOC).first()
    if existing is not None:
        raise ServiceError("already_allocated", "New user already has an active seat from this purchase.", status=409)

    new_alloc = SeatAllocation.objects.create(
        org_id=sp.org_id,
        seat_purchase=sp,
        user_id=new_user_id,
        status=SeatAllocation.Status.ALLOCATED,
    )

    from apps.catalog.models import Course
    from apps.learning.services import enrol

    course = Course.objects.get(pk=sp.offering.course_id)
    enrollment = enrol(
        user=member.user,
        course=course,
        source="organization",
        org_id=sp.org_id,
        source_ref=new_alloc.id,
    )

    new_alloc.status = SeatAllocation.Status.ACTIVE
    new_alloc.activated_at = now
    new_alloc.enrollment = enrollment
    new_alloc.save(update_fields=["status", "activated_at", "enrollment", "updated_at"])

    AllocationEvent.objects.create(
        org_id=sp.org_id,
        allocation=new_alloc,
        action=AllocationEvent.Action.REASSIGNED,
        actor=request.auth,
        target_user_id=new_user_id,
        previous_user_id=old_user_id,
        note=reason or f"Reassigned from {old_user_id}",
    )

    audit_request(
        request, "seat_reassigned", "seat_allocation", new_alloc.id,
        data={
            "old_allocation_id": str(old_alloc.id),
            "old_user_id": str(old_user_id),
            "new_user_id": str(new_user_id),
            "purchase_id": str(sp.id),
        },
    )

    return new_alloc


def seat_inventory(org_id, offering_id=None) -> dict:
    qs = SeatPurchase.objects.filter(org_id=org_id, status=SeatPurchase.Status.PAID)
    if offering_id is not None:
        qs = qs.filter(offering_id=offering_id)

    purchases = qs.values("offering_id").annotate(
        total_purchased=Sum("quantity"),
    )

    result = {}
    for row in purchases:
        oid = row["offering_id"]
        purchased = row["total_purchased"] or 0
        allocated = (
            SeatAllocation.objects
            .filter(seat_purchase__offering_id=oid, seat_purchase__org_id=org_id)
            .filter(ACTIVE_ALLOC)
            .count()
        )
        result[str(oid)] = {
            "purchased": purchased,
            "allocated": allocated,
            "available": purchased - allocated,
        }

    return result