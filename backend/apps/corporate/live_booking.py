"""Live courses, option 1: book seats in the next intake and pay a deposit.

1. The company admin picks a number of seats and names one employee per seat (typed or
   CSV). They pay the deposit on Stripe: deposit per seat x seats (LiveCourseTerms).
2. Paid: every employee is invited (one email each; people already in the company need
   no invite). The booking is placed in the next public intake that has not started.
   If there is none yet it waits, and is placed when the admin creates one.
3. Someone attends (LiveAttendee) once they have joined the company AND the booking is
   placed. The rest of the price is paid in instalments (renewals, stage 3).
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.commerce import gateway
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.permissions import ROLE_RANK, OrgRole

from .models import (
    CohortCompany,
    CorporateOffering,
    LiveAttendee,
    LiveBooking,
    LiveBookingPerson,
    LiveCohort,
    LiveCourseTerms,
    SeatPurchase,
)

log = logging.getLogger(__name__)
OPEN = (LiveCohort.Status.FORMING, LiveCohort.Status.CONFIRMED)


def _live_offering(course_id):
    return (
        CorporateOffering.objects.filter(
            course_id=course_id, delivery_type=CorporateOffering.DeliveryType.LIVE, is_active=True
        )
        .select_related("course")
        .first()
    )


def next_intake(course_id) -> LiveCohort | None:
    """The next public intake of the course that has not started yet."""
    today = timezone.localdate()
    qs = LiveCohort.objects.filter(course_id=course_id, status__in=OPEN, scheduled_start__gt=today)
    if hasattr(LiveCohort, "private_org"):
        qs = qs.filter(private_org__isnull=True)
    return qs.order_by("scheduled_start", "created_at").first()


def terms_snapshot(t: LiveCourseTerms) -> dict:
    return {
        "programme_months": t.programme_months,
        "deposit_months": t.deposit_months,
        "deposit_minor": t.deposit_minor,
        "instalments": t.instalments,
        "seat_price_minor": t.seat_price_minor,
    }


def course_live_offer(course_id) -> dict:
    """What a company sees before booking: the plan per seat and the next intake."""
    offer = _live_offering(course_id)
    terms = LiveCourseTerms.objects.filter(course_id=course_id).first()
    if offer is None or terms is None:
        raise ServiceError("not_bookable", "Live booking is not open for this course yet.", status=404)
    from core.tenancy import tenant_context

    with tenant_context(staff=True):  # intakes are platform rows; only the date is shown
        nxt = next_intake(course_id)
    return {
        "course_id": str(course_id),
        "course_title": offer.course.title,
        **terms_snapshot(terms),
        "private_price_minor": terms.private_price_minor,
        "next_intake_starts_on": nxt.scheduled_start if nxt else None,
        "next_intake_title": (nxt.title or nxt.intake) if nxt else "",
    }


def create_live_booking(
    request, course_id, quantity: int, employees: list[dict], source="manual", plan: dict | None = None
) -> dict:
    from apps.org.models import Organization, OrgMember

    from .pending import _clean_rows

    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)
    member = OrgMember.objects.filter(org_id=org_id, user_id=request.user.id, removed_at__isnull=True).first()
    if member is None or ROLE_RANK.get(OrgRole(member.role), -1) < ROLE_RANK[OrgRole.ADMIN]:
        raise ServiceError("forbidden", "Only company admins or owners may book.", status=403)
    if not 1 <= quantity <= (5000 if plan else 500):
        raise ServiceError("bad_quantity", "Book between 1 and 500 seats.", status=400)
    offer = _live_offering(course_id)
    terms = LiveCourseTerms.objects.filter(course_id=course_id).first()
    if offer is None or terms is None:
        raise ServiceError("not_bookable", "Live booking is not open for this course yet.", status=404)
    rows = _clean_rows(employees)
    if len(rows) != quantity:
        raise ServiceError(
            "employees_required",
            f"Add an email for every seat before paying ({len(rows)} of {quantity}).",
            status=400,
        )

    snapshot = plan or terms_snapshot(terms)
    whole = bool(snapshot.get("whole"))  # private intake: one price for the company
    deposit = snapshot["deposit_minor"]
    total = deposit if whole else deposit * quantity
    with transaction.atomic():
        purchase = SeatPurchase.objects.create(
            org_id=org_id,
            offering=offer,
            buyer=request.user,
            quantity=quantity,
            unit_price_minor=deposit if not whole else total // quantity,
            currency="GBP",
            total_minor=total,
            gbp_total_minor=total,
            status=SeatPurchase.Status.PENDING,
            payment_plan=SeatPurchase.PaymentPlan.INSTALMENTS,
            programme_months=terms.programme_months,
            notes=f"Live deposit: first {terms.deposit_months} months",
        )
        booking = LiveBooking.objects.create(
            org_id=org_id,
            course_id=course_id,
            buyer=request.user,
            quantity=quantity,
            terms=snapshot,
            deposit_purchase=purchase,
        )
        LiveBookingPerson.objects.bulk_create(
            [
                LiveBookingPerson(
                    org_id=org_id,
                    booking=booking,
                    email=r["email"],
                    full_name=r["full_name"],
                    job_title=r["job_title"],
                )
                for r in rows
            ]
        )

    org = Organization.objects.filter(pk=org_id).first()
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "gbp",
                    "unit_amount": deposit,
                    "product_data": {
                        "name": f"{offer.course.title}: "
                        + ("private intake" if whole else "live seat")
                        + f" deposit (first {terms.deposit_months} months)"
                    },
                },
                "quantity": 1 if whole else quantity,
            }
        ],
        metadata={"kind": "corporate_live_deposit", "id": str(booking.id), "org_id": str(org_id)},
        customer_email=request.user.email,
        customer=(org.stripe_customer_id if org else "") or "",
        success_url=f"{settings.FRONTEND_URL}/business/live-bookings?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/business/packages",
        idempotency_key=f"corp_live_deposit_{booking.id}",
    )
    SeatPurchase.objects.filter(pk=purchase.pk).update(
        stripe_session_id=session["id"], updated_at=timezone.now()
    )
    audit_request(
        request,
        "live_booking_started",
        "live_booking",
        booking.id,
        data={
            "course_id": str(course_id),
            "seats": quantity,
            "deposit": total,
            "private": whole,
            "source": source,
        },
    )
    return {"purchase_id": str(booking.id), "checkout_url": session["url"]}


# ------------------------------------------------------------------ after payment


@transaction.atomic
def fulfil_deposit(session: dict, meta: dict) -> None:
    """Stripe confirmed the deposit (idempotent: a replay changes nothing)."""
    booking = LiveBooking.objects.select_for_update().filter(pk=meta.get("id")).first()
    if booking is None or booking.status != LiveBooking.Status.PENDING_PAYMENT:
        return
    SeatPurchase.objects.filter(pk=booking.deposit_purchase_id).update(
        status=SeatPurchase.Status.PAID,
        payment_intent=session.get("payment_intent") or "",
        paid_at=timezone.now(),
        updated_at=timezone.now(),
    )
    booking.status = LiveBooking.Status.WAITING_INTAKE
    booking.save(update_fields=["status", "updated_at"])
    _invite_people(booking)
    place_booking(booking)
    from .live_private import mark_booked

    mark_booked(booking)


def _invite_people(booking: LiveBooking) -> None:
    from apps.org import services as org_services
    from apps.org.models import Invite, Organization, OrgMember
    from apps.org.tasks import send_seat_invite_task

    org_name = Organization.objects.filter(pk=booking.org_id).values_list("name", flat=True).first()
    inviter = booking.buyer.full_name or booking.buyer.email
    course = f"{booking.course.title} (live)"
    for p in LiveBookingPerson.objects.filter(booking=booking, status=LiveBookingPerson.Status.NAMED):
        member = OrgMember.objects.filter(
            org_id=booking.org_id, user__email__iexact=p.email, removed_at__isnull=True
        ).first()
        if member is not None:
            LiveBookingPerson.objects.filter(pk=p.pk).update(
                status=LiveBookingPerson.Status.JOINED, user_id=member.user_id
            )
            continue
        pending = Invite.objects.filter(
            org_id=booking.org_id, email__iexact=p.email, accepted_at__isnull=True, revoked_at__isnull=True
        ).exists()
        LiveBookingPerson.objects.filter(pk=p.pk).update(status=LiveBookingPerson.Status.INVITED)
        if pending:
            continue  # already invited (e.g. a recorded seat): one invite covers both on joining
        _inv, token = org_services.invite(
            org_id=booking.org_id, email=p.email, role="learner", invited_by=booking.buyer, by_role="owner"
        )
        transaction.on_commit(
            lambda e=p.email, t=token: send_seat_invite_task.delay(e, org_name, inviter, t, [course])
        )


def place_booking(booking: LiveBooking) -> bool:
    """Put a paid booking in the next intake (adds to the company's seats if it is already
    in that intake). Returns False when no intake is open yet."""
    if booking.status != LiveBooking.Status.WAITING_INTAKE:
        return False
    private = (booking.terms or {}).get("cohort_id")
    cohort = LiveCohort.objects.filter(pk=private).first() if private else next_intake(booking.course_id)
    if cohort is None:
        return False
    cohort = LiveCohort.objects.select_for_update().get(pk=cohort.pk)
    cc = CohortCompany.objects.select_for_update().filter(cohort=cohort, org_id=booking.org_id).first()
    if cc is None:
        cc = CohortCompany.objects.create(
            org_id=booking.org_id,
            cohort=cohort,
            seat_purchase_id=booking.deposit_purchase_id,
            approved_seats=booking.quantity,
            status=CohortCompany.Status.PAID,
        )
    else:
        cc.approved_seats += booking.quantity
        if cc.status not in (
            CohortCompany.Status.PAID,
            CohortCompany.Status.ACTIVE,
            CohortCompany.Status.INCLUDED,
        ):
            cc.status = CohortCompany.Status.PAID
        cc.save(update_fields=["approved_seats", "status", "updated_at"])
    cohort.current_seats = (
        CohortCompany.objects.filter(cohort=cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .aggregate(total=Sum("approved_seats"))["total"]
        or 0
    )
    cohort.save(update_fields=["current_seats", "updated_at"])
    booking.status = LiveBooking.Status.PLACED
    booking.cohort = cohort
    booking.cohort_company = cc
    booking.placed_at = timezone.now()
    booking.save(update_fields=["status", "cohort", "cohort_company", "placed_at", "updated_at"])
    from .live_renewals import schedule_instalments

    schedule_instalments(booking)
    for p in LiveBookingPerson.objects.filter(
        booking=booking, status=LiveBookingPerson.Status.JOINED, attendee__isnull=True
    ):
        _attend(booking, p)
    return True


def _attend(booking: LiveBooking, p: LiveBookingPerson) -> None:
    att = LiveAttendee.objects.filter(
        cohort=booking.cohort, user_id=p.user_id, status=LiveAttendee.Status.ACTIVE
    ).first()
    if att is None:
        att = LiveAttendee.objects.create(
            org_id=booking.org_id,
            cohort_company=booking.cohort_company,
            cohort=booking.cohort,
            user_id=p.user_id,
            added_by=booking.buyer,
        )
    LiveBookingPerson.objects.filter(pk=p.pk).update(attendee=att)


def place_waiting(course_id) -> int:
    """A new intake was created: place every paid booking still waiting for one."""
    from core.tenancy import tenant_context

    n = 0
    with tenant_context(staff=True):
        for b in LiveBooking.objects.filter(
            course_id=course_id, status=LiveBooking.Status.WAITING_INTAKE
        ).order_by("created_at"):
            with transaction.atomic():
                n += place_booking(LiveBooking.objects.select_for_update().get(pk=b.pk))
    return n


def fulfil_live_for_member(member) -> None:
    """Someone accepted a company invite: mark them joined on every live booking that named
    them, set their name/job title if still empty, and seat them where already placed."""
    from django.contrib.auth import get_user_model

    from apps.org.models import JobRole, MemberJobRole
    from core.tenancy import tenant_context

    with tenant_context(org_id=member.org_id, user_id=member.user_id, staff=True), transaction.atomic():
        user = member.user
        people = list(
            LiveBookingPerson.objects.select_for_update()
            .filter(org_id=member.org_id, email__iexact=user.email, status=LiveBookingPerson.Status.INVITED)
            .select_related("booking")
        )
        if not people:
            return
        name = next((p.full_name for p in people if p.full_name), "")
        title = next((p.job_title for p in people if p.job_title), "")
        if name and not user.full_name:
            get_user_model().objects.filter(pk=user.pk).update(full_name=name)
        if title and not MemberJobRole.objects.filter(org_id=member.org_id, member=member).exists():
            role = JobRole.objects.filter(
                org_id=member.org_id, name__iexact=title
            ).first() or JobRole.objects.create(org_id=member.org_id, name=title)
            MemberJobRole.objects.get_or_create(org_id=member.org_id, member=member, job_role=role)
        for p in people:
            LiveBookingPerson.objects.filter(pk=p.pk).update(
                status=LiveBookingPerson.Status.JOINED, user_id=user.id
            )
            p.user_id = user.id
            if p.booking.status == LiveBooking.Status.PLACED:
                _attend(p.booking, p)


def close_deposit(meta: dict, status: str) -> None:
    """Checkout expired or failed: the booking never started."""
    b = LiveBooking.objects.filter(pk=meta.get("id"), status=LiveBooking.Status.PENDING_PAYMENT).first()
    if b is None:
        return
    LiveBooking.objects.filter(pk=b.pk).update(status=LiveBooking.Status.CANCELLED, updated_at=timezone.now())
    SeatPurchase.objects.filter(pk=b.deposit_purchase_id, status=SeatPurchase.Status.PENDING).update(
        status=status, updated_at=timezone.now()
    )
