"""Resolve company recorded seats from the platform's shared course price.

CorporateOffering remains the ledger key for historical purchases and seat
allocations. Recorded prices and availability come from CoursePrice, the same
catalogue price used by individual learners. Live offerings remain company-only.
"""

from __future__ import annotations

from django.db import transaction

from apps.catalog.models import Course
from apps.commerce.models import CoursePrice
from core.tenancy import tenant_context

from .models import CorporateOffering


def recorded_course_prices():
    """Published, non-company courses with an active paid catalogue price."""
    return (
        CoursePrice.objects.filter(
            is_free=False,
            tier__is_active=True,
            tier__gbp_minor__gt=0,
            course__status=Course.Status.PUBLISHED,
            course__owner_org_id__isnull=True,
            course__deleted_at__isnull=True,
        )
        .select_related("course", "tier")
        .order_by("course__title")
    )


@transaction.atomic
def ensure_recorded_offering(course_id):
    """Return the seat-ledger row for a currently priced course, syncing its tier.

    The offering table is platform-owned. This narrow staff context lets an already
    authorized company checkout or assignment resolve the shared-price course without
    granting company users write access to global course offers.
    """
    price = recorded_course_prices().filter(course_id=course_id).first()
    if price is None:
        return None, None

    with tenant_context(staff=True):
        offering, _ = CorporateOffering.objects.get_or_create(
            course_id=price.course_id,
            delivery_type=CorporateOffering.DeliveryType.RECORDED,
            is_active=True,
            defaults={"price_tier_id": price.tier_id},
        )
        if offering.price_tier_id != price.tier_id:
            offering.price_tier_id = price.tier_id
            offering.save(update_fields=["price_tier", "updated_at"])
    return offering, price
