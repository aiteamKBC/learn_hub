"""B2B-02: Custom quote flow via Stripe Invoicing.

Admin creates quote → adds items → sends via Stripe Invoice → company pays →
invoice.paid webhook triggers seat credit.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.org.models import Organization
from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CorporateOffering, CorporateQuote, QuoteItem, SeatPurchase


@transaction.atomic
def send_quote(request, quote_id) -> CorporateQuote:
    quote = (
        CorporateQuote.objects
        .select_for_update()
        .select_related("org")
        .filter(pk=quote_id)
        .first()
    )
    if quote is None:
        raise ServiceError("quote_not_found", "Quote not found.", status=404)
    if quote.status != CorporateQuote.Status.DRAFT:
        raise ServiceError("not_draft", "Only draft quotes can be sent.", status=400)

    items = list(QuoteItem.objects.filter(quote=quote).select_related("offering__course"))
    if not items:
        raise ServiceError("no_items", "Quote has no items.", status=400)

    if quote.valid_until <= timezone.now():
        raise ServiceError("already_expired", "Quote validity date is in the past.", status=400)

    org = quote.org
    customer_id = org.stripe_customer_id
    if not customer_id:
        customer_id = gateway.create_customer(
            email=quote.buyer.email,
            name=org.name,
            metadata={"org_id": str(org.id)},
            idempotency_key=f"corp_customer_{org.id}",
        )
        Organization.objects.filter(pk=org.id).update(
            stripe_customer_id=customer_id, updated_at=timezone.now(),
        )

    inv = gateway.create_invoice(
        customer=customer_id,
        metadata={
            "kind": "corporate_quote",
            "id": str(quote.id),
            "org_id": str(org.id),
        },
        collection_method="send_invoice",
        days_until_due=max(1, (quote.valid_until - timezone.now()).days),
        currency=quote.currency,
        description=f"Corporate training quote for {org.name}",
        idempotency_key=f"corp_invoice_{quote.id}",
    )

    for item in items:
        gateway.add_invoice_item(
            invoice_id=inv["id"],
            description=f"{item.offering.course.title} ({item.offering.delivery_type}) × {item.quantity}",
            amount=item.unit_price_minor,
            currency=quote.currency,
            quantity=item.quantity,
        )

    finalized = gateway.finalize_invoice(inv["id"])
    sent = gateway.send_invoice(inv["id"])

    quote.status = CorporateQuote.Status.SENT
    quote.stripe_invoice_id = inv["id"]
    quote.stripe_invoice_url = sent.get("hosted_invoice_url", "")
    quote.save(update_fields=["status", "stripe_invoice_id", "stripe_invoice_url", "updated_at"])

    audit_request(
        request, "quote_sent", "corporate_quote", quote.id,
        data={"stripe_invoice_id": inv["id"], "total": quote.total_minor},
    )

    return quote


@transaction.atomic
def void_quote(request, quote_id) -> CorporateQuote:
    quote = (
        CorporateQuote.objects
        .select_for_update()
        .filter(pk=quote_id)
        .first()
    )
    if quote is None:
        raise ServiceError("quote_not_found", "Quote not found.", status=404)
    if quote.status not in (CorporateQuote.Status.DRAFT, CorporateQuote.Status.SENT):
        raise ServiceError("not_voidable", "Only draft or sent quotes can be voided.", status=400)

    if quote.stripe_invoice_id:
        gateway.void_invoice(quote.stripe_invoice_id)

    quote.status = CorporateQuote.Status.VOIDED
    quote.save(update_fields=["status", "updated_at"])

    audit_request(request, "quote_voided", "corporate_quote", quote.id)
    return quote


@transaction.atomic
def fulfil_quote(invoice: dict) -> None:
    meta = invoice.get("metadata") or {}
    quote_id = meta.get("id")
    if not quote_id:
        return

    quote = (
        CorporateQuote.objects
        .select_for_update()
        .filter(pk=quote_id)
        .first()
    )
    if quote is None:
        return
    if quote.status == CorporateQuote.Status.ACCEPTED:
        return

    items = list(QuoteItem.objects.filter(quote=quote).select_related("offering"))

    for item in items:
        SeatPurchase.objects.create(
            org_id=quote.org_id,
            offering=item.offering,
            buyer_id=quote.buyer_id,
            quantity=item.quantity,
            unit_price_minor=item.unit_price_minor,
            currency=quote.currency,
            total_minor=item.line_total_minor,
            gbp_total_minor=item.line_total_minor,
            status=SeatPurchase.Status.PAID,
            stripe_invoice_id=quote.stripe_invoice_id,
            paid_at=timezone.now(),
            quote=quote,
        )

    quote.status = CorporateQuote.Status.ACCEPTED
    quote.save(update_fields=["status", "updated_at"])
