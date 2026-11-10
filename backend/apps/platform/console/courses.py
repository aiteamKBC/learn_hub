"""Console > Courses (mockup 45): every course with KPIs, filters and bulk actions, the
detail panel (overview, content, pricing & access, performance, versions), company
(platform-owned) courses and categories."""

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog import certificates
from apps.catalog import services as catalog
from apps.catalog.models import Category, Course, CourseInstructor, CourseVersion
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleOkOut, clamp, router, staff

TABS = ("all", "company", "instructor", "archived")
STATUSES = ("draft", "published", "unlisted", "archived", "pending")
OWNERSHIP_LABEL = {"platform": "Company course", "instructor": "Instructor course",
                   "organization": "Company private"}  # fmt: skip


# ---------------------------------------------------------------- schemas
class ConsoleCourseKpisOut(Schema):
    total: int
    published: int
    pending: int
    drafts: int
    archived: int


class ConsoleCourseRowOut(Schema):
    id: UUID
    title: str
    slug: str
    thumbnail_url: str
    ownership: str
    owner_name: str
    category_id: UUID | None
    category: str | None
    price_gbp_minor: int | None
    is_free: bool
    in_subscription: bool
    enrolments: int
    rating_avg: float
    rating_count: int
    status: str
    in_review: bool
    has_live_version: bool
    deleted: bool


class ConsoleOptionOut(Schema):
    value: str
    label: str


class ConsoleCoursePageOut(Schema):
    kpis: ConsoleCourseKpisOut
    items: list[ConsoleCourseRowOut]
    next_cursor: str | None
    languages: list[ConsoleOptionOut]


class ConsoleCourseSectionOut(Schema):
    title: str
    lessons: int
    duration_sec: int


class ConsoleCourseVersionOut(Schema):
    id: UUID
    number: int
    status: str
    is_major_change: bool
    change_summary: str
    submitted_at: datetime | None
    reviewed_at: datetime | None
    review_notes: str
    published_at: datetime | None


class ConsoleCoursePlanOut(Schema):
    id: UUID
    name: str


class ConsoleTierOptionOut(Schema):
    id: UUID
    name: str
    gbp_minor: int


class ConsoleCoursePerformanceOut(Schema):
    enrolments: int
    active: int
    completed: int
    completion_pct: float
    enrolments_30d: int
    rating_avg: float
    rating_count: int
    sales: int
    revenue_gbp_minor: int
    refunds: int


class ConsoleCourseDetailOut(ConsoleCourseRowOut):
    subtitle: str
    description: str
    level: str
    language: str
    access_days: int | None
    in_business: bool
    price_tier_id: UUID | None
    certificate_template: str | None
    created_at: datetime
    published_at: datetime | None
    instructors: list[str]
    plans: list[ConsoleCoursePlanOut]
    sections: list[ConsoleCourseSectionOut]
    performance: ConsoleCoursePerformanceOut
    versions: list[ConsoleCourseVersionOut]
    tiers: list[ConsoleTierOptionOut]


class ConsoleCoursePatch(Schema):
    category_id: UUID | None = None
    language: str | None = None
    access_days: int | None = Field(None, ge=1, le=3650)
    lifetime_access: bool | None = None  # true clears access_days
    in_subscription: bool | None = None
    in_business: bool | None = None
    level: Literal["beginner", "intermediate", "advanced", "all"] | None = None


class ConsoleCoursePriceIn(Schema):
    free: bool = False
    tier_id: UUID | None = None


class ConsoleCourseStatusIn(Schema):
    action: Literal["publish", "unpublish", "archive", "relist"]
    reason: str = Field("", max_length=300)


class ConsoleBulkIn(Schema):
    ids: list[UUID] = Field(..., min_length=1, max_length=100)
    action: Literal["publish", "unpublish", "archive", "duplicate", "category", "delete"]
    reason: str = Field("", max_length=300)
    category_id: UUID | None = None


class ConsoleBulkFailureOut(Schema):
    id: UUID
    title: str
    message: str


