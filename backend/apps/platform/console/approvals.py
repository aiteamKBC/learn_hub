"""Console > Approvals (mockup 25): the queue of course submissions and certificate
templates, the review workspace (preview, content & checklist, instructor, history) and
the decisions (approve, request changes, reject)."""

from datetime import UTC, datetime
from uuid import UUID

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.catalog import certificates
from apps.catalog import services as catalog
from apps.catalog.media import playback
from apps.catalog.models import CertificateTemplate, Course, CourseInstructor, CourseVersion, Lecture
from apps.catalog.schemas import PlaybackOut
from apps.catalog.studio import _editor_tree
from apps.catalog.studio_schemas import StudioEditorSectionOut
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleReasonIn, ConsoleStatusOut, router, staff


class ConsoleNotesIn(Schema):
    notes: str = Field("", max_length=1000)


# ---------------------------------------------------------------- the queue
class ConsoleQueueItemOut(Schema):
    kind: str  # course / template
    id: UUID  # the version id (course) or template id
    course_id: UUID | None
    title: str
    label: str  # New course / Course change / Course change (major) / Certificate template
    tab: str  # new / changes / templates
    is_major_change: bool
    by_name: str | None
    submitted_at: datetime | None
    thumbnail_url: str
    category: str | None


class ConsoleQueueCountsOut(Schema):
    all: int
    new: int
    changes: int
    major: int
    templates: int


class ConsoleQueueOut(Schema):
    counts: ConsoleQueueCountsOut
    items: list[ConsoleQueueItemOut]


QUEUE_TABS = ("all", "new", "changes", "templates")


@router.get("/approvals", response=ConsoleQueueOut)
def approvals_queue(request, tab: str = "all", q: str = ""):
    """Everything waiting for a decision, oldest first. `tab` filters; `q` searches the
    title and the submitter's name. Counts are always for the whole queue."""
    staff(request)
    if tab not in QUEUE_TABS:
        raise ServiceError("bad_tab", "Unknown tab.")
    versions = CourseVersion.objects.filter(status="in_review")
    templates = CertificateTemplate.objects.filter(status="pending")
    counts = versions.aggregate(
        new=Count("id", filter=Q(course__live_version__isnull=True)),
        changes=Count("id", filter=Q(course__live_version__isnull=False)),
        major=Count("id", filter=Q(course__live_version__isnull=False, is_major_change=True)),
    )
    counts["templates"] = templates.count()
    counts["all"] = counts["new"] + counts["changes"] + counts["templates"]
    needle = html.plain(q, 100).strip()
    if needle:
        versions = versions.filter(
            Q(course__title__icontains=needle) | Q(submitted_by__full_name__icontains=needle)
        )
        templates = templates.filter(Q(name__icontains=needle) | Q(created_by__full_name__icontains=needle))
    items: list[dict] = []
    if tab in ("all", "new", "changes"):
        if tab == "new":
            versions = versions.filter(course__live_version__isnull=True)
        elif tab == "changes":
            versions = versions.filter(course__live_version__isnull=False)
        for v in versions.select_related("course__category", "submitted_by").order_by("submitted_at")[:200]:
            first = v.course.live_version_id is None
            label = (
                "New course" if first else ("Course change (major)" if v.is_major_change else "Course change")
            )
            items.append({"kind": "course", "id": v.id, "course_id": v.course_id, "title": v.course.title,
                          "label": label, "tab": "new" if first else "changes", "is_major_change": v.is_major_change,
                          "by_name": _name(v.submitted_by), "submitted_at": v.submitted_at,
                          "thumbnail_url": v.course.thumbnail_url,
                          "category": v.course.category.name if v.course.category else None})  # fmt: skip
    if tab in ("all", "templates"):
        for t in templates.select_related("created_by").order_by("updated_at")[:200]:
            items.append({"kind": "template", "id": t.id, "course_id": None, "title": t.name,
                          "label": "Certificate template", "tab": "templates", "is_major_change": False,
                          "by_name": _name(t.created_by), "submitted_at": t.updated_at, "thumbnail_url": "",
                          "category": None})  # fmt: skip
    items.sort(key=lambda i: i["submitted_at"] or datetime.min.replace(tzinfo=UTC))
    return {"counts": counts, "items": items}


