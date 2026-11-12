"""Console > Company packages: seat inventory, agreements (programme length, payment plan,
instalments, who each instalment covers) and purchase files. Staff only."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from django.db.models import Count, Sum
from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.corporate import files, instalments, programme
from apps.corporate.models import (
    LiveAttendee,
    PurchaseAttachment,
    SeatAllocation,
    SeatPurchase,
)

from .common import ConsoleOkOut, router, staff

SEAT_LIMIT = 500


# ---------------------------------------------------------------- inventory
class ConsoleInventoryGroupOut(Schema):
    offering_id: UUID
    course_title: str
    delivery_type: str
    purchases: int
    purchased: int
    allocated: int
    available: int


class ConsoleInventorySeatOut(Schema):
    id: UUID  # allocation or live attendee
    kind: str  # recorded | live
    purchase_id: UUID | None = None
    offering_id: UUID
    course_title: str
    user_id: UUID
    user_name: str
    user_email: str
    seat_status: str
    allocated_at: datetime
    left_at: datetime | None = None
    programme_months: int | None = None
    programme_start: datetime | None = None
    programme_end: datetime | None = None
    programme_status: str
    payment_plan: str
    entitlement_status: str
    paid_through: datetime | None = None


class ConsoleInventoryOut(Schema):
    groups: list[ConsoleInventoryGroupOut]
    seats: list[ConsoleInventorySeatOut]
    seats_shown: bool  # seats are listed for one company at a time


def _groups(org_id) -> list[dict]:
    paid = SeatPurchase.objects.filter(status__in=["paid", "partial"])
    if org_id:
        paid = paid.filter(org_id=org_id)
    bought = {
        r["offering_id"]: r
        for r in paid.values("offering_id", "offering__course__title", "offering__delivery_type").annotate(
            n=Count("id"), qty=Sum("quantity")
        )
    }
    used = dict(
        SeatAllocation.objects.filter(seat_purchase__in=paid, status__in=programme.LIVE_SEAT)
        .values("seat_purchase__offering_id")
        .annotate(n=Count("id"))
        .values_list("seat_purchase__offering_id", "n")
    )
    live_used = dict(
        LiveAttendee.objects.filter(cohort_company__seat_purchase__in=paid, status="active")
        .values("cohort_company__seat_purchase__offering_id")
        .annotate(n=Count("id"))
        .values_list("cohort_company__seat_purchase__offering_id", "n")
    )
    out = []
    for oid, r in bought.items():
        allocated = used.get(oid, 0) + live_used.get(oid, 0)
        out.append(
            {
                "offering_id": oid,
                "course_title": r["offering__course__title"],
                "delivery_type": r["offering__delivery_type"],
                "purchases": r["n"],
                "purchased": r["qty"] or 0,
                "allocated": allocated,
                "available": max(0, (r["qty"] or 0) - allocated),
            }
        )
    return sorted(out, key=lambda g: g["course_title"].lower())


def _seats(org_id) -> list[dict]:
    from apps.org.models import OrgMember

    rows = []
    allocs = (
        SeatAllocation.objects.filter(org_id=org_id, status__in=programme.LIVE_SEAT)
        .select_related("user", "seat_purchase__offering__course")
        .order_by("-allocated_at")[:SEAT_LIMIT]
    )
    attendees = (
        LiveAttendee.objects.filter(org_id=org_id, status="active")
        .select_related("user", "cohort_company__seat_purchase__offering__course")
        .order_by("-created_at")[:SEAT_LIMIT]
    )
    attendees = [a for a in attendees if a.cohort_company.seat_purchase_id]
    users = {a.user_id for a in allocs} | {a.user_id for a in attendees}
    left = dict(
        OrgMember.objects.filter(org_id=org_id, user_id__in=users)
        .order_by("joined_at")
        .values_list("user_id", "removed_at")
    )
    for a in allocs:
        sp = a.seat_purchase
        rows.append(
            {
                "id": a.id,
                "kind": "recorded",
                "purchase_id": sp.id,
                "offering_id": sp.offering_id,
                "course_title": sp.offering.course.title,
                "user_id": a.user_id,
                "user_name": a.user.full_name or a.user.email,
                "user_email": a.user.email,
                "seat_status": a.status,
                "allocated_at": a.allocated_at,
                "left_at": left.get(a.user_id),
                "payment_plan": sp.payment_plan,
                **programme.programme_dates(a.programme_started_at, sp),
                **{
                    f"entitlement_{k}" if k == "status" else k: v
                    for k, v in programme.entitlement(a, sp, left.get(a.user_id)).items()
                },
            }
        )
    first = {}
    for a in attendees:
        sp = a.cohort_company.seat_purchase
        if a.cohort_id not in first:
            first[a.cohort_id] = programme.live_first_session(a.cohort_id)
        rows.append(
            {
                "id": a.id,
                "kind": "live",
                "purchase_id": sp.id,
                "offering_id": sp.offering_id,
                "course_title": sp.offering.course.title,
                "user_id": a.user_id,
                "user_name": a.user.full_name or a.user.email,
                "user_email": a.user.email,
                "seat_status": "active",
                "allocated_at": a.created_at,
                "left_at": left.get(a.user_id),
                "payment_plan": sp.payment_plan,
                **programme.programme_dates(first[a.cohort_id], sp),
                "entitlement_status": "paid_in_full" if sp.status in ("paid", "partial") else "unpaid",
                "paid_through": None,
            }
        )
    return rows


SEAT_FILTERS = {
    "": lambda r: True,
    "current": lambda r: r["left_at"] is None,
    "left": lambda r: r["left_at"] is not None,
    "expired": lambda r: r["entitlement_status"] in ("expired", "not_covered", "unpaid"),
    "ended": lambda r: r["programme_status"] == "ended",
}


@router.get("/corporate/inventory", response=ConsoleInventoryOut)
def inventory(request, org_id: UUID | None = None, q: str = "", status: str = ""):
    """Seats bought, used and free per programme; with a company chosen, every seat holder."""
    staff(request)
    if status not in SEAT_FILTERS:
        status = ""
    seats = []
    if org_id:
        needle = q.strip().lower()
        seats = [
            r
            for r in _seats(org_id)
            if SEAT_FILTERS[status](r)
            and (not needle or needle in r["user_name"].lower() or needle in r["user_email"].lower())
        ]
    return {"groups": _groups(org_id), "seats": seats, "seats_shown": bool(org_id)}


# ---------------------------------------------------------------- agreement: programme length
class ConsoleProgrammeIn(Schema):
    programme_months: int | None = Field(None, ge=1, le=120)  # None = use the package default


@router.patch("/corporate/purchases/{purchase_id}/programme", response=ConsoleOkOut)
def set_programme(request, purchase_id: UUID, body: ConsoleProgrammeIn):
    staff(request)
    instalments.set_programme_months(request, purchase_id, body.programme_months)
    return {"ok": True}


# ---------------------------------------------------------------- agreement: instalments
class ConsoleInstalmentIn(Schema):
    amount_minor: int = Field(..., ge=1)
    due_at: datetime
    covers_months: int = Field(..., ge=1, le=120)


class ConsoleInstalmentPlanIn(Schema):
    org_id: UUID
    offering_id: UUID
    buyer_id: UUID
    quantity: int = Field(..., ge=1, le=10000)
    unit_price_minor: int = Field(..., ge=1)
    currency: str = Field("GBP", pattern=r"^[A-Za-z]{3}$")
    programme_months: int | None = Field(None, ge=1, le=120)
    schedule: list[ConsoleInstalmentIn]


class ConsoleInstalmentPlanCreatedOut(Schema):
    purchase_id: UUID


class ConsoleInstalmentOut(Schema):
    id: UUID
    sequence: int
    amount_minor: int
    due_at: datetime
    covers_months: int
    status: str  # pending | sent | paid | failed | void | overdue
    paid_at: datetime | None = None
    paid_through: datetime | None = None
    stripe_invoice_id: str
    covered_allocation_ids: list[UUID]


class ConsoleInstalmentSeatOut(Schema):
    allocation_id: UUID
    user_id: UUID
    user_name: str
    user_email: str
    left_at: datetime | None = None
    entitlement_status: str
    entitlement_paid_through: datetime | None = None


class ConsoleInstalmentPlanOut(Schema):
    purchase_id: UUID
    payment_plan: str
    currency: str
    total_minor: int
    paid_minor: int
    outstanding_minor: int
    programme_months: int | None = None
    agreement_months: int | None = None
    instalments: list[ConsoleInstalmentOut]
    seats: list[ConsoleInstalmentSeatOut]


class ConsoleCoverIn(Schema):
    allocation_ids: list[UUID] = Field(..., min_length=1, max_length=SEAT_LIMIT)


class ConsoleCoverOut(Schema):
    added: int
    already_covered: int


@router.post("/corporate/instalment-plans", response=ConsoleInstalmentPlanCreatedOut)
def create_plan(request, body: ConsoleInstalmentPlanIn):
    staff(request)
    sp = instalments.create_instalment_purchase(
        request,
        org_id=body.org_id,
        offering_id=body.offering_id,
        buyer_id=body.buyer_id,
        quantity=body.quantity,
        unit_price_minor=body.unit_price_minor,
        currency=body.currency,
        programme_months=body.programme_months,
        schedule=[s.dict() for s in body.schedule],
    )
    return {"purchase_id": sp.id}


@router.get("/corporate/purchases/{purchase_id}/plan", response=ConsoleInstalmentPlanOut)
def get_plan(request, purchase_id: UUID):
    staff(request)
    sp = get_object_or_404(SeatPurchase.objects.select_related("offering"), pk=purchase_id)
    return instalments.plan_summary(sp)


@router.post("/corporate/instalments/{instalment_id}/send", response=ConsoleOkOut)
def send_instalment(request, instalment_id: UUID):
    staff(request)
    instalments.send_instalment_invoice(request, instalment_id)
    return {"ok": True}


@router.post("/corporate/instalments/{instalment_id}/cover", response=ConsoleCoverOut)
def cover(request, instalment_id: UUID, body: ConsoleCoverIn):
    staff(request)
    return instalments.cover_seats(request, instalment_id, body.allocation_ids)


@router.delete("/corporate/instalments/{instalment_id}/cover/{allocation_id}", response=ConsoleOkOut)
def uncover(request, instalment_id: UUID, allocation_id: UUID):
    staff(request)
    instalments.uncover_seat(request, instalment_id, allocation_id)
    return {"ok": True}


# ---------------------------------------------------------------- purchase files
class ConsoleAttachmentOut(Schema):
    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_by_name: str
    uploaded_by_staff: bool
    uploaded_at: datetime
    can_delete: bool


class ConsoleAttachmentUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., ge=1)


class ConsoleAttachmentUploadOut(Schema):
    attachment_id: UUID
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class ConsoleDownloadOut(Schema):
    url: str


@router.get("/corporate/purchases/{purchase_id}/attachments", response=list[ConsoleAttachmentOut])
def list_attachments(request, purchase_id: UUID):
    staff(request)
    sp = get_object_or_404(SeatPurchase, pk=purchase_id)
    return [files.attachment_out(a, request.auth, is_staff=True) for a in files.listing(sp)]


@router.post("/corporate/purchases/{purchase_id}/attachments", response=ConsoleAttachmentUploadOut)
def start_attachment(request, purchase_id: UUID, body: ConsoleAttachmentUploadIn):
    staff(request)
    sp = get_object_or_404(SeatPurchase, pk=purchase_id)
    return files.start_upload(request, sp, filename=body.filename, size_bytes=body.size_bytes, by_staff=True)


@router.post("/corporate/attachments/{attachment_id}/confirm", response=ConsoleAttachmentOut)
def confirm_attachment(request, attachment_id: UUID):
    staff(request)
    att = files.confirm(request, attachment_id)
    return files.attachment_out(att, request.auth, is_staff=True)


@router.get("/corporate/attachments/{attachment_id}/download", response=ConsoleDownloadOut)
def download_attachment(request, attachment_id: UUID):
    staff(request)
    return {"url": files.download_url(get_object_or_404(PurchaseAttachment, pk=attachment_id))}


@router.delete("/corporate/attachments/{attachment_id}", response=ConsoleOkOut)
def delete_attachment(request, attachment_id: UUID):
    staff(request)
    files.delete(request, get_object_or_404(PurchaseAttachment, pk=attachment_id), is_staff=True)
    return {"ok": True}
