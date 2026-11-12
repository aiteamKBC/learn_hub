"""Company-facing corporate package endpoints.

Mounted at /api/v1/corporate/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
"""

from __future__ import annotations

from ninja import Router, Schema
from pydantic import Field

from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, org_scope

router = Router(tags=["corporate"], auth=session_auth)


# ---------------------------------------------------------------- schemas


class PackageOut(Schema):
    id: str
    course_id: str
    course_title: str
    course_slug: str
    delivery_type: str
    price_gbp_minor: int
    custom_quote_enabled: bool
    description: str


class CheckoutIn(Schema):
    quantity: int = Field(ge=1, le=500)


class CheckoutOut(Schema):
    purchase_id: str
    checkout_url: str


class PurchaseOut(Schema):
    id: str
    offering_id: str
    quantity: int
    unit_price_minor: int
    currency: str
    total_minor: int
    status: str
    paid_at: str | None = None
    created_at: str


class QuoteOut(Schema):
    id: str
    status: str
    currency: str
    total_minor: int
    valid_until: str
    stripe_invoice_url: str
    notes: str
    created_at: str


class InventoryOut(Schema):
    offering_id: str
    purchased: int
    allocated: int
    available: int


# ---------------------------------------------------------------- packages


@router.get("/packages", response=list[PackageOut])
def list_packages(request):
    org_scope(request, OrgRole.MANAGER)
    from .models import CorporateOffering

    offerings = (
        CorporateOffering.objects.filter(is_active=True)
        .select_related("course", "price_tier")
        .order_by("course__title")
    )
    return [
        {
            "id": str(o.id),
            "course_id": str(o.course_id),
            "course_title": o.course.title,
            "course_slug": o.course.slug,
            "delivery_type": o.delivery_type,
            "price_gbp_minor": o.price_tier.gbp_minor,
            "custom_quote_enabled": o.custom_quote_enabled,
            "description": o.description,
        }
        for o in offerings
    ]


@router.post("/packages/{offering_id}/checkout", response=CheckoutOut)
def checkout(request, offering_id: str, body: CheckoutIn):
    org_scope(request, OrgRole.ADMIN)
    from .checkout import create_recorded_checkout

    return create_recorded_checkout(request, offering_id, body.quantity)


# ---------------------------------------------------------------- purchases


