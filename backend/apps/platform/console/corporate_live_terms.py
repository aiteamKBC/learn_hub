"""Console > Company packages > Live payment plans: per live course, its length, the
deposit (first months), the instalments after it and the private-intake price."""

from datetime import date
from uuid import UUID

from ninja import Field, Schema

from apps.corporate.live_terms import live_courses_with_terms, save_terms

from .common import ConsoleOkOut, router, staff


class LiveTermsPartIn(Schema):
    months: int = Field(..., ge=1, le=60)
    amount_minor: int = Field(..., ge=1, le=100_000_000)


class LiveTermsIn(Schema):
    programme_months: int = Field(..., ge=1, le=60)
    deposit_months: int = Field(..., ge=1, le=60)
    deposit_minor: int = Field(..., ge=1, le=100_000_000)
    instalments: list[LiveTermsPartIn] = Field(default_factory=list, max_length=24)
    private_price_minor: int | None = Field(None, ge=1, le=1_000_000_000)


class LiveTermsPartOut(Schema):
    months: int
    amount_minor: int


class LiveIntakeOut(Schema):
    id: str
    title: str
    starts_on: date | None = None


class LiveTermsOut(Schema):
    course_id: str
    title: str
    has_terms: bool
    programme_months: int | None = None
    deposit_months: int | None = None
    deposit_minor: int | None = None
    instalments: list[LiveTermsPartOut] = []
    seat_price_minor: int | None = None
    private_price_minor: int | None = None
    intakes: list[LiveIntakeOut] = []


@router.get("/corporate/live-terms", response=list[LiveTermsOut])
def list_live_terms(request):
    staff(request)
    return live_courses_with_terms()


@router.put("/corporate/live-terms/{course_id}", response=ConsoleOkOut)
def put_live_terms(request, course_id: UUID, body: LiveTermsIn):
    staff(request)
    save_terms(request, course_id, body.dict())
    return {"ok": True}


class LiveRemindersOut(Schema):
    sent: int


@router.post("/corporate/live-reminders", response=LiveRemindersOut)
def send_live_reminders(request):
    """Run the daily renewal reminders now (also handy when Celery beat is not running)."""
    staff(request)
    from apps.corporate.live_renewals import send_due_reminders

    return {"sent": send_due_reminders()}
