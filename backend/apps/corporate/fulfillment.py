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