class ConsoleBulkOut(Schema):
    done: int
    failed: list[ConsoleBulkFailureOut]


class ConsoleCompanyCourseIn(Schema):
    title: str = Field(..., min_length=3, max_length=160)
    category_id: UUID | None = None


class ConsoleCategoryOut(Schema):
    id: UUID
    name: str
    slug: str
    icon: str
    parent_id: UUID | None
    sort_order: int
    is_active: bool
    course_count: int


class ConsoleCategoryIn(Schema):
    name: str = Field(..., min_length=2, max_length=120)
    icon: str = Field("", max_length=48)
    parent_id: UUID | None = None


class ConsoleCategoryPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=120)
    icon: str | None = Field(None, max_length=48)
    is_active: bool | None = None


class ConsoleCategoryOrderIn(Schema):
    ids: list[UUID] = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------- reads
def _filtered(tab: str, status: str, category: UUID | None, q: str):
    qs = Course.objects.all()
    if tab == "archived":
        qs = qs.filter(Q(status="archived") | Q(deleted_at__isnull=False))
    else:
        qs = qs.filter(deleted_at__isnull=True)
    if tab == "company":
        qs = qs.filter(ownership__in=["platform", "organization"])
    elif tab == "instructor":
        qs = qs.filter(ownership="instructor")
    if status == "pending":
        qs = qs.filter(versions__status="in_review")
    elif status:
        qs = qs.filter(status=status)
    if category:
        qs = qs.filter(Q(category_id=category) | Q(category__parent_id=category))
    needle = html.plain(q, 100).strip()
    if needle:
        qs = qs.filter(Q(title__icontains=needle) | Q(created_by__full_name__icontains=needle)
                       | Q(category__name__icontains=needle))  # fmt: skip
    return qs


def _rows(courses: list[Course]) -> list[dict]:
    """Table rows for one page: prices, enrolments and review state in 3 grouped queries."""
    from apps.commerce.models import CoursePrice
    from apps.learning.models import Enrollment

    ids = [c.id for c in courses]
    prices = {p.course_id: p for p in CoursePrice.objects.filter(course_id__in=ids).select_related("tier")}
    enrolled = dict(
        Enrollment.objects.filter(course_id__in=ids).exclude(status__in=["revoked", "superseded"])
        .values("course_id").annotate(n=Count("id")).values_list("course_id", "n")
    )  # fmt: skip
    in_review = set(
        CourseVersion.objects.filter(course_id__in=ids, status="in_review").values_list(
            "course_id", flat=True
        )
    )
    out = []
    for c in courses:
        p = prices.get(c.id)
        owner = (
            "Platform"
            if c.ownership == "platform"
            else (c.created_by.full_name or c.created_by.email.split("@")[0])
        )
        out.append({"id": c.id, "title": c.title, "slug": c.slug, "thumbnail_url": c.thumbnail_url,
                    "ownership": c.ownership, "owner_name": owner, "category_id": c.category_id,
                    "category": c.category.name if c.category else None,
                    "price_gbp_minor": p.tier.gbp_minor if p and p.tier else None, "is_free": bool(p and p.is_free),
                    "in_subscription": c.in_subscription, "enrolments": enrolled.get(c.id, 0),
                    "rating_avg": float(c.rating_avg), "rating_count": c.rating_count, "status": c.status,
                    "in_review": c.id in in_review, "has_live_version": c.live_version_id is not None,
                    "deleted": c.deleted_at is not None})  # fmt: skip
    return out


