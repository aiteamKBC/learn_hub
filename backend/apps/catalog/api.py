"""Public catalog: browse, search and course pages. Works signed out; signed in, the
course page also says what the viewer has (enrolled, in cart, wishlisted)."""

from django.db.models import BooleanField, Count, F, Prefetch, Q
from django.db.models.expressions import RawSQL
from django.shortcuts import get_object_or_404
from ninja import Field, Query, Router, Schema

from apps.commerce import pricing
from core import cursor
from core.errors import ServiceError
from core.money import request_currency

from . import media, selectors
from .models import Category, Course, CourseInstructor, Lecture
from .schemas import CategoryOut, CourseDetail, CoursePage, PlaybackOut

router = Router(tags=["catalog"])

SORTS = {  # name -> (field, cursor cast)
    "newest": "published_at",
    "popular": "student_count",
    "rating": "rating_avg",
}


class CourseFilters(Schema):
    q: str | None = None
    category: str | None = None
    level: str | None = None
    price: str | None = None  # "free" | "paid"
    rating: float | None = Field(None, ge=0, le=5)  # minimum average rating
    sort: str = "popular"
    currency: str | None = None
    cursor: str | None = None
    limit: int = 24


def _public():
    return Course.objects.filter(status="published", live_version__isnull=False, deleted_at__isnull=True,
                                 owner_org_id__isnull=True)  # fmt: skip


def _instructor_names():
    links = (
        CourseInstructor.objects.filter(is_visible=True)
        .select_related("user", "user__instructor_profile")
        .order_by("position")
    )
    return Prefetch("instructor_links", queryset=links, to_attr="visible_instructors")


def _cards(courses: list[Course], currency: dict, quotes: dict | None = None) -> list[dict]:
    """Price every course on the page with ONE quote (4 queries for any page size).
    Callers that already priced the courses (the cart) pass their quotes in."""
    if quotes is None:
        quotes = pricing.quote([c.id for c in courses], currency["code"]) if courses else {}
    out = []
    for c in courses:
        q = quotes.get(c.id)
        out.append({
            "id": c.id, "slug": c.slug, "title": c.title, "subtitle": c.subtitle, "thumbnail_url": c.thumbnail_url,
            "level": c.level, "category": c.category.name if c.category_id else None,
            "rating_avg": float(c.rating_avg), "rating_count": c.rating_count, "student_count": c.student_count,
            "lecture_count": c.lecture_count, "total_duration_sec": c.total_duration_sec,
            "instructors": [i.user.full_name for i in getattr(c, "visible_instructors", [])],
            "price": {"currency": currency["code"], "exponent": currency["exponent"], **q} if q else None,
        })  # fmt: skip
    return out


@router.get("/categories", response=list[CategoryOut], auth=None)
def categories(request):
    return Category.objects.filter(is_active=True, parent__isnull=True).order_by("sort_order")


@router.get("/courses", response=CoursePage, auth=None)
def list_courses(request, f: Query[CourseFilters]):
    """Browse and search. Search ranks by relevance (full-text index); browsing pages by
    keyset on the chosen sort."""
    limit = max(1, min(f.limit, 60))
    currency = request_currency(request, f.currency)
    qs = _public().select_related("category").prefetch_related(_instructor_names())
    if f.category:
        qs = qs.filter(category__slug=f.category)
    if f.level:
        qs = qs.filter(level=f.level)
    if f.price == "free":
        qs = qs.filter(price__is_free=True)
    elif f.price == "paid":
        qs = qs.filter(price__is_free=False)
    if f.rating:
        qs = qs.filter(rating_avg__gte=f.rating)

    if f.q and f.q.strip():
        term = f.q.strip()[:100]
        tsq = "websearch_to_tsquery('english', %s)"
        qs = qs.annotate(
            rank=RawSQL(f'ts_rank("catalog"."courses".search, {tsq})', (term,)),  # noqa: S611 - parameterised
            matches=RawSQL(f'"catalog"."courses".search @@ {tsq}', (term,), output_field=BooleanField()),  # noqa: S611
        ).filter(Q(matches=True) | Q(title__trigram_similar=term))
        offset = int((cursor.decode(f.cursor, 1) or [0])[0])
        if offset > 240:
            raise ServiceError("too_deep", "Refine your search to see more results.")
        total = qs.count() if not offset else None
        rows = list(qs.order_by("-rank", "-student_count", "-id")[offset : offset + limit + 1])
        nxt = cursor.encode(offset + limit) if len(rows) > limit else None
        return {"items": _cards(rows[:limit], currency), "next_cursor": nxt, "total": total}

    field = SORTS.get(f.sort, "student_count")
    after = cursor.decode(f.cursor, 2)
    qs = qs.filter(**{f"{field}__isnull": False}).order_by(F(field).desc(), "-id")
    total = qs.count() if not after else None
    if after:
        value, last_id = after
        qs = qs.filter(Q(**{f"{field}__lt": value}) | Q(**{field: value, "id__lt": last_id}))
    rows = list(qs[: limit + 1])
    page = rows[:limit]
    nxt = cursor.encode(getattr(page[-1], field), page[-1].id) if len(rows) > limit else None
    return {"items": _cards(page, currency), "next_cursor": nxt, "total": total}


