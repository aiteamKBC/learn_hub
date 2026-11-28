"""Live courses: instalments after the deposit, renewal reminders, and access.

* When a booking is placed in an intake, its instalments are scheduled (one SeatInstalment
  per part of the course plan, amount = per-seat amount x seats). Months count from the
  intake start: the deposit covers [start, start + deposit_months), then each paid
  instalment adds its months, in order.
* A week before the paid months run out, the buyer is reminded (in-app + email) and can
  pay the next instalment from Live training (Stripe Checkout).
* Employees see no join link for sessions after the paid months until the next
  instalment is paid.
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import LiveBooking, LiveCohort, SeatInstalment

log = logging.getLogger(__name__)
REMIND_BEFORE = timedelta(days=7)
OPEN_STATUS = (SeatInstalment.Status.PENDING, SeatInstalment.Status.SENT, SeatInstalment.Status.FAILED)


def _months(when: datetime, months: int) -> datetime:
    from .programme import add_months

    return add_months(when, months)


def _start(cohort: LiveCohort | None) -> datetime | None:
    if cohort is None or cohort.scheduled_start is None:
        return None
    return timezone.make_aware(datetime.combine(cohort.scheduled_start, time.min))


def schedule_instalments(booking: LiveBooking) -> None:
    """Called when a booking is placed. Idempotent."""
    start = _start(booking.cohort)
    if start is None or SeatInstalment.objects.filter(seat_purchase_id=booking.deposit_purchase_id).exists():
        return
    covered = int(booking.terms.get("deposit_months") or 0)
    for n, part in enumerate(booking.terms.get("instalments") or [], start=1):
        SeatInstalment.objects.create(
            org_id=booking.org_id,
            seat_purchase_id=booking.deposit_purchase_id,
            sequence=n,
            amount_minor=int(part["amount_minor"]) * (1 if booking.terms.get("whole") else booking.quantity),
            currency="GBP",
            due_at=_months(start, covered),
            covers_months=int(part["months"]),
        )
        covered += int(part["months"])


def paid_until(booking: LiveBooking, instalments: list[SeatInstalment] | None = None) -> datetime | None:
    """End of the months paid so far (None: not placed yet, or everything is paid)."""
    start = _start(booking.cohort)
    if start is None:
        return None
    rows = (
        instalments
        if instalments is not None
        else list(
            SeatInstalment.objects.filter(seat_purchase_id=booking.deposit_purchase_id).order_by("sequence")
        )
    )
    months = int(booking.terms.get("deposit_months") or 0)
    for i in sorted(rows, key=lambda r: r.sequence):
        if i.status != SeatInstalment.Status.PAID:
            return _months(start, months)
        months += i.covers_months
    return None  # fully paid: no end


def next_due(booking: LiveBooking) -> SeatInstalment | None:
    return (
        SeatInstalment.objects.filter(seat_purchase_id=booking.deposit_purchase_id, status__in=OPEN_STATUS)
        .order_by("sequence")
        .first()
    )


# ------------------------------------------------------------------ reminders


def send_due_reminders(now=None) -> int:
    """Remind each buyer once per instalment, a week before their paid months end."""
    from apps.engagement.notify import notify
    from core.tenancy import tenant_context

    now = now or timezone.now()
    sent = 0
    with tenant_context(staff=True):
        for b in LiveBooking.objects.filter(status=LiveBooking.Status.PLACED).select_related(
            "cohort", "course"
        ):
            inst = next_due(b)
            if inst is None or inst.status != SeatInstalment.Status.PENDING:
                continue
            until = paid_until(b)
            if until is None or now < until - REMIND_BEFORE:
                continue
            notify(
                [b.buyer_id],
                "corporate_live_renewal_due",
                {
                    "course": b.course.title,
                    "date": timezone.localtime(until).strftime("%d %B %Y"),
                    "amount": f"£{inst.amount_minor / 100:,.2f}",
                    "seats": b.quantity,
                },
                url="/business/live-bookings",
                dedupe=f"live-renewal-{inst.id}",
            )
            SeatInstalment.objects.filter(pk=inst.pk).update(
                status=SeatInstalment.Status.SENT, updated_at=now
            )
            sent += 1
    return sent


# ------------------------------------------------------------------ paying an instalment


def pay_next(request, booking_id) -> dict:
    org_id = getattr(request, "org_id", None)
    booking = LiveBooking.objects.filter(pk=booking_id, org_id=org_id).select_related("course").first()
    if booking is None:
        raise ServiceError("not_found", "Booking not found.", status=404)
    inst = next_due(booking)
    if inst is None:
        raise ServiceError("nothing_due", "Nothing to pay: every instalment is paid.", status=400)
    from apps.org.models import Organization

    org = Organization.objects.filter(pk=org_id).first()
    qty = 1 if booking.terms.get("whole") else max(1, booking.quantity)
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "gbp",
                    "unit_amount": inst.amount_minor // qty,
                    "product_data": {
                        "name": f"{booking.course.title}: live seats, next {inst.covers_months} months"
                    },
                },
                "quantity": qty,
            }
        ],
        metadata={"kind": "corporate_live_instalment", "id": str(inst.id), "org_id": str(org_id)},
        customer_email=request.user.email,
        customer=(org.stripe_customer_id if org else "") or "",
        success_url=f"{settings.FRONTEND_URL}/business/live-bookings?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/business/live-bookings",
        idempotency_key=f"corp_live_inst_{inst.id}_{inst.updated_at.timestamp():.0f}",
    )
    audit_request(
        request, "live_instalment_checkout", "seat_instalment", inst.id, data={"amount": inst.amount_minor}
    )
    return {"purchase_id": str(inst.id), "checkout_url": session["url"]}


@transaction.atomic
def instalment_paid(session: dict, meta: dict) -> None:
    """Stripe confirmed an instalment (idempotent)."""
    inst = SeatInstalment.objects.select_for_update().filter(pk=meta.get("id")).first()
    if inst is None or inst.status == SeatInstalment.Status.PAID:
        return
    inst.status = SeatInstalment.Status.PAID
    inst.paid_at = timezone.now()
    inst.save(update_fields=["status", "paid_at", "updated_at"])


# ------------------------------------------------------------------ what employees may join


def locks_for(attendee_ids: list) -> dict:
    """attendee id -> paid-until datetime (only where some months are still unpaid)."""
    from .models import LiveBookingPerson

    out: dict = {}
    people = LiveBookingPerson.objects.filter(attendee_id__in=attendee_ids).select_related("booking__cohort")
    for p in people:
        until = paid_until(p.booking)
        if until is not None:
            prev = out.get(p.attendee_id)
            out[p.attendee_id] = until if prev is None else max(prev, until)
    return out
