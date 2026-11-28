"""Commit a reservation before contacting Stripe. Never retry an uncertain transfer.

HELD is deliberately durable even if the process dies or the confirmation commit
fails. Recovery needs authoritative provider evidence, never another transfer.
"""

import logging

import stripe
from django.db import connection, transaction
from django.utils import timezone

from apps.commerce import gateway
from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import Payout, PayoutRequest
from .safety import lock_payouts, validate_bundle

QUEUED = "Transfer queued; earnings remain reserved."
ATTEMPTED = "Transfer outcome requires provider reconciliation; earnings remain reserved."
logger = logging.getLogger(__name__)


def matching_transfer(transfer, payout, destination):
    return (
        bool(transfer.get("id"))
        and transfer.get("amount") == payout.amount_gbp_minor
        and transfer.get("currency") == "gbp"
        and transfer.get("destination") == destination
        and transfer.get("description") == f"LearnHub payout {payout.id}"
    )


def confirmed_transfer(transfer, payout, destination):
    return matching_transfer(transfer, payout, destination) and (
        transfer.get("reversed") is False and transfer.get("amount_reversed") == 0
    )


def prepare(payout, by):
    """Caller holds the payout lock inside its transaction. No transfer happens yet."""
    validate_bundle(payout)
    if payout.method != "stripe":
        raise ServiceError(
            "provider_confirmation_required",
            "This method has no provider confirmation integration. A typed reference cannot confirm payment.",
        )
    payout.status = Payout.Status.HELD
    payout.approved_by = by
    payout.failure_reason = QUEUED
    payout.save(update_fields=["status", "approved_by", "failure_reason", "updated_at"])
    transaction.on_commit(lambda: execute(payout.id), robust=True)
    return payout


def execute(payout_id):
    if connection.in_atomic_block:
        raise RuntimeError("Payout execution requires an outer commit before contacting the provider.")
    # Claim in a separate committed transaction. Even a crash before sending must
    # require reconciliation; false uncertainty is safer than double payment.
    with tenant_context(staff=True):
        lock_payouts()
        payout = Payout.objects.select_for_update().get(pk=payout_id)
        if payout.status != Payout.Status.HELD or payout.failure_reason != QUEUED:
            return
        payout.failure_reason = ATTEMPTED
        payout.save(update_fields=["failure_reason", "updated_at"])
    try:
        with tenant_context(staff=True):
            lock_payouts()
            payout = Payout.objects.select_for_update().get(pk=payout_id)
            if payout.status != Payout.Status.HELD or payout.failure_reason != ATTEMPTED:
                return
            try:
                account = validate_bundle(payout)
                if not gateway.payout_destination_enabled(account.stripe_account_id):
                    raise ServiceError("destination_disabled", "Stripe has not enabled payouts and transfers for this account.")
            except ServiceError as exc:
                # No transfer has been attempted. The reservation may safely be
                # cancelled through the existing pending-state actions.
                payout.status, payout.failure_reason = Payout.Status.PENDING, str(exc)[:300]
                payout.save(update_fields=["status", "failure_reason", "updated_at"])
                return
            try:
                ref = gateway.transfer(
                    destination=account.stripe_account_id,
                    amount_gbp_minor=payout.amount_gbp_minor,
                    idempotency_key=f"payout-{payout.id}",
                    description=f"LearnHub payout {payout.id}",
                )
            except stripe.InvalidRequestError as exc:
                if exc.code != "balance_insufficient":
                    raise
                # Stripe explicitly rejected creation: no transfer exists. All
                # timeouts, 5xx responses and other errors remain HELD.
                from .models import Earning

                payout.status = Payout.Status.FAILED
                payout.failure_reason = "Stripe rejected the transfer: insufficient platform balance."
                payout.save(update_fields=["status", "failure_reason", "updated_at"])
                Earning.objects.filter(payout=payout).update(payout=None, updated_at=timezone.now())
                PayoutRequest.objects.filter(payout=payout, status="approved").update(
                    status="failed", reason=payout.failure_reason, updated_at=timezone.now(),
                )
                return
            transfer = gateway.retrieve_transfer(ref)
            if not confirmed_transfer(transfer, payout, account.stripe_account_id):
                raise ServiceError("provider_mismatch", "Provider confirmation does not match this payout.")
            complete(payout, transfer["id"])
    except Exception:  # noqa: BLE001 -- retain committed HELD; never log provider secrets
        logger.warning("Payout %s remains held; provider reconciliation required", payout_id)


def complete(payout, provider_ref):
    """Only call after matching authoritative provider evidence, under the payout lock."""
    if payout.status == Payout.Status.PAID:
        return
    payout.status, payout.provider_ref, payout.paid_at = Payout.Status.PAID, provider_ref, timezone.now()
    payout.failure_reason = ""
    payout.save(update_fields=["status", "provider_ref", "paid_at", "failure_reason", "updated_at"])
    PayoutRequest.objects.filter(payout=payout, status=PayoutRequest.Status.APPROVED).update(
        status=PayoutRequest.Status.PAID, provider_ref=provider_ref,
        paid_at=payout.paid_at, updated_at=timezone.now(),
    )


def reconcile(payout, provider_ref):
    """Read-only Stripe lookup: safe for repeated confirmations, never creates a transfer."""
    from .models import PayoutAccount

    lock_payouts()
    payout = Payout.objects.select_for_update().get(pk=payout.pk)
    if payout.method != "stripe" or payout.status not in (Payout.Status.HELD, Payout.Status.PAID):
        raise ServiceError("bad_status", "Only held Stripe transfers can be reconciled.")
    account = PayoutAccount.objects.get(user_id=payout.user_id)
    transfer = gateway.retrieve_transfer(provider_ref)
    if payout.status == Payout.Status.PAID and payout.provider_ref != transfer["id"]:
        raise ServiceError("provider_mismatch", "This payout already has a different confirmed transfer.")
    # Paid records already pin the authoritative transfer ID; the instructor may
    # legitimately have changed destinations since that settlement.
    destination = transfer.get("destination") if payout.status == Payout.Status.PAID else account.stripe_account_id
    if not matching_transfer(transfer, payout, destination):
        raise ServiceError("provider_mismatch", "Provider confirmation does not match this payout.")
    if transfer.get("reversed") or transfer.get("amount_reversed", 0) > 0:
        # Record the evidence without inventing a reversal accounting policy or
        # erasing an earlier settlement. In particular, do not free its earnings.
        payout.failure_reason = "Stripe reports a transfer reversal; finance reconciliation required."
        payout.save(update_fields=["failure_reason", "updated_at"])
        PayoutRequest.objects.filter(payout=payout).update(reason=payout.failure_reason, updated_at=timezone.now())
        return payout
    if not confirmed_transfer(transfer, payout, destination):
        raise ServiceError("provider_mismatch", "Provider confirmation is incomplete.")
    complete(payout, transfer["id"])
    return payout


def transfer_event(obj):
    """Called only by the existing signature-verified Stripe dispatcher.

    Retrieve current provider state rather than trusting callback ordering. A
    duplicate confirmation never re-sends funds or releases ledger reservations.
    """
    from uuid import UUID

    description = obj.get("description") or ""
    if not description.startswith("LearnHub payout "):
        return
    try:
        payout_id = UUID(description.removeprefix("LearnHub payout "))
    except ValueError:
        return
    lock_payouts()
    payout = Payout.objects.select_for_update().filter(pk=payout_id).first()
    if payout is None or payout.method != "stripe":
        return
    if payout.status in (Payout.Status.HELD, Payout.Status.PAID):
        reconcile(payout, obj["id"])
