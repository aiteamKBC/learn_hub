"""Company-facing corporate package endpoints.

Mounted at /api/v1/corporate/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from django.shortcuts import get_object_or_404
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


class CheckoutEmployeeIn(Schema):
    email: str = Field(..., max_length=320)
    full_name: str = Field("", max_length=200)
    job_title: str = Field("", max_length=120)


class CorporateCheckoutIn(Schema):
    quantity: int = Field(ge=1, le=500)
    # optional: the employees for these seats (typed or from a CSV). Invited only after
    # payment succeeds, following the platform's approval setting.
    employees: list[CheckoutEmployeeIn] = Field(default_factory=list, max_length=500)
    employees_source: str = "manual"


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
    stage_access_enabled: bool = False


class CorporateStageOut(Schema):
    id: str
    title: str
    sequence: int
    lecture_count: int
    lectures: list[str]


class CorporateStageInstalmentOut(Schema):
    id: str
    sequence: int
    amount_minor: int
    due_at: datetime
    status: str
    paid_at: datetime | None = None
    payment_requested_at: datetime | None = None
    stages: list[CorporateStageOut]


class CorporateEmployeeStageOut(Schema):
    stage_id: str
    title: str
    completed_lessons: int
    total_lessons: int


class CorporateEmployeeStageProgressOut(Schema):
    user_id: str
    name: str
    stages: list[CorporateEmployeeStageOut]


class CorporateStagePlanOut(Schema):
    purchase_id: str
    total_minor: int
    paid_minor: int
    outstanding_minor: int
    currency: str
    instalments: list[CorporateStageInstalmentOut]
    employees: list[CorporateEmployeeStageProgressOut]


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
    held: int = 0  # held for an invited email, not yet joined
    available: int


# ---------------------------------------------------------------- packages


@router.get("/packages", response=list[PackageOut])
def list_packages(request):
    org_scope(request, OrgRole.MANAGER)
    from apps.corporate.offerings import recorded_course_prices

    from .models import CorporateOffering

    live_offerings = (
        CorporateOffering.objects.filter(
            is_active=True, delivery_type=CorporateOffering.DeliveryType.LIVE, price_tier__gbp_minor__gt=0
        )  # an option without a price is not on sale
        .select_related("course", "price_tier")
        .order_by("course__title")
    )
    recorded_prices = recorded_course_prices()
    live = [
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
        for o in live_offerings
    ]
    recorded = [
        {
            # Recorded catalog items are keyed by course; checkout resolves the
            # shared CoursePrice and creates/updates the internal seat-ledger row.
            "id": str(price.course_id),
            "course_id": str(price.course_id),
            "course_title": price.course.title,
            "course_slug": price.course.slug,
            "delivery_type": "recorded",
            "price_gbp_minor": price.tier.gbp_minor,
            "custom_quote_enabled": False,
            "description": "",
            "currency": "GBP",
        }
        for price in recorded_prices
    ]
    return sorted(recorded + live, key=lambda item: (item["course_title"].casefold(), item["delivery_type"]))


@router.post("/packages/{offering_id}/checkout", response=CorporateCheckoutOut)
def checkout(request, offering_id: str, body: CorporateCheckoutIn):
    org_scope(request, OrgRole.ADMIN)
    from .checkout import create_recorded_checkout

    return create_recorded_checkout(
        request, offering_id, body.quantity,
        employees=[e.dict() for e in body.employees], source=body.employees_source,
        require_employees=True,
    )  # fmt: skip


# ---------------------------------------------------------------- bundles and baskets


class BundleCourseOut(Schema):
    course_id: str
    title: str
    slug: str
    seats_on_sale: bool  # recorded seats can be bought in this course today
    normal_price_minor: int | None = None


class BundleOut(Schema):
    id: str
    title: str
    description: str
    seat_price_minor: int
    is_active: bool
    currency: str
    courses: list[BundleCourseOut]


class BasketLineIn(Schema):
    course_id: UUID
    quantity: int = Field(..., ge=0, le=500)
    employees: list[CheckoutEmployeeIn] = Field(default_factory=list, max_length=500)


class BasketCheckoutIn(Schema):
    lines: list[BasketLineIn] = Field(..., min_length=1, max_length=20)
    bundle_id: UUID | None = None
    employees_source: str = "manual"


@router.get("/bundles", response=list[BundleOut], auth=None)
def list_bundles(request):
    """Public: the bundles on sale (the home page shows them; company admins buy them)."""
    from .bundles import active_bundles, bundle_out

    return [bundle_out(b) for b in active_bundles()[:50]]


@router.post("/basket/checkout", response=CorporateCheckoutOut)
def basket_checkout(request, body: BasketCheckoutIn):
    """Seats in several courses, one payment. With bundle_id every seat costs the
    bundle's seat price; without it each course costs its normal seat price."""
    org_scope(request, OrgRole.ADMIN)
    from .bundles import create_basket_checkout

    return create_basket_checkout(
        request,
        [{"course_id": ln.course_id, "quantity": ln.quantity, "employees": [e.dict() for e in ln.employees]} for ln in body.lines],
        bundle_id=body.bundle_id, source=body.employees_source,
    )  # fmt: skip