@router.get("/courses", response=ConsoleCoursePageOut)
def courses(request, tab: str = "all", status: str = "", category: UUID | None = None, q: str = "",
            cursor: str | None = None, limit: int = 25):  # fmt: skip
    staff(request)
    if tab not in TABS or (status and status not in STATUSES):
        raise ServiceError("bad_filter", "Unknown filter.")
    limit = clamp(limit, 100)
    live = Course.objects.filter(deleted_at__isnull=True)
    k = live.aggregate(total=Count("id"), published=Count("id", filter=Q(status="published")),
                       drafts=Count("id", filter=Q(status="draft")),
                       archived=Count("id", filter=Q(status="archived")))  # fmt: skip
    k["pending"] = CourseVersion.objects.filter(status="in_review", course__deleted_at__isnull=True).count()
    qs = _filtered(tab, status, category, q).distinct()
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    page = list(qs.select_related("category", "created_by").order_by("-id")[: limit + 1])
    more = len(page) > limit
    page = page[:limit]
    return {"kpis": k, "items": _rows(page), "next_cursor": keyset.encode(page[-1].id) if more else None,
            "languages": [{"value": code, "label": label} for code, label in catalog.LANGUAGES.items()]}  # fmt: skip


def _course(course_id) -> Course:
    return get_object_or_404(
        Course.objects.select_related("category", "created_by", "live_version"), pk=course_id
    )


@router.get("/courses/{uuid:course_id}", response=ConsoleCourseDetailOut)
def course_detail(request, course_id: UUID):
    staff(request)
    from apps.commerce.models import CoursePrice, OrderItem, Plan, PlanCourse, PriceTier
    from apps.learning.models import Enrollment

    c = _course(course_id)
    row = _rows([c])[0]
    price = CoursePrice.objects.filter(course=c).first()
    version = c.live_version or c.versions.order_by("-number").first()
    sections = []
    if version:
        sections = [{"title": s.title, "lessons": s.n, "duration_sec": s.d or 0}
                    for s in version.sections.annotate(n=Count("lectures"), d=Sum("lectures__duration_sec"))
                    .order_by("position")]  # fmt: skip
    enrol = Enrollment.objects.filter(course=c).exclude(status__in=["revoked", "superseded"]).aggregate(
        total=Count("id"), active=Count("id", filter=Q(status="active")),
        completed=Count("id", filter=Q(status="completed")),
        recent=Count("id", filter=Q(enrolled_at__gte=timezone.now() - timedelta(days=30))),
    )  # fmt: skip
    sold = OrderItem.objects.filter(course=c, order__status__in=["paid", "partially_refunded", "refunded"]).aggregate(
        sales=Count("id"), revenue=Sum("gbp_gross_minor", filter=Q(refunded_at__isnull=True)),
        refunds=Count("id", filter=Q(refunded_at__isnull=False)),
    )  # fmt: skip
    linked = PlanCourse.objects.filter(course=c).values_list("plan_id", flat=True)
    # a plan with no course list includes every course marked in_subscription
    open_plans = Plan.objects.filter(is_active=True, audience="personal").exclude(
        pk__in=PlanCourse.objects.values("plan_id")
    )
    plans = list(Plan.objects.filter(pk__in=linked)) + (list(open_plans) if c.in_subscription else [])
    template = certificates.template_for(c)
    versions = list(c.versions.order_by("-number").values(
        "id", "number", "status", "is_major_change", "change_summary", "submitted_at", "reviewed_at",
        "review_notes", "published_at"))  # fmt: skip
    names = [link.user.full_name or link.user.email.split("@")[0]
             for link in CourseInstructor.objects.filter(course=c).select_related("user").order_by("position")]  # fmt: skip
    total = enrol["total"] or 0
    return {
        **row, "subtitle": c.subtitle, "description": c.description, "level": c.level, "language": c.language,
        "access_days": c.access_days, "in_business": c.in_business,
        "price_tier_id": price.tier_id if price else None,
        "certificate_template": template.name if template else None, "created_at": c.created_at,
        "published_at": c.published_at, "instructors": names,
        "plans": [{"id": p.id, "name": p.name} for p in plans], "sections": sections,
        "performance": {"enrolments": total, "active": enrol["active"] or 0, "completed": enrol["completed"] or 0,
                        "completion_pct": round((enrol["completed"] or 0) * 100 / total, 1) if total else 0.0,
                        "enrolments_30d": enrol["recent"] or 0, "rating_avg": float(c.rating_avg),
                        "rating_count": c.rating_count, "sales": sold["sales"] or 0,
                        "revenue_gbp_minor": sold["revenue"] or 0, "refunds": sold["refunds"] or 0},
        "versions": versions,
        "tiers": list(PriceTier.objects.filter(is_active=True).order_by("sort_order", "gbp_minor")
                      .values("id", "name", "gbp_minor")),
    }  # fmt: skip


