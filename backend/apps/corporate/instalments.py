"""Instalment purchases: platform staff set the schedule for each company agreement.

  create_instalment_purchase  -> purchase (pending) + its schedule
  send_instalment_invoice     -> Stripe invoice for one instalment (send_invoice, not a subscription)
  cover_seats / uncover_seat  -> staff choose which seats an instalment pays for
  instalment_paid             -> invoice.paid webhook (metadata kind corporate_instalment)
  instalment_failed           -> invoice.payment_failed webhook
  plan_summary                -> schedule, balances, history and each seat's entitlement

Only a signed Stripe webhook marks an instalment paid (commerce.webhooks verifies the
signature); a browser redirect never does. Paying the first instalment makes the seats
usable. Each instalment gives access only to the seats staff chose for it, from its
own payment date (see programme.py). Pending or failed instalments give nothing. Full
upfront payment is unchanged (payment_plan "full", the existing checkout and quote flows).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.org.models import Organization, OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError

from . import programme
from .models import CorporateOffering, InstalmentCover, SeatAllocation, SeatInstalment, SeatPurchase

MAX_INSTALMENTS = 24


@transaction.atomic
def create_instalment_purchase(
    request,
    *,
    org_id,
    offering_id,
    buyer_id,
    quantity: int,
    unit_price_minor: int,
    currency: str,
    schedule: list[dict],
    programme_months: int | None = None,
) -> SeatPurchase:
    """schedule: [{"amount_minor", "due_at", "covers_months"}, ...] in payment order.

    Amounts are whole minor units (pence), so they must add up exactly to the total.
    covers_months is each instalment's own paid period, counted from its payment.
    """
    offering = CorporateOffering.objects.filter(pk=offering_id, is_active=True).first()
    if offering is None:
        raise ServiceError("offering_not_found", "Package not found.", status=404)
    if not OrgMember.objects.filter(org_id=org_id, user_id=buyer_id, removed_at__isnull=True).exists():
        raise ServiceError("buyer_not_member", "The billing contact must belong to this company.", status=400)
    if quantity < 1 or unit_price_minor < 1:
        raise ServiceError("bad_quantity", "Check the number of seats and the price.", status=400)
    if programme_months is not None and not 1 <= programme_months <= 120:
        raise ServiceError("bad_programme", "Programme length must be 1 to 120 months.", status=400)
    if not 2 <= len(schedule) <= MAX_INSTALMENTS:
        raise ServiceError("bad_schedule", f"Use 2 to {MAX_INSTALMENTS} instalments.", status=400)
    total = quantity * unit_price_minor
    amounts = [int(s["amount_minor"]) for s in schedule]
    if any(a < 1 for a in amounts) or sum(amounts) != total:
        raise ServiceError(
            "bad_schedule", "The instalments must add up exactly to the full price.", status=400
        )
    if any(not 1 <= int(s["covers_months"]) <= 120 for s in schedule):
        raise ServiceError("bad_schedule", "Each instalment must cover 1 to 120 months.", status=400)
    dues = [s["due_at"] for s in schedule]
    if any(b < a for a, b in zip(dues, dues[1:], strict=False)):
        raise ServiceError("bad_schedule", "Due dates must be in order.", status=400)

    sp = SeatPurchase.objects.create(
        org_id=org_id,
        offering=offering,
        buyer_id=buyer_id,
        quantity=quantity,
        unit_price_minor=unit_price_minor,
        currency=currency.upper(),
        total_minor=total,
        gbp_total_minor=total,  # as quotes do: staff agree the price in the invoice currency
        status=SeatPurchase.Status.PENDING,
        payment_plan=SeatPurchase.PaymentPlan.INSTALMENTS,
        programme_months=programme_months,
    )
    SeatInstalment.objects.bulk_create(
        SeatInstalment(
            org_id=org_id,
            seat_purchase=sp,
            sequence=n,
            amount_minor=int(s["amount_minor"]),
            currency=sp.currency,
            due_at=s["due_at"],
            covers_months=int(s["covers_months"]),
        )
        for n, s in enumerate(schedule, start=1)
    )
    audit_request(
        request,
        "instalment_plan_created",
        "seat_purchase",
        sp.id,
        data={"org_id": str(org_id), "instalments": len(schedule), "total": total},
    )
    return sp


@transaction.atomic
def set_programme_months(request, purchase_id, months: int | None) -> SeatPurchase:
    """Agreed programme length for one company purchase (None = the package default)."""
    if months is not None and not 1 <= months <= 120:
        raise ServiceError("bad_programme", "Programme length must be 1 to 120 months.", status=400)
    sp = SeatPurchase.objects.select_for_update().filter(pk=purchase_id).first()
    if sp is None:
        raise ServiceError("purchase_not_found", "Purchase not found.", status=404)
    old = sp.programme_months
    sp.programme_months = months
    sp.save(update_fields=["programme_months", "updated_at"])
    audit_request(request, "programme_length_set", "seat_purchase", sp.id, data={"from": old, "to": months})
    return sp


def _locked(instalment_id) -> SeatInstalment:
    inst = SeatInstalment.objects.select_for_update().filter(pk=instalment_id).first()  # no join (RLS)
    if inst is None:
        raise ServiceError("instalment_not_found", "Instalment not found.", status=404)
    return inst


@transaction.atomic
def send_instalment_invoice(request, instalment_id) -> SeatInstalment:
    inst = _locked(instalment_id)
    if inst.status not in (SeatInstalment.Status.PENDING, SeatInstalment.Status.FAILED) or (
        inst.status == SeatInstalment.Status.FAILED and inst.stripe_invoice_id
    ):
        raise ServiceError("already_sent", "This instalment has already been sent.", status=400)
    sp = SeatPurchase.objects.select_related("offering__course", "buyer").get(pk=inst.seat_purchase_id)
    org = Organization.objects.get(pk=sp.org_id)
    customer_id = org.stripe_customer_id
    if not customer_id:
        customer_id = gateway.create_customer(
            email=sp.buyer.email,
            name=org.name,
            metadata={"org_id": str(org.id)},
            idempotency_key=f"corp_customer_{org.id}",
        )
        Organization.objects.filter(pk=org.id).update(
            stripe_customer_id=customer_id, updated_at=timezone.now()
        )
    inv = gateway.create_invoice(
        customer=customer_id,
        metadata={"kind": "corporate_instalment", "id": str(inst.id), "org_id": str(org.id)},
        collection_method="send_invoice",
        days_until_due=max(1, (inst.due_at - timezone.now()).days),
        currency=inst.currency,
        description=f"{sp.offering.course.title}: instalment {inst.sequence}",
        idempotency_key=f"corp_instalment_{inst.id}",
    )
    gateway.add_invoice_item(
        invoice_id=inv["id"],
        description=f"{sp.offering.course.title} × {sp.quantity}, instalment {inst.sequence}",
        amount=inst.amount_minor,
        currency=inst.currency,
    )
    gateway.finalize_invoice(inv["id"])
    gateway.send_invoice(inv["id"])
    inst.status = SeatInstalment.Status.SENT
    inst.stripe_invoice_id = inv["id"]
    inst.save(update_fields=["status", "stripe_invoice_id", "updated_at"])
    audit_request(
        request, "instalment_sent", "seat_instalment", inst.id, data={"stripe_invoice_id": inv["id"]}
    )
    return inst


def _matches(inst: SeatInstalment, invoice: dict) -> bool:
    """The event must be for the invoice we sent for this instalment (and this company)."""
    meta = invoice.get("metadata") or {}
    if meta.get("org_id") and meta["org_id"] != str(inst.org_id):
        return False
    return not inst.stripe_invoice_id or invoice.get("id") == inst.stripe_invoice_id


@transaction.atomic
def instalment_paid(invoice: dict) -> None:
    """invoice.paid webhook. Idempotent: a repeated or concurrent event changes nothing."""
    inst_id = (invoice.get("metadata") or {}).get("id")
    inst = SeatInstalment.objects.select_for_update().filter(pk=inst_id).first() if inst_id else None
    if inst is None or inst.status in (SeatInstalment.Status.PAID, SeatInstalment.Status.VOID):
        return
    if not _matches(inst, invoice):
        return
    now = timezone.now()
    inst.status = SeatInstalment.Status.PAID
    inst.paid_at = now
    inst.save(update_fields=["status", "paid_at", "updated_at"])
    sp = SeatPurchase.objects.select_for_update().get(pk=inst.seat_purchase_id)
    if sp.status == SeatPurchase.Status.PENDING:  # first payment: the seats become usable
        sp.status = SeatPurchase.Status.PAID
        sp.paid_at = now
        sp.save(update_fields=["status", "paid_at", "updated_at"])
    programme.extend_for_payment(inst, SeatPurchase.objects.select_related("offering").get(pk=sp.pk))


@transaction.atomic
def instalment_failed(invoice: dict) -> None:
    """invoice.payment_failed webhook: record it; no access is given or taken."""
    inst_id = (invoice.get("metadata") or {}).get("id")
    inst = SeatInstalment.objects.select_for_update().filter(pk=inst_id).first() if inst_id else None
    if inst is None or inst.status != SeatInstalment.Status.SENT or not _matches(inst, invoice):
        return
    inst.status = SeatInstalment.Status.FAILED
    inst.save(update_fields=["status", "updated_at"])


@transaction.atomic
def cover_seats(request, instalment_id, allocation_ids: list) -> dict:
    """Staff choose which seats this instalment pays for. Before or after it is paid.

    Seats must belong to the same purchase and to people still in the company.
    Choosing a seat twice for the same instalment adds nothing (unique per pair).
    """
    inst = _locked(instalment_id)
    if inst.status == SeatInstalment.Status.VOID:
        raise ServiceError("instalment_void", "This instalment was cancelled.", status=400)
    ids = list(dict.fromkeys(str(i) for i in allocation_ids))
    if not ids:
        raise ServiceError("no_seats", "Choose at least one person.", status=400)
    allocs = list(
        SeatAllocation.objects.filter(
            pk__in=ids, seat_purchase_id=inst.seat_purchase_id, status__in=programme.LIVE_SEAT
        )
    )
    if len(allocs) != len(ids):
        raise ServiceError(
            "seat_not_on_purchase", "Some seats are not active seats on this purchase.", status=400
        )
    current = set(
        OrgMember.objects.filter(
            org_id=inst.org_id, user_id__in=[a.user_id for a in allocs], removed_at__isnull=True
        ).values_list("user_id", flat=True)
    )
    if any(a.user_id not in current for a in allocs):
        raise ServiceError("member_left", "Someone you chose has left the company.", status=400)
    existing = set(InstalmentCover.objects.filter(instalment=inst).values_list("allocation_id", flat=True))
    new = [a for a in allocs if a.id not in existing]
    InstalmentCover.objects.bulk_create(
        InstalmentCover(org_id=inst.org_id, instalment=inst, allocation=a, added_by=request.auth) for a in new
    )
    if inst.status == SeatInstalment.Status.PAID and new:
        sp = SeatPurchase.objects.select_related("offering").get(pk=inst.seat_purchase_id)
        for a in new:
            programme.apply_paid_access(a, sp)
    audit_request(
        request,
        "instalment_seats_covered",
        "seat_instalment",
        inst.id,
        data={"added": [str(a.id) for a in new], "already": len(allocs) - len(new)},
    )
    return {"added": len(new), "already_covered": len(allocs) - len(new)}


@transaction.atomic
def uncover_seat(request, instalment_id, allocation_id) -> None:
    """Take a seat off an instalment that is not paid yet. Paid cover is history: kept."""
    inst = _locked(instalment_id)
    if inst.status == SeatInstalment.Status.PAID:
        raise ServiceError("already_paid", "This instalment is paid; its cover cannot change.", status=400)
    deleted, _ = InstalmentCover.objects.filter(instalment=inst, allocation_id=allocation_id).delete()
    if not deleted:
        raise ServiceError("not_covered", "This seat is not on this instalment.", status=404)
    audit_request(
        request,
        "instalment_seat_removed",
        "seat_instalment",
        inst.id,
        data={"allocation": str(allocation_id)},
    )


def instalment_state(inst: SeatInstalment) -> str:
    """Stored status, plus 'overdue' for anything unpaid past its due date."""
    if (
        inst.status in (SeatInstalment.Status.PENDING, SeatInstalment.Status.SENT)
        and inst.due_at < timezone.now()
    ):
        return "overdue"
    return inst.status


def plan_summary(sp: SeatPurchase) -> dict:
    """Everything the staff instalment screen shows for one purchase."""
    from apps.org.models import OrgMember

    instalments = list(SeatInstalment.objects.filter(seat_purchase=sp).order_by("sequence"))
    covers: dict = {}
    for c in InstalmentCover.objects.filter(instalment__seat_purchase=sp).values(
        "instalment_id", "allocation_id"
    ):
        covers.setdefault(c["instalment_id"], []).append(c["allocation_id"])
    allocs = list(
        SeatAllocation.objects.filter(seat_purchase=sp, status__in=programme.LIVE_SEAT)
        .select_related("user")
        .order_by("allocated_at")
    )
    left = dict(
        OrgMember.objects.filter(org_id=sp.org_id, user_id__in=[a.user_id for a in allocs])
        .order_by("joined_at")
        .values_list("user_id", "removed_at")
    )
    paid_minor = sum(i.amount_minor for i in instalments if i.status == SeatInstalment.Status.PAID)
    live = [i for i in instalments if i.status != SeatInstalment.Status.VOID]
    return {
        "purchase_id": sp.id,
        "payment_plan": sp.payment_plan,
        "currency": sp.currency,
        "total_minor": sp.total_minor,
        "paid_minor": paid_minor,
        "outstanding_minor": max(0, sum(i.amount_minor for i in live) - paid_minor),
        "programme_months": programme.agreed_months(sp),
        "agreement_months": sp.programme_months,
        "instalments": [
            {
                "id": i.id,
                "sequence": i.sequence,
                "amount_minor": i.amount_minor,
                "due_at": i.due_at,
                "covers_months": i.covers_months,
                "status": instalment_state(i),
                "paid_at": i.paid_at,
                "paid_through": programme.add_months(i.paid_at, i.covers_months) if i.paid_at else None,
                "stripe_invoice_id": i.stripe_invoice_id,
                "covered_allocation_ids": covers.get(i.id, []),
            }
            for i in instalments
        ],
        "seats": [
            {
                "allocation_id": a.id,
                "user_id": a.user_id,
                "user_name": a.user.full_name or a.user.email,
                "user_email": a.user.email,
                "left_at": left.get(a.user_id),
                **{
                    f"entitlement_{k}": v
                    for k, v in programme.entitlement(a, sp, left.get(a.user_id)).items()
                },
            }
            for a in allocs
        ],
    }
