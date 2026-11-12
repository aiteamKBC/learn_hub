"""Company seats: programme duration, paid entitlement and content access, kept apart.

Five separate things, five separate sources (never one field for all):
  * employment      OrgMember.removed_at                (departure)
  * seat            SeatAllocation.status               (allocated / active / released)
  * programme       SeatAllocation.programme_started_at + agreed months (completion only)
  * entitlement     full payment, or the paid instalments that cover this seat
  * content access  Enrollment.access_expires_at        (learning enforces it)

1. Programme duration (completion date only). Agreed per company purchase
   (SeatPurchase.programme_months; the package's access_months is only the default).
   Recorded: from the first lesson opened. Live: from the cohort's first scheduled
   session. When it ends the programme shows as ended and new live sessions can no
   longer be joined. It never locks lessons or recordings.

2. Paid entitlement -> content access.
   * Paid in full: no end date.
   * Instalments: staff choose which seats each instalment pays for
     (InstalmentCover). Each paid instalment gives its covered seats access from the
     moment the company's payment succeeded (SeatInstalment.paid_at, never backdated)
     for that instalment's own covers_months. A seat's access ends at the latest such
     date. Once every instalment of the plan is paid for a seat there is no end date,
     as with full payment. Pending or failed instalments give nothing.
   * Times are UTC. Access is allowed up to and including the end instant and refused
     after it (learning: refused when access_expires_at < now).

3. Departure: someone who left keeps what was paid while they were a member. Payments
   made after they left never extend them, and staff cannot choose them for a new
   instalment. Nothing is revoked, refunded or moved.

Legacy purchases (no programme length, payment_plan "full") keep exactly the access they
had: nothing here backfills or invents dates.
"""

from __future__ import annotations

from datetime import datetime

from django.db import connection
from django.utils import timezone

from .models import InstalmentCover, SeatAllocation, SeatInstalment, SeatPurchase

LIVE_SEAT = ("allocated", "active")


def add_months(when: datetime, months: int) -> datetime:
    """Calendar months, same arithmetic as Postgres (31 Jan + 1 month = 28/29 Feb)."""
    with connection.cursor() as cur:
        cur.execute("SELECT %s::timestamptz + make_interval(months => %s)", [when, months])
        return cur.fetchone()[0]


# ---------------------------------------------------------------- 1. programme duration
def agreed_months(sp: SeatPurchase) -> int | None:
    """This company's agreed programme length; the package default when not set."""
    return sp.programme_months or sp.offering.access_months or None


def programme_dates(start: datetime | None, sp: SeatPurchase) -> dict:
    months = agreed_months(sp)
    end = add_months(start, months) if start and months else None
    if start is None:
        status = "not_started"
    elif end is None:
        status = "in_progress"  # no agreed length: it never ends by date
    else:
        status = "ended" if end <= timezone.now() else "in_progress"
    return {
        "programme_months": months,
        "programme_start": start,
        "programme_end": end,
        "programme_status": status,
    }


def programme_end(alloc: SeatAllocation, sp: SeatPurchase) -> datetime | None:
    """Completion date of a recorded programme. Shown only; it never limits access."""
    return programme_dates(alloc.programme_started_at, sp)["programme_end"]


def live_first_session(cohort_id) -> datetime | None:
    from .models import Session

    return (
        Session.objects.filter(cohort_id=cohort_id)
        .exclude(status="cancelled")
        .order_by("scheduled_at")
        .values_list("scheduled_at", flat=True)
        .first()
    )


def on_lesson_opened(enrollment) -> None:
    """Called by learning when someone opens a lesson: the first one starts the programme.

    Company seat enrolments carry the allocation id in source_ref. One conditional
    UPDATE, set once, so later lessons change nothing.
    """
    if enrollment.source != "organization" or enrollment.source_ref is None:
        return
    now = timezone.now()
    SeatAllocation.objects.filter(
        pk=enrollment.source_ref, programme_started_at__isnull=True, status__in=LIVE_SEAT
    ).update(programme_started_at=now, updated_at=now)


# ---------------------------------------------------------------- 2. paid entitlement
def _left_at(alloc: SeatAllocation) -> datetime | None:
    """When the person left this company, or None while they are still a member."""
    from apps.org.models import OrgMember

    m = OrgMember.objects.filter(org_id=alloc.org_id, user_id=alloc.user_id).order_by("-joined_at").first()
    return m.removed_at if m else None


def entitlement(alloc: SeatAllocation, sp: SeatPurchase, left_at: datetime | None = None) -> dict:
    """What this seat has paid for. status: paid_in_full | active | expired | not_covered | unpaid.

    paid_through is the end of paid access (None = no end date or nothing paid).
    left_at limits instalments to those paid while the person was still a member.
    """
    if sp.payment_plan != SeatPurchase.PaymentPlan.INSTALMENTS:
        paid = sp.status in (SeatPurchase.Status.PAID, SeatPurchase.Status.PARTIAL)
        return {"status": "paid_in_full" if paid else "unpaid", "paid_through": None}
    plan = list(SeatInstalment.objects.filter(seat_purchase=sp).exclude(status=SeatInstalment.Status.VOID))
    covered = set(InstalmentCover.objects.filter(allocation=alloc).values_list("instalment_id", flat=True))
    paid = [
        i
        for i in plan
        if i.id in covered
        and i.status == SeatInstalment.Status.PAID
        and (left_at is None or i.paid_at <= left_at)
    ]
    if plan and len(paid) == len(plan):
        return {"status": "paid_in_full", "paid_through": None}
    if not paid:
        return {"status": "not_covered", "paid_through": None}
    end = max(add_months(i.paid_at, i.covers_months) for i in paid)
    return {"status": "active" if end >= timezone.now() else "expired", "paid_through": end}