# ---------------------------------------------------------------- live booking (deposit)


class LivePlanPartOut(Schema):
    months: int
    amount_minor: int


class LiveOfferOut(Schema):
    course_id: str
    course_title: str
    programme_months: int
    deposit_months: int
    deposit_minor: int
    instalments: list[LivePlanPartOut]
    seat_price_minor: int
    private_price_minor: int | None = None
    next_intake_starts_on: datetime | str | None = None
    next_intake_title: str = ""


class LiveBookIn(Schema):
    course_id: UUID
    quantity: int = Field(..., ge=1, le=500)
    employees: list[CheckoutEmployeeIn] = Field(..., max_length=500)
    employees_source: str = "manual"


class LiveSeatPersonOut(Schema):
    email: str
    full_name: str
    status: str


class LiveSeatBookingOut(Schema):
    id: str
    course_title: str
    quantity: int
    status: str
    deposit_months: int
    deposit_total_minor: int
    intake_starts_on: str | None = None
    created_at: datetime
    people: list[LiveSeatPersonOut]
    paid_until: datetime | None = None  # None: not started yet, or fully paid
    next_due_minor: int | None = None
    next_due_on: datetime | None = None
    next_due_months: int | None = None
    instalments_left: int = 0


@router.get("/live/offer/{course_id}", response=LiveOfferOut)
def live_offer(request, course_id: UUID):
    org_scope(request, OrgRole.MANAGER)
    from .live_booking import course_live_offer

    return course_live_offer(course_id)


@router.post("/live/book", response=CorporateCheckoutOut)
def live_book(request, body: LiveBookIn):
    org_scope(request, OrgRole.ADMIN)
    from .live_booking import create_live_booking

    return create_live_booking(
        request,
        body.course_id,
        body.quantity,
        [e.dict() for e in body.employees],
        source=body.employees_source,
    )


@router.get("/live/bookings", response=list[LiveSeatBookingOut])
def live_bookings(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import LiveBooking

    rows = (
        LiveBooking.objects.filter(org_id=scope.org_id)
        .exclude(status=LiveBooking.Status.PENDING_PAYMENT)
        .select_related("course", "deposit_purchase")
        .prefetch_related("people")
        .order_by("-created_at")[:100]
    )
    rows = list(rows)
    from core.tenancy import tenant_context

    from .models import LiveCohort

    with tenant_context(staff=True):  # intakes are platform rows: read their start dates
        starts = dict(
            LiveCohort.objects.filter(pk__in=[b.cohort_id for b in rows if b.cohort_id]).values_list(
                "id", "scheduled_start"
            )
        )
    return [
        {
            "id": str(b.id),
            "course_title": b.course.title,
            "quantity": b.quantity,
            "status": b.status,
            "deposit_months": int(b.terms.get("deposit_months") or 0),
            "deposit_total_minor": b.deposit_purchase.total_minor,
            "intake_starts_on": starts[b.cohort_id].isoformat() if starts.get(b.cohort_id) else None,
            "created_at": b.created_at,
            "people": [
                {"email": p.email, "full_name": p.full_name, "status": p.status} for p in b.people.all()
            ],
            **_renewal(b),
        }
        for b in rows
    ]


def _renewal(b) -> dict:
    from core.tenancy import tenant_context

    from .live_renewals import OPEN_STATUS, paid_until
    from .models import SeatInstalment

    if b.status != "placed":
        return {}
    with tenant_context(staff=True):  # reads the intake start date
        insts = list(
            SeatInstalment.objects.filter(seat_purchase_id=b.deposit_purchase_id).order_by("sequence")
        )
        b.cohort = b.cohort if b.cohort_id else None
        until = paid_until(b, insts)
    due = next((i for i in insts if i.status in OPEN_STATUS), None)
    return {
        "paid_until": until,
        "next_due_minor": due.amount_minor if due else None,
        "next_due_on": due.due_at if due else None,
        "next_due_months": due.covers_months if due else None,
        "instalments_left": sum(1 for i in insts if i.status in OPEN_STATUS),
    }


@router.post("/live/bookings/{booking_id}/pay-next", response=CorporateCheckoutOut)
def live_pay_next(request, booking_id: UUID):
    org_scope(request, OrgRole.ADMIN)
    from .live_renewals import pay_next

    return pay_next(request, booking_id)


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
            "stage_access_enabled": p.stage_access_enabled,
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "created_at": p.created_at.isoformat(),
        }
        for p in qs
    ]


