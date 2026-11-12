"""Company-facing corporate package endpoints.

Mounted at /api/v1/corporate/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
"""

from __future__ import annotations

from datetime import datetime

from ninja import Router, Schema
from pydantic import Field

from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, org_scope

router = Router(tags=["corporate"], auth=session_auth)


class CorporateOkOut(Schema):
    ok: bool


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
    currency: str = "GBP"


class CorporateCheckoutIn(Schema):
    quantity: int = Field(ge=1, le=500)


class CorporateCheckoutOut(Schema):
    purchase_id: str
    checkout_url: str


class PurchaseOut(Schema):
    id: str
    offering_id: str
    course_title: str = ""
    delivery_type: str = ""
    quantity: int
    unit_price_minor: int
    currency: str
    total_minor: int
    status: str
    paid_at: str | None = None
    created_at: str


class CorporateQuoteItemOut(Schema):
    course_title: str
    delivery_type: str
    quantity: int
    unit_price_minor: int
    line_total_minor: int


class QuoteOut(Schema):
    id: str
    items: list[CorporateQuoteItemOut] = []
    status: str
    currency: str
    total_minor: int
    valid_until: str
    stripe_invoice_url: str
    notes: str
    created_at: str


class InventoryOut(Schema):
    offering_id: str
    course_title: str = ""
    delivery_type: str = ""
    purchased: int
    allocated: int
    available: int


# ---------------------------------------------------------------- packages


@router.get("/packages", response=list[PackageOut])
def list_packages(request):
    org_scope(request, OrgRole.MANAGER)
    from .models import CorporateOffering

    offerings = (
        CorporateOffering.objects.filter(
            is_active=True, price_tier__gbp_minor__gt=0
        )  # an option without a price is not on sale
        .select_related("course", "price_tier")
        .order_by("course__title", "delivery_type")
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
            "currency": "GBP",
        }
        for o in offerings
    ]


@router.post("/packages/{offering_id}/checkout", response=CorporateCheckoutOut)
def checkout(request, offering_id: str, body: CorporateCheckoutIn):
    org_scope(request, OrgRole.ADMIN)
    from .checkout import create_recorded_checkout

    return create_recorded_checkout(request, offering_id, body.quantity)


# ---------------------------------------------------------------- purchases