def _name(user) -> str | None:
    if user is None:
        return None
    return user.full_name or user.email.split("@")[0]


# ---------------------------------------------------------------- the review workspace
class ConsoleReviewRowOut(Schema):
    version_id: UUID
    course_id: UUID
    title: str
    number: int
    submitted_by: str | None
    submitted_at: datetime | None
    change_summary: str
    first_release: bool


class ConsoleReviewCourseOut(Schema):
    id: UUID
    title: str
    subtitle: str
    description: str
    slug: str = ""
    level: str = ""
    category: str | None = None
    thumbnail_url: str = ""
    outcomes: list[str] = []
    requirements: list[str] = []
    price_gbp_minor: int | None = None
    is_free: bool = False
    full_course_token_price: int | None = None
    token_pricing_mode: str = "manual"  # noqa: S105 - enum default, not a password
    in_subscription: bool = True
    status: str = ""


class ConsoleQuickCheckOut(Schema):
    label: str
    ok: bool


class ConsoleReviewIncludesOut(Schema):
    lessons: int
    quizzes: int
    assignments: int
    duration_sec: int
    certificate: bool


class ConsoleReviewInstructorOut(Schema):
    id: UUID
    name: str
    email: str
    avatar_url: str
    headline: str
    bio: str
    status: str | None
    approved_at: datetime | None
    rating_avg: float
    student_count: int
    course_count: int
    published_count: int
    rejected_versions: int


class ConsoleReviewOtherCourseOut(Schema):
    id: UUID
    title: str
    status: str
    student_count: int
    rating_avg: float


class ConsoleReviewHistoryOut(Schema):
    version_id: UUID
    number: int
    status: str
    is_major_change: bool
    change_summary: str
    submitted_by: str | None
    submitted_at: datetime | None
    reviewed_by: str | None
    reviewed_at: datetime | None
    review_notes: str
    published_at: datetime | None


class ConsoleReviewVersionOut(Schema):
    version_id: UUID
    number: int = 0
    course: ConsoleReviewCourseOut
    status: str
    first_release: bool = False
    is_major_change: bool = False
    change_summary: str = ""
    submitted_at: datetime | None = None
    checklist: list[str]
    quick_checks: list[ConsoleQuickCheckOut] = []
    includes: ConsoleReviewIncludesOut | None = None
    preview_lecture_id: UUID | None = None
    sections: list[StudioEditorSectionOut]
    instructors: list[ConsoleReviewInstructorOut] = []
    other_courses: list[ConsoleReviewOtherCourseOut] = []
    history: list[ConsoleReviewHistoryOut] = []


@router.get("/review/courses", response=list[ConsoleReviewRowOut])
def review_queue(request):
    """Course submissions only (kept for older screens; the console uses /approvals)."""
    staff(request)
    rows = (
        CourseVersion.objects.filter(status="in_review")
        .select_related("course", "submitted_by")
        .order_by("submitted_at")
    )
    return [{"version_id": v.id, "course_id": v.course_id, "title": v.course.title, "number": v.number,
             "submitted_by": _name(v.submitted_by), "submitted_at": v.submitted_at,
             "change_summary": v.change_summary, "first_release": v.course.live_version_id is None} for v in rows]  # fmt: skip


def _quick_checks(
    course: Course, version: CourseVersion, lectures: list, problems: list, price
) -> list[dict]:
    kinds = {lec.kind for lec in lectures}
    return [
        {"label": "Course details are complete", "ok": bool(course.title and course.subtitle and course.category_id)},
        {"label": "At least one section and lesson", "ok": bool(lectures) and version.sections.exists()},
        {"label": "Assessments included (quiz or assignment)", "ok": bool(kinds & {"quiz", "assignment"})},
        {"label": "Cash/free price is set", "ok": price is not None},
        {"label": "Token pricing is complete", "ok": not any("token price" in p.lower() for p in problems)},
        {"label": "Description and learning outcomes", "ok": bool(course.description.strip() and course.outcomes)},
        {"label": "Course image", "ok": bool(course.thumbnail_url)},
        {"label": "Every lesson is ready (builder checklist)", "ok": not problems},
    ]  # fmt: skip


