"""Console > Corporate Packages: offerings, seat inventory, allocations."""

from datetime import datetime
from uuid import UUID

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.corporate.models import (
    CorporateOffering,
    CorporateQuote,
    QuoteItem,
    SeatAllocation,
    SeatPurchase,
)
from apps.corporate.services import allocate_seat, reassign_seat, release_seat

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, clamp, router, staff

# ---- Schemas ----


class ConsoleOfferingIn(Schema):
    course_id: UUID
    delivery_type: str = Field(..., pattern=r"^(recorded|live)$")
    price_tier_id: UUID
    is_active: bool = True
    custom_quote_enabled: bool = False
    description: str = ""
    access_months: int | None = Field(None, ge=1, le=120)  # programme length; empty = no end date


class ConsoleOfferingPatch(Schema):
    price_tier_id: UUID | None = None
    is_active: bool | None = None
    custom_quote_enabled: bool | None = None
    description: str | None = None
    access_months: int | None = Field(None, ge=0, le=120)  # 0 = no end date


class ConsoleOfferingOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    delivery_type: str
    price_tier_id: UUID
    tier_name: str
    gbp_minor: int
    is_active: bool
    custom_quote_enabled: bool
    description: str
    access_months: int | None = None
    created_at: datetime


class ConsoleSeatPurchaseOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    offering_id: UUID
    course_title: str
    delivery_type: str
    buyer_email: str
    quantity: int
    allocated: int
    available: int
    unit_price_minor: int
    currency: str
    total_minor: int
    status: str
    paid_at: datetime | None
    created_at: datetime
    payment_plan: str
    agreement_months: int | None = None  # this company's agreed programme length
    programme_months: int | None = None  # in force: the agreement, else the package default


class ConsoleSeatAllocationOut(Schema):
    id: UUID
    seat_purchase_id: UUID
    user_id: UUID
    user_email: str
    user_name: str
    status: str
    allocated_at: datetime
    activated_at: datetime | None
    released_at: datetime | None
    enrollment_id: UUID | None


class ConsoleAllocateIn(Schema):
    seat_purchase_id: UUID
    user_id: UUID


class ConsoleReassignIn(Schema):
    new_user_id: UUID
    reason: str = Field("", max_length=500)


class ConsoleReleaseIn(Schema):
    reason: str = Field("", max_length=500)


class ConsoleQuoteItemIn(Schema):
    offering_id: UUID
    quantity: int = Field(..., ge=1)
    unit_price_minor: int = Field(..., ge=0)


class ConsoleQuoteIn(Schema):
    org_id: UUID
    buyer_id: UUID
    currency: str = Field("GBP", max_length=3)
    valid_until: datetime
    notes: str = ""
    items: list[ConsoleQuoteItemIn] = Field(..., min_length=1)


class ConsoleQuoteItemOut(Schema):
    id: UUID
    offering_id: UUID
    course_title: str
    delivery_type: str
    quantity: int
    unit_price_minor: int
    line_total_minor: int


class ConsoleQuoteOut(Schema):
    id: UUID
    org_id: UUID
    org_name: str
    buyer_email: str
    status: str
    currency: str
    total_minor: int
    valid_until: datetime
    stripe_invoice_id: str
    stripe_invoice_url: str
    notes: str
    created_at: datetime
    items: list[ConsoleQuoteItemOut] = []


# ---- Offerings CRUD ----


@router.get("/corporate/offerings", response=list[ConsoleOfferingOut])
def list_offerings(request, active_only: bool = False, limit: int = 50, offset: int = 0):
    staff(request)
    qs = CorporateOffering.objects.select_related("course", "price_tier").order_by("-created_at")
    if active_only:
        qs = qs.filter(is_active=True)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": o.id,
            "course_id": o.course_id,
            "course_title": o.course.title,
            "delivery_type": o.delivery_type,
            "price_tier_id": o.price_tier_id,
            "tier_name": o.price_tier.name,
            "gbp_minor": o.price_tier.gbp_minor,
            "is_active": o.is_active,
            "custom_quote_enabled": o.custom_quote_enabled,
            "description": o.description,
            "access_months": o.access_months,
            "created_at": o.created_at,
        }
        for o in items
    ]


def _check_price(tier):
    """Recorded and live are priced separately by the admin; a free tier is not a price."""
    if tier.gbp_minor <= 0:
        from core.errors import ServiceError

        raise ServiceError("price_required", "Choose a price above zero for this option.", status=400)


def _check_single_active(course_id, delivery_type):
    """One live and one recorded option per course at a time."""
    if CorporateOffering.objects.filter(
        course_id=course_id, delivery_type=delivery_type, is_active=True
    ).exists():
        from core.errors import ServiceError

        kind = "live" if delivery_type == "live" else "recorded"
        raise ServiceError(
            "offering_exists",
            f"This course already has an active {kind} option. Edit that one instead.",
            status=400,
        )


