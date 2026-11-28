"""Console > Company packages > Recorded or live: the platform admin decides, per course,
whether companies can buy it as recorded seats, request it as live training, or both."""

from uuid import UUID

from django.db import transaction
from ninja import Schema

from apps.catalog.models import Course
from apps.commerce.models import CoursePrice
from apps.corporate.models import CorporateOffering
from apps.corporate.offerings import recorded_switched_off
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleOkOut, router, staff

REC = CorporateOffering.DeliveryType.RECORDED
LIVE = CorporateOffering.DeliveryType.LIVE


class ConsoleDeliveryRowOut(Schema):
    course_id: UUID
    title: str
    has_price: bool  # recorded seats need a catalogue price
    recorded: bool
    live: bool


class ConsoleDeliveryIn(Schema):
    recorded: bool | None = None
    live: bool | None = None


def _courses():
    return Course.objects.filter(status="published", deleted_at__isnull=True, owner_org_id__isnull=True)


@router.get("/corporate/delivery", response=list[ConsoleDeliveryRowOut])
def list_delivery(request):
    staff(request)
    priced = set(
        CoursePrice.objects.filter(is_free=False, tier__is_active=True, tier__gbp_minor__gt=0).values_list(
            "course_id", flat=True
        )
    )
    off = set(recorded_switched_off().values_list("course_id", flat=True))
    live = set(
        CorporateOffering.objects.filter(delivery_type=LIVE, is_active=True).values_list(
            "course_id", flat=True
        )
    )
    return [
        {"course_id": c.id, "title": c.title, "has_price": c.id in priced, "recorded": c.id in priced and c.id not in off, "live": c.id in live}
        for c in _courses().order_by("title").only("id", "title")[:500]
    ]  # fmt: skip


@router.post("/corporate/delivery/{course_id}", response=ConsoleOkOut)
@transaction.atomic
def set_delivery(request, course_id: UUID, body: ConsoleDeliveryIn):
    staff(request)
    course = _courses().filter(pk=course_id).first()
    if course is None:
        raise ServiceError("not_found", "Course not found.", status=404)
    price = CoursePrice.objects.filter(course=course).select_related("tier").first()

    def switch(kind, on: bool):
        rows = CorporateOffering.objects.select_for_update().filter(course=course, delivery_type=kind)
        if not on:
            if rows.filter(is_active=True).exists():
                rows.filter(is_active=True).update(is_active=False)
            elif kind == REC and not rows.exists() and price:
                # a closed row marks "recorded switched off" (see recorded_switched_off)
                CorporateOffering.objects.create(
                    course=course, delivery_type=kind, price_tier=price.tier, is_active=False
                )
            return
        if rows.filter(is_active=True).exists():
            return
        latest = rows.order_by("-updated_at").first()
        if latest is not None:
            latest.is_active = True
            latest.save(update_fields=["is_active", "updated_at"])
        elif price is not None and price.tier.gbp_minor > 0:
            CorporateOffering.objects.create(
                course=course, delivery_type=kind, price_tier=price.tier, is_active=True
            )
        else:
            raise ServiceError("no_price", "Give this course a price first.", status=400)

    from apps.catalog.cache import bump

    bump()  # bulk updates below send no signals: clear the course-list cache explicitly
    if body.recorded is not None:
        if body.recorded and (price is None or price.is_free):
            raise ServiceError("no_price", "Recorded seats need a paid course price.", status=400)
        switch(REC, body.recorded)
    if body.live is not None:
        switch(LIVE, body.live)
    audit_request(request, "corporate_delivery_set", "course", course.id, data=body.dict(exclude_none=True))
    return {"ok": True}