@router.get("/review/versions/{version_id}", response=ConsoleReviewVersionOut)
def review_version(request, version_id: UUID):
    staff(request)
    from apps.commerce.models import CoursePrice
    from apps.identity.models import InstructorProfile

    v = get_object_or_404(CourseVersion.objects.select_related("course__category"), pk=version_id)
    c = v.course
    lectures = list(Lecture.objects.filter(version=v).only("id", "kind", "duration_sec", "is_preview", "token_price", "video_id",
                                                          "section_id", "position"))  # fmt: skip
    problems = catalog.publish_checklist(v)
    price = CoursePrice.objects.filter(course=c).select_related("tier").first()
    videos = sorted((lec for lec in lectures if lec.kind == "video" and lec.video_id),
                    key=lambda lec: (not lec.is_preview, lec.position))  # fmt: skip
    links = list(CourseInstructor.objects.filter(course=c).select_related("user").order_by("position"))
    user_ids = [link.user_id for link in links]
    profiles = {p.user_id: p for p in InstructorProfile.objects.filter(user_id__in=user_ids)}
    own = CourseInstructor.objects.filter(user_id__in=user_ids).values_list("course_id", flat=True)
    others = list(
        Course.objects.filter(pk__in=own, deleted_at__isnull=True)
        .exclude(pk=c.pk)
        .order_by("-student_count")[:8]
    )
    per_user = {
        r["user_id"]: r
        for r in CourseInstructor.objects.filter(user_id__in=user_ids, course__deleted_at__isnull=True)
        .values("user_id")
        .annotate(courses=Count("course"), published=Count("course", filter=Q(course__status="published")))
    }
    rejected = dict(
        CourseInstructor.objects.filter(user_id__in=user_ids)
        .values("user_id")
        .annotate(n=Count("course__versions", filter=Q(course__versions__status="rejected")))
        .values_list("user_id", "n")
    )
    instructors = []
    for link in links:
        p, u, n = profiles.get(link.user_id), link.user, per_user.get(link.user_id, {})
        instructors.append({"id": u.id, "name": _name(u), "email": u.email, "avatar_url": u.avatar_url,
                            "headline": p.headline if p else "", "bio": p.bio if p else "",
                            "status": p.status if p else None, "approved_at": p.approved_at if p else None,
                            "rating_avg": float(p.rating_avg) if p else 0.0, "student_count": p.student_count if p else 0,
                            "course_count": n.get("courses", 0), "published_count": n.get("published", 0),
                            "rejected_versions": rejected.get(link.user_id, 0)})  # fmt: skip
    history = [{"version_id": h.id, "number": h.number, "status": h.status, "is_major_change": h.is_major_change,
                "change_summary": h.change_summary, "submitted_by": _name(h.submitted_by),
                "submitted_at": h.submitted_at, "reviewed_by": _name(h.reviewed_by), "reviewed_at": h.reviewed_at,
                "review_notes": h.review_notes, "published_at": h.published_at}
               for h in c.versions.select_related("submitted_by", "reviewed_by").order_by("-number")]  # fmt: skip
    return {
        "version_id": v.id, "number": v.number, "status": v.status, "first_release": c.live_version_id is None,
        "is_major_change": v.is_major_change, "change_summary": v.change_summary, "submitted_at": v.submitted_at,
        "course": {"id": c.id, "title": c.title, "subtitle": c.subtitle, "description": c.description, "slug": c.slug,
                   "level": c.get_level_display(), "category": c.category.name if c.category else None,
                   "thumbnail_url": c.thumbnail_url, "outcomes": c.outcomes, "requirements": c.requirements,
                   "price_gbp_minor": price.tier.gbp_minor if price and price.tier else None,
                   "is_free": bool(price and price.is_free),
                   "full_course_token_price": c.full_course_token_price,
                   "token_pricing_mode": c.token_pricing_mode, "in_subscription": c.in_subscription,
                   "status": c.status},
        "checklist": problems, "quick_checks": _quick_checks(c, v, lectures, problems, price),
        "includes": {"lessons": len(lectures), "quizzes": sum(1 for x in lectures if x.kind == "quiz"),
                     "assignments": sum(1 for x in lectures if x.kind == "assignment"),
                     "duration_sec": sum(x.duration_sec for x in lectures),
                     "certificate": certificates.template_for(c) is not None},
        "preview_lecture_id": videos[0].id if videos else None,
        "sections": _editor_tree(v),
        "instructors": instructors,
        "other_courses": [{"id": x.id, "title": x.title, "status": x.status, "student_count": x.student_count,
                           "rating_avg": float(x.rating_avg)} for x in others],
        "history": history,
    }  # fmt: skip