@router.post("/corporate/offerings", response=ConsoleIdOut)
def create_offering(request, body: ConsoleOfferingIn):
    staff(request)
    from apps.catalog.models import Course
    from apps.commerce.models import PriceTier

    course = get_object_or_404(Course, pk=body.course_id)
    tier = get_object_or_404(PriceTier, pk=body.price_tier_id)
    _check_price(tier)
    if body.is_active:
        _check_single_active(course.id, body.delivery_type)
    offering = CorporateOffering.objects.create(
        course=course,
        delivery_type=body.delivery_type,
        price_tier=tier,
        is_active=body.is_active,
        custom_quote_enabled=body.custom_quote_enabled,
        description=body.description,
        access_months=body.access_months,
    )
    audit_request(
        request,
        "offering_created",
        "corporate_offering",
        offering.id,
        {
            "course_id": str(course.id),
            "delivery_type": body.delivery_type,
        },
    )
    return {"id": offering.id}


@router.patch("/corporate/offerings/{offering_id}", response=ConsoleOkOut)
def update_offering(request, offering_id: UUID, body: ConsoleOfferingPatch):
    staff(request)
    offering = get_object_or_404(CorporateOffering, pk=offering_id)
    changes = {}
    if body.price_tier_id is not None:
        from apps.commerce.models import PriceTier

        tier = get_object_or_404(PriceTier, pk=body.price_tier_id)
        _check_price(tier)
        offering.price_tier = tier
        changes["price_tier_id"] = str(tier.id)
    if body.is_active is not None:
        if body.is_active and not offering.is_active:
            _check_single_active(offering.course_id, offering.delivery_type)
        offering.is_active = body.is_active
        changes["is_active"] = body.is_active
    if body.custom_quote_enabled is not None:
        offering.custom_quote_enabled = body.custom_quote_enabled
        changes["custom_quote_enabled"] = body.custom_quote_enabled
    if body.description is not None:
        offering.description = body.description
    if body.access_months is not None:  # used the next time an end date is worked out; stored dates stay
        offering.access_months = body.access_months or None
        changes["access_months"] = offering.access_months
    offering.save()
    audit_request(request, "offering_updated", "corporate_offering", offering.id, changes)
    return {"ok": True}


# ---- Seat Purchases ----


@router.get("/corporate/purchases", response=list[ConsoleSeatPurchaseOut])
def list_purchases(
    request, org_id: UUID | None = None, status: str | None = None, limit: int = 50, offset: int = 0
):
    staff(request)
    qs = (
        SeatPurchase.objects.select_related("org", "offering__course", "buyer")
        .annotate(
            allocated_count=Count(
                "allocations",
                filter=Q(allocations__status__in=["allocated", "active"]),
            )
        )
        .order_by("-created_at")
    )
    if org_id:
        qs = qs.filter(org_id=org_id)
    if status:
        qs = qs.filter(status=status)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": p.id,
            "org_id": p.org_id,
            "org_name": p.org.name,
            "offering_id": p.offering_id,
            "course_title": p.offering.course.title,
            "delivery_type": p.offering.delivery_type,
            "buyer_email": p.buyer.email,
            "quantity": p.quantity,
            "allocated": p.allocated_count,
            "available": max(0, p.quantity - p.allocated_count),
            "unit_price_minor": p.unit_price_minor,
            "currency": p.currency,
            "total_minor": p.total_minor,
            "status": p.status,
            "paid_at": p.paid_at,
            "created_at": p.created_at,
            "payment_plan": p.payment_plan,
            "agreement_months": p.programme_months,
            "programme_months": p.programme_months or p.offering.access_months,
        }
        for p in items
    ]


# ---- Seat Allocations ----


@router.get("/corporate/allocations", response=list[ConsoleSeatAllocationOut])
def list_allocations(
    request,
    purchase_id: UUID | None = None,
    org_id: UUID | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    staff(request)
    qs = SeatAllocation.objects.select_related("user").order_by("-allocated_at")
    if purchase_id:
        qs = qs.filter(seat_purchase_id=purchase_id)
    if org_id:
        qs = qs.filter(org_id=org_id)
    if status:
        qs = qs.filter(status=status)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": a.id,
            "seat_purchase_id": a.seat_purchase_id,
            "user_id": a.user_id,
            "user_email": a.user.email,
            "user_name": getattr(a.user, "full_name", a.user.email),
            "status": a.status,
            "allocated_at": a.allocated_at,
            "activated_at": a.activated_at,
            "released_at": a.released_at,
            "enrollment_id": a.enrollment_id,
        }
        for a in items
    ]