# ---------------------------------------------------------------- writes
@router.patch("/courses/{uuid:course_id}", response=ConsoleOkOut)
def update_course(request, course_id: UUID, body: ConsoleCoursePatch):
    """Pricing & access and listing details (category, language, access, inclusion)."""
    staff(request)
    c = _course(course_id)
    changes = body.dict(exclude_unset=True)
    if changes.pop("lifetime_access", None):
        changes["access_days"] = None
    if "category_id" in changes and changes["category_id"] is not None:
        get_object_or_404(Category, pk=changes["category_id"])
    catalog.update_course(course=c, **changes)
    audit_request(request, "course.update", "course", c.id, {k: str(v) for k, v in changes.items()})
    return {"ok": True}


@router.put("/courses/{course_id}/price", response=ConsoleOkOut)
def set_price(request, course_id: UUID, body: ConsoleCoursePriceIn):
    staff(request)
    from apps.commerce.models import CoursePrice, PriceTier

    c = _course(course_id)
    if c.ownership == Course.Ownership.ORGANIZATION:
        raise ServiceError("not_sold", "Company-private courses are not sold.")
    tier = None if body.free else get_object_or_404(PriceTier, pk=body.tier_id, is_active=True)
    old = CoursePrice.objects.filter(course=c).values("is_free", "tier_id").first()
    CoursePrice.objects.update_or_create(course=c, defaults={"is_free": body.free, "tier": tier})
    audit_request(request, "course.price", "course", c.id,
                  {"from": {k: str(v) for k, v in (old or {}).items()}, "free": body.free, "tier": str(tier.id) if tier else None})  # fmt: skip
    return {"ok": True}


def _apply(request, c: Course, action: str, reason: str = "", category_id=None) -> UUID | None:
    """One course, one action (shared by the panel and bulk). Returns a new id for duplicates."""
    reason = html.plain(reason, 300).strip()
    if action in ("publish", "relist"):
        catalog.staff_publish(course=c)
    elif action == "unpublish":
        catalog.staff_unpublish(course=c, reason=reason)
    elif action == "archive":
        catalog.staff_archive(course=c)
    elif action == "delete":
        catalog.staff_delete(course=c)
    elif action == "category":
        catalog.staff_set_category(course_ids=[c.id], category_id=category_id)
    elif action == "duplicate":
        copy = catalog.duplicate(course=c)
        _copy_price(c, copy)
        audit_request(request, "course.duplicate", "course", copy.id, {"from": str(c.id)})
        return copy.id
    audit_request(request, f"course.{action}", "course", c.id,
                  {k: v for k, v in {"reason": reason, "category": str(category_id) if category_id else ""}.items() if v})  # fmt: skip
    return None


def _copy_price(src: Course, dst: Course) -> None:
    from apps.commerce.models import CoursePrice

    p = CoursePrice.objects.filter(course=src).first()
    if p:
        CoursePrice.objects.create(course=dst, tier_id=p.tier_id, is_free=p.is_free)


@router.post("/courses/{course_id}/status", response=ConsoleOkOut)
def set_status(request, course_id: UUID, body: ConsoleCourseStatusIn):
    """Publish, unpublish (reason required), archive or relist one course."""
    staff(request)
    _apply(request, _course(course_id), body.action, body.reason)
    return {"ok": True}


@router.post("/courses/{course_id}/unpublish", response=ConsoleOkOut)
def unpublish(request, course_id: UUID, body: ConsoleCourseStatusIn):
    """Kept for older screens: the same as status action "unpublish" (reason required)."""
    staff(request)
    _apply(request, _course(course_id), "unpublish", body.reason)
    return {"ok": True}