def _plan_covers(user, course) -> bool:
    """True when the learner's live personal plan includes this course (the plan's own
    course list when it has one, otherwise the course's "in subscription" flag)."""
    from apps.commerce.models import Subscription
    from apps.commerce.services import plan_covers

    sub = (
        Subscription.objects.filter(
            user=user, org__isnull=True, plan__audience="personal", status__in=["trialing", "active"]
        )
        .select_related("plan")
        .order_by("-current_period_end")
        .first()
    )
    return sub is not None and plan_covers(sub.plan, course)


@router.get("/courses/{slug}", response=CourseDetail, auth=None)
def course_detail(request, slug: str, currency: str | None = None):
    """The course landing page. A company's private course is visible only inside that
    company (RLS), so a guessed slug just returns 404."""
    course = get_object_or_404(
        Course.objects.select_related("category", "live_version").prefetch_related(
            _instructor_names(), "topics"
        ),
        slug=slug, status="published", live_version__isnull=False, deleted_at__isnull=True,
    )  # fmt: skip
    cur = request_currency(request, currency)
    card = _cards([course], cur)[0]
    if course.owner_org_id is not None:
        card["price"] = None
    sections = [
        {"id": s.id, "title": s.title, "lectures": [
            {"key": lec.lecture_key, "title": lec.title, "kind": lec.kind, "duration_sec": lec.duration_sec,
             "is_preview": lec.is_preview} for lec in s.lectures.all()]}
        for s in selectors.curriculum(course.live_version)
    ]  # fmt: skip
    from apps.engagement.models import Review

    breakdown = {str(r["rating"]): r["n"] for r in Review.objects.filter(course=course, status="published")
                 .values("rating").annotate(n=Count("id"))}  # fmt: skip
    viewer = {}
    user = request.user
    if user.is_authenticated:
        from apps.commerce.models import CartItem, WishlistItem
        from apps.learning.models import Enrollment

        e = (
            # personal access counts in every workspace; company access only in that company
            Enrollment.objects.filter(Q(org__isnull=True) | Q(org_id=getattr(request, "org_id", None)),
                                      user=user, course=course, status__in=["active", "completed"])
            .order_by(F("org_id").desc(nulls_last=True)).values("id", "progress_pct").first()
        )  # fmt: skip
        viewer = {
            "enrollment_id": e["id"] if e else None,
            "progress_pct": float(e["progress_pct"]) if e else None,
            "in_cart": CartItem.objects.filter(user=user, course=course).exists(),
            "in_wishlist": WishlistItem.objects.filter(user=user, course=course).exists(),
            "is_instructor": any(i.user_id == user.id for i in course.visible_instructors),
            "plan_access": bool(not e and course.owner_org_id is None and _plan_covers(user, course)),
        }
    profiles = []
    for link in course.visible_instructors:
        p = getattr(link.user, "instructor_profile", None)
        profiles.append({"id": link.user_id, "name": link.user.full_name, "avatar_url": link.user.avatar_url,
                         "headline": p.headline if p else "", "slug": p.public_slug if p else None})  # fmt: skip
    return {
        **card, "description": course.description, "cpd_hours": float(course.cpd_hours) if course.cpd_hours else None,
        "published_at": course.published_at, "updated_at": course.updated_at,
        "topics": [t.name for t in course.topics.all()], "instructor_profiles": profiles,
        "rating_breakdown": breakdown, "sections": sections, "viewer": viewer,
    }  # fmt: skip


@router.get("/courses/{slug}/preview/{lecture_key}", response=PlaybackOut, auth=None)
def preview(request, slug: str, lecture_key: str):
    """Free sample lectures play without enrolling."""
    lecture = get_object_or_404(
        Lecture.objects.select_related("video__library"),
        version__course__slug=slug, version__course__live_version=F("version"), lecture_key=lecture_key,
        is_preview=True, kind="video",
    )  # fmt: skip
    return media.playback(lecture.video)
