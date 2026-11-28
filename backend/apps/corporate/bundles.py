"""Course bundles and multi-course seat purchases.

* The platform admin builds a bundle: some courses + one seat price.
* A company admin buys seats in several courses with ONE Stripe payment, either
  - from a bundle: every seat costs the bundle's seat price, split between its courses
    however the company likes (a course may get no seats), or
  - as a basket: any recorded courses, each at its normal seat price.
* Each course becomes its own SeatPurchase (same ledger as single-course purchases), all
  sharing `checkout_group`. The webhook marks the whole group paid, then the employees
  named for each course are invited exactly as for a single purchase.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.commerce import gateway
from apps.platform.services import audit_request
from core.errors import ServiceError
from core.html import plain
from core.permissions import ROLE_RANK, OrgRole

from .models import BundleCourse, CourseBundle, SeatPurchase

MAX_LINES = 20
MAX_SEATS = 500


# ------------------------------------------------------------------ reads


def active_bundles():
    return CourseBundle.objects.filter(is_active=True).prefetch_related("items__course").order_by("title")


def bundle_out(b: CourseBundle) -> dict:
    from .offerings import recorded_course_prices

    items = sorted(b.items.all(), key=lambda i: (i.position, i.course.title))
    priced = set(
        recorded_course_prices()
        .filter(course_id__in=[i.course_id for i in items])
        .values_list("course_id", flat=True)
    )
    normal = dict(
        recorded_course_prices().filter(course_id__in=priced).values_list("course_id", "tier__gbp_minor")
    )
    return {
        "id": str(b.id),
        "title": b.title,
        "description": b.description,
        "seat_price_minor": b.seat_price_minor,
        "is_active": b.is_active,
        "currency": "GBP",
        "courses": [
            {
                "course_id": str(i.course_id),
                "title": i.course.title,
                "slug": i.course.slug,
                # seats can be bought only in courses sold as recorded today
                "seats_on_sale": i.course_id in priced,
                "normal_price_minor": normal.get(i.course_id),
            }
            for i in items
        ],
    }


# ------------------------------------------------------------------ admin (console)


def _clean_bundle(data: dict) -> dict:
    title = plain(str(data.get("title") or "")).strip()[:160]
    if not title:
        raise ServiceError("bad_title", "Give the bundle a name.", status=400)
    price = data.get("seat_price_minor")
    if price is None or int(price) < 1:
        raise ServiceError("bad_price", "Set a seat price above zero.", status=400)
    ids = list(dict.fromkeys(str(c) for c in data.get("course_ids") or []))
    if len(ids) < 2:
        raise ServiceError("bad_courses", "A bundle needs at least two courses.", status=400)
    if len(ids) > MAX_LINES:
        raise ServiceError("bad_courses", f"A bundle can hold up to {MAX_LINES} courses.", status=400)
    from apps.catalog.models import Course

    found = set(
        str(i)
        for i in Course.objects.filter(
            pk__in=ids, status=Course.Status.PUBLISHED, deleted_at__isnull=True, owner_org_id__isnull=True
        ).values_list("id", flat=True)
    )
    if len(found) != len(ids):
        raise ServiceError("bad_courses", "One of these courses is not published.", status=400)
    return {
        "title": title,
        "description": plain(str(data.get("description") or ""))[:2000],
        "seat_price_minor": int(price),
        "is_active": bool(data.get("is_active", True)),
        "course_ids": ids,
    }


@transaction.atomic
def save_bundle(request, data: dict, bundle_id=None) -> CourseBundle:
    clean = _clean_bundle(data)
    ids = clean.pop("course_ids")
    if bundle_id:
        b = CourseBundle.objects.select_for_update().filter(pk=bundle_id).first()
        if b is None:
            raise ServiceError("not_found", "Bundle not found.", status=404)
        for k, v in clean.items():
            setattr(b, k, v)
        b.save()
    else:
        b = CourseBundle.objects.create(**clean)
    BundleCourse.objects.filter(bundle=b).exclude(course_id__in=ids).delete()
    have = set(str(c) for c in BundleCourse.objects.filter(bundle=b).values_list("course_id", flat=True))
    for pos, cid in enumerate(ids):
        if cid in have:
            BundleCourse.objects.filter(bundle=b, course_id=cid).update(position=pos)
        else:
            BundleCourse.objects.create(bundle=b, course_id=cid, position=pos)
    audit_request(
        request, "bundle_saved", "course_bundle", b.id, data={"courses": ids, "price": b.seat_price_minor}
    )
    return b


# ------------------------------------------------------------------ company checkout


def create_basket_checkout(request, lines: list[dict], *, bundle_id=None, source="manual") -> dict:
    """lines: [{course_id, quantity, employees: [{email, full_name, job_title}]}].
    Every seat must have an employee before paying (same rule as one course)."""
    from apps.org.models import Organization, OrgMember

    from .offerings import ensure_recorded_offering
    from .pending import _clean_rows

    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)
    member = OrgMember.objects.filter(org_id=org_id, user_id=request.user.id, removed_at__isnull=True).first()
    if member is None or ROLE_RANK.get(OrgRole(member.role), -1) < ROLE_RANK[OrgRole.ADMIN]:
        raise ServiceError("forbidden", "Only company admins or owners may purchase.", status=403)
    if source not in ("manual", "csv"):
        source = "manual"

    lines = [ln for ln in lines if int(ln.get("quantity") or 0) > 0]
    if not lines:
        raise ServiceError("empty_basket", "Add seats to at least one course.", status=400)
    if len(lines) > MAX_LINES:
        raise ServiceError("too_many_courses", f"Up to {MAX_LINES} courses in one payment.", status=400)
    ids = [str(ln["course_id"]) for ln in lines]
    if len(set(ids)) != len(ids):
        raise ServiceError("duplicate_course", "Each course can appear once.", status=400)
    if sum(int(ln["quantity"]) for ln in lines) > MAX_SEATS:
        raise ServiceError("bad_quantity", f"Up to {MAX_SEATS} seats in one payment.", status=400)

    bundle = None
    if bundle_id:
        bundle = CourseBundle.objects.filter(pk=bundle_id, is_active=True).prefetch_related("items").first()
        if bundle is None:
            raise ServiceError("bundle_not_found", "This bundle is not on sale.", status=404)
        allowed = {str(i.course_id) for i in bundle.items.all()}
        if not set(ids) <= allowed:
            raise ServiceError("not_in_bundle", "One of these courses is not in the bundle.", status=400)

    # the same employee may be listed in several courses (one seat each); within a course
    # each person appears once (_clean_rows refuses duplicates)
    prepared = []
    for ln in lines:
        qty = int(ln["quantity"])
        offering, price = ensure_recorded_offering(ln["course_id"])
        if offering is None:
            raise ServiceError(
                "offering_not_found", "Seats in one of these courses are not on sale.", status=404
            )
        rows = _clean_rows(ln.get("employees") or [])
        if len(rows) != qty:
            raise ServiceError(
                "employees_required",
                f"{offering.course.title}: add an email for every seat before paying ({len(rows)} of {qty}).",
                status=400,
            )
        unit = bundle.seat_price_minor if bundle else price.tier.gbp_minor
        prepared.append((offering, qty, unit, [{**r, "_source": source} for r in rows]))

    group = uuid.uuid4()
    with transaction.atomic():
        purchases = [
            SeatPurchase.objects.create(
                org_id=org_id,
                offering=offering,
                buyer=request.user,
                quantity=qty,
                unit_price_minor=unit,
                currency="GBP",
                total_minor=unit * qty,
                gbp_total_minor=unit * qty,
                status=SeatPurchase.Status.PENDING,
                planned_employees=planned,
                checkout_group=group,
                bundle=bundle,
            )
            for offering, qty, unit, planned in prepared
        ]

    org = Organization.objects.filter(pk=org_id).first()
    suffix = f" ({bundle.title})" if bundle else ""
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "gbp",
                    "unit_amount": unit,
                    "product_data": {"name": f"{offering.course.title}: company seats{suffix}"},
                },
                "quantity": qty,
            }
            for offering, qty, unit, _ in prepared
        ],
        metadata={"kind": "corporate_basket", "id": str(group), "org_id": str(org_id)},
        customer_email=request.user.email,
        customer=(org.stripe_customer_id if org else "") or "",
        success_url=f"{settings.FRONTEND_URL}/business/purchases?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/business/packages",
        idempotency_key=f"corp_basket_{group}",
    )
    SeatPurchase.objects.filter(checkout_group=group).update(
        stripe_session_id=session["id"], updated_at=timezone.now()
    )
    total = sum(p.total_minor for p in purchases)
    audit_request(
        request,
        "corporate_basket_started",
        "seat_purchase",
        purchases[0].id,
        data={
            "group": str(group),
            "bundle": str(bundle.id) if bundle else None,
            "lines": len(purchases),
            "total": total,
        },
    )
    return {"purchase_id": str(group), "checkout_url": session["url"]}


# ------------------------------------------------------------------ webhook


def fulfil_basket(session: dict, meta: dict) -> None:
    from .fulfillment import fulfil_recorded_purchase

    group = meta.get("id")
    if not group:
        return
    from .pending import MAIL_LATER

    rows = list(SeatPurchase.objects.filter(checkout_group=group).order_by("created_at", "id"))
    for i, p in enumerate(rows):
        # people also listed in a later course of this payment are emailed once, by that
        # later course, with every course they were given
        later = {(e.get("email") or "").lower() for q in rows[i + 1 :] for e in (q.planned_employees or [])}
        token = MAIL_LATER.set(later)
        try:
            fulfil_recorded_purchase(session, {"id": str(p.id)})  # idempotent per purchase
        finally:
            MAIL_LATER.reset(token)


def close_basket(meta: dict, status: str) -> None:
    group = meta.get("id")
    if group:
        SeatPurchase.objects.filter(checkout_group=group, status=SeatPurchase.Status.PENDING).update(
            status=status, updated_at=timezone.now()
        )