@router.post("/corporate/allocations", response=ConsoleIdOut)
def create_allocation(request, body: ConsoleAllocateIn):
    staff(request)
    alloc = allocate_seat(request, body.seat_purchase_id, body.user_id)
    return {"id": alloc.id}


@router.post("/corporate/allocations/{allocation_id}/release", response=ConsoleOkOut)
def release_allocation(request, allocation_id: UUID, body: ConsoleReleaseIn):
    staff(request)
    release_seat(request, allocation_id, reason=body.reason)
    return {"ok": True}


@router.post("/corporate/allocations/{allocation_id}/reassign", response=ConsoleIdOut)
def reassign_allocation(request, allocation_id: UUID, body: ConsoleReassignIn):
    staff(request)
    new_alloc = reassign_seat(request, allocation_id, body.new_user_id, reason=body.reason)
    return {"id": new_alloc.id}


# Inventory: see corporate_agreements.py (GET /corporate/inventory).


# ---- Quotes ----


def _quote_out(q, items=None):
    if items is None:
        items = list(QuoteItem.objects.filter(quote=q).select_related("offering__course"))
    return {
        "id": q.id,
        "org_id": q.org_id,
        "org_name": q.org.name,
        "buyer_email": q.buyer.email,
        "status": q.status,
        "currency": q.currency,
        "total_minor": q.total_minor,
        "valid_until": q.valid_until,
        "stripe_invoice_id": q.stripe_invoice_id,
        "stripe_invoice_url": q.stripe_invoice_url,
        "notes": q.notes,
        "created_at": q.created_at,
        "items": [
            {
                "id": i.id,
                "offering_id": i.offering_id,
                "course_title": i.offering.course.title,
                "delivery_type": i.offering.delivery_type,
                "quantity": i.quantity,
                "unit_price_minor": i.unit_price_minor,
                "line_total_minor": i.line_total_minor,
            }
            for i in items
        ],
    }


@router.get("/corporate/quotes", response=list[ConsoleQuoteOut])
def list_quotes(
    request, org_id: UUID | None = None, status: str | None = None, limit: int = 50, offset: int = 0
):
    staff(request)
    qs = CorporateQuote.objects.select_related("org", "buyer").order_by("-created_at")
    if org_id:
        qs = qs.filter(org_id=org_id)
    if status:
        qs = qs.filter(status=status)
    quotes = list(qs[offset : offset + clamp(limit)])
    quote_ids = [q.id for q in quotes]
    items_by_quote = {}
    for item in QuoteItem.objects.filter(quote_id__in=quote_ids).select_related("offering__course"):
        items_by_quote.setdefault(item.quote_id, []).append(item)
    return [_quote_out(q, items_by_quote.get(q.id, [])) for q in quotes]


@router.post("/corporate/quotes", response=ConsoleQuoteOut)
def create_quote(request, body: ConsoleQuoteIn):
    staff(request)
    from django.db import transaction

    from apps.identity.models import User
    from apps.org.models import Organization

    org = get_object_or_404(Organization, pk=body.org_id)
    buyer = get_object_or_404(User, pk=body.buyer_id)
    with transaction.atomic():
        total = sum(i.unit_price_minor * i.quantity for i in body.items)
        quote = CorporateQuote.objects.create(
            org=org,
            buyer=buyer,
            currency=body.currency,
            total_minor=total,
            valid_until=body.valid_until,
            notes=body.notes,
            created_by_staff=request.auth,
        )
        items = []
        for item_in in body.items:
            offering = get_object_or_404(CorporateOffering, pk=item_in.offering_id)
            qi = QuoteItem.objects.create(
                org=org,
                quote=quote,
                offering=offering,
                quantity=item_in.quantity,
                unit_price_minor=item_in.unit_price_minor,
                line_total_minor=item_in.unit_price_minor * item_in.quantity,
            )
            items.append(qi)
    audit_request(
        request,
        "quote_created",
        "corporate_quote",
        quote.id,
        {
            "org_id": str(org.id),
            "total": total,
        },
    )
    for i in items:
        i.offering = CorporateOffering.objects.select_related("course").get(pk=i.offering_id)
    return _quote_out(quote, items)


@router.post("/corporate/quotes/{quote_id}/send", response=ConsoleQuoteOut)
def send_quote(request, quote_id: UUID):
    staff(request)
    from apps.corporate.quotes import send_quote as _send_quote

    quote = _send_quote(request, quote_id)
    quote = CorporateQuote.objects.select_related("org", "buyer").get(pk=quote.id)
    return _quote_out(quote)


@router.post("/corporate/quotes/{quote_id}/void", response=ConsoleOkOut)
def void_quote(request, quote_id: UUID):
    staff(request)
    from apps.corporate.quotes import void_quote as _void_quote

    _void_quote(request, quote_id)
    return {"ok": True}