@router.get("/review/lectures/{lecture_id}/play", response=PlaybackOut)
def review_play(request, lecture_id: UUID):
    """A signed player link for any video in a version under review (staff preview)."""
    staff(request)
    lec = get_object_or_404(Lecture.objects.select_related("video__library"), pk=lecture_id, kind="video")
    out = playback(lec.video)
    if out is None:
        raise ServiceError("no_video", "This lesson has no video yet.", status=404)
    return out


# ---------------------------------------------------------------- decisions
@router.post("/review/versions/{version_id}/approve", response=ConsoleStatusOut)
def approve(request, version_id: UUID, body: ConsoleNotesIn):
    staff(request)
    v = catalog.approve(version=get_object_or_404(CourseVersion, pk=version_id), reviewer=request.user,
                        notes=html.plain(body.notes, 1000))  # fmt: skip
    audit_request(request, "course.approve", "course_version", v.id, {"course": str(v.course_id)})
    return {"status": v.status}


@router.post("/review/versions/{version_id}/request-changes", response=ConsoleStatusOut)
def request_changes(request, version_id: UUID, body: ConsoleNotesIn):
    staff(request)
    v = catalog.request_changes(version=get_object_or_404(CourseVersion, pk=version_id), reviewer=request.user,
                                notes=html.plain(body.notes, 1000).strip())  # fmt: skip
    audit_request(request, "course.request_changes", "course_version", v.id, {"notes": v.review_notes[:500]})
    return {"status": v.status}


class ConsoleRejectIn(Schema):
    reason: str = Field(..., min_length=3, max_length=1000)


@router.post("/review/versions/{version_id}/reject", response=ConsoleStatusOut)
def reject(request, version_id: UUID, body: ConsoleRejectIn):
    staff(request)
    v = catalog.reject(version=get_object_or_404(CourseVersion, pk=version_id), reviewer=request.user,
                       reason=html.plain(body.reason, 1000).strip())  # fmt: skip
    audit_request(request, "course.reject", "course_version", v.id, {"reason": v.review_notes[:500]})
    return {"status": v.status}


# ---------------------------------------------------------------- certificate template decisions
@router.post("/certificates/templates/{template_id}/approve", response=ConsoleStatusOut)
def approve_template(request, template_id: UUID):
    staff(request)
    t = certificates.approve_template(template=get_object_or_404(CertificateTemplate, pk=template_id))
    audit_request(request, "certificate_template.approve", "certificate_template", t.id)
    return {"status": t.status}


@router.post("/certificates/templates/{template_id}/reject", response=ConsoleStatusOut)
def reject_template(request, template_id: UUID, body: ConsoleReasonIn):
    staff(request)
    t = certificates.reject_template(template=get_object_or_404(CertificateTemplate, pk=template_id),
                                     reason=body.reason)  # fmt: skip
    audit_request(
        request, "certificate_template.reject", "certificate_template", t.id, {"reason": t.decision_reason}
    )
    return {"status": t.status}
