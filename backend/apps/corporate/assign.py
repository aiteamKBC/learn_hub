"""Assign training, recorded: courses the platform sells to companies use paid seats.

A course with an active, priced recorded offering is sold per seat. Giving it to people
from "Assign training" takes one paid seat per person who does not have it yet. Without
enough free seats nothing is assigned and the company is told how many to buy. Courses
without a company price (the company's own, or included in its plan) stay free, as before.
"""

from __future__ import annotations

from django.db import transaction

from core.errors import ServiceError

from .models import CorporateOffering
from .services import allocate_for_company, seat_inventory


def recorded_offer(course_id) -> CorporateOffering | None:
    return (
        CorporateOffering.objects.filter(
            course_id=course_id, delivery_type="recorded", is_active=True, price_tier__gbp_minor__gt=0
        )
        .select_related("price_tier")
        .first()
    )


def seat_check(org_id, course_id, needed: int) -> dict | None:
    """None when the course is not sold per seat. Otherwise the free seats and the gap."""
    offer = recorded_offer(course_id)
    if offer is None:
        return None
    free = seat_inventory(org_id, offer.id).get(str(offer.id), {}).get("available", 0)
    return {
        "offering_id": offer.id,
        "price_minor": offer.price_tier.gbp_minor,
        "currency": "GBP",
        "free": free,
        "needed": needed,
        "short": max(0, needed - free),
    }


@transaction.atomic
def assign_with_seats(request, scope, check: dict, user_ids: list) -> list:
    """One seat per person, all or nothing. Returns the user ids that got the course."""
    if check["short"] > 0:
        n = check["short"]
        raise ServiceError(
            "not_enough_seats",
            f"You need {n} more {'seat' if n == 1 else 'seats'}. Buy them, then assign again.",
            status=409,
            details={"short": n, "free": check["free"]},
        )
    for uid in user_ids:
        allocate_for_company(request, scope, check["offering_id"], uid)
    return list(user_ids)
