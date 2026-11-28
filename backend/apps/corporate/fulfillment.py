"""B2B-02: Webhook fulfillment for corporate purchases.

Called from apps/commerce/webhooks.py dispatch when meta.kind starts with "corporate_".
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from .models import SeatPurchase

log = logging.getLogger(__name__)


@transaction.atomic
def fulfil_recorded_purchase(session: dict, meta: dict) -> None:
    purchase_id = meta.get("id")
    if not purchase_id:
        log.warning("corporate_recorded: no purchase id in session %s", session.get("id"))
        return

    purchase = SeatPurchase.objects.select_for_update().filter(pk=purchase_id).first()
    if purchase is None:
        log.warning("corporate_recorded: purchase %s not found", purchase_id)
        return
    if purchase.status == SeatPurchase.Status.PAID:
        return

    purchase.status = SeatPurchase.Status.PAID
    purchase.payment_intent = session.get("payment_intent") or ""
    purchase.paid_at = timezone.now()
    purchase.save(update_fields=["status", "payment_intent", "paid_at", "updated_at"])
    _send_planned(purchase)


def _send_planned(purchase: SeatPurchase) -> None:
    """Paid: the employees named while buying become a seat request (sent at once, or
    waiting for approval, per the platform setting). Runs once, on the move to PAID. If it
    cannot (e.g. someone got the course meanwhile), the payment still stands and the
    employer gives the seats from the Seats page."""
    rows = purchase.planned_employees or []
    if not rows:
        return
    from types import SimpleNamespace

    from core.errors import ServiceError
    from core.tenancy import tenant_context

    from .pending import _Actor, submit_request

    source = rows[0].get("_source", "manual")
    clean = [{k: r.get(k, "") for k in ("email", "full_name", "job_title")} for r in rows]
    buyer = purchase.buyer
    scope = SimpleNamespace(org_id=purchase.org_id, role=SimpleNamespace(value="owner"))
    try:
        with tenant_context(org_id=purchase.org_id, user_id=buyer.id, staff=True), transaction.atomic():
            submit_request(_Actor(buyer, purchase.org_id), scope, purchase.offering_id, clean, source)
    except ServiceError as exc:
        log.warning("corporate_recorded: planned employees for %s not sent: %s", purchase.id, exc)


def expire_purchase(session: dict, meta: dict) -> None:
    purchase_id = meta.get("id")
    if not purchase_id:
        return

    SeatPurchase.objects.filter(
        pk=purchase_id,
        status=SeatPurchase.Status.PENDING,
    ).update(status=SeatPurchase.Status.EXPIRED, updated_at=timezone.now())


def fail_purchase(session: dict, meta: dict) -> None:
    purchase_id = meta.get("id")
    if not purchase_id:
        return

    SeatPurchase.objects.filter(
        pk=purchase_id,
        status=SeatPurchase.Status.PENDING,
    ).update(status=SeatPurchase.Status.VOIDED, updated_at=timezone.now())
