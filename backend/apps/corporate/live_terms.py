"""Live course payment terms (platform admin): course length, a deposit that covers the
first months, then instalments each covering some months, plus a private-intake price.
Read by the live booking (deposit), the renewal reminders and the access check."""

from __future__ import annotations

from django.db import transaction

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CorporateOffering, LiveCohort, LiveCourseTerms

MAX_MONTHS = 60
MAX_PARTS = 24


def _bad(msg: str):
    raise ServiceError("bad_terms", msg, status=400)


def clean_terms(data: dict) -> dict:
    months = int(data.get("programme_months") or 0)
    dep_m = int(data.get("deposit_months") or 0)
    dep = int(data.get("deposit_minor") or 0)
    parts = data.get("instalments") or []
    if not 1 <= months <= MAX_MONTHS:
        _bad(f"Course length must be 1 to {MAX_MONTHS} months.")
    if not 1 <= dep_m <= months:
        _bad("The deposit must cover between 1 month and the whole course.")
    if dep < 1:
        _bad("Set the deposit amount.")
    if len(parts) > MAX_PARTS:
        _bad(f"Up to {MAX_PARTS} instalments.")
    clean = []
    for n, p in enumerate(parts, start=1):
        m, a = int(p.get("months") or 0), int(p.get("amount_minor") or 0)
        if m < 1 or a < 1:
            _bad(f"Instalment {n}: set the months it covers and its amount.")
        clean.append({"months": m, "amount_minor": a})
    covered = dep_m + sum(p["months"] for p in clean)
    if covered != months:
        _bad(f"The deposit and instalments cover {covered} months; the course is {months} months.")
    private = data.get("private_price_minor")
    private = int(private) if private not in (None, "", 0) else None
    if private is not None and private < 1:
        _bad("The private intake price must be above zero.")
    return {
        "programme_months": months,
        "deposit_months": dep_m,
        "deposit_minor": dep,
        "instalments": clean,
        "private_price_minor": private,
    }


def terms_out(course, terms: LiveCourseTerms | None, intakes: list) -> dict:
    return {
        "course_id": str(course.id),
        "title": course.title,
        "has_terms": terms is not None,
        "programme_months": terms.programme_months if terms else None,
        "deposit_months": terms.deposit_months if terms else None,
        "deposit_minor": terms.deposit_minor if terms else None,
        "instalments": terms.instalments if terms else [],
        "seat_price_minor": terms.seat_price_minor if terms else None,
        "private_price_minor": terms.private_price_minor if terms else None,
        "intakes": intakes,
    }


def live_courses_with_terms() -> list[dict]:
    """Every course offered live, its terms (if set) and its upcoming public intakes."""
    from django.utils import timezone

    offers = (
        CorporateOffering.objects.filter(delivery_type=CorporateOffering.DeliveryType.LIVE, is_active=True)
        .select_related("course")
        .order_by("course__title")
    )
    courses = {o.course_id: o.course for o in offers}
    terms = {t.course_id: t for t in LiveCourseTerms.objects.filter(course_id__in=courses)}
    today = timezone.localdate()
    intakes: dict = {}
    for c in (
        LiveCohort.objects.filter(course_id__in=courses, scheduled_start__gte=today, private_org__isnull=True)
        .exclude(status=LiveCohort.Status.CANCELLED)
        .order_by("scheduled_start")
    ):
        intakes.setdefault(c.course_id, []).append(
            {"id": str(c.id), "title": c.title or c.intake or "Intake", "starts_on": c.scheduled_start}
        )
    return [terms_out(c, terms.get(cid), intakes.get(cid, [])[:3]) for cid, c in courses.items()]


@transaction.atomic
def save_terms(request, course_id, data: dict) -> LiveCourseTerms:
    offered = CorporateOffering.objects.filter(
        course_id=course_id, delivery_type=CorporateOffering.DeliveryType.LIVE, is_active=True
    ).exists()
    if not offered:
        raise ServiceError("not_live", "Switch live on for this course first.", status=400)
    clean = clean_terms(data)
    terms, _ = LiveCourseTerms.objects.update_or_create(
        course_id=course_id, defaults={**clean, "updated_by": request.user}
    )
    audit_request(request, "live_terms_saved", "course", course_id, data=clean)
    return terms
