"""Console > Packages: staff manage the B2C cash course-bundles (CashPackage).

A package bundles several courses for a one-off cash price (via a PriceTier). Learners buy it
on /packages; on payment each included course becomes a ContentEntitlement(source=cash_package).
This module is the staff CRUD that was missing, so bundles can be created without a seed.
"""

from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from ninja import Field, Schema

from apps.catalog.models import Course
from apps.commerce.models import CashPackage, CashPackageCourse, CoursePrice, PriceTier
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, router, staff


# ----------------------------------------------------------------------- schemas
class ConsolePackageCourseOut(Schema):
    id: UUID
    title: str
    slug: str


class ConsolePackageOut(Schema):
    id: UUID
    name: str
    slug: str
    description: str
    price_tier_id: UUID
    price_gbp_minor: int
    # Sum of the included courses' own cash prices — lets the UI show the saving, and the
    # server blocks a bundle that costs more than buying the courses separately.
    courses_cash_total_minor: int
    is_active: bool
    course_count: int
    courses: list[ConsolePackageCourseOut]


class ConsolePackageIn(Schema):
    name: str = Field(..., min_length=2, max_length=200)
    description: str = Field("", max_length=4000)
    price_tier_id: UUID
    course_ids: list[UUID] = Field(default_factory=list, max_length=500)


class ConsolePackagePatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = Field(None, max_length=4000)
    price_tier_id: UUID | None = None
    is_active: bool | None = None
    course_ids: list[UUID] | None = Field(None, max_length=500)


# ----------------------------------------------------------------------- helpers
def _snapshot_map(course_ids) -> dict:
    """Each course's current GBP list price in pence, in ONE query (no N+1). Free/unpriced = 0."""
    rows = CoursePrice.objects.filter(course_id__in=course_ids).select_related("tier")
    return {cp.course_id: (0 if cp.is_free or cp.tier is None else cp.tier.gbp_minor) for cp in rows}


def _validate_courses(course_ids: list) -> tuple[set, dict]:
    """Keep only platform-owned, PUBLISHED, live courses; return their ids and price snapshots.
    Draft/unpublished courses can't be sold, so they must not go in a sellable bundle."""
    ids = set(
        Course.objects.filter(
            pk__in=course_ids, owner_org_id__isnull=True, deleted_at__isnull=True,
            status="published", live_version__isnull=False,
        ).values_list("id", flat=True)
    )
    if course_ids and not ids:
        raise ServiceError("no_courses", "None of the chosen courses are published and sellable.")
    return ids, _snapshot_map(ids)


def _guard_price(tier: PriceTier, snapshots: dict) -> None:
    """A bundle must never cost MORE than buying its courses separately (it'd be pointless)."""
    total = sum(snapshots.values())
    if total > 0 and tier.gbp_minor > total:
        raise ServiceError(
            "price_too_high",
            f"Bundle price £{tier.gbp_minor / 100:.2f} is more than buying the courses separately "
            f"(£{total / 100:.2f}). Choose a lower price so the bundle is a saving.",
        )


def _set_courses(pkg: CashPackage, ids: set, snapshots: dict) -> None:
    """Replace the package's course set and REFRESH every snapshot to today's price (so revenue
    share doesn't drift when a course's price later changes)."""
    CashPackageCourse.objects.filter(package=pkg).exclude(course_id__in=ids).delete()
    have = {r.course_id: r for r in CashPackageCourse.objects.filter(package=pkg)}
    to_create, to_update = [], []
    for cid in ids:
        snap = snapshots.get(cid, 0)
        if cid in have:
            row = have[cid]
            if row.snapshot_gbp_minor != snap:
                row.snapshot_gbp_minor = snap
                to_update.append(row)
        else:
            to_create.append(CashPackageCourse(package=pkg, course_id=cid, snapshot_gbp_minor=snap))
    if to_create:
        CashPackageCourse.objects.bulk_create(to_create)
    if to_update:
        CashPackageCourse.objects.bulk_update(to_update, ["snapshot_gbp_minor"])


