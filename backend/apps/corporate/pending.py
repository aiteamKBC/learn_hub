"""Employers give paid recorded-course seats to their employees (B2B recorded flow).

1. The employer has PAID seats (only paid purchases are used, so nothing is ever sent
   before payment).
2. They send a list of employees (typed in, or read from a CSV file; both arrive here as
   the same rows): email, name, job title. Every row holds one seat at once, so seats
   cannot be oversold, and a SeatRequest records the list.
3. Platform setting `corporate.invite_approval_required`:
   * ON  -> the request waits for a platform admin to approve or reject it;
   * OFF -> it is approved straight away.
   Changing the setting never approves requests that are already waiting.
4. On approval: someone already in the company gets the course at once; anyone else gets
   an invite email, creates an account with that email and a password, and accepting the
   invite gives them the seat (course open) plus the name and job title the employer gave.
5. Rejecting, or cancelling one row, frees the seat. Nothing here deletes data.

Duplicates are refused: the same email twice in a list, an email that already has a
seat, a held seat or the course on this offering.
"""

from __future__ import annotations

from contextvars import ContextVar

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.errors import ServiceError

from .models import CorporateOffering, PendingSeat, SeatAllocation, SeatPurchase, SeatRequest

ACTIVE_ALLOC = Q(status__in=[SeatAllocation.Status.ALLOCATED, SeatAllocation.Status.ACTIVE])
HELD = Q(status__in=[PendingSeat.Status.AWAITING, PendingSeat.Status.PENDING])
PAID = Q(status=SeatPurchase.Status.PAID) | Q(
    stage_access_enabled=True, status=SeatPurchase.Status.PARTIAL_PAID
)
MAX_ROWS = 500
SETTING = "corporate.invite_approval_required"


def seats_taken(sp: SeatPurchase) -> int:
    """Seats used in one purchase: given seats plus seats held for a listed employee."""
    return sp.allocations.filter(ACTIVE_ALLOC).count() + sp.pending_seats.filter(HELD).count()


def held_count(org_id, offering_id=None) -> int:
    qs = PendingSeat.objects.filter(HELD, org_id=org_id)
    if offering_id is not None:
        qs = qs.filter(seat_purchase__offering_id=offering_id)
    return qs.count()


def approval_required() -> bool:
    from apps.platform.services import get_setting

    return bool(get_setting(SETTING))


def _clean_rows(rows: list[dict]) -> list[dict]:
    from email_validator import EmailNotValidError, validate_email

    from core.html import plain

    if not rows:
        raise ServiceError("no_rows", "Add at least one employee.")
    if len(rows) > MAX_ROWS:
        raise ServiceError("too_many_rows", f"Send at most {MAX_ROWS} employees at a time.")
    out, seen, bad = [], set(), []
    for n, r in enumerate(rows, start=1):
        try:
            email = validate_email(
                str(r.get("email") or "").strip(), check_deliverability=False
            ).normalized.lower()
        except EmailNotValidError:
            bad.append(f"row {n}: email is not valid")
            continue
        if email in seen:
            bad.append(f"row {n}: {email} is listed twice")
            continue
        seen.add(email)
        name = plain(str(r.get("full_name") or ""))[:200]
        title = plain(str(r.get("job_title") or ""))[:120]
        out.append({"email": email, "full_name": name, "job_title": title})
    if bad:
        raise ServiceError(
            "bad_rows", "Fix these rows: " + "; ".join(bad[:10]) + (" …" if len(bad) > 10 else "")
        )
    return out


