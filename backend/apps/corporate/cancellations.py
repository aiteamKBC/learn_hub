"""B2B-07: Cancellation workflows and refund processing.

Admin reviews cancellation requests manually. No automated refund calculation (GATE G04).
Stripe refunds are manual admin operations with full audit trail.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CancellationRequest, SeatPurchase


@transaction.atomic
def submit_cancellation(request, *, type: str, reason: str,
                        seat_purchase_id=None, cohort_company_id=None) -> CancellationRequest:
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
        request, "cancellation_submitted", "cancellation_request", cr.id,
        data={"type": type, "reason": reason[:200]},
    )
    return cr


@transaction.atomic
def review_cancellation(request, cancellation_id, *, approve: bool, admin_notes="") -> CancellationRequest:
    cr = (
        CancellationRequest.objects
        .select_for_update()
        .filter(pk=cancellation_id)
        .first()
    )
    if cr is None:
        raise ServiceError("not_found", "Cancellation request not found.", status=404)
    if cr.status not in (CancellationRequest.Status.SUBMITTED, CancellationRequest.Status.UNDER_REVIEW):
        raise ServiceError("not_reviewable", "Request is not in reviewable state.", status=400)

    cr.status = CancellationRequest.Status.APPROVED if approve else CancellationRequest.Status.REJECTED
    cr.reviewed_by = request.user
    cr.reviewed_at = timezone.now()
    cr.admin_notes = admin_notes
    cr.save(update_fields=["status", "reviewed_by", "reviewed_at", "admin_notes", "updated_at"])

    audit_request(
        request, "cancellation_reviewed", "cancellation_request", cr.id,
        data={"approved": approve, "admin_notes": admin_notes[:200]},
    )
    return cr


@transaction.atomic
def process_refund(request, cancellation_id, *, amount_minor: int, currency: str = "GBP") -> CancellationRequest:
    cr = (
        CancellationRequest.objects
        .select_for_update()
        .filter(pk=cancellation_id)
        .first()
    )
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
    cr.save(update_fields=[
        "status", "refund_amount_minor", "refund_currency",
        "stripe_refund_id", "refunded_at", "updated_at",
    ])

    if cr.seat_purchase_id:
        sp_status = SeatPurchase.Status.REFUNDED if amount_minor >= (sp.total_minor if sp else 0) else SeatPurchase.Status.PARTIAL
        SeatPurchase.objects.filter(pk=cr.seat_purchase_id).update(
            status=sp_status, refunded_at=timezone.now(), updated_at=timezone.now(),
        )

    audit_request(
        request, "refund_processed", "cancellation_request", cr.id,
        data={
            "amount_minor": amount_minor, "currency": currency,
            "stripe_refund_id": refund_id,
        },
    )
    return cr