@router.get("/purchases/{purchase_id}/stage-plan", response=CorporateStagePlanOut)
def staged_purchase_summary(request, purchase_id: str):
    scope = org_scope(request, OrgRole.MANAGER)
    from .models import SeatPurchase
    from .stage_instalments import employer_summary

    purchase = get_object_or_404(
        SeatPurchase.objects.select_related("offering"),
        pk=purchase_id,
        org_id=scope.org_id,
        stage_access_enabled=True,
    )
    return employer_summary(purchase)


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
    company_message: str = Field("", max_length=2000)


class TrainingRequestOut(Schema):
    id: str
    course_id: str
    course_title: str = ""
    requested_seats: int
    preferred_intake: str
    preferred_delivery_mode: str
    company_message: str = ""
    admin_reply: str = ""
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
        company_message=body.company_message,
    )
    return {
        "id": str(tr.id),
        "course_id": str(tr.course_id),
        "course_title": tr.course.title,
        "requested_seats": tr.requested_seats,
        "preferred_intake": tr.preferred_intake,
        "preferred_delivery_mode": tr.preferred_delivery_mode,
        "company_message": tr.company_message,
        "admin_reply": tr.admin_reply,
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
            "company_message": r.company_message,
            "admin_reply": r.admin_reply,
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
    included_live_seats_remaining: int | None = None


@router.get("/live-bookings", response=list[LiveBookingOut])
def list_live_bookings(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from django.db.models import Count, Q

    from .live import live_subscription_coverage
    from .models import CohortCompany, CorporateOffering, LiveAttendee

    coverage = live_subscription_coverage(scope.org_id)

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
        booking_coverage = (
            live_subscription_coverage(scope.org_id, booking_created_at=cc.created_at, snapshot=coverage)
            if coverage
            else None
        )
        remaining = booking_coverage["remaining"] if booking_coverage else None
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
                "included_live_seats_remaining": remaining,
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


@router.post("/live-bookings/{cc_id}/accept-included", response=CorporateOkOut)
def accept_included_live_booking(request, cc_id: str):
    scope = org_scope(request, OrgRole.ADMIN)
    from .live import accept_included_live_booking as accept_included

    accept_included(request, org_id=scope.org_id, cohort_company_id=cc_id)
    return {"ok": True}


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


class SeatEmployeeIn(Schema):
    email: str = Field(..., max_length=320)
    full_name: str = Field("", max_length=200)
    job_title: str = Field("", max_length=120)


class SeatRequestIn(Schema):
    offering_id: str
    source: str = "manual"  # manual | csv (the browser reads the CSV file into rows)
    employees: list[SeatEmployeeIn] = Field(..., max_length=500)


class PendingSeatOut(Schema):
    id: str
    offering_id: str
    course_title: str
    email: str
    full_name: str
    job_title: str
    status: str  # awaiting (approval) | pending (invited) | fulfilled | cancelled
    invited_at: str


class SeatRequestOut(Schema):
    id: str
    offering_id: str
    course_title: str
    status: str  # pending_approval | approved | rejected
    source: str
    auto_approved: bool
    submitted_at: str
    submitted_by: str
    reviewed_at: str | None
    review_note: str
    rows: list[PendingSeatOut]


def _pending_out(p) -> dict:
    return {
        "id": str(p.id),
        "offering_id": str(p.seat_purchase.offering_id),
        "course_title": p.seat_purchase.offering.course.title,
        "email": p.email,
        "full_name": p.full_name,
        "job_title": p.job_title,
        "status": p.status,
        "invited_at": p.created_at.isoformat(),
    }


def seat_request_out(req) -> dict:
    rows = req.rows.select_related("seat_purchase__offering__course").order_by("created_at")
    return {
        "id": str(req.id),
        "offering_id": str(req.offering_id),
        "course_title": req.offering.course.title,
        "status": req.status,
        "source": req.source,
        "auto_approved": req.auto_approved,
        "submitted_at": req.created_at.isoformat(),
        "submitted_by": req.submitted_by.full_name or req.submitted_by.email,
        "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
        "review_note": req.review_note,
        "rows": [_pending_out(p) for p in rows],
    }


@router.post("/seat-requests", response=SeatRequestOut)
def submit_seat_request(request, body: SeatRequestIn):
    """Send a list of employees (typed in or from a CSV file) for paid recorded seats.
    Each one holds a seat. When the platform requires approval the request waits for an
    admin; otherwise invites go out now. Owners and admins only."""
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import SeatRequest
    from .pending import submit_request

    req = submit_request(request, scope, body.offering_id, [e.dict() for e in body.employees], body.source)
    req = SeatRequest.objects.select_related("offering__course", "submitted_by").get(pk=req.pk)
    return seat_request_out(req)


@router.get("/seat-requests", response=list[SeatRequestOut])
def list_seat_requests(request, offering_id: str | None = None):
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import SeatRequest

    qs = SeatRequest.objects.filter(org_id=scope.org_id)
    if offering_id:
        qs = qs.filter(offering_id=offering_id)
    qs = qs.select_related("offering__course", "submitted_by").order_by("-created_at")[:50]
    return [seat_request_out(r) for r in qs]


@router.get("/pending-seats", response=list[PendingSeatOut])
def list_pending_seats(request, offering_id: str | None = None):
    """Seats held for listed employees: waiting for approval, or invited and not joined."""
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import PendingSeat
    from .pending import HELD

    qs = PendingSeat.objects.filter(HELD, org_id=scope.org_id)
    if offering_id:
        qs = qs.filter(seat_purchase__offering_id=offering_id)
    qs = qs.select_related("seat_purchase__offering__course").order_by("-created_at")[:500]
    return [_pending_out(p) for p in qs]


@router.post("/pending-seats/{pending_id}/cancel", response=PendingSeatOut)
def cancel_pending_seat(request, pending_id: str):
    """Free a held seat (the person can still be listed again later)."""
    scope = org_scope(request, OrgRole.ADMIN)
    from .models import PendingSeat
    from .pending import cancel_pending

    p = cancel_pending(request, scope, pending_id)
    return _pending_out(PendingSeat.objects.select_related("seat_purchase__offering__course").get(pk=p.pk))


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
    locked: bool = False  # after the months the company has paid for


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
    paid_until: datetime | None = None  # sessions from here wait for the company's next payment


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


# ------------------------------------------------------------------ private live intakes


class PrivateIntakeIn(Schema):
    course_id: UUID
    expected_people: int | None = Field(None, ge=1, le=5000)
    message: str = Field("", max_length=2000)


class PrivateIntakePartOut(Schema):
    months: int
    amount_minor: int


class PrivateIntakeOut(Schema):
    id: str
    course_id: str
    course_title: str
    status: str
    expected_people: int | None = None
    message: str
    admin_reply: str
    price_minor: int
    deposit_minor: int | None = None
    deposit_months: int | None = None
    programme_months: int | None = None
    instalments: list[PrivateIntakePartOut] = []
    starts_on: date | None = None
    booking_status: str | None = None
    created_at: datetime


class PrivateIntakeBookIn(Schema):
    employees: list[CheckoutEmployeeIn] = Field(..., min_length=1, max_length=5000)
    employees_source: str = "manual"


class PrivateIntakeOkOut(Schema):
    ok: bool


@router.get("/live/private-intakes", response=list[PrivateIntakeOut])
def private_intakes(request):
    scope = org_scope(request, OrgRole.MANAGER)
    from .live_private import company_requests

    return company_requests(scope.org_id)


@router.post("/live/private-intakes", response=PrivateIntakeOkOut)
def private_intake_request(request, body: PrivateIntakeIn):
    org_scope(request, OrgRole.ADMIN)
    from .live_private import send_request

    send_request(request, body.course_id, body.expected_people, body.message)
    return {"ok": True}


@router.post("/live/private-intakes/{req_id}/withdraw", response=PrivateIntakeOkOut)
def private_intake_withdraw(request, req_id: UUID):
    org_scope(request, OrgRole.ADMIN)
    from .live_private import cancel_request

    cancel_request(request, req_id)
    return {"ok": True}


@router.post("/live/private-intakes/{req_id}/book", response=CorporateCheckoutOut)
def private_intake_book(request, req_id: UUID, body: PrivateIntakeBookIn):
    org_scope(request, OrgRole.ADMIN)
    from .live_private import book_private

    return book_private(request, req_id, [e.dict() for e in body.employees], body.employees_source)
