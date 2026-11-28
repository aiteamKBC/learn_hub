"""Live courses, option 2: a private intake for one company.

1. The company admin sends a request (no money): course, rough head count, a message.
   The price shown is the course's fixed private price (LiveCourseTerms).
2. The platform admin approves it with a start date (a private LiveCohort is created for
   that company only) or rejects it, with an optional reply. The company is notified.
3. Approved: the company names its employees (no limit) and pays the deposit. The private
   price is split into deposit + instalments in the same proportions as a public seat;
   from there it is the same as option 1 (invites, reminders, instalments, access).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import LiveBooking, LiveCohort, LiveCourseTerms, PrivateIntakeRequest

OPEN_REQUEST = (PrivateIntakeRequest.Status.SUBMITTED, PrivateIntakeRequest.Status.APPROVED)


def _terms(course_id) -> LiveCourseTerms:
    from .live_booking import _live_offering

    terms = LiveCourseTerms.objects.filter(course_id=course_id).first()
    if _live_offering(course_id) is None or terms is None or not terms.private_price_minor:
        raise ServiceError("no_private", "A private intake is not offered for this course.", status=404)
    return terms


def private_terms(terms: LiveCourseTerms, price: int) -> dict:
    """Split the whole private price like a seat: deposit share first, then each part.
    Amounts are totals for the company (`whole`), not per seat."""
    seat = terms.seat_price_minor or 1
    deposit = round(price * terms.deposit_minor / seat)
    parts, left = [], price - deposit
    insts = terms.instalments or []
    for n, part in enumerate(insts):
        amount = left if n == len(insts) - 1 else round(price * int(part["amount_minor"]) / seat)
        left -= amount
        parts.append({"months": int(part["months"]), "amount_minor": amount})
    return {
        "programme_months": terms.programme_months,
        "deposit_months": terms.deposit_months,
        "deposit_minor": deposit,
        "instalments": parts,
        "seat_price_minor": price,
        "whole": True,
    }


# ------------------------------------------------------------------ company side


def send_request(request, course_id, expected_people: int | None, message: str) -> PrivateIntakeRequest:
    from core.html import plain

    org_id = getattr(request, "org_id", None)
    terms = _terms(course_id)
    if PrivateIntakeRequest.objects.filter(
        org_id=org_id, course_id=course_id, status__in=OPEN_REQUEST
    ).exists():
        raise ServiceError("already_asked", "You already have an open request for this course.", status=409)
    r = PrivateIntakeRequest.objects.create(
        org_id=org_id,
        course_id=course_id,
        requester=request.user,
        expected_people=expected_people,
        message=plain(message or "")[:2000],
        price_minor=terms.private_price_minor,
    )
    audit_request(
        request,
        "private_intake_requested",
        "private_intake_request",
        r.id,
        data={"course_id": str(course_id)},
    )
    return r


def request_out(r: PrivateIntakeRequest, start=None, terms: LiveCourseTerms | None = None) -> dict:
    terms = terms or LiveCourseTerms.objects.filter(course_id=r.course_id).first()
    plan = private_terms(terms, r.price_minor) if terms else None
    return {
        "id": str(r.id),
        "course_id": str(r.course_id),
        "course_title": r.course.title,
        "status": r.status,
        "expected_people": r.expected_people,
        "message": r.message,
        "admin_reply": r.admin_reply,
        "price_minor": r.price_minor,
        "deposit_minor": plan["deposit_minor"] if plan else None,
        "deposit_months": plan["deposit_months"] if plan else None,
        "programme_months": plan["programme_months"] if plan else None,
        "instalments": plan["instalments"] if plan else [],
        "starts_on": start,
        "booking_status": r.booking.status if r.booking_id else None,
        "created_at": r.created_at,
    }


def _starts_and_terms(rows) -> tuple[dict, dict]:
    starts = dict(
        LiveCohort.objects.filter(pk__in=[r.cohort_id for r in rows if r.cohort_id]).values_list(
            "id", "scheduled_start"
        )
    )
    terms = {
        t.course_id: t for t in LiveCourseTerms.objects.filter(course_id__in={r.course_id for r in rows})
    }
    return starts, terms


def company_requests(org_id) -> list[dict]:
    from core.tenancy import tenant_context

    rows = list(
        PrivateIntakeRequest.objects.filter(org_id=org_id)
        .exclude(status=PrivateIntakeRequest.Status.CANCELLED)
        .select_related("course", "booking")
        .order_by("-created_at")[:50]
    )
    with tenant_context(staff=True):  # the private intake and the plan are platform rows
        starts, terms = _starts_and_terms(rows)
    return [request_out(r, starts.get(r.cohort_id), terms.get(r.course_id)) for r in rows]


def cancel_request(request, req_id) -> None:
    n = PrivateIntakeRequest.objects.filter(
        pk=req_id, org_id=getattr(request, "org_id", None), status=PrivateIntakeRequest.Status.SUBMITTED
    ).update(status=PrivateIntakeRequest.Status.CANCELLED, updated_at=timezone.now())
    if not n:
        raise ServiceError(
            "not_open", "Only a request still waiting for LearnHub can be withdrawn.", status=400
        )


def book_private(request, req_id, employees: list[dict], source: str) -> dict:
    from .live_booking import create_live_booking

    with transaction.atomic():
        r = (
            PrivateIntakeRequest.objects.select_for_update()
            .filter(pk=req_id, org_id=getattr(request, "org_id", None))
            .first()
        )
        if r is None:
            raise ServiceError("not_found", "Request not found.", status=404)
        if r.status != PrivateIntakeRequest.Status.APPROVED:
            raise ServiceError("not_approved", "LearnHub has not approved this request yet.", status=400)
        if r.booking_id and LiveBooking.objects.filter(pk=r.booking_id).exclude(status="cancelled").exists():
            raise ServiceError(
                "already_booking", "This intake already has a payment in progress.", status=409
            )
        terms = LiveCourseTerms.objects.get(course_id=r.course_id)
        plan = {
            **private_terms(terms, r.price_minor),
            "cohort_id": str(r.cohort_id),
            "private_request_id": str(r.id),
        }
        out = create_live_booking(request, r.course_id, len(employees), employees, source, plan=plan)
        PrivateIntakeRequest.objects.filter(pk=r.pk).update(
            booking_id=out["purchase_id"], updated_at=timezone.now()
        )
    return out


def mark_booked(booking: LiveBooking) -> None:
    rid = (booking.terms or {}).get("private_request_id")
    if rid:
        PrivateIntakeRequest.objects.filter(pk=rid).update(
            status=PrivateIntakeRequest.Status.BOOKED, updated_at=timezone.now()
        )


# ------------------------------------------------------------------ console side


def console_requests() -> list[dict]:
    from apps.org.models import Organization

    rows = list(
        PrivateIntakeRequest.objects.select_related("course", "booking", "requester").order_by("-created_at")[
            :200
        ]
    )
    orgs = dict(Organization.objects.filter(pk__in={r.org_id for r in rows}).values_list("id", "name"))
    starts, terms = _starts_and_terms(rows)
    return [
        {
            **request_out(r, starts.get(r.cohort_id), terms.get(r.course_id)),
            "company": orgs.get(r.org_id, ""),
            "requester_email": r.requester.email,
        }
        for r in rows
    ]


def _tell(r: PrivateIntakeRequest, code: str, ctx: dict) -> None:
    from apps.engagement.notify import notify

    notify(
        [r.requester_id],
        code,
        {"course": r.course.title, **ctx},
        url="/business/live-bookings",
        dedupe=f"{code}-{r.id}",
    )


def _open_for_decision(req_id) -> PrivateIntakeRequest:
    r = PrivateIntakeRequest.objects.select_for_update().select_related("course").filter(pk=req_id).first()
    if r is None:
        raise ServiceError("not_found", "Request not found.", status=404)
    if r.status != PrivateIntakeRequest.Status.SUBMITTED:
        raise ServiceError("decided", "This request has already been answered.", status=400)
    return r


@transaction.atomic
def approve(request, req_id, starts_on, reply: str = "") -> None:
    from apps.org.models import Organization
    from core.html import plain

    r = _open_for_decision(req_id)
    if starts_on <= timezone.localdate():
        raise ServiceError("bad_date", "Pick a start date in the future.", status=400)
    org = Organization.objects.filter(pk=r.org_id).values_list("name", flat=True).first() or "Company"
    cohort = LiveCohort.objects.create(
        course_id=r.course_id,
        title=f"{r.course.title}: {org} (private)",
        intake="Private",
        status=LiveCohort.Status.CONFIRMED,
        delivery_mode=LiveCohort.DeliveryMode.ONLINE,
        min_learners=1,
        max_learners=10_000,  # no people limit on a private intake
        scheduled_start=starts_on,
        private_org_id=r.org_id,
    )
    r.status, r.cohort = PrivateIntakeRequest.Status.APPROVED, cohort
    r.admin_reply, r.decided_by, r.decided_at = plain(reply or "")[:2000], request.user, timezone.now()
    r.save(update_fields=["status", "cohort", "admin_reply", "decided_by", "decided_at", "updated_at"])
    audit_request(
        request, "private_intake_approved", "private_intake_request", r.id, data={"starts_on": str(starts_on)}
    )
    _tell(r, "corporate_private_intake_approved", {"date": starts_on.strftime("%d %B %Y")})


@transaction.atomic
def reject(request, req_id, reply: str = "") -> None:
    from core.html import plain

    r = _open_for_decision(req_id)
    r.status = PrivateIntakeRequest.Status.REJECTED
    r.admin_reply, r.decided_by, r.decided_at = plain(reply or "")[:2000], request.user, timezone.now()
    r.save(update_fields=["status", "admin_reply", "decided_by", "decided_at", "updated_at"])
    audit_request(request, "private_intake_rejected", "private_intake_request", r.id)
    _tell(r, "corporate_private_intake_rejected", {"reply": r.admin_reply or "No reason given."})
