"""B2B-07: Cancellation workflows and refund processing.

Admin reviews cancellation requests manually. No automated refund calculation (GATE G04).
Stripe refunds are manual admin operations with full audit trail.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.commerce import gateway
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CancellationRequest, CohortCompany, LiveAttendee, LiveCohort, SeatPurchase


@transaction.atomic
def submit_cancellation(
    request, *, type: str, reason: str, seat_purchase_id=None, cohort_company_id=None
) -> CancellationRequest:
    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)

    cr = CancellationRequest.objects.create(
        org_id=org_id,
        type=type,
        requester=request.user,
        seat_purchase_id=seat_purchase_id,
        cohort_company_id=cohort_company_id,
        reason=reason,
    )

    audit_request(
        request,
        "cancellation_submitted",
        "cancellation_request",
        cr.id,
        data={"type": type, "reason": reason[:200]},
    )
    return cr


@transaction.atomic
def review_cancellation(request, cancellation_id, *, approve: bool, admin_notes="") -> CancellationRequest:
    cr = CancellationRequest.objects.select_for_update().filter(pk=cancellation_id).first()
    if cr is None:
        raise ServiceError("not_found", "Cancellation request not found.", status=404)
    if cr.status not in (CancellationRequest.Status.SUBMITTED, CancellationRequest.Status.UNDER_REVIEW):
        raise ServiceError("not_reviewable", "Request is not in reviewable state.", status=400)
    if approve and cr.type == CancellationRequest.Type.POSTPONEMENT:
        raise ServiceError(
            "postponement_needs_transfer",
            "Choose the replacement live cohort and the unused seats to move. Approval alone does not move training.",
            status=400,
        )

    cr.status = CancellationRequest.Status.APPROVED if approve else CancellationRequest.Status.REJECTED
    cr.reviewed_by = request.user
    cr.reviewed_at = timezone.now()
    cr.admin_notes = admin_notes
    cr.save(update_fields=["status", "reviewed_by", "reviewed_at", "admin_notes", "updated_at"])

    audit_request(
        request,
        "cancellation_reviewed",
        "cancellation_request",
        cr.id,
        data={"approved": approve, "admin_notes": admin_notes[:200]},
    )
    return cr


@transaction.atomic
def process_postponement(
    request, cancellation_id, *, target_cohort_id, seats: int, admin_notes=""
) -> CancellationRequest:
    """Move unused, paid live places to a compatible future cohort.

    A move is not a refund: the original paid purchase remains the entitlement.  We
    only move places with no named attendee and never silently overbook the target.
    """
    if seats <= 0:
        raise ServiceError("bad_seat_count", "Choose at least one seat to move.", status=400)

    cr = CancellationRequest.objects.select_for_update().filter(pk=cancellation_id).first()
    if cr is None:
        raise ServiceError("not_found", "Cancellation request not found.", status=404)
    if cr.type != CancellationRequest.Type.POSTPONEMENT or cr.cohort_company_id is None:
        raise ServiceError(
            "not_postponement", "This request is not a live-training postponement.", status=400
        )
    if cr.status not in (CancellationRequest.Status.SUBMITTED, CancellationRequest.Status.UNDER_REVIEW):
        raise ServiceError("not_reviewable", "Request is not in reviewable state.", status=400)

    source = (
        CohortCompany.objects.select_for_update()
        .select_related("cohort")
        .filter(pk=cr.cohort_company_id)
        .first()
    )
    target = LiveCohort.objects.select_for_update().filter(pk=target_cohort_id).first()
    if source is None or target is None:
        raise ServiceError("not_found", "The source booking or target cohort was not found.", status=404)
    if target.course_id != source.cohort.course_id:
        raise ServiceError("wrong_course", "The replacement cohort must be for the same course.", status=400)
    if source.status not in (CohortCompany.Status.PAID, CohortCompany.Status.ACTIVE):
        raise ServiceError("booking_not_paid", "Only paid live places can be postponed.", status=400)
    if target.status not in (LiveCohort.Status.FORMING, LiveCohort.Status.CONFIRMED):
        raise ServiceError("cohort_not_open", "The replacement cohort is not accepting places.", status=400)
    if target.id == source.cohort_id:
        raise ServiceError("same_cohort", "Choose a different cohort for the postponement.", status=400)

    named = LiveAttendee.objects.filter(
        cohort_company_id=source.id, status=LiveAttendee.Status.ACTIVE
    ).count()
    unused = source.approved_seats - named
    if seats > unused:
        raise ServiceError("seats_already_named", f"Only {unused} unused seats can be moved.", status=409)

    target_cc = CohortCompany.objects.select_for_update().filter(cohort=target, org_id=source.org_id).first()
    if target_cc and target_cc.seat_purchase_id not in (None, source.seat_purchase_id):
        raise ServiceError(
            "different_purchase", "The company already has a different purchase in that cohort.", status=409
        )
    occupied = target.current_seats
    if occupied + seats > target.max_learners:
        raise ServiceError("cohort_full", "The replacement cohort does not have enough capacity.", status=409)

    source.approved_seats -= seats
    if source.approved_seats == 0:
        source.status = CohortCompany.Status.CANCELLED
    source.save(update_fields=["approved_seats", "status", "updated_at"])

    if target_cc is None:
        target_cc = CohortCompany.objects.create(
            org_id=source.org_id,
            cohort=target,
            seat_purchase_id=source.seat_purchase_id,
            approved_seats=seats,
            status=CohortCompany.Status.PAID,
        )
    else:
        target_cc.approved_seats += seats
        target_cc.seat_purchase_id = target_cc.seat_purchase_id or source.seat_purchase_id
        target_cc.status = CohortCompany.Status.PAID
        target_cc.save(update_fields=["approved_seats", "seat_purchase", "status", "updated_at"])

    for cohort in (source.cohort, target):
        cohort.current_seats = (
            CohortCompany.objects.filter(cohort=cohort)
            .exclude(status__in=[CohortCompany.Status.CANCELLED, CohortCompany.Status.WITHDRAWN])
            .aggregate(total=Sum("approved_seats"))["total"]
            or 0
        )
        cohort.save(update_fields=["current_seats", "updated_at"])

    cr.status = CancellationRequest.Status.PROCESSED
    cr.reviewed_by = request.user
    cr.reviewed_at = timezone.now()
    cr.admin_notes = admin_notes
    cr.save(update_fields=["status", "reviewed_by", "reviewed_at", "admin_notes", "updated_at"])
    audit_request(
        request,
        "live_places_postponed",
        "cancellation_request",
        cr.id,
        data={"source_cohort_id": str(source.cohort_id), "target_cohort_id": str(target.id), "seats": seats},
    )
    return cr


@transaction.atomic
def process_refund(
    request, cancellation_id, *, amount_minor: int, currency: str = "GBP"
) -> CancellationRequest:
    cr = CancellationRequest.objects.select_for_update().filter(pk=cancellation_id).first()
    if cr is None:
        raise ServiceError("not_found", "Cancellation request not found.", status=404)
    if cr.status != CancellationRequest.Status.APPROVED:
        raise ServiceError("not_approved", "Only approved requests can be refunded.", status=400)

    if amount_minor <= 0:
        raise ServiceError("bad_amount", "Refund amount must be positive.", status=400)

    payment_intent = None
    if cr.seat_purchase_id:
        sp = SeatPurchase.objects.filter(pk=cr.seat_purchase_id).first()
        if sp:
            payment_intent = sp.payment_intent

    if not payment_intent:
        raise ServiceError(
            "no_payment_intent",
            "No payment intent found for this purchase. Manual Stripe refund required.",
            status=400,
        )

    refund_id = gateway.refund(
        payment_intent=payment_intent,
        amount=amount_minor,
        idempotency_key=f"corp_refund_{cr.id}",
    )

    cr.status = CancellationRequest.Status.PROCESSED
    cr.refund_amount_minor = amount_minor
    cr.refund_currency = currency
    cr.stripe_refund_id = refund_id
    cr.refunded_at = timezone.now()
    cr.save(
        update_fields=[
            "status",
            "refund_amount_minor",
            "refund_currency",
            "stripe_refund_id",
            "refunded_at",
            "updated_at",
        ]
    )

    if cr.seat_purchase_id:
        sp_status = (
            SeatPurchase.Status.REFUNDED
            if amount_minor >= (sp.total_minor if sp else 0)
            else SeatPurchase.Status.PARTIAL
        )
        SeatPurchase.objects.filter(pk=cr.seat_purchase_id).update(
            status=sp_status,
            refunded_at=timezone.now(),
            updated_at=timezone.now(),
        )
        # A full refund removes the entitlement that the purchase paid for.  A
        # partial refund remains a manual case because it does not identify which
        # particular seats were credited back.
        if sp_status == SeatPurchase.Status.REFUNDED:
            from apps.learning.models import Enrollment

            from .models import SeatAllocation

            allocations = SeatAllocation.objects.filter(
                seat_purchase_id=cr.seat_purchase_id,
                status__in=[SeatAllocation.Status.ALLOCATED, SeatAllocation.Status.ACTIVE],
            )
            Enrollment.objects.filter(
                pk__in=allocations.exclude(enrollment_id=None).values("enrollment_id")
            ).update(status="revoked")
            allocations.update(
                status=SeatAllocation.Status.REVOKED, released_at=timezone.now(), updated_at=timezone.now()
            )

    audit_request(
        request,
        "refund_processed",
        "cancellation_request",
        cr.id,
        data={
            "amount_minor": amount_minor,
            "currency": currency,
            "stripe_refund_id": refund_id,
        },
    )
    return cr