def _row(pkg: CashPackage) -> dict:
    courses = list(
        CashPackageCourse.objects.filter(package=pkg)
        .select_related("course")
        .values_list("course_id", "course__title", "course__slug", "snapshot_gbp_minor")
    )
    return {
        "id": pkg.id, "name": pkg.name, "slug": pkg.slug, "description": pkg.description,
        "price_tier_id": pkg.price_tier_id, "price_gbp_minor": pkg.price_tier.gbp_minor,
        "courses_cash_total_minor": sum(snap for *_, snap in courses),
        "is_active": pkg.is_active, "course_count": len(courses),
        "courses": [{"id": c, "title": t, "slug": s} for c, t, s, _ in courses],
    }


def _unique_slug(name: str) -> str:
    base = slugify(name)[:110] or "package"
    slug, i = base, 2
    while CashPackage.objects.filter(slug=slug).exists():
        slug = f"{base}-{i}"[:120]
        i += 1
    return slug


# ----------------------------------------------------------------------- endpoints
@router.get("/packages", response=list[ConsolePackageOut])
def list_packages(request):
    staff(request)
    pkgs = CashPackage.objects.select_related("price_tier").order_by("-is_active", "name")
    return [_row(p) for p in pkgs]


@router.post("/packages", response=ConsoleIdOut)
@transaction.atomic
def create_package(request, body: ConsolePackageIn):
    staff(request)
    tier = get_object_or_404(PriceTier, pk=body.price_tier_id)
    ids, snapshots = _validate_courses(body.course_ids)
    _guard_price(tier, snapshots)
    pkg = CashPackage.objects.create(
        name=html.plain(body.name, 200),
        slug=_unique_slug(body.name),
        description=html.plain(body.description, 4000),
        price_tier=tier,
        is_active=True,
        created_by=request.user,
    )
    _set_courses(pkg, ids, snapshots)
    audit_request(request, "cash_package.create", "cash_package", pkg.id,
                  {"name": pkg.name, "price_tier_id": str(tier.id), "course_ids": len(ids)})
    return {"id": pkg.id}


@router.patch("/packages/{package_id}", response=ConsoleOkOut)
@transaction.atomic
def update_package(request, package_id: UUID, body: ConsolePackagePatch):
    staff(request)
    pkg = get_object_or_404(CashPackage, pk=package_id)
    sent = body.dict(exclude_unset=True)

    # Work out the resulting tier + course set, then guard the price BEFORE saving anything.
    tier = get_object_or_404(PriceTier, pk=sent["price_tier_id"]) if sent.get("price_tier_id") else pkg.price_tier
    if sent.get("course_ids") is not None:
        ids, snapshots = _validate_courses(sent["course_ids"])
    else:
        ids = set(CashPackageCourse.objects.filter(package=pkg).values_list("course_id", flat=True))
        snapshots = _snapshot_map(ids)
    _guard_price(tier, snapshots)

    if sent.get("name") is not None:
        pkg.name = html.plain(sent["name"], 200)
    if sent.get("description") is not None:
        pkg.description = html.plain(sent["description"], 4000)
    pkg.price_tier = tier
    if sent.get("is_active") is not None:
        pkg.is_active = sent["is_active"]
    pkg.save()
    _set_courses(pkg, ids, snapshots)  # also refreshes snapshots to today's prices
    audit_request(request, "cash_package.update", "cash_package", pkg.id,
                  {k: (len(v) if isinstance(v, list) else str(v)) for k, v in sent.items()})
    return {"ok": True}


@router.delete("/packages/{package_id}", response=ConsoleOkOut)
def delete_package(request, package_id: UUID):
    """Soft delete: deactivate so existing buyers keep their entitlements."""
    staff(request)
    pkg = get_object_or_404(CashPackage, pk=package_id)
    if pkg.is_active:
        pkg.is_active = False
        pkg.save(update_fields=["is_active", "updated_at"])
    audit_request(request, "cash_package.deactivate", "cash_package", pkg.id, {})
    return {"ok": True}
