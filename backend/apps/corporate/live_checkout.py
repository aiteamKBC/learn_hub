"""B2B-04: Live cohort payment — Stripe Checkout for confirmed cohort seats.

Company Admin pays for approved_seats in their CohortCompany placement after
admin has confirmed the cohort schedule.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.org.models import OrgMember, Organization
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.permissions import OrgRole, ROLE_RANK

from .models import CohortCompany, LiveCohort, SeatPurchase


@transaction.atomic
def create_live_checkout(request, cohort_company_id) -> dict:
    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)

    member = (
        OrgMember.objects
        .filter(org_id=org_id, user_id=request.user.id, removed_at__isnull=True)
        .first()
    )
    if member is None or ROLE_RANK.get(OrgRole(member.role), -1) < ROLE_RANK[OrgRole.ADMIN]:
        raise ServiceError("forbidden", "Only company admins or owners may pay.", status=403)

    cc = (
        CohortCompany.objects
        .select_for_update()
        .select_related("cohort__course")
        .filter(pk=cohort_company_id, org_id=org_id)
        .first()
    )
    if cc is None:
        raise ServiceError("not_found", "Cohort placement not found.", status=404)
    if cc.status not in (CohortCompany.Status.OFFERED, CohortCompany.Status.PENDING_PAY):
        raise ServiceError("not_payable", "This placement is not awaiting payment.", status=400)

    if cc.payment_deadline and cc.payment_deadline <= timezone.now():
        cc.status = CohortCompany.Status.CANCELLED
        cc.save(update_fields=["status", "updated_at"])
        raise ServiceError("deadline_passed", "Payment deadline has passed.", status=410)

    cohort = cc.cohort
    if cohort.status not in (LiveCohort.Status.CONFIRMED, LiveCohort.Status.PENDING_PAY):
        raise ServiceError("cohort_not_confirmed", "Cohort schedule is not confirmed yet.", status=400)

    from .models import CorporateOffering
    offering = CorporateOffering.objects.filter(
        course=cohort.course, delivery_type="live", is_active=True,
    ).first()
    if offering is None:
        raise ServiceError("no_offering", "No active live offering for this course.", status=404)

    unit_price = offering.price_tier.gbp_minor
    quantity = cc.approved_seats
    total = unit_price * quantity
    currency = "GBP"

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

    cc.seat_purchase = purchase
    cc.status = CohortCompany.Status.PENDING_PAY
    cc.save(update_fields=["seat_purchase", "status", "updated_at"])

    org = Organization.objects.filter(pk=org_id).first()
    customer_id = org.stripe_customer_id if org else ""

    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": currency.lower(),
                "unit_amount": unit_price,
                "product_data": {
                    "name": f"{cohort.course.title} — Live Training ({quantity} seats)",
                },
            },
            "quantity": quantity,
        }],
        metadata={
            "kind": "corporate_live",
            "id": str(purchase.id),
            "cohort_company_id": str(cc.id),
            "cohort_id": str(cohort.id),
            "org_id": str(org_id),
        },
        customer_email=request.user.email,
        customer=customer_id or "",
        success_url=f"{settings.FRONTEND_URL}/business/live-bookings?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/business/live-bookings",
        idempotency_key=f"corp_live_checkout_{cc.id}",
    )

    purchase.stripe_session_id = session["id"]
    purchase.save(update_fields=["stripe_session_id", "updated_at"])

    audit_request(
        request, "live_checkout_started", "seat_purchase", purchase.id,
        data={"cohort_id": str(cohort.id), "seats": quantity, "total": total},
    )

    return {"purchase_id": str(purchase.id), "checkout_url": session["url"]}


def fulfil_live_purchase(session: dict, meta: dict) -> None:
    """Called from webhook when corporate_live checkout completes."""
    from .fulfillment import fulfil_recorded_purchase
    fulfil_recorded_purchase(session, meta)

    cc_id = meta.get("cohort_company_id")
    if cc_id:
        CohortCompany.objects.filter(pk=cc_id, status="pending_pay").update(
            status="paid", updated_at=timezone.now(),
        )
