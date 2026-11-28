"""Console > Company packages > Private intakes: approve (with a start date) or reject."""

from datetime import date, datetime
from uuid import UUID

from ninja import Field, Schema

from apps.corporate.live_private import approve, console_requests, reject

from .common import ConsoleOkOut, router, staff


class ConsolePrivatePartOut(Schema):
    months: int
    amount_minor: int


class ConsolePrivateIntakeOut(Schema):
    id: str
    course_id: str
    course_title: str
    company: str
    requester_email: str
    status: str
    expected_people: int | None = None
    message: str
    admin_reply: str
    price_minor: int
    deposit_minor: int | None = None
    deposit_months: int | None = None
    programme_months: int | None = None
    instalments: list[ConsolePrivatePartOut] = []
    starts_on: date | None = None
    booking_status: str | None = None
    created_at: datetime


class ConsolePrivateApproveIn(Schema):
    starts_on: date
    reply: str = Field("", max_length=2000)


class ConsolePrivateRejectIn(Schema):
    reply: str = Field("", max_length=2000)


@router.get("/corporate/private-intakes", response=list[ConsolePrivateIntakeOut])
def list_private_intakes(request):
    staff(request)
    return console_requests()


@router.post("/corporate/private-intakes/{req_id}/approve", response=ConsoleOkOut)
def approve_private_intake(request, req_id: UUID, body: ConsolePrivateApproveIn):
    staff(request)
    approve(request, req_id, body.starts_on, body.reply)
    return {"ok": True}


@router.post("/corporate/private-intakes/{req_id}/reject", response=ConsoleOkOut)
def reject_private_intake(request, req_id: UUID, body: ConsolePrivateRejectIn):
    staff(request)
    reject(request, req_id, body.reply)
    return {"ok": True}