def seat_entitlement(alloc: SeatAllocation, sp: SeatPurchase) -> dict:
    return entitlement(alloc, sp, left_at=_left_at(alloc))


def apply_paid_access(alloc: SeatAllocation, sp: SeatPurchase) -> None:
    """Write the paid end date to this seat's own enrolment (never a personal one).

    Full payment is left alone (no end date). For instalments: covered -> the paid end
    date; fully paid -> no end date; not covered by any paid instalment -> closed now.
    """
    from apps.learning.models import Enrollment

    if not alloc.enrollment_id or sp.payment_plan != SeatPurchase.PaymentPlan.INSTALMENTS:
        return
    ent = seat_entitlement(alloc, sp)
    if ent["status"] == "paid_in_full":
        end = None
    elif ent["paid_through"] is not None:
        end = ent["paid_through"]
    else:
        end = timezone.now()  # nothing paid for this seat: no access (never NULL = lifetime)
    Enrollment.objects.filter(pk=alloc.enrollment_id, source="organization", source_ref=alloc.id).update(
        access_expires_at=end
    )


def extend_for_payment(inst: SeatInstalment, sp: SeatPurchase) -> int:
    """After an instalment is paid: update only the seats staff chose for it."""
    allocs = SeatAllocation.objects.filter(
        pk__in=InstalmentCover.objects.filter(instalment=inst).values("allocation_id"), status__in=LIVE_SEAT
    )
    n = 0
    for alloc in allocs:
        apply_paid_access(alloc, sp)  # a leaver's cut-off is applied inside
        n += 1
    return n


# ---------------------------------------------------------------- the employee's own view
def _purchases_for(user_id, org_id, purchase_ids) -> dict:
    """Read this person's own company purchases with that company's RLS key.

    seat_purchases are company-only rows; the learner's request has no company set
    (they may belong to several). Rows are filtered to ids reached from the user's own
    enrolments and attendee records, so nothing else in the company is read.
    """
    from core.tenancy import tenant_context

    with tenant_context(org_id=org_id, user_id=user_id):
        return {
            sp.id: sp for sp in SeatPurchase.objects.filter(pk__in=purchase_ids).select_related("offering")
        }


def live_programme(user_id, attendee, first_session) -> dict:
    """Programme dates for one live attendee (duration from the cohort's first session)."""
    from core.tenancy import tenant_context

    with tenant_context(org_id=attendee.org_id, user_id=user_id):
        sp_id = (
            type(attendee.cohort_company)
            .objects.filter(pk=attendee.cohort_company_id)
            .values_list("seat_purchase_id", flat=True)
            .first()
        )
    if not sp_id:  # booked before payment was linked: no agreed length to apply
        return {
            "programme_months": None,
            "programme_start": first_session,
            "programme_end": None,
            "programme_status": "not_started" if first_session is None else "in_progress",
        }
    sp = _purchases_for(user_id, attendee.org_id, [sp_id])[sp_id]
    return programme_dates(first_session, sp)


def my_recorded_programmes(user_id) -> list[dict]:
    """The signed-in person's company-paid recorded courses, with programme and access."""
    from apps.learning.models import Enrollment
    from core.tenancy import tenant_context

    enrolments = list(
        Enrollment.objects.filter(user_id=user_id, source="organization", source_ref__isnull=False)
        .exclude(org_id=None)
        .select_related("course")
    )
    by_org: dict = {}
    for e in enrolments:
        by_org.setdefault(e.org_id, []).append(e)
    out = []
    for org_id, rows in by_org.items():
        with tenant_context(org_id=org_id, user_id=user_id):
            allocs = {
                a.id: a
                for a in SeatAllocation.objects.filter(
                    pk__in=[e.source_ref for e in rows], user_id=user_id
                ).select_related("seat_purchase__offering", "org")
            }
            for e in rows:
                a = allocs.get(e.source_ref)
                if a is None:
                    continue  # a library assignment, not a paid seat
                sp = a.seat_purchase
                ent = entitlement(a, sp, left_at=_left_at(a))
                out.append(
                    {
                        "enrollment_id": e.id,
                        "course_title": e.course.title,
                        "course_slug": e.course.slug,
                        "company_name": a.org.name,
                        "seat_status": a.status,
                        "enrollment_status": e.status,
                        "access_expires_at": e.access_expires_at,
                        "access_open": e.status in ("active", "completed")
                        and (e.access_expires_at is None or e.access_expires_at >= timezone.now()),
                        "entitlement_status": ent["status"],
                        **programme_dates(a.programme_started_at, sp),
                    }
                )
    return out