@router.get("/purchases", response=list[PurchaseOut])
def list_purchases(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import SeatPurchase

    qs = SeatPurchase.objects.filter(org_id=scope.org_id).order_by("-created_at")[:200]
    return [
        {
            "id": str(p.id),
            "offering_id": str(p.offering_id),
            "quantity": p.quantity,
            "unit_price_minor": p.unit_price_minor,
            "currency": p.currency,
            "total_minor": p.total_minor,
            "status": p.status,
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "created_at": p.created_at.isoformat(),
        }
        for p in qs
    ]


# ---------------------------------------------------------------- quotes


@router.get("/quotes", response=list[QuoteOut])
def list_quotes(request):
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import CorporateQuote

    qs = CorporateQuote.objects.filter(org_id=scope.org_id).order_by("-created_at")[:200]
    return [
        {
            "id": str(q.id),
            "status": q.status,
            "currency": q.currency,
            "total_minor": q.total_minor,
            "valid_until": q.valid_until.isoformat(),
            "stripe_invoice_url": q.stripe_invoice_url,
            "notes": q.notes,
            "created_at": q.created_at.isoformat(),
        }
        for q in qs
    ]


# ---------------------------------------------------------------- inventory


@router.get("/inventory", response=list[InventoryOut])
def inventory(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .services import seat_inventory

    data = seat_inventory(scope.org_id)
    return [{"offering_id": oid, **counts} for oid, counts in data.items()]


# ---------------------------------------------------------------- training requests


class TrainingRequestIn(Schema):
    course_id: str
    seats: int = Field(ge=1, le=200)
    preferred_intake: str = ""
    preferred_delivery_mode: str = ""


class TrainingRequestOut(Schema):
    id: str
    course_id: str
    requested_seats: int
    preferred_intake: str
    preferred_delivery_mode: str
    status: str
    status_label: str
    created_at: str


@router.post("/training-requests", response=TrainingRequestOut)
def submit_request(request, body: TrainingRequestIn):
    org_scope(request, OrgRole.ADMIN)
    from .live import submit_request as _submit

    tr = _submit(
        request,
        body.course_id,
        body.seats,
        preferred_intake=body.preferred_intake,
        preferred_delivery=body.preferred_delivery_mode,
    )
    return {
        "id": str(tr.id),
        "course_id": str(tr.course_id),
        "requested_seats": tr.requested_seats,
        "preferred_intake": tr.preferred_intake,
        "preferred_delivery_mode": tr.preferred_delivery_mode,
        "status": tr.status,
        "status_label": tr.status_label,
        "created_at": tr.created_at.isoformat(),
    }


@router.get("/training-requests", response=list[TrainingRequestOut])
def list_training_requests(request):
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import TrainingRequest

    qs = TrainingRequest.objects.filter(org_id=scope.org_id).order_by("-created_at")[:100]
    return [
        {
            "id": str(r.id),
            "course_id": str(r.course_id),
            "requested_seats": r.requested_seats,
            "preferred_intake": r.preferred_intake,
            "preferred_delivery_mode": r.preferred_delivery_mode,
            "status": r.status,
            "status_label": r.status_label,
            "created_at": r.created_at.isoformat(),
        }
        for r in qs
    ]


@router.delete("/training-requests/{request_id}")
def cancel_training_request(request, request_id: str):
    org_scope(request, OrgRole.ADMIN)
    from .live import cancel_request

    cancel_request(request, request_id)
    return {"ok": True}


# ---------------------------------------------------------------- live bookings (company view)


class LiveBookingOut(Schema):
    id: str
    cohort_id: str
    course_title: str
    approved_seats: int
    status: str
    payment_deadline: str | None = None


@router.get("/live-bookings", response=list[LiveBookingOut])
def list_live_bookings(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import CohortCompany

    qs = (
        CohortCompany.objects.filter(org_id=scope.org_id)
        .select_related("cohort__course")
        .order_by("-cohort__created_at")[:100]
    )
    return [
        {
            "id": str(cc.id),
            "cohort_id": str(cc.cohort_id),
            "course_title": cc.cohort.course.title,
            "approved_seats": cc.approved_seats,
            "status": cc.status,
            "payment_deadline": cc.payment_deadline.isoformat() if cc.payment_deadline else None,
        }
        for cc in qs
    ]


# ---------------------------------------------------------------- schedule visibility


class SessionOut(Schema):
    sequence: int
    title: str
    scheduled_at: str
    duration_min: int
    delivery_mode: str
    location: str
    status: str


@router.post("/live-bookings/{cc_id}/checkout", response=CheckoutOut)
def live_checkout(request, cc_id: str):
    org_scope(request, OrgRole.ADMIN)
    from .live_checkout import create_live_checkout

    return create_live_checkout(request, cc_id)


# ---------------------------------------------------------------- company dashboard / reports


class CompanyDashboardOut(Schema):
    total_seats_purchased: int
    seats_allocated: int
    seats_available: int
    active_cohorts: int
    pending_requests: int
    total_spend_minor: int


class EmployeeProgressOut(Schema):
    user_id: str
    user_email: str
    user_name: str
    course_title: str
    enrollment_status: str
    progress_pct: int
    allocated_at: str | None = None
    activated_at: str | None = None


class AttendanceSummaryOut(Schema):
    user_email: str
    user_name: str
    session_title: str
    course_title: str
    join_at: str
    leave_at: str | None = None
    duration_seconds: int
    match_status: str


@router.get("/dashboard", response=CompanyDashboardOut)
def company_dashboard(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .reports import company_dashboard as _dashboard

    return _dashboard(scope.org_id)


@router.get("/employee-progress", response=list[EmployeeProgressOut])
def employee_progress(request, offering_id: str | None = None):
    scope = org_scope(request, OrgRole.MANAGER)
    from .reports import company_employee_progress

    return company_employee_progress(scope.org_id, offering_id)


@router.get("/attendance-summary", response=list[AttendanceSummaryOut])
def attendance_summary(request, cohort_id: str | None = None):
    scope = org_scope(request, OrgRole.MANAGER)
    from .reports import company_attendance_summary

    return company_attendance_summary(scope.org_id, cohort_id)


# ---------------------------------------------------------------- schedule visibility

# ---------------------------------------------------------------- cancellation requests (company)


class CancellationIn(Schema):
    type: str
    reason: str = Field(..., min_length=10, max_length=2000)
    seat_purchase_id: str | None = None
    cohort_company_id: str | None = None


class CancellationOut(Schema):
    id: str
    type: str
    status: str
    reason: str
    created_at: str


@router.post("/cancellation-requests", response=CancellationOut)
def submit_cancellation(request, body: CancellationIn):
    org_scope(request, OrgRole.ADMIN)
    from .cancellations import submit_cancellation as _submit

    cr = _submit(
        request,
        type=body.type,
        reason=body.reason,
        seat_purchase_id=body.seat_purchase_id,
        cohort_company_id=body.cohort_company_id,
    )
    return {
        "id": str(cr.id),
        "type": cr.type,
        "status": cr.status,
        "reason": cr.reason,
        "created_at": cr.created_at.isoformat(),
    }


@router.get("/cancellation-requests", response=list[CancellationOut])
def list_cancellations(request):
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import CancellationRequest

    qs = CancellationRequest.objects.filter(org_id=scope.org_id).order_by("-created_at")[:100]
    return [
        {
            "id": str(c.id),
            "type": c.type,
            "status": c.status,
            "reason": c.reason,
            "created_at": c.created_at.isoformat(),
        }
        for c in qs
    ]


# ---------------------------------------------------------------- schedule visibility


@router.get("/live-bookings/{cc_id}/schedule", response=list[SessionOut])
def booking_schedule(request, cc_id: str):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import CohortCompany
    from .models import Session as SessionModel

    cc = CohortCompany.objects.filter(pk=cc_id, org_id=scope.org_id).first()
    if cc is None:
        raise ServiceError("not_found", "Booking not found.", status=404)

    sessions = list(
        SessionModel.objects.filter(cohort_id=cc.cohort_id).exclude(status="cancelled").order_by("sequence")
    )

    if not sessions:
        return []

    from django.utils import timezone

    first = sessions[0]
    first_ended = first.status == "completed" or (first.actual_end and first.actual_end <= timezone.now())

    if scope.is_admin:
        visible = sessions
    elif first_ended:
        visible = sessions
    else:
        visible = [first]

    return [
        {
            "sequence": s.sequence,
            "title": s.title,
            "scheduled_at": s.scheduled_at.isoformat(),
            "duration_min": s.duration_min,
            "delivery_mode": s.delivery_mode,
            "location": s.location,
            "status": s.status,
        }
        for s in visible
    ]
