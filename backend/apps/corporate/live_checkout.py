"""B2B-04: Live cohort payment — Stripe Checkout for confirmed cohort seats.

Company Admin pays for approved_seats in their CohortCompany placement after
admin has confirmed the cohort schedule.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.org.models import Organization, OrgMember
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.permissions import ROLE_RANK, OrgRole

from .models import CohortCompany, LiveCohort, SeatPurchase


def create_live_checkout(request, cohort_company_id) -> dict:
    # A passed deadline closes the placement. That write must survive the error the
    # buyer sees, so it happens outside the atomic block that raises.
    org_id = getattr(request, "org_id", None)
    expired = CohortCompany.objects.filter(
        pk=cohort_company_id, org_id=org_id,
        status__in=[CohortCompany.Status.OFFERED, CohortCompany.Status.PENDING_PAY],
        payment_deadline__lte=timezone.now(),
    ).update(status=CohortCompany.Status.CANCELLED, updated_at=timezone.now())
    if expired:
        raise ServiceError("deadline_passed", "The payment deadline has passed. Contact us to rebook.", status=410)
    return _create_live_checkout(request, cohort_company_id)


@transaction.atomic
def _create_live_checkout(request, cohort_company_id) -> dict:
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
        .select_for_update()  # no join: it would lock and RLS-filter the joined table
        .filter(pk=cohort_company_id, org_id=org_id)
        .first()
    )
    if cc is None:
        raise ServiceError("not_found", "Cohort placement not found.", status=404)
    if cc.status not in (CohortCompany.Status.OFFERED, CohortCompany.Status.PENDING_PAY):
        raise ServiceError("not_payable", "This placement is not awaiting payment.", status=400)


    cohort = cc.cohort
    if cohort.status not in (LiveCohort.Status.CONFIRMED, LiveCohort.Status.PENDING_PAY):
        raise ServiceError("cohort_not_confirmed", "Cohort schedule is not confirmed yet.", status=400)

    from .models import CorporateOffering
    offering = CorporateOffering.objects.filter(
        course=cohort.course, delivery_type="live", is_active=True,
    ).first()
    if offering is None:
        raise ServiceError("no_offering", "No active live offering for this course.", status=404)

    # A retry (the buyer closed Stripe and pressed Pay again) replaces the earlier
    # unpaid attempt instead of leaving two pending purchases for one booking.
    if cc.seat_purchase_id is not None:
        SeatPurchase.objects.filter(pk=cc.seat_purchase_id, status=SeatPurchase.Status.PENDING).update(
            status=SeatPurchase.Status.VOIDED, updated_at=timezone.now()
        )

    unit_price = offering.price_tier.gbp_minor
    if unit_price <= 0:  # the admin has not set a live price for this course
        raise ServiceError("no_price", "Live training for this course has no price yet.", status=400)
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
        idempotency_key=f"corp_live_checkout_{purchase.id}",  # one Stripe session per attempt
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
        # only the booking's current attempt confirms it (an older, replaced attempt
        # that still gets paid stays visible to staff as a paid purchase to refund)
        CohortCompany.objects.filter(pk=cc_id, status="pending_pay", seat_purchase_id=meta.get("id")).update(
            status="paid", updated_at=timezone.now(),
        )
