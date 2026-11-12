"""Console > Corporate Cancellations & Departure Policies."""

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema

from apps.corporate.models import CancellationRequest, DeparturePolicy

from .common import ConsoleOkOut, clamp, router, staff

# ---- Schemas ----

class ConsoleCancellationOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    type: str
    status: str
    requester_email: str
    reason: str
    admin_notes: str
    reviewed_by_email: str | None = None
    reviewed_at: datetime | None = None
    refund_amount_minor: int | None = None
    refund_currency: str
    stripe_refund_id: str
    refunded_at: datetime | None = None
    created_at: datetime


class ConsoleCancellationReview(Schema):
    approve: bool
    admin_notes: str = ""


class ConsoleRefundIn(Schema):
    amount_minor: int = Field(..., ge=1)
    currency: str = Field("GBP", max_length=3)


class ConsoleDeparturePolicyOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    action: str
    notes: str
    set_by_email: str | None = None
    created_at: datetime
    updated_at: datetime


class ConsoleDeparturePolicyIn(Schema):
    action: str = Field(..., pattern=r"^(revoke_all|preserve_completed|admin_decides)$")
    notes: str = ""


class ConsoleDepartureApplyIn(Schema):
    user_id: UUID


# ---- Cancellation Endpoints ----

@router.get("/corporate/cancellations", response=list[ConsoleCancellationOut])
def list_cancellations(request, org_id: UUID | None = None, status: str | None = None,
                       type: str | None = None, limit: int = 50, offset: int = 0):
    staff(request)
    qs = CancellationRequest.objects.select_related("org", "requester", "reviewed_by").order_by("-created_at")
    if org_id:
        qs = qs.filter(org_id=org_id)
    if status:
        qs = qs.filter(status=status)
    if type:
        qs = qs.filter(type=type)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": c.id, "org_id": c.org_id, "org_name": c.org.name,
            "type": c.type, "status": c.status,
            "requester_email": c.requester.email,
            "reason": c.reason, "admin_notes": c.admin_notes,
            "reviewed_by_email": c.reviewed_by.email if c.reviewed_by else None,
            "reviewed_at": c.reviewed_at,
            "refund_amount_minor": c.refund_amount_minor,
            "refund_currency": c.refund_currency,
            "stripe_refund_id": c.stripe_refund_id,
            "refunded_at": c.refunded_at,
            "created_at": c.created_at,
        }
        for c in items
    ]


@router.post("/corporate/cancellations/{cancellation_id}/review", response=ConsoleOkOut)
def review_cancellation(request, cancellation_id: UUID, body: ConsoleCancellationReview):
    staff(request)
    from apps.corporate.cancellations import review_cancellation as _review
    _review(request, str(cancellation_id), approve=body.approve, admin_notes=body.admin_notes)
    return {"ok": True}


@router.post("/corporate/cancellations/{cancellation_id}/refund", response=ConsoleOkOut)
def process_refund(request, cancellation_id: UUID, body: ConsoleRefundIn):
    staff(request)
    from apps.corporate.cancellations import process_refund as _refund
    _refund(request, str(cancellation_id), amount_minor=body.amount_minor, currency=body.currency)
    return {"ok": True}


# ---- Departure Policy Endpoints ----

@router.get("/corporate/departure-policies", response=list[ConsoleDeparturePolicyOut])
def list_departure_policies(request, org_id: UUID | None = None, limit: int = 50, offset: int = 0):
    staff(request)
    qs = DeparturePolicy.objects.select_related("org", "set_by").order_by("-updated_at")
    if org_id:
        qs = qs.filter(org_id=org_id)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": p.id, "org_id": p.org_id, "org_name": p.org.name,
            "action": p.action, "notes": p.notes,
            "set_by_email": p.set_by.email if p.set_by else None,
            "created_at": p.created_at, "updated_at": p.updated_at,
        }
        for p in items
    ]


@router.put("/corporate/departure-policies/{org_id}", response=ConsoleOkOut)
def set_departure_policy(request, org_id: UUID, body: ConsoleDeparturePolicyIn):
    staff(request)
    from apps.corporate.departure import set_policy
    set_policy(request, str(org_id), body.action, body.notes)
    return {"ok": True}


class ConsoleDepartureCourseOut(Schema):
    course_title: str
    enrollment_status: str
    access_expires_at: datetime | None = None  # None: no end date


class ConsoleDepartureResultOut(Schema):
    action: str
    left_at: datetime
    revoked: int
    preserved: int
    courses: list[ConsoleDepartureCourseOut]


@router.post("/corporate/departure-policies/{org_id}/apply", response=ConsoleDepartureResultOut)
def apply_departure(request, org_id: UUID, body: ConsoleDepartureApplyIn):
    """Record that someone left. Paid access is never ended early (see corporate/departure.py)."""
    staff(request)
    from apps.corporate.departure import apply_departure as _apply

    return _apply(request, str(org_id), str(body.user_id))