@router.get("/purchases", response=list[PurchaseOut])
def list_purchases(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import SeatPurchase

    qs = (
        SeatPurchase.objects.filter(org_id=scope.org_id)
        .select_related("offering__course")
        .order_by("-created_at")[:200]
    )
    return [
        {
            "id": str(p.id),
            "offering_id": str(p.offering_id),
            "course_title": p.offering.course.title,
            "delivery_type": p.offering.delivery_type,
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

    qs = (
        CorporateQuote.objects.filter(org_id=scope.org_id)
        .exclude(status=CorporateQuote.Status.DRAFT)  # drafts are staff work in progress
        .prefetch_related("items__offering__course")
        .order_by("-created_at")[:200]
    )
    return [
        {
            "id": str(q.id),
            "items": [
                {
                    "course_title": i.offering.course.title,
                    "delivery_type": i.offering.delivery_type,
                    "quantity": i.quantity,
                    "unit_price_minor": i.unit_price_minor,
                    "line_total_minor": i.line_total_minor,
                }
                for i in q.items.all()
            ],
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
    from .models import CorporateOffering

    offerings = {
        str(o.id): o for o in CorporateOffering.objects.filter(pk__in=list(data)).select_related("course")
    }
    return [
        {
            "offering_id": oid,
            "course_title": offerings[oid].course.title if oid in offerings else "",
            "delivery_type": offerings[oid].delivery_type if oid in offerings else "",
            **counts,
        }
        for oid, counts in data.items()
    ]


# ---------------------------------------------------------------- training requests


class TrainingRequestIn(Schema):
    course_id: str
    seats: int = Field(ge=1, le=200)
    preferred_intake: str = ""
    preferred_delivery_mode: str = ""


class TrainingRequestOut(Schema):
    id: str
    course_id: str
    course_title: str = ""
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
        "course_title": tr.course.title,
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

    qs = (
        TrainingRequest.objects.filter(org_id=scope.org_id)
        .select_related("course")
        .order_by("-created_at")[:100]
    )
    return [
        {
            "id": str(r.id),
            "course_id": str(r.course_id),
            "course_title": r.course.title,
            "requested_seats": r.requested_seats,
            "preferred_intake": r.preferred_intake,
            "preferred_delivery_mode": r.preferred_delivery_mode,
            "status": r.status,
            "status_label": r.status_label,
            "created_at": r.created_at.isoformat(),
        }
        for r in qs
    ]


@router.delete("/training-requests/{request_id}", response=CorporateOkOut)
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
    cohort_title: str = ""
    cohort_status: str = ""
    delivery_mode: str = ""
    intake: str = ""
    scheduled_start: str | None = None
    scheduled_end: str | None = None
    currency: str = "GBP"
    unit_price_minor: int | None = None
    total_minor: int | None = None
    attendee_count: int = 0


@router.get("/live-bookings", response=list[LiveBookingOut])
def list_live_bookings(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from django.db.models import Count, Q

    from .models import CohortCompany, CorporateOffering, LiveAttendee

    qs = list(
        CohortCompany.objects.filter(org_id=scope.org_id)
        .select_related("cohort__course", "seat_purchase")
        .annotate(n_att=Count("attendees", filter=Q(attendees__status=LiveAttendee.Status.ACTIVE)))
        .order_by("-cohort__created_at")[:100]
    )
    prices = {
        o.course_id: o.price_tier.gbp_minor
        for o in CorporateOffering.objects.filter(
            course_id__in={cc.cohort.course_id for cc in qs}, delivery_type="live", is_active=True
        ).select_related("price_tier")
    }

    def _price(cc):
        # a paid booking shows what was paid; an open one shows today's live price
        if cc.seat_purchase is not None:
            return cc.seat_purchase.unit_price_minor, cc.seat_purchase.total_minor
        unit = prices.get(cc.cohort.course_id)
        return unit, (unit * cc.approved_seats if unit is not None else None)

    out = []
    for cc in qs:
        unit, total = _price(cc)
        c = cc.cohort
        out.append(
            {
                "id": str(cc.id),
                "cohort_id": str(cc.cohort_id),
                "course_title": c.course.title,
                "approved_seats": cc.approved_seats,
                "status": cc.status,
                "payment_deadline": cc.payment_deadline.isoformat() if cc.payment_deadline else None,
                "cohort_title": c.title,
                "cohort_status": c.status,
                "delivery_mode": c.delivery_mode,
                "intake": c.intake,
                "scheduled_start": c.scheduled_start.isoformat() if c.scheduled_start else None,
                "scheduled_end": c.scheduled_end.isoformat() if c.scheduled_end else None,
                "currency": "GBP",
                "unit_price_minor": unit,
                "total_minor": total,
                "attendee_count": cc.n_att,
            }
        )
    return out


# ---------------------------------------------------------------- schedule visibility


class SessionOut(Schema):
    sequence: int
    title: str
    scheduled_at: str
    duration_min: int
    delivery_mode: str
    location: str
    status: str


@router.post("/live-bookings/{cc_id}/checkout", response=CorporateCheckoutOut)
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
    seat_purchase_id: str | None = None
    cohort_company_id: str | None = None
    refund_amount_minor: int | None = None
    refund_currency: str = ""


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
    return _cancellation_out(cr)


@router.get("/cancellation-requests", response=list[CancellationOut])
def list_cancellations(request):
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import CancellationRequest

    qs = CancellationRequest.objects.filter(org_id=scope.org_id).order_by("-created_at")[:100]
    return [_cancellation_out(c) for c in qs]


def _cancellation_out(c) -> dict:
    return {
        "id": str(c.id),
        "type": c.type,
        "status": c.status,
        "reason": c.reason,
        "created_at": c.created_at.isoformat(),
        "seat_purchase_id": str(c.seat_purchase_id) if c.seat_purchase_id else None,
        "cohort_company_id": str(c.cohort_company_id) if c.cohort_company_id else None,
        "refund_amount_minor": c.refund_amount_minor,
        "refund_currency": c.refund_currency or "",
    }


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

    from .attendees import visible_sessions

    # admins see the agreed schedule; managers follow the employees' first-session rule
    visible = visible_sessions(sessions, full=scope.is_admin)

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


# ---------------------------------------------------------------- recorded seat allocation (company)


class CorporateAllocationOut(Schema):
    id: str
    offering_id: str
    course_title: str
    user_id: str
    user_name: str
    user_email: str
    status: str
    allocated_at: str
    left_at: datetime | None = None  # employment: when they left the company
    programme_months: int | None = None
    programme_start: datetime | None = None
    programme_end: datetime | None = None
    programme_status: str = "not_started"  # not_started | in_progress | ended
    entitlement_status: str = "paid_in_full"  # paid_in_full | active | expired | not_covered | unpaid
    paid_through: datetime | None = None


class CorporateAllocateIn(Schema):
    offering_id: str
    user_id: str


def _allocation_out(a, left_at=None) -> dict:
    from .programme import entitlement, programme_dates

    sp = a.seat_purchase
    return {
        **programme_dates(a.programme_started_at, sp),
        **{("entitlement_status" if k == "status" else k): v for k, v in entitlement(a, sp, left_at).items()},
        "left_at": left_at,
        "id": str(a.id),
        "offering_id": str(a.seat_purchase.offering_id),
        "course_title": a.seat_purchase.offering.course.title,
        "user_id": str(a.user_id),
        "user_name": a.user.full_name or a.user.email,
        "user_email": a.user.email,
        "status": a.status,
        "allocated_at": a.allocated_at.isoformat(),
    }


@router.get("/allocations", response=list[CorporateAllocationOut])
def list_allocations(request, offering_id: str | None = None):
    """Who holds this company's recorded seats. Managers see people in their units only."""
    scope = org_scope(request, OrgRole.MANAGER)
    from apps.org.models import OrgMember

    from .models import SeatAllocation

    qs = SeatAllocation.objects.filter(org_id=scope.org_id, status__in=["allocated", "active"])
    if offering_id:
        qs = qs.filter(seat_purchase__offering_id=offering_id)
    if not scope.is_admin:
        people = scope.members(OrgMember.objects.filter(removed_at__isnull=True)).values("user_id")
        qs = qs.filter(user_id__in=people)
    qs = list(qs.select_related("user", "seat_purchase__offering__course").order_by("-allocated_at")[:500])
    left = dict(
        OrgMember.objects.filter(org_id=scope.org_id, user_id__in={a.user_id for a in qs})
        .order_by("joined_at")
        .values_list("user_id", "removed_at")
    )
    return [_allocation_out(a, left.get(a.user_id)) for a in qs]


@router.post("/allocations", response=CorporateAllocationOut)
def allocate(request, body: CorporateAllocateIn):
    """Give one employee a seat on a recorded course this company has paid for."""
    scope = org_scope(request, OrgRole.MANAGER)
    from .services import allocate_for_company

    a = allocate_for_company(request, scope, body.offering_id, body.user_id)
    return _allocation_out(a)


# ---------------------------------------------------------------- live attendees (company)


class LiveAttendeeOut(Schema):
    id: str
    user_id: str
    user_name: str
    user_email: str
    added_at: str


class LiveAttendeeIn(Schema):
    user_id: str


def _attendee_out(a) -> dict:
    return {
        "id": str(a.id),
        "user_id": str(a.user_id),
        "user_name": a.user.full_name or a.user.email,
        "user_email": a.user.email,
        "added_at": a.created_at.isoformat(),
    }


@router.get("/live-bookings/{cc_id}/attendees", response=list[LiveAttendeeOut])
def list_attendees(request, cc_id: str):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import LiveAttendee

    qs = (
        LiveAttendee.objects.filter(org_id=scope.org_id, cohort_company_id=cc_id, status="active")
        .select_related("user")
        .order_by("created_at")
    )
    return [_attendee_out(a) for a in qs]


@router.post("/live-bookings/{cc_id}/attendees", response=LiveAttendeeOut)
def add_attendee(request, cc_id: str, body: LiveAttendeeIn):
    scope = org_scope(request, OrgRole.ADMIN)
    from .attendees import add_attendee as _add

    a = _add(request, org_id=scope.org_id, cohort_company_id=cc_id, user_id=body.user_id)
    return _attendee_out(a)


@router.delete("/live-bookings/{cc_id}/attendees/{attendee_id}", response=CorporateOkOut)
def remove_attendee(request, cc_id: str, attendee_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    from .attendees import remove_attendee as _remove

    _remove(request, org_id=scope.org_id, cohort_company_id=cc_id, attendee_id=attendee_id)
    return {"ok": True}


# ---------------------------------------------------------------- my live training (employee)


class MyLiveSessionOut(Schema):
    sequence: int
    title: str
    scheduled_at: str
    duration_min: int
    delivery_mode: str
    location: str
    status: str
    join_url: str | None = None


class MyLiveCohortOut(Schema):
    cohort_id: str
    course_title: str
    course_slug: str
    company_name: str
    delivery_mode: str
    cohort_status: str
    programme_months: int | None = None
    programme_start: datetime | None = None  # the cohort's first scheduled session
    programme_end: datetime | None = None
    programme_status: str  # not_started | in_progress | ended (ended: no new sessions)
    sessions: list[MyLiveSessionOut]
    more_sessions_hidden: bool


@router.get("/my/live", response=list[MyLiveCohortOut])
def my_live(request):
    """The signed-in employee's live training, in any workspace. First session only until
    it ends; the join link shows from 15 minutes before a session until it ends."""
    from .attendees import my_live_training

    rows = my_live_training(request.user.id)
    for r in rows:
        r["cohort_id"] = str(r["cohort_id"])
        for x in r["sessions"]:
            x["scheduled_at"] = x["scheduled_at"].isoformat()
    return rows


# ---------------------------------------------------------------- the employee's programmes


class MyProgrammeOut(Schema):
    enrollment_id: str
    course_title: str
    course_slug: str
    company_name: str
    seat_status: str
    enrollment_status: str
    access_expires_at: datetime | None = None  # None: no end date
    access_open: bool
    entitlement_status: str
    programme_months: int | None = None
    programme_start: datetime | None = None
    programme_end: datetime | None = None
    programme_status: str


@router.get("/my/programmes", response=list[MyProgrammeOut])
def my_programmes(request):
    """The signed-in person's company-paid recorded courses: programme dates and access.

    The programme end never closes lessons; access follows payment only."""
    from .programme import my_recorded_programmes

    return [{**r, "enrollment_id": str(r["enrollment_id"])} for r in my_recorded_programmes(request.user.id)]


# ---------------------------------------------------------------- purchase files (owner/admin)


class CorporateAttachmentOut(Schema):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_by_name: str
    uploaded_by_staff: bool
    uploaded_at: datetime
    can_delete: bool


class CorporateUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., ge=1)


class CorporateUploadOut(Schema):
    attachment_id: str
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class CorporateDownloadOut(Schema):
    url: str


def _purchase(scope, purchase_id):
    from .models import SeatPurchase

    sp = SeatPurchase.objects.filter(pk=purchase_id, org_id=scope.org_id).first()
    if sp is None:
        raise ServiceError("purchase_not_found", "Purchase not found.", status=404)
    return sp


def _attachment(scope, attachment_id):
    from .models import PurchaseAttachment

    att = (
        PurchaseAttachment.objects.filter(pk=attachment_id, org_id=scope.org_id)
        .select_related("uploaded_by")
        .first()
    )
    if att is None:
        raise ServiceError("attachment_not_found", "File not found.", status=404)
    return att


def _att_out(att, user) -> dict:
    from . import files

    return {**files.attachment_out(att, user, is_staff=False), "id": str(att.id)}


@router.get("/purchases/{purchase_id}/attachments", response=list[CorporateAttachmentOut])
def list_attachments(request, purchase_id: str):
    """Files kept with a purchase. Owners and admins only (commercial documents)."""
    scope = org_scope(request, OrgRole.ADMIN)
    from . import files

    return [_att_out(a, request.auth) for a in files.listing(_purchase(scope, purchase_id))]


@router.post("/purchases/{purchase_id}/attachments", response=CorporateUploadOut)
def start_attachment(request, purchase_id: str, body: CorporateUploadIn):
    scope = org_scope(request, OrgRole.ADMIN)
    from . import files

    out = files.start_upload(
        request,
        _purchase(scope, purchase_id),
        filename=body.filename,
        size_bytes=body.size_bytes,
        by_staff=False,
    )
    return {**out, "attachment_id": str(out["attachment_id"])}


@router.post("/attachments/{attachment_id}/confirm", response=CorporateAttachmentOut)
def confirm_attachment(request, attachment_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    from . import files

    att = files.confirm(request, _attachment(scope, attachment_id).id)
    return _att_out(_attachment(scope, att.id), request.auth)


@router.get("/attachments/{attachment_id}/download", response=CorporateDownloadOut)
def download_attachment(request, attachment_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    from . import files

    return {"url": files.download_url(_attachment(scope, attachment_id))}


@router.delete("/attachments/{attachment_id}", response=CorporateOkOut)
def delete_attachment(request, attachment_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    from . import files

    files.delete(request, _attachment(scope, attachment_id), is_staff=False)
    return {"ok": True}