@router.post("/courses/{course_id}/duplicate", response=ConsoleIdOut)
def duplicate(request, course_id: UUID):
    staff(request)
    return {"id": _apply(request, _course(course_id), "duplicate")}


@router.post("/courses/{course_id}/delete", response=ConsoleOkOut)
def delete(request, course_id: UUID):
    """Soft delete (refused while learners are enrolled)."""
    staff(request)
    _apply(request, _course(course_id), "delete")
    return {"ok": True}


@router.post("/courses/bulk", response=ConsoleBulkOut)
def bulk(request, body: ConsoleBulkIn):
    """One action on many courses. Each course succeeds or fails on its own; failures are
    returned with the reason (e.g. a draft can't be published before review)."""
    staff(request)
    if body.action == "unpublish" and len(body.reason.strip()) < 3:
        raise ServiceError("reason_required", "Give a reason for unpublishing.")
    if body.action == "category":
        if body.category_id is None:
            raise ServiceError("category_required", "Choose a category.")
        get_object_or_404(Category, pk=body.category_id)
    done, failed = 0, []
    for c in Course.objects.filter(pk__in=body.ids).select_related("live_version").order_by("title"):
        try:
            _apply(request, c, body.action, body.reason, body.category_id)
            done += 1
        except ServiceError as e:
            failed.append({"id": c.id, "title": c.title, "message": e.message})
    return {"done": done, "failed": failed}


@router.post("/courses/company", response=ConsoleIdOut)
def create_company_course(request, body: ConsoleCompanyCourseIn):
    """A platform-owned course (the client's own library). The studio builder opens it in
    staff mode; platform courses publish without review."""
    import secrets

    from django.utils.text import slugify

    staff(request)
    title = html.plain(body.title, 160).strip()
    if len(title) < 3:
        raise ServiceError("title_short", "The title needs at least 3 characters.")
    if body.category_id:
        get_object_or_404(Category, pk=body.category_id)
    c = catalog.create_course(title=title, slug=f"{slugify(title)[:100] or 'course'}-{secrets.token_hex(3)}",
                              ownership=Course.Ownership.PLATFORM, created_by=request.user,
                              category_id=body.category_id)  # fmt: skip
    audit_request(request, "course.create", "course", c.id, {"ownership": "platform"})
    return {"id": c.id}


# ---------------------------------------------------------------- categories
@router.get("/categories", response=list[ConsoleCategoryOut])
def categories(request):
    staff(request)
    return list(
        Category.objects.annotate(course_count=Count("courses", filter=Q(courses__deleted_at__isnull=True)))
        .order_by("parent_id", "sort_order", "name")
        .values("id", "name", "slug", "icon", "parent_id", "sort_order", "is_active", "course_count")
    )


@router.post("/categories", response=ConsoleIdOut)
def create_category(request, body: ConsoleCategoryIn):
    staff(request)
    if body.parent_id:
        get_object_or_404(Category, pk=body.parent_id)
    cat = catalog.create_category(name=body.name, icon=body.icon, parent_id=body.parent_id)
    audit_request(request, "category.create", "category", cat.id, {"name": cat.name})
    return {"id": cat.id}


@router.patch("/categories/{uuid:category_id}", response=ConsoleOkOut)
def update_category(request, category_id: UUID, body: ConsoleCategoryPatch):
    staff(request)
    cat = catalog.update_category(
        category=get_object_or_404(Category, pk=category_id), **body.dict(exclude_unset=True)
    )
    audit_request(request, "category.update", "category", cat.id, body.dict(exclude_unset=True))
    return {"ok": True}


@router.post("/categories/reorder", response=ConsoleOkOut)
def reorder_categories(request, body: ConsoleCategoryOrderIn):
    staff(request)
    catalog.reorder_categories(ids=body.ids)
    audit_request(request, "category.reorder", "category", body.ids[0], {"count": len(body.ids)})
    return {"ok": True}
