"""B2B-02: Recorded package checkout via Stripe Checkout.

Company Admin/Owner selects an offering + quantity → we create a pending SeatPurchase,
then redirect to Stripe. Only the `checkout.session.completed` webhook marks it paid.
"""

from __future__ import annotations

import uuid

from django.conf import settings

from apps.commerce import gateway
from apps.org.models import OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.permissions import OrgRole, ROLE_RANK

from .models import CorporateOffering, SeatPurchase


def create_recorded_checkout(request, offering_id, quantity: int) -> dict:
    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)

    member = (
        OrgMember.objects
        .filter(org_id=org_id, user_id=request.user.id, removed_at__isnull=True)
        .first()
    )
    if member is None or ROLE_RANK.get(OrgRole(member.role), -1) < ROLE_RANK[OrgRole.ADMIN]:
        raise ServiceError("forbidden", "Only company admins or owners may purchase.", status=403)

    offering = (
        CorporateOffering.objects
        .select_related("price_tier", "course")
        .filter(pk=offering_id, is_active=True, delivery_type="recorded")
        .first()
    )
    if offering is None:
        raise ServiceError("offering_not_found", "Active recorded offering not found.", status=404)

    if quantity < 1 or quantity > 500:
        raise ServiceError("bad_quantity", "Quantity must be between 1 and 500.", status=400)

    unit_price = offering.price_tier.gbp_minor
    currency = "GBP"
    total = unit_price * quantity

    purchase = SeatPurchase.objects.create(
        org_id=org_id,
        offering=offering,
        buyer=request.user,
        quantity=quantity,
        unit_price_minor=unit_price,
        currency=currency,
        total_minor=total,
        gbp_total_minor=total,
        status=SeatPurchase.Status.PENDING,
    )

    from apps.org.models import Organization
    org = Organization.objects.filter(pk=org_id).first()
    customer_id = org.stripe_customer_id if org else ""

    idempotency_key = f"corp_checkout_{purchase.id}"
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": currency.lower(),
                "unit_amount": unit_price,
                "product_data": {"name": f"{offering.course.title} — Corporate Seats"},
            },
            "quantity": quantity,
        }],
        metadata={
            "kind": "corporate_recorded",
            "id": str(purchase.id),
            "offering_id": str(offering.id),
            "org_id": str(org_id),
        },
        customer_email=request.user.email,
        customer=customer_id or "",
        success_url=f"{settings.FRONTEND_URL}/business/purchases?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/business/packages",
        idempotency_key=idempotency_key,
    )

    purchase.stripe_session_id = session["id"]
    purchase.save(update_fields=["stripe_session_id", "updated_at"])

    audit_request(
        request, "corporate_checkout_started", "seat_purchase", purchase.id,
        data={"offering_id": str(offering.id), "quantity": quantity, "total": total},
    )

    return {"purchase_id": str(purchase.id), "checkout_url": session["url"]}