@transaction.atomic
def submit_request(request, scope, offering_id, rows: list[dict], source: str = "manual") -> SeatRequest:
    """Hold one paid seat per employee and record the request. Released at once when
    approval is not required."""
    from apps.learning.models import Enrollment
    from apps.org.models import OrgMember

    offering = CorporateOffering.objects.filter(pk=offering_id).first()
    if offering is None:
        raise ServiceError("offering_not_found", "Course package not found.", status=404)
    if offering.delivery_type != CorporateOffering.DeliveryType.RECORDED:
        raise ServiceError("live_offering", "Name live attendees from the live booking instead.", status=400)
    if source not in SeatRequest.Source.values:
        raise ServiceError("bad_source", "Unknown source.")
    clean = _clean_rows(rows)
    emails = [r["email"] for r in clean]

    # lock the paid stock first, so two requests cannot take the same free seat
    purchases = list(
        SeatPurchase.objects.select_for_update()
        .filter(org_id=scope.org_id, offering_id=offering_id)
        .filter(PAID)
        .order_by("paid_at", "created_at", "id")
    )
    clash = set(
        PendingSeat.objects.filter(HELD, org_id=scope.org_id, seat_purchase__offering_id=offering_id)
        .filter(email__in=emails)
        .values_list("email", flat=True)
    )
    members = dict(
        OrgMember.objects.filter(
            org_id=scope.org_id, removed_at__isnull=True, user__email__in=emails
        ).values_list("user__email", "user_id")
    )
    members = {e.lower(): uid for e, uid in members.items()}
    if members:
        has_seat = SeatAllocation.objects.filter(
            ACTIVE_ALLOC,
            org_id=scope.org_id,
            seat_purchase__offering_id=offering_id,
            user_id__in=members.values(),
        ).values_list("user_id", flat=True)
        has_course = Enrollment.objects.filter(
            org_id=scope.org_id, course_id=offering.course_id, user_id__in=members.values(),
            status__in=[Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED],
        ).values_list("user_id", flat=True)  # fmt: skip
        busy = set(has_seat) | set(has_course)
        clash |= {e for e, uid in members.items() if uid in busy}
    if clash:
        raise ServiceError(
            "already_has_seat",
            "Already have this course or a seat on it: " + ", ".join(sorted(clash)[:10]),
            status=409,
        )

    free = [(sp, sp.quantity - seats_taken(sp)) for sp in purchases]
    if sum(max(0, n) for _, n in free) < len(clean):
        raise ServiceError(
            "no_seats_available",
            f"Not enough paid seats: {len(clean)} needed, {sum(max(0, n) for _, n in free)} free. Buy more seats first.",
            status=409,
        )

    auto = not approval_required()
    req = SeatRequest.objects.create(
        org_id=scope.org_id, offering=offering, source=source, submitted_by=request.user,
        status=SeatRequest.Status.APPROVED if auto else SeatRequest.Status.PENDING_APPROVAL,
        auto_approved=auto, reviewed_at=timezone.now() if auto else None,
    )  # fmt: skip
    it = iter(clean)
    for sp, n in free:
        for _ in range(max(0, n)):
            row = next(it, None)
            if row is None:
                break
            PendingSeat.objects.create(
                org_id=scope.org_id, seat_purchase=sp, request=req, created_by=request.user,
                status=PendingSeat.Status.AWAITING, **row,
            )  # fmt: skip

    from apps.platform.services import audit_request

    audit_request(request, "seat_request.submit", "seat_request", req.id,
                  {"rows": len(clean), "source": source, "auto_approved": auto})  # fmt: skip
    if auto:
        _release(req)
    return req


# Emails that a later step of the same payment will send (see bundles.fulfil_basket):
# the invite is still made here, but its email waits so each person gets ONE message.
MAIL_LATER: ContextVar[set] = ContextVar("corporate_mail_later", default=set())  # noqa: B039


def _release(req: SeatRequest) -> None:
    """Approved: give seats to people already in the company, invite everyone else."""
    from apps.org import services as org_services
    from apps.org.models import Invite, Organization, OrgMember
    from apps.org.tasks import send_seat_invite_task

    from .services import allocate_seat

    org_name = Organization.objects.filter(pk=req.org_id).values_list("name", flat=True).first()
    inviter = req.submitted_by.full_name or req.submitted_by.email
    shim = _Actor(req.submitted_by, req.org_id)
    to_mail: dict[str, tuple[str, set]] = {}
    for p in PendingSeat.objects.select_for_update().filter(request=req, status=PendingSeat.Status.AWAITING):
        member = OrgMember.objects.filter(
            org_id=req.org_id, user__email__iexact=p.email, removed_at__isnull=True
        ).first()
        if member is not None:
            PendingSeat.objects.filter(pk=p.pk).update(
                status=PendingSeat.Status.FULFILLED, resolved_at=timezone.now()
            )
            try:
                with transaction.atomic():
                    alloc = allocate_seat(shim, p.seat_purchase_id, member.user_id)
                PendingSeat.objects.filter(pk=p.pk).update(allocation=alloc)
            except ServiceError:
                PendingSeat.objects.filter(pk=p.pk).update(status=PendingSeat.Status.CANCELLED)
            continue
        old = Invite.objects.filter(
            org_id=req.org_id, email__iexact=p.email, accepted_at__isnull=True, revoked_at__isnull=True
        ).first()
        if p.email in to_mail:
            inv_id, titles = to_mail[p.email]
            PendingSeat.objects.filter(pk=p.pk).update(invite_id=inv_id, status=PendingSeat.Status.PENDING)
            titles.add(p.seat_purchase.offering.course.title)
            continue
        inv, token = org_services.invite(
            org_id=req.org_id, email=p.email, role="learner", invited_by=req.submitted_by, by_role="owner"
        )
        if old is not None:  # the new invite replaced it: seats held on it move across
            PendingSeat.objects.filter(invite=old, status=PendingSeat.Status.PENDING).update(invite=inv)
        PendingSeat.objects.filter(pk=p.pk).update(invite=inv, status=PendingSeat.Status.PENDING)
        titles = set(
            PendingSeat.objects.filter(invite=inv, status=PendingSeat.Status.PENDING).values_list(
                "seat_purchase__offering__course__title", flat=True
            )
        ) | {p.seat_purchase.offering.course.title}
        to_mail[p.email] = (inv.id, titles)
        tok = token
        if p.email in MAIL_LATER.get():
            continue
        transaction.on_commit(
            lambda e=p.email, t=tok, ts=titles: send_seat_invite_task.delay(
                e, org_name, inviter, t, sorted(ts)
            )
        )


