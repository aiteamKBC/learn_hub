"""B2B Recorded agreements whose fixed invoice payments unlock named course stages.

This is deliberately separate from legacy SeatInstalment/Covers, where payments buy
paid time for selected seats. New staged agreements use StageInstalment and
SeatPurchaseStage; requests are recorded locally and verified settlement unlocks stages.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.org.models import OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import (
    CorporateOffering,
    SeatAllocation,
    SeatPurchase,
    SeatPurchaseStage,
    StageInstalment,
    StageLecture,
)

MAX_INSTALMENTS = 24


@transaction.atomic
def create_stage_purchase(request, *, org_id, offering_id, buyer_id, quantity, unit_price_minor, schedule):
    from .offerings import ensure_recorded_offering

    offering, _ = ensure_recorded_offering(offering_id)
    if offering is None or offering.delivery_type != CorporateOffering.DeliveryType.RECORDED:
        raise ServiceError("offering_not_found", "Recorded course offer not found.", status=404)
    if not offering.instalments_enabled:
        raise ServiceError(
            "instalments_disabled", "Enable staged instalments for this course first.", status=400
        )
    if not OrgMember.objects.filter(org_id=org_id, user_id=buyer_id, removed_at__isnull=True).exists():
        raise ServiceError("buyer_not_member", "The billing contact must belong to this company.", status=400)
    if quantity < 1 or unit_price_minor < 1:
        raise ServiceError("bad_quantity", "Check the number of seats and the price.", status=400)
    if not 2 <= len(schedule) <= MAX_INSTALMENTS:
        raise ServiceError("bad_schedule", f"Use 2 to {MAX_INSTALMENTS} instalments.", status=400)
    total = quantity * unit_price_minor
    amounts = [int(row["amount_minor"]) for row in schedule]
    if any(a < 1 for a in amounts) or sum(amounts) != total:
        raise ServiceError(
            "bad_schedule", "The instalments must add up exactly to the full price.", status=400
        )
    dues = [row["due_at"] for row in schedule]
    if any(b < a for a, b in zip(dues, dues[1:], strict=False)):
        raise ServiceError("bad_schedule", "Due dates must be in order.", status=400)
    from apps.catalog.models import Lecture

    valid_keys = set(
        Lecture.objects.filter(version_id=offering.course.live_version_id).values_list(
            "lecture_key", flat=True
        )
    )
    all_keys: list[str] = []
    for row in schedule:
        stages = row.get("stages", [])
        if not stages or any(not s.get("title", "").strip() or not s.get("lecture_keys") for s in stages):
            raise ServiceError(
                "bad_stages", "Give every mapped stage a title and at least one course lesson.", status=400
            )
        all_keys.extend(str(k) for stage in stages for k in stage["lecture_keys"])
        if any(not set(stage["lecture_keys"]).issubset(valid_keys) for stage in stages):
            raise ServiceError(
                "bad_stages", "A selected lesson is no longer in the published course.", status=400
            )
    if len(all_keys) != len(set(all_keys)):
        raise ServiceError(
            "bad_stages", "Each course lesson can belong to one stage in this agreement.", status=400
        )

    sp = SeatPurchase.objects.create(
        org_id=org_id,
        offering=offering,
        buyer_id=buyer_id,
        quantity=quantity,
        unit_price_minor=unit_price_minor,
        currency="GBP",
        total_minor=total,
        gbp_total_minor=total,
        status=SeatPurchase.Status.PENDING,
        payment_plan=SeatPurchase.PaymentPlan.INSTALMENTS,
        stage_access_enabled=True,
    )
    stage_sequence = 0
    for n, row in enumerate(schedule, start=1):
        payment = StageInstalment.objects.create(
            org_id=org_id,
            seat_purchase=sp,
            sequence=n,
            amount_minor=int(row["amount_minor"]),
            currency="GBP",
            due_at=row["due_at"],
        )
        for stage in row["stages"]:
            stage_sequence += 1
            purchase_stage = SeatPurchaseStage.objects.create(
                org_id=org_id,
                seat_purchase=sp,
                instalment=payment,
                title=stage["title"].strip()[:120],
                sequence=stage_sequence,
            )
            StageLecture.objects.bulk_create(
                StageLecture(org_id=org_id, stage=purchase_stage, lecture_key=key)
                for key in dict.fromkeys(stage["lecture_keys"])
            )
    audit_request(
        request,
        "stage_instalment_plan_created",
        "seat_purchase",
        sp.id,
        data={"org_id": str(org_id), "instalments": len(schedule), "total": total},
    )
    return sp


def _locked(instalment_id):
    inst = StageInstalment.objects.select_for_update().filter(pk=instalment_id).first()
    if inst is None:
        raise ServiceError("instalment_not_found", "Instalment not found.", status=404)
    return inst


@transaction.atomic
def request_payment(request, instalment_id):
    purchase_id = (
        StageInstalment.objects.filter(pk=instalment_id).values_list("seat_purchase_id", flat=True).first()
    )
    if purchase_id is None:
        raise ServiceError("instalment_not_found", "Instalment not found.", status=404)
    sp = SeatPurchase.objects.select_for_update().get(pk=purchase_id)
    inst = _locked(instalment_id)
    if sp.status not in (SeatPurchase.Status.PENDING, SeatPurchase.Status.PARTIAL_PAID):
        raise ServiceError("purchase_not_payable", "This agreement is not awaiting payment.", status=409)
    if inst.status not in (StageInstalment.Status.PENDING, StageInstalment.Status.FAILED):
        raise ServiceError("already_requested", "This instalment already has a payment request.", status=400)
    inst.status = StageInstalment.Status.REQUESTED
    inst.payment_requested_at = timezone.now()
    inst.save(update_fields=["status", "payment_requested_at", "updated_at"])
    audit_request(
        request,
        "stage_payment_requested",
        "stage_instalment",
        inst.id,
        data={"purchase_id": str(sp.id), "sequence": inst.sequence},
    )
    return {"ok": True, "status": inst.status, "payment_requested_at": inst.payment_requested_at}


@transaction.atomic
def instalment_paid(*, instalment_id, payment_reference: str, amount_minor: int, currency: str) -> None:
    """Settle a payment after an external provider verifies it.

    The payment adapter must supply a unique reference and exact scheduled amount. This
    function records confirmation and updates seat-purchase paid/partial status; it does
    not contact or trust a payment provider itself.
    """
    purchase_id = StageInstalment.objects.values_list("seat_purchase_id", flat=True).get(pk=instalment_id)
    sp = SeatPurchase.objects.select_for_update().get(pk=purchase_id)
    inst = StageInstalment.objects.select_for_update().get(pk=instalment_id, seat_purchase=sp)
    if inst.status == StageInstalment.Status.PAID:
        if inst.payment_reference == payment_reference:
            return
        raise ServiceError("already_settled", "This instalment has already been settled.", status=409)
    if inst.status == StageInstalment.Status.VOID:
        raise ServiceError("cancelled_payment", "Cancelled instalments cannot be settled.", status=409)
    if sp.status not in (SeatPurchase.Status.PENDING, SeatPurchase.Status.PARTIAL_PAID):
        raise ServiceError("purchase_not_payable", "This agreement is not awaiting payment.", status=409)
    if not payment_reference:
        raise ServiceError("payment_reference_required", "A unique payment reference is required.")
    if StageInstalment.objects.filter(payment_reference=payment_reference).exclude(pk=inst.pk).exists():
        raise ServiceError("duplicate_payment", "This payment reference is already recorded.", status=409)
    if amount_minor != inst.amount_minor or currency.upper() != inst.currency:
        raise ServiceError("amount_mismatch", "Paid amount does not match the scheduled instalment.")
    inst.status, inst.paid_at, inst.payment_reference = (
        StageInstalment.Status.PAID,
        timezone.now(),
        payment_reference,
    )
    inst.save(update_fields=["status", "paid_at", "payment_reference", "updated_at"])
    if sp.stage_access_enabled and sp.status in (
        SeatPurchase.Status.PENDING,
        SeatPurchase.Status.PARTIAL_PAID,
    ):
        payments = list(
            StageInstalment.objects.filter(seat_purchase=sp).exclude(status=StageInstalment.Status.VOID)
        )
        fully_paid = bool(payments) and all(p.status == StageInstalment.Status.PAID for p in payments)
        sp.status = SeatPurchase.Status.PAID if fully_paid else SeatPurchase.Status.PARTIAL_PAID
        sp.paid_at = inst.paid_at if fully_paid else None
        sp.save(update_fields=["status", "paid_at", "updated_at"])


@transaction.atomic
def instalment_failed(*, instalment_id):
    purchase_id = StageInstalment.objects.values_list("seat_purchase_id", flat=True).get(pk=instalment_id)
    sp = SeatPurchase.objects.select_for_update().get(pk=purchase_id)
    inst = StageInstalment.objects.select_for_update().get(pk=instalment_id, seat_purchase_id=purchase_id)
    if sp.status in (SeatPurchase.Status.PENDING, SeatPurchase.Status.PARTIAL_PAID) and inst.status in (
        StageInstalment.Status.REQUESTED,
        StageInstalment.Status.SENT,
    ):
        inst.status = StageInstalment.Status.FAILED
        inst.save(update_fields=["status", "updated_at"])


def locked_lecture_keys(enrollment, lecture_keys):
    """Return staged lectures still locked for this company enrollment."""

    with tenant_context(org_id=enrollment.org_id, user_id=enrollment.user_id):
        allocation = SeatAllocation.objects.filter(
            pk=enrollment.source_ref, enrollment_id=enrollment.id
        ).first()
        if allocation is None:
            return set()
        sp = SeatPurchase.objects.filter(pk=allocation.seat_purchase_id, stage_access_enabled=True).first()
        if sp is None:
            return set()
        payments = list(
            StageInstalment.objects.filter(seat_purchase=sp).exclude(status=StageInstalment.Status.VOID)
        )
        if payments and all(p.status == StageInstalment.Status.PAID for p in payments):
            return set()
        paid_ids = [p.id for p in payments if p.status == StageInstalment.Status.PAID]
        unlocked = set(
            StageLecture.objects.filter(
                stage__instalment_id__in=paid_ids, lecture_key__in=lecture_keys
            ).values_list("lecture_key", flat=True)
        )
        return set(lecture_keys) - unlocked


def lecture_allowed(enrollment, lecture_key) -> bool:
    return lecture_key not in locked_lecture_keys(enrollment, [lecture_key])


def summary(sp):
    payments = list(StageInstalment.objects.filter(seat_purchase=sp).order_by("sequence"))
    paid = sum(p.amount_minor for p in payments if p.status == StageInstalment.Status.PAID)
    return {
        "purchase_id": sp.id,
        "total_minor": sp.total_minor,
        "paid_minor": paid,
        "outstanding_minor": max(0, sp.total_minor - paid),
        "currency": sp.currency,
        "instalments": [
            {
                "id": p.id,
                "sequence": p.sequence,
                "amount_minor": p.amount_minor,
                "due_at": p.due_at,
                "status": p.status,
                "paid_at": p.paid_at,
                "payment_requested_at": p.payment_requested_at,
                "stages": [
                    {
                        "id": s.id,
                        "title": s.title,
                        "sequence": s.sequence,
                        "lecture_count": s.lectures.count(),
                        "lectures": list(s.lectures.order_by("id").values_list("lecture_key", flat=True)),
                    }
                    for s in p.stages.order_by("sequence")
                ],
            }
            for p in payments
        ],
    }


def employer_summary(sp):
    """Payment schedule and per-employee counts from the existing lecture completion rows."""
    from apps.learning.models import LectureProgress

    data = summary(sp)
    allocations = list(
        SeatAllocation.objects.filter(seat_purchase=sp, status=SeatAllocation.Status.ACTIVE)
        .select_related("user")
        .order_by("allocated_at")
    )
    enrollment_ids = [a.enrollment_id for a in allocations if a.enrollment_id]
    completed = {
        (row["enrollment_id"], row["lecture_key"])
        for row in LectureProgress.objects.filter(
            enrollment_id__in=enrollment_ids, completed_at__isnull=False
        ).values("enrollment_id", "lecture_key")
    }
    stages = [stage for payment in data["instalments"] for stage in payment["stages"]]
    data["employees"] = [
        {
            "user_id": a.user_id,
            "name": a.user.full_name or a.user.email,
            "stages": [
                {
                    "stage_id": stage["id"],
                    "title": stage["title"],
                    "completed_lessons": sum(
                        (a.enrollment_id, key) in completed for key in stage["lectures"]
                    ),
                    "total_lessons": len(stage["lectures"]),
                }
                for stage in stages
            ],
        }
        for a in allocations
    ]
    return data