class _Actor:
    """allocate_seat records who gave the seat: the employer who sent the list."""

    def __init__(self, user, org_id):
        self.user = self.auth = user
        self.org_id = org_id
        self.META = {}


@transaction.atomic
def review(request, request_id, *, approve: bool, note: str = "") -> SeatRequest:
    """Platform admin approves or rejects a waiting request."""
    from core.html import plain
    from core.tenancy import tenant_context

    with tenant_context(staff=True):
        req = SeatRequest.objects.select_for_update().filter(pk=request_id).first()
        if req is None:
            raise ServiceError("not_found", "Request not found.", status=404)
        if req.status != SeatRequest.Status.PENDING_APPROVAL:
            raise ServiceError("already_reviewed", "This request was already reviewed.", status=409)
        now = timezone.now()
        req.status = SeatRequest.Status.APPROVED if approve else SeatRequest.Status.REJECTED
        req.reviewed_by, req.reviewed_at, req.review_note = request.user, now, plain(note)[:1000]
        req.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_note", "updated_at"])
        if approve:
            with tenant_context(org_id=req.org_id, user_id=req.submitted_by_id, staff=True):
                _release(req)
        else:
            PendingSeat.objects.filter(request=req, status=PendingSeat.Status.AWAITING).update(
                status=PendingSeat.Status.CANCELLED, resolved_at=now, updated_at=now
            )
    from apps.platform.services import audit_request

    audit_request(
        request, "seat_request.approve" if approve else "seat_request.reject", "seat_request", req.id
    )
    return req


@transaction.atomic
def cancel_pending(request, scope, pending_id) -> PendingSeat:
    """The employer frees one held seat (waiting for approval or for the person to join)."""
    p = PendingSeat.objects.select_for_update().filter(pk=pending_id, org_id=scope.org_id).first()
    if p is None:
        raise ServiceError("not_found", "Held seat not found.", status=404)
    if p.status not in (PendingSeat.Status.AWAITING, PendingSeat.Status.PENDING):
        raise ServiceError("not_pending", "This seat is no longer waiting.", status=409)
    PendingSeat.objects.filter(pk=p.pk).update(
        status=PendingSeat.Status.CANCELLED, resolved_at=timezone.now(), updated_at=timezone.now()
    )
    p.status = PendingSeat.Status.CANCELLED
    from apps.platform.services import audit_request

    audit_request(request, "seat.held_cancel", "pending_seat", p.id, {"email": p.email})
    return p


def fulfil_for_member(request, member) -> int:
    """After someone accepts a company invite: give them every seat held for their email,
    and fill in the name and job title the employer gave (only where still empty).
    A seat that cannot be given (e.g. they already had the course) is cancelled so it
    frees up again. Returns how many seats were given."""
    from django.contrib.auth import get_user_model

    from apps.org.models import JobRole, MemberJobRole
    from core.tenancy import tenant_context

    from .services import allocate_seat

    given = 0
    with tenant_context(org_id=member.org_id, user_id=member.user_id, staff=True), transaction.atomic():
        user = member.user
        held = list(
            PendingSeat.objects.select_for_update()
            .filter(org_id=member.org_id, email__iexact=user.email, status=PendingSeat.Status.PENDING)
            .order_by("created_at")
        )
        name = next((p.full_name for p in held if p.full_name), "")
        title = next((p.job_title for p in held if p.job_title), "")
        if name and not user.full_name:
            get_user_model().objects.filter(pk=user.pk).update(full_name=name)
        if title and not MemberJobRole.objects.filter(org_id=member.org_id, member=member).exists():
            role = JobRole.objects.filter(org_id=member.org_id, name__iexact=title).first()
            if role is None:
                role = JobRole.objects.create(org_id=member.org_id, name=title)
            MemberJobRole.objects.get_or_create(org_id=member.org_id, member=member, job_role=role)
        for p in held:
            # stop holding first, so the seat it reserved is free for allocate_seat
            PendingSeat.objects.filter(pk=p.pk).update(
                status=PendingSeat.Status.FULFILLED, resolved_at=timezone.now(), updated_at=timezone.now()
            )
            try:
                with transaction.atomic():
                    alloc = allocate_seat(request, p.seat_purchase_id, member.user_id)
            except ServiceError:
                PendingSeat.objects.filter(pk=p.pk).update(status=PendingSeat.Status.CANCELLED)
                continue
            PendingSeat.objects.filter(pk=p.pk).update(allocation=alloc)
            given += 1
    return given
