"""Studio: where instructors and company course authors build and run courses.

Mounted at /api/v1/studio/. Who may edit a course (checked on EVERY call, answering
404 rather than 403 so the API never confirms that someone else's course exists):
    marketplace course  -> a co-instructor with can_edit
    company course      -> an admin of the owning company (X-Org-Id)
    platform course     -> platform staff

Learners' submissions, attempts and enrolments are private rows (RLS). An instructor
reads or grades them only through a narrow, elevated context opened AFTER the course
permission check, and only for that course.
"""

import os
import secrets
from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Count, DecimalField, F, Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from ninja import Field, Router, Schema

from apps.commerce.models import Coupon, CoursePrice, PriceTier
from apps.identity.models import InstructorProfile
from apps.identity.schemas import OkOut
from apps.learning import services as learning
from apps.learning.models import Enrollment, QuizAttempt, Submission, SubmissionFile
from apps.payouts import selectors as revenue
from apps.payouts import services as payouts
from apps.payouts.models import Earning, Payout, PayoutAccount
from core import html, storage
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, org_scope
from core.tenancy import tenant_context

from . import bunny, media, resources, services
from . import permissions as instructor_perms
from .models import (
    Assignment,
    Course,
    CourseInstructor,
    CourseVersion,
    Lecture,
    LectureResource,
    MediaAsset,
    Quiz,
    QuizQuestion,
    Section,
)
from .studio_schemas import (
    StudioCouponCreateOut,
    StudioCouponOut,
    StudioCourseCreateOut,
    StudioCourseDetailOut,
    StudioCourseRow,
    StudioDashboardOut,
    StudioDraftOut,
    StudioEssayGradeOut,
    StudioGradeOut,
    StudioGradingQueueOut,
    StudioLectureCreateOut,
    StudioMediaStatusOut,
    StudioPayoutAccountOut,
    StudioPayoutAccountSetOut,
    StudioPayoutOut,
    StudioPriceTierOut,
    StudioQuestionCreateOut,
    StudioQuestionInboxOut,
    StudioResourceDownloadOut,
    StudioResourceOut,
    StudioResourceUploadOut,
    StudioRevenueOut,
    StudioReviewInboxOut,
    StudioSectionCreateOut,
    StudioStatusOut,
    StudioStudentOut,
    StudioVideoDetailsOut,
    StudioVideoFetchOut,
    StudioVideoMetaOut,
    StudioVideoUploadOut,
)

router = Router(tags=["studio"], auth=session_auth)


# ---------------------------------------------------------------- permissions
def editable(request, course_id) -> Course:
    course = (
        Course.objects.select_related("live_version").filter(pk=course_id, deleted_at__isnull=True).first()
    )
    if course is None:
        raise ServiceError("not_found", "Course not found.", status=404)
    if course.ownership == Course.Ownership.ORGANIZATION:
        scope = org_scope(request, OrgRole.ADMIN)
        allowed = course.owner_org_id == scope.org_id
    elif course.ownership == Course.Ownership.PLATFORM:
        allowed = request.user.is_staff
    else:
        allowed = CourseInstructor.objects.filter(course=course, user=request.user, can_edit=True).exists()
        if allowed:
            instructor_perms.ensure_active(request.user)  # suspended: courses stay live, studio off
    if not allowed:
        raise ServiceError("not_found", "Course not found.", status=404)
    return course


def _version(request, version_id) -> CourseVersion:
    v = get_object_or_404(CourseVersion, pk=version_id)
    editable(request, v.course_id)
    return v


def _section(request, section_id) -> Section:
    s = get_object_or_404(Section.objects.select_related("version"), pk=section_id)
    editable(request, s.version.course_id)
    return s


def _lecture(request, lecture_id) -> Lecture:
    lec = get_object_or_404(Lecture.objects.select_related("version"), pk=lecture_id)
    editable(request, lec.version.course_id)
    return lec


def _my_course_ids(request) -> list:
    """Courses the caller can edit (for inboxes and grading queues)."""
    ids = set(
        CourseInstructor.objects.filter(user=request.user, can_edit=True).values_list("course_id", flat=True)
    )
    org_id = getattr(request, "org_id", None)
    if org_id:
        from apps.org.selectors import member_role

        if member_role(user_id=request.user.id, org_id=org_id) in ("admin", "owner"):
            ids |= set(Course.objects.filter(owner_org_id=org_id).values_list("id", flat=True))
    return list(ids)


def _instructor_view(request):
    """Elevated context for reading learners' rows, used ONLY after course checks."""
    return tenant_context(user_id=request.user.id, staff=True)


# ---------------------------------------------------------------- schemas
class CourseIn(Schema):
    title: str = Field(..., min_length=3, max_length=160)
    category_id: str | None = None


class CoursePatch(Schema):
    title: str | None = Field(None, min_length=3, max_length=160)
    subtitle: str | None = Field(None, max_length=240)
    description: str | None = Field(None, max_length=20000)
    level: str | None = None
    category_id: str | None = None
    thumbnail_url: str | None = Field(None, max_length=500)
    cpd_hours: float | None = Field(None, ge=0, le=500)
    outcomes: list[str] | None = Field(None, max_length=20)
    requirements: list[str] | None = Field(None, max_length=20)
    in_subscription: bool | None = None
    in_business: bool | None = None


class PriceIn(Schema):
    tier_id: str | None = None
    free: bool = False


class SectionIn(Schema):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=2000)


class OrderIn(Schema):
    ids: list[str] = Field(..., max_length=500)


class LectureIn(Schema):
    kind: str
    title: str = Field(..., min_length=1, max_length=200)
    body: str | None = Field(None, max_length=100000)
    external_url: str | None = Field(None, max_length=500)
    video_id: str | None = None


class LecturePatch(Schema):
    title: str | None = Field(None, min_length=1, max_length=200)
    body: str | None = Field(None, max_length=100000)
    is_preview: bool | None = None
    is_required: bool | None = None
    duration_sec: int | None = Field(None, ge=0, le=86400)
    external_url: str | None = Field(None, max_length=500)
    live_starts_at: str | None = None
    live_duration_min: int | None = Field(None, ge=5, le=600)
    live_join_url: str | None = Field(None, max_length=500)
    min_watch_pct: int | None = Field(None, ge=0, le=100)
    video_id: str | None = None
    section_id: str | None = None
    prerequisite_key: UUID | None = None  # send null to remove


class QuizPatch(Schema):
    mode: str | None = None
    pass_mark_pct: int | None = Field(None, ge=0, le=100)
    time_limit_sec: int | None = Field(None, ge=30, le=14400)
    max_attempts: int | None = Field(None, ge=1, le=100)
    shuffle_questions: bool | None = None
    shuffle_options: bool | None = None
    reveal_answers: str | None = None


class OptionIn(Schema):
    body: str = Field("", max_length=2000)
    is_correct: bool = False
    match_text: str = Field("", max_length=500)
    blank_index: int | None = Field(None, ge=0, le=20)


class QuizQuestionIn(Schema):
    kind: str
    prompt: str = Field(..., min_length=1, max_length=5000)
    explanation: str = Field("", max_length=5000)
    points: int = Field(1, ge=1, le=100)
    options: list[OptionIn] = Field(default_factory=list, max_length=20)


class AssignmentPatch(Schema):
    instructions: str | None = Field(None, max_length=20000)
    max_score: int | None = Field(None, ge=1, le=1000)
    pass_score: int | None = Field(None, ge=0, le=1000)
    rubric: list[dict] | None = Field(None, max_length=20)
    due_days_after_enrolment: int | None = Field(None, ge=1, le=365)
    allow_late: bool | None = None
    max_resubmissions: int | None = Field(None, ge=0, le=10)
    submission_types: list[str] | None = None


class ResourceUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., gt=0)


class ResourceIn(Schema):
    asset_id: str
    title: str = Field("", max_length=200)


class ResourcePatch(Schema):
    title: str = Field(..., min_length=1, max_length=200)


class VideoIn(Schema):
    course_id: str
    title: str = Field(..., min_length=1, max_length=200)
    filename: str = Field("", max_length=255)
    size_bytes: int = Field(0, ge=0, le=20 * 1024**3)


class VideoPartIn(Schema):
    title: str = Field(..., max_length=255)
    start: int = Field(..., ge=0, le=86400)


class VideoMomentIn(Schema):
    label: str = Field(..., max_length=255)
    timestamp: int = Field(..., ge=0, le=86400)


class VideoPartsIn(Schema):
    parts: list[VideoPartIn] = Field(default_factory=list, max_length=200)
    moments: list[VideoMomentIn] = Field(default_factory=list, max_length=200)


class ThumbnailIn(Schema):
    choice: str = Field(..., min_length=1, max_length=500)


class VideoFetchIn(Schema):
    course_id: str
    title: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., min_length=10, max_length=2000)


class CaptionIn(Schema):
    srclang: str = Field(..., pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
    label: str = Field("", max_length=60)
    content: str = Field(
        ..., min_length=10, max_length=1_100_000
    )  # the .srt / .vtt text (1 MB checked as bytes)


class SubmitIn(Schema):
    change_summary: str = Field("", max_length=2000)
    requires_recompletion: bool = False
    is_major_change: bool = False  # puts an update in the "Course changes (major)" approvals tab


class CouponIn(Schema):
    code: str = Field(..., min_length=4, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    percent_off: int = Field(..., ge=1, le=100)
    max_redemptions: int | None = Field(None, ge=1, le=100000)
    days: int = Field(..., ge=1, le=31)


class RubricScoreIn(Schema):
    criterion: str = Field(..., max_length=200)
    points: int = Field(..., ge=0, le=1000)


class GradeIn(Schema):
    score: int = Field(..., ge=0, le=1000)
    rubric_scores: list[RubricScoreIn] = Field(default_factory=list, max_length=20)
    feedback: str = Field("", max_length=20000)
    return_for_resubmission: bool = False


class EssayGradeIn(Schema):
    question_id: str
    points: float = Field(..., ge=0, le=100)
    feedback: str = Field("", max_length=5000)


class InstructorProfileIn(Schema):
    headline: str = Field(..., min_length=3, max_length=160)
    bio: str = Field("", max_length=5000)
    website_url: str = Field("", max_length=500)


class PayoutAccountIn(Schema):
    method: str
    paypal_email: str = Field("", max_length=320)
    stripe_account_id: str = Field("", max_length=64)
    country: str = Field("", max_length=2)


# ---------------------------------------------------------------- becoming an instructor
@router.post("/instructor-profile", response=StudioStatusOut)
def apply_as_instructor(request, body: InstructorProfileIn):
    """Marketplace instructors are reviewed by staff before they can publish."""
    if body.website_url and not body.website_url.startswith("https://"):
        raise ServiceError("bad_url", "Use an https:// link.")
    profile, created = InstructorProfile.objects.get_or_create(
        user=request.user,
        defaults={"headline": html.plain(body.headline, 160), "bio": html.plain(body.bio, 5000),
                  "website_url": body.website_url},
    )  # fmt: skip
    reapplied = False
    if not created:
        changes = {"headline": html.plain(body.headline, 160), "bio": html.plain(body.bio, 5000),
                   "website_url": body.website_url}  # fmt: skip
        if profile.status == InstructorProfile.Status.REJECTED:  # applying again: back in the queue
            changes["status"] = profile.status = InstructorProfile.Status.PENDING
        reapplied = changes.get("status") == InstructorProfile.Status.PENDING
        InstructorProfile.objects.filter(pk=profile.pk).update(**changes)
    if created or reapplied:
        from apps.engagement.notify import notify_staff

        name = request.user.full_name or request.user.email
        notify_staff("staff_instructor_application", {"name": name},
                     url=f"/console/instructors?tab=applications&user={request.user.id}",
                     dedupe=f"apply:{profile.id}:{profile.updated_at:%Y%m%d%H%M}")  # fmt: skip
    return {"status": profile.status}


# ---------------------------------------------------------------- courses
@router.get("/courses", response=list[StudioCourseRow])
def my_courses(request):
    ids = _my_course_ids(request)
    courses = list(
        Course.objects.filter(pk__in=ids, deleted_at__isnull=True)
        .annotate(open_versions=Count("versions", filter=Q(versions__status__in=["draft", "in_review",
                                                                                   "changes_requested"])))
        .order_by("-updated_at")
    )  # fmt: skip
    # the newest open version's status: draft / in_review / changes_requested
    open_status = {}
    for course_id, status in (
        CourseVersion.objects.filter(course_id__in=ids, status__in=["draft", "in_review", "changes_requested"])
        .order_by("course_id", "-number").values_list("course_id", "status")
    ):  # fmt: skip
        open_status.setdefault(course_id, status)
    earned = dict(
        Earning.objects.filter(user=request.user, course_id__in=ids)
        .values("course_id").annotate(total=Sum("amount_gbp_minor")).values_list("course_id", "total")
    )  # fmt: skip
    return [{"id": c.id, "slug": c.slug, "title": c.title, "ownership": c.ownership, "status": c.status,
             "students": c.student_count, "rating_avg": float(c.rating_avg), "rating_count": c.rating_count,
             "has_draft": c.open_versions > 0, "draft_status": open_status.get(c.id), "earned_gbp_minor": earned.get(c.id, 0), "updated_at": c.updated_at}
            for c in courses]  # fmt: skip


@router.post("/courses", response=StudioCourseCreateOut)
@transaction.atomic
def create_course(request, body: CourseIn):
    org_id = getattr(request, "org_id", None)
    if org_id:  # inside a company workspace: a private company course
        org_scope(request, OrgRole.ADMIN)
        ownership = Course.Ownership.ORGANIZATION
    else:
        p = InstructorProfile.objects.filter(user=request.user).first()
        if p is None or p.status != InstructorProfile.Status.APPROVED:
            raise ServiceError("not_instructor", "Apply to teach and wait for approval first.", status=403)
        instructor_perms.check_course_limit(request.user)
        ownership, org_id = Course.Ownership.INSTRUCTOR, None
    title = html.plain(body.title, 160).strip()
    slug = f"{slugify(title)[:100] or 'course'}-{secrets.token_hex(3)}"
    course = services.create_course(title=title, slug=slug, ownership=ownership, created_by=request.user,
                                    owner_org_id=org_id, category_id=body.category_id)  # fmt: skip
    return {"id": course.id, "slug": course.slug}


def _editor_tree(version: CourseVersion) -> list:
    """The builder's view: everything, INCLUDING correct answers (editors only)."""
    sections = version.sections.order_by("position").prefetch_related(
        "lectures__video",
        "lectures__quiz__questions__options",
        "lectures__assignment",
        "lectures__resources__asset",
    )
    out = []
    for s in sections:
        lectures = []
        for lec in sorted(s.lectures.all(), key=lambda x: x.position):
            item = {"id": lec.id, "key": lec.lecture_key, "kind": lec.kind, "title": lec.title,
                    "position": lec.position, "is_preview": lec.is_preview, "is_required": lec.is_required,
                    "duration_sec": lec.duration_sec, "body": lec.body, "external_url": lec.external_url,
                    "live_starts_at": lec.live_starts_at, "live_duration_min": lec.live_duration_min,
                    "live_join_url": lec.live_join_url, "min_watch_pct": lec.min_watch_pct,
                    "prerequisite_key": lec.prerequisite_key}  # fmt: skip
            item["resources"] = [
                resources.payload(r) for r in sorted(lec.resources.all(), key=lambda r: r.position)
            ]
            if lec.video_id:
                item["video"] = {"id": lec.video.id, "status": lec.video.status, "duration_sec": lec.video.duration_sec,
                                 "encode_progress": lec.video.encode_progress,
                                 "filename": lec.video.original_filename, "size_bytes": lec.video.size_bytes}  # fmt: skip
            if lec.kind == Lecture.Kind.QUIZ:
                q = lec.quiz
                item["quiz"] = {"id": q.id, "mode": q.mode, "pass_mark_pct": q.pass_mark_pct,
                                "time_limit_sec": q.time_limit_sec, "max_attempts": q.max_attempts,
                                "shuffle_questions": q.shuffle_questions, "shuffle_options": q.shuffle_options,
                                "reveal_answers": q.reveal_answers,
                                "questions": [{"id": qq.id, "kind": qq.kind, "prompt": qq.prompt, "points": qq.points,
                                               "explanation": qq.explanation,
                                               "options": [{"body": o.body, "is_correct": o.is_correct,
                                                            "match_text": o.match_text, "blank_index": o.blank_index}
                                                           for o in sorted(qq.options.all(), key=lambda o: o.position)]}
                                              for qq in sorted(q.questions.all(), key=lambda x: x.position)]}  # fmt: skip
            if lec.kind == Lecture.Kind.ASSIGNMENT:
                a = lec.assignment
                item["assignment"] = {"id": a.id, "instructions": a.instructions, "max_score": a.max_score,
                                      "pass_score": a.pass_score, "rubric": a.rubric,
                                      "due_days_after_enrolment": a.due_days_after_enrolment, "allow_late": a.allow_late,
                                      "max_resubmissions": a.max_resubmissions, "submission_types": a.submission_types}  # fmt: skip
            lectures.append(item)
        out.append({"id": s.id, "title": s.title, "description": s.description, "position": s.position,
                    "lectures": lectures})  # fmt: skip
    return out


def _refresh_unfinished_videos(version: CourseVersion) -> None:
    """Ask Bunny about videos still processing, so the publish checklist isn't stale when
    Bunny's webhook can't reach us. Rate-limited per video inside sync_from_bunny."""
    unfinished = (
        Lecture.objects.filter(version=version, kind=Lecture.Kind.VIDEO, video__isnull=False)
        .exclude(video__status__in=[MediaAsset.Status.READY, MediaAsset.Status.FAILED])
        .select_related("video__library")[:20]
    )
    for lec in unfinished:
        media.sync_from_bunny(lec.video)


@router.get("/courses/{course_id}", response=StudioCourseDetailOut)
def course(request, course_id: str):
    c = editable(request, course_id)
    versions = list(
        c.versions.order_by("-number").values("id", "number", "status", "published_at", "review_notes")
    )
    working = next((v for v in versions if v["status"] in ("draft", "in_review", "changes_requested")), None)
    version = (
        CourseVersion.objects.get(pk=(working or {"id": c.live_version_id})["id"])
        if (working or c.live_version_id)
        else None
    )
    if version is not None and version.status in ("draft", "changes_requested"):
        _refresh_unfinished_videos(version)
    price = CoursePrice.objects.filter(course=c).select_related("tier").first()
    return {
        "id": c.id, "slug": c.slug, "title": c.title, "subtitle": c.subtitle, "description": c.description,
        "level": c.level, "category_id": c.category_id, "outcomes": c.outcomes, "requirements": c.requirements, "thumbnail_url": c.thumbnail_url, "status": c.status,
        "ownership": c.ownership, "cpd_hours": float(c.cpd_hours) if c.cpd_hours else None,
        "in_subscription": c.in_subscription, "in_business": c.in_business,
        "certificate_template_id": c.certificate_template_id,
        "price": {"free": price.is_free, "tier_id": price.tier_id, "tier": price.tier.name if price.tier else None,
                  "gbp_minor": price.tier.gbp_minor if price.tier else 0} if price else None,
        "versions": versions,
        "working_version": {"id": version.id, "number": version.number, "status": version.status,
                            "editable": version.status in ("draft", "changes_requested"),
                            "checklist": services.publish_checklist(version),
                            "sections": _editor_tree(version)} if version else None,
    }  # fmt: skip


@router.patch("/courses/{course_id}", response=OkOut)
def update_course(request, course_id: str, body: CoursePatch):
    c = editable(request, course_id)
    services.update_course(course=c, **body.dict(exclude_unset=True))
    return {"ok": True}


@router.get("/price-tiers", response=list[StudioPriceTierOut])
def price_tiers(request):
    return list(
        PriceTier.objects.filter(is_active=True).order_by("sort_order").values("id", "name", "gbp_minor")
    )


@router.put("/courses/{course_id}/price", response=OkOut)
def set_price(request, course_id: str, body: PriceIn):
    c = editable(request, course_id)
    if c.ownership == Course.Ownership.ORGANIZATION:
        raise ServiceError("not_sold", "Company courses are not sold.")
    tier = None if body.free else get_object_or_404(PriceTier, pk=body.tier_id, is_active=True)
    with tenant_context(user_id=request.user.id, staff=True):  # narrow write after the editor check
        CoursePrice.objects.update_or_create(course=c, defaults={"is_free": body.free, "tier": tier})
    return {"ok": True}


@router.post("/courses/{course_id}/draft", response=StudioDraftOut)
def new_draft(request, course_id: str):
    c = editable(request, course_id)
    v = services.create_draft(course=c, by=request.user)
    return {"version_id": v.id, "number": v.number}


@router.post("/versions/{version_id}/submit", response=StudioStatusOut)
def submit(request, version_id: str, body: SubmitIn):
    v = _version(request, version_id)
    _refresh_unfinished_videos(v)
    v = services.submit(version=v, by=request.user, change_summary=html.plain(body.change_summary, 2000),
                        requires_recompletion=body.requires_recompletion,
                        is_major_change=body.is_major_change)  # fmt: skip
    if v.status == CourseVersion.Status.IN_REVIEW and instructor_perms.publishes_without_review(
        request.user, v.course
    ):
        v = services.approve(version=v, reviewer=request.user, notes="Published without review (permission).")
    return {"status": v.status}


# ---------------------------------------------------------------- curriculum
@router.post("/versions/{version_id}/sections", response=StudioSectionCreateOut)
def add_section(request, version_id: str, body: SectionIn):
    v = _version(request, version_id)
    s = services.add_section(
        version=v, title=html.plain(body.title, 200), description=html.plain(body.description, 2000)
    )
    return {"id": s.id, "position": s.position}


@router.put("/versions/{version_id}/sections/order", response=OkOut)
def order_sections(request, version_id: str, body: OrderIn):
    services.reorder_sections(version=_version(request, version_id), ids=body.ids)
    return {"ok": True}


@router.patch("/sections/{section_id}", response=OkOut)
def update_section(request, section_id: str, body: SectionIn):
    services.update_section(
        section=_section(request, section_id), title=body.title, description=body.description
    )
    return {"ok": True}


@router.delete("/sections/{section_id}", response=OkOut)
def delete_section(request, section_id: str):
    services.delete_section(section=_section(request, section_id))
    return {"ok": True}


@router.post("/sections/{section_id}/lectures", response=StudioLectureCreateOut)
def add_lecture(request, section_id: str, body: LectureIn):
    s = _section(request, section_id)
    if body.kind not in Lecture.Kind.values:
        raise ServiceError("bad_kind", "Unknown lecture type.")
    fields = {k: v for k, v in body.dict().items() if k not in ("kind", "title") and v is not None}
    if fields.get("external_url") and not fields["external_url"].startswith("https://"):
        raise ServiceError("bad_url", "Links must use https://")
    lec = services.add_lecture(section=s, kind=body.kind, title=html.plain(body.title, 200), **fields)
    return {"id": lec.id, "key": lec.lecture_key}


@router.put("/sections/{section_id}/lectures/order", response=OkOut)
def order_lectures(request, section_id: str, body: OrderIn):
    services.reorder_lectures(section=_section(request, section_id), ids=body.ids)
    return {"ok": True}


@router.patch("/lectures/{lecture_id}", response=OkOut)
def update_lecture(request, lecture_id: str, body: LecturePatch):
    services.update_lecture(lecture=_lecture(request, lecture_id), **body.dict(exclude_unset=True))
    return {"ok": True}


@router.delete("/lectures/{lecture_id}", response=OkOut)
def delete_lecture(request, lecture_id: str):
    services.delete_lecture(lecture=_lecture(request, lecture_id))
    return {"ok": True}


@router.patch("/quizzes/{quiz_id}", response=OkOut)
def update_quiz(request, quiz_id: str, body: QuizPatch):
    q = get_object_or_404(Quiz.objects.select_related("lecture__version"), pk=quiz_id)
    editable(request, q.lecture.version.course_id)
    services.update_quiz(quiz=q, **body.dict(exclude_unset=True))
    return {"ok": True}


@router.post("/quizzes/{quiz_id}/questions", response=StudioQuestionCreateOut)
def add_question(request, quiz_id: str, body: QuizQuestionIn):
    q = get_object_or_404(Quiz.objects.select_related("lecture__version"), pk=quiz_id)
    editable(request, q.lecture.version.course_id)
    if body.kind not in QuizQuestion.Kind.values:
        raise ServiceError("bad_kind", "Unknown question type.")
    question = services.add_question(quiz=q, kind=body.kind, prompt=body.prompt, explanation=body.explanation,
                                     points=body.points, options=_options(body))  # fmt: skip
    return {"id": question.id}


@router.put("/questions/{question_id}", response=OkOut)
def replace_question(request, question_id: str, body: QuizQuestionIn):
    question = get_object_or_404(
        QuizQuestion.objects.select_related("quiz__lecture__version"), pk=question_id
    )
    editable(request, question.quiz.lecture.version.course_id)
    services.replace_question(question=question, prompt=body.prompt, explanation=body.explanation, points=body.points,
                              options=_options(body))  # fmt: skip
    return {"ok": True}


@router.delete("/questions/{question_id}", response=OkOut)
def delete_question(request, question_id: str):
    question = get_object_or_404(
        QuizQuestion.objects.select_related("quiz__lecture__version"), pk=question_id
    )
    editable(request, question.quiz.lecture.version.course_id)
    services.delete_question(question=question)
    return {"ok": True}


@router.patch("/assignments/{assignment_id}", response=OkOut)
def update_assignment(request, assignment_id: str, body: AssignmentPatch):
    a = get_object_or_404(Assignment.objects.select_related("lecture__version"), pk=assignment_id)
    editable(request, a.lecture.version.course_id)
    services.update_assignment(assignment=a, **body.dict(exclude_unset=True))
    return {"ok": True}


def _options(body) -> list[dict]:
    """Unset option fields (e.g. blank_index for a normal choice) fall back to defaults."""
    return [{k: v for k, v in o.dict().items() if v is not None} for o in body.options]


# ---------------------------------------------------------------- lecture files (Azure Blob)
def _resource(request, resource_id) -> LectureResource:
    r = get_object_or_404(LectureResource.objects.select_related("lecture__version", "asset"), pk=resource_id)
    editable(request, r.lecture.version.course_id)
    return r


@router.post("/lectures/{lecture_id}/resources/uploads", response=StudioResourceUploadOut)
def start_resource_upload(request, lecture_id: str, body: ResourceUploadIn):
    """1) a write-only link for one file, 2) the browser PUTs the file to Azure,
    3) POST /lectures/{id}/resources attaches it after we check what arrived."""
    return resources.start_upload(lecture=_lecture(request, lecture_id), user=request.user,
                                  filename=body.filename, size_bytes=body.size_bytes)  # fmt: skip


@router.post("/lectures/{lecture_id}/resources", response=StudioResourceOut)
def attach_resource(request, lecture_id: str, body: ResourceIn):
    r = resources.attach(lecture=_lecture(request, lecture_id), user=request.user, asset_id=body.asset_id,
                         title=body.title)  # fmt: skip
    return resources.payload(r)


@router.patch("/resources/{resource_id}", response=StudioResourceOut)
def rename_resource(request, resource_id: str, body: ResourcePatch):
    return resources.payload(resources.rename(resource=_resource(request, resource_id), title=body.title))


@router.delete("/resources/{resource_id}", response=OkOut)
def delete_resource(request, resource_id: str):
    resources.remove(resource=_resource(request, resource_id))
    return {"ok": True}


@router.get("/resources/{resource_id}/download", response=StudioResourceDownloadOut)
def preview_resource(request, resource_id: str):
    return {"url": resources.download_url(_resource(request, resource_id)), "expires_in": 3600}


# ---------------------------------------------------------------- video uploads
@router.post("/media/videos", response=StudioVideoUploadOut)
def start_video_upload(request, body: VideoIn):
    """1) we create the video at Bunny, 2) the browser uploads the file directly with the
    returned TUS session, 3) Bunny's signed webhook moves the asset to 'ready'."""
    c = editable(request, body.course_id)
    library = instructor_perms.default_library(request.user, c)
    if library is None:
        raise ServiceError("video_unavailable", "Video uploads are not configured.", status=503)
    guid = bunny.create_video(library, html.plain(body.title, 200))
    asset = services.create_media(kind="video", status="awaiting_upload", library=library, uploaded_by=request.user,
                                      owner_org_id=c.owner_org_id, bunny_video_guid=guid,
                                      original_filename=html.plain(body.filename, 255), size_bytes=body.size_bytes)  # fmt: skip
    return {"asset_id": asset.id, "upload": bunny.upload_session(library, guid)}


def _video(request, asset_id, *, write=False) -> MediaAsset:
    """A video the caller may see: its uploader, or an editor of a course that uses it.
    Changes to a video a course uses need edit rights on that course."""
    a = get_object_or_404(MediaAsset.objects.select_related("library"), pk=asset_id, kind="video")
    lec = Lecture.objects.filter(video=a).select_related("version").first()
    if lec is not None and (write or a.uploaded_by_id != request.user.id):
        editable(request, lec.version.course_id)
    elif lec is None and a.uploaded_by_id != request.user.id:
        raise ServiceError("not_found", "Video not found.", status=404)
    return a


def _bunny_video(request, asset_id, *, write=False) -> MediaAsset:
    a = _video(request, asset_id, write=write)
    if not a.bunny_video_guid or a.library is None:
        raise ServiceError("video_unavailable", "This video isn't on the video service.", status=409)
    return a


@router.get("/media/{asset_id}/details", response=StudioVideoDetailsOut)
def video_details(request, asset_id: str):
    """Parts, key moments and thumbnails for the builder's video sheet."""
    a = _bunny_video(request, asset_id)
    return {**media.video_meta(a), "duration_sec": a.duration_sec, "thumbnails": media.thumbnails(a)}


@router.put("/media/{asset_id}/parts", response=StudioVideoMetaOut)
def save_video_parts(request, asset_id: str, body: VideoPartsIn):
    a = _bunny_video(request, asset_id, write=True)
    return media.save_parts_and_moments(
        a, parts=[p.dict() for p in body.parts], moments=[m.dict() for m in body.moments]
    )


@router.put("/media/{asset_id}/thumbnail", response=OkOut)
def set_video_thumbnail(request, asset_id: str, body: ThumbnailIn):
    media.set_thumbnail(_bunny_video(request, asset_id, write=True), body.choice.strip())
    return {"ok": True}


@router.post("/media/{asset_id}/captions", response=OkOut)
def add_video_caption(request, asset_id: str, body: CaptionIn):
    media.add_caption(_bunny_video(request, asset_id, write=True), srclang=body.srclang, label=body.label,
                      content=body.content)  # fmt: skip
    return {"ok": True}


@router.delete("/media/{asset_id}/captions/{srclang}", response=OkOut)
def delete_video_caption(request, asset_id: str, srclang: str):
    media.delete_caption(_bunny_video(request, asset_id, write=True), srclang)
    return {"ok": True}


@router.get("/media/{asset_id}", response=StudioMediaStatusOut)
def media_status(request, asset_id: str):
    """Processing status, plus a signed preview link once Bunny can play it."""
    a = media.sync_from_bunny(_video(request, asset_id))  # in case Bunny's webhook can't reach us
    play = media.playback(a) if a.status in (MediaAsset.Status.PLAYABLE, MediaAsset.Status.READY) else None
    return {
        "id": a.id,
        "status": a.status,
        "encode_progress": a.encode_progress,
        "duration_sec": a.duration_sec,
        "preview_url": play["url"] if play else None,
    }


@router.post("/media/videos/fetch", response=StudioVideoFetchOut)
def fetch_video_from_link(request, body: VideoFetchIn):
    """An external video link (a direct file URL): Bunny downloads and hosts it, so it
    plays, is tracked and protected exactly like an upload."""
    c = editable(request, body.course_id)
    url = body.url.strip()
    if not url.startswith("https://"):
        raise ServiceError("bad_url", "Use an https:// link to the video file.")
    library = instructor_perms.default_library(request.user, c)
    if library is None:
        raise ServiceError("video_unavailable", "Video uploads are not configured.", status=503)
    marker = f"lh-{secrets.token_hex(8)}"
    guid = bunny.fetch_video(library, url, marker)
    asset = services.create_media(kind="video", status="processing", library=library, uploaded_by=request.user,
                                  owner_org_id=c.owner_org_id, bunny_video_guid=guid,
                                  original_filename=html.plain(url.rsplit("/", 1)[-1], 255))  # fmt: skip
    try:  # give it its real title (the marker only served to find it)
        bunny.rename_video(library, guid, html.plain(body.title, 200))
    except ServiceError:
        pass  # cosmetic: the title in Bunny's dashboard only
    return {"asset_id": asset.id}


# ---------------------------------------------------------------- coupons
@router.get("/courses/{course_id}/coupons", response=list[StudioCouponOut])
def coupons(request, course_id: str):
    c = editable(request, course_id)
    return list(Coupon.objects.filter(course=c).order_by("-created_at").values(
        "id", "code", "percent_off", "max_redemptions", "redeemed_count", "starts_at", "ends_at", "is_active"))  # fmt: skip


@router.post("/courses/{course_id}/coupons", response=StudioCouponCreateOut)
def create_coupon(request, course_id: str, body: CouponIn):
    c = editable(request, course_id)
    if c.ownership != Course.Ownership.INSTRUCTOR:
        raise ServiceError("not_sold", "Coupons are for marketplace courses.")
    instructor_perms.check_coupons(request.user)
    if Coupon.objects.filter(code__iexact=body.code).exists():
        raise ServiceError("code_taken", "That code is already in use.")
    now = timezone.now()
    cp = Coupon.objects.create(code=body.code.upper(), course=c, percent_off=body.percent_off,
                               max_redemptions=body.max_redemptions, starts_at=now, ends_at=now + timedelta(days=body.days),
                               created_by=request.user)  # fmt: skip
    return {"id": cp.id, "code": cp.code}


@router.delete("/coupons/{coupon_id}", response=OkOut)
def deactivate_coupon(request, coupon_id: str):
    cp = get_object_or_404(Coupon, pk=coupon_id, course__isnull=False)
    editable(request, cp.course_id)
    Coupon.objects.filter(pk=cp.pk).update(is_active=False, updated_at=timezone.now())
    return {"ok": True}


# ---------------------------------------------------------------- students, inbox & grading
@router.get("/courses/{course_id}/students", response=list[StudioStudentOut])
def students(request, course_id: str, limit: int = 200):
    """Personal learners only: company learners' progress belongs to their company."""
    c = editable(request, course_id)
    with _instructor_view(request):
        rows = list(
            Enrollment.objects.filter(course=c, org__isnull=True, status__in=["active", "completed"])
            .select_related("user").order_by("-enrolled_at")[: max(1, min(limit, 500))]
        )  # fmt: skip
        return [{"name": e.user.full_name, "progress_pct": float(e.progress_pct), "status": e.status,
                 "enrolled_at": e.enrolled_at, "last_accessed_at": e.last_accessed_at} for e in rows]  # fmt: skip


@router.get("/questions", response=list[StudioQuestionInboxOut])
def question_inbox(request, unanswered: bool = True, limit: int = 50):
    from apps.engagement.models import Question

    qs = Question.objects.filter(course_id__in=_my_course_ids(request), hidden_at__isnull=True)
    if unanswered:
        qs = qs.filter(has_instructor_answer=False)
    rows = qs.select_related("user", "course").order_by("-created_at")[: max(1, min(limit, 200))]
    return [{"id": q.id, "course_id": q.course_id, "course_title": q.course.title, "title": q.title, "body": q.body,
             "author": q.user.full_name, "answer_count": q.answer_count,
             "has_instructor_answer": q.has_instructor_answer, "created_at": q.created_at} for q in rows]  # fmt: skip


@router.get("/reviews", response=list[StudioReviewInboxOut])
def review_inbox(request, unreplied: bool = False, limit: int = 50):
    from apps.engagement.models import Review

    qs = Review.objects.filter(course_id__in=_my_course_ids(request), status="published")
    if unreplied:
        qs = qs.filter(replied_at__isnull=True)
    rows = qs.select_related("user", "course").order_by("-created_at")[: max(1, min(limit, 200))]
    return [{"id": r.id, "course_id": r.course_id, "course_title": r.course.title, "rating": r.rating, "body": r.body, "author": r.user.full_name,
             "instructor_reply": r.instructor_reply, "created_at": r.created_at} for r in rows]  # fmt: skip


@router.get("/grading", response=StudioGradingQueueOut)
def grading_queue(request):
    """Assignments and essay answers waiting for the instructor, across my courses."""
    ids = _my_course_ids(request)
    with _instructor_view(request):
        subs = (
            Submission.objects.filter(enrollment__course_id__in=ids, status="submitted")
            .select_related("enrollment__user", "enrollment__course", "assignment__lecture")
            .prefetch_related("files__asset")
            .order_by("submitted_at")[:200]
        )
        attempts = (
            QuizAttempt.objects.filter(enrollment__course_id__in=ids, status="needs_grading")
            .select_related("enrollment__user", "enrollment__course", "quiz__lecture")
            .prefetch_related(Prefetch("quiz__questions", queryset=QuizQuestion.objects.filter(kind="essay")))
            .order_by("submitted_at")[:200]
        )
        return {
            "submissions": [{"id": s.id, "learner": s.enrollment.user.full_name, "course": s.enrollment.course.title,
                             "lecture": s.assignment.lecture.title, "attempt_no": s.attempt_no, "text": s.text_body,
                             "url": s.url, "submitted_at": s.submitted_at, "is_late": s.is_late,
                             "course_id": s.enrollment.course_id,
                             "max_score": s.assignment.max_score, "pass_score": s.assignment.pass_score,
                             "rubric": s.assignment.rubric,
                             "files": [{"id": f.id, "filename": f.asset.original_filename,
                                        "size_bytes": f.asset.size_bytes} for f in s.files.all()]} for s in subs],
            "attempts": [{"id": a.id, "learner": a.enrollment.user.full_name, "course": a.enrollment.course.title,
                          "quiz": a.quiz.lecture.title, "submitted_at": a.submitted_at, "answers": a.answers,
                          "results": a.results, "course_id": a.enrollment.course_id,
                          "essays": [{"id": q.id, "prompt": q.prompt, "points": q.points}
                                     for q in sorted(a.quiz.questions.all(), key=lambda q: q.position)]}
                         for a in attempts],
        }  # fmt: skip


@router.post("/submissions/{submission_id}/grade", response=StudioGradeOut)
def grade_submission(request, submission_id: str, body: GradeIn):
    with _instructor_view(request):
        sub = get_object_or_404(Submission.objects.select_related("enrollment"), pk=submission_id)
    editable(request, sub.enrollment.course_id)
    with _instructor_view(request):
        sub = learning.grade_submission(submission=sub, score=body.score, grader=request.user,
                                        feedback=html.clean(body.feedback, 20000),
                                        rubric_scores=[{"criterion": html.plain(r.criterion, 200), "points": r.points}
                                                       for r in body.rubric_scores],
                                        return_for_resubmission=body.return_for_resubmission)  # fmt: skip
    return {"status": sub.status, "passed": sub.passed}


@router.get("/submission-files/{file_id}/download", response=StudioResourceDownloadOut)
def submission_file(request, file_id: str):
    """A short-lived read link for a learner's hand-in, after the course check."""
    with _instructor_view(request):
        f = get_object_or_404(
            SubmissionFile.objects.select_related("submission__enrollment", "asset"), pk=file_id
        )
    editable(request, f.submission.enrollment.course_id)
    if not storage.configured():
        raise ServiceError("files_unavailable", "File storage is not configured.", status=503)
    key = f.asset.storage_key
    return {"url": storage.download_url(key, os.path.basename(key)), "expires_in": 3600}  # slugified name


@router.post("/attempts/{attempt_id}/grade", response=StudioEssayGradeOut)
def grade_essay(request, attempt_id: str, body: EssayGradeIn):
    with _instructor_view(request):
        attempt = get_object_or_404(QuizAttempt.objects.select_related("enrollment"), pk=attempt_id)
    editable(request, attempt.enrollment.course_id)
    with _instructor_view(request):
        attempt = learning.grade_manual(attempt=attempt, question_id=body.question_id, points=body.points,
                                        feedback=html.plain(body.feedback, 5000), grader=request.user)  # fmt: skip
    return {"status": attempt.status, "passed": attempt.passed, "score_pct": float(attempt.score_pct or 0)}


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard", response=StudioDashboardOut)
def dashboard(request):
    """The studio home's KPIs: a handful of aggregate queries, no per-course loops."""
    from apps.engagement.models import Question

    ids = _my_course_ids(request)
    agg = Course.objects.filter(pk__in=ids, deleted_at__isnull=True).aggregate(
        students=Sum("student_count"), ratings=Sum("rating_count"),
        weighted=Sum(F("rating_avg") * F("rating_count"), output_field=DecimalField()),
        courses=Count("id"), live=Count("id", filter=Q(status="published")),
    )  # fmt: skip
    month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = Earning.objects.filter(user=request.user, earned_at__gte=month_start).aggregate(
        t=Sum("amount_gbp_minor")
    )
    with _instructor_view(request):
        to_mark = (
            Submission.objects.filter(enrollment__course_id__in=ids, status="submitted").count()
            + QuizAttempt.objects.filter(enrollment__course_id__in=ids, status="needs_grading").count()
        )
    unanswered = Question.objects.filter(
        course_id__in=ids, hidden_at__isnull=True, has_instructor_answer=False
    ).count()
    ratings = agg["ratings"] or 0
    return {"courses": agg["courses"], "published": agg["live"], "students": agg["students"] or 0,
            "rating_avg": round(float(agg["weighted"] or 0) / ratings, 2) if ratings else 0.0, "rating_count": ratings,
            "earned_this_month_gbp_minor": month["t"] or 0, "to_mark": to_mark, "unanswered": unanswered}  # fmt: skip


# ---------------------------------------------------------------- revenue & payouts
@router.get("/revenue", response=StudioRevenueOut)
def my_revenue(request):
    own = payouts.instructor_fees([request.user.id]).get(request.user.id)
    fee = own if own is not None else payouts.default_fee_bps()
    return {"balance": revenue.balance(user_id=request.user.id), "by_month": revenue.by_month(user_id=request.user.id),
            "by_course": list(revenue.by_course(user_id=request.user.id)[:100]),
            "platform_fee_pct": round(fee / 100, 2), "fee_is_custom": own is not None}  # fmt: skip


@router.get("/payouts", response=list[StudioPayoutOut])
def my_payouts(request):
    return list(Payout.objects.filter(user=request.user).order_by("-period_end").values(
        "id", "period_end", "amount_gbp_minor", "status", "method", "paid_at", "failure_reason")[:60])  # fmt: skip


@router.get("/payout-account", response=StudioPayoutAccountOut)
def payout_account(request):
    a = PayoutAccount.objects.filter(user=request.user).first()
    if a is None:
        return {"configured": False}
    masked = a.paypal_email[:2] + "***" + a.paypal_email[a.paypal_email.find("@") :] if a.paypal_email else ""
    return {"configured": True, "method": a.method, "paypal_email": masked, "country": a.country,
            "verified": a.verified_at is not None, "stripe_connected": bool(a.stripe_account_id)}  # fmt: skip


@router.put("/payout-account", response=StudioPayoutAccountSetOut)
def set_payout_account(request, body: PayoutAccountIn):
    if body.method not in PayoutAccount.Method.values:
        raise ServiceError("bad_method", "Choose Stripe or PayPal.")
    a = payouts.set_payout_account(user=request.user, method=body.method, paypal_email=body.paypal_email.strip(),
                                   stripe_account_id=body.stripe_account_id.strip(), country=body.country)  # fmt: skip
    return {"verified": a.verified_at is not None}


# ---------------------------------------------------------------- certificate templates (mockup 23/30)
class StudioCertTemplateIn(Schema):
    name: str = Field(..., min_length=3, max_length=120)
    layout: dict = Field(default_factory=dict)
    signatory_name: str = Field("", max_length=120)
    signatory_title: str = Field("", max_length=120)
    show_qr_code: bool = True


class StudioCertTemplateOut(Schema):
    id: UUID
    name: str
    status: str
    is_platform: bool
    is_default: bool
    layout: dict
    signatory_name: str
    signatory_title: str
    show_qr_code: bool
    decision_reason: str


class StudioCourseTemplateIn(Schema):
    template_id: UUID | None = None  # None = the platform default


def _template_out(t) -> dict:
    from .certificates import clean_layout

    return {"id": t.id, "name": t.name, "status": t.status, "is_platform": t.created_by.is_staff,
            "is_default": t.is_default, "layout": clean_layout(t.layout), "signatory_name": t.signatory_name,
            "signatory_title": t.signatory_title, "show_qr_code": t.show_qr_code,
            "decision_reason": t.decision_reason}  # fmt: skip


def _instructor(request) -> None:
    p = InstructorProfile.objects.filter(user=request.user).first()
    if p is None or p.status != InstructorProfile.Status.APPROVED:
        raise ServiceError("not_instructor", "Only approved instructors can do this.", status=403)
    instructor_perms.ensure_active(request.user)


@router.get("/certificate-templates", response=list[StudioCertTemplateOut])
def certificate_templates(request):
    """Active platform templates and the instructor's own (any status)."""
    from .models import CertificateTemplate

    rows = (
        CertificateTemplate.objects.filter(owner_org__isnull=True)
        .filter(Q(created_by__is_staff=True, status="active") | Q(created_by=request.user))
        .exclude(status="archived")
        .select_related("created_by")
        .order_by("-is_default", "name")[:100]
    )
    return [_template_out(t) for t in rows]


@router.post("/certificate-templates", response=StudioCertTemplateOut)
def create_certificate_template(request, body: StudioCertTemplateIn):
    """An instructor's own design: staff approve it before it can be used."""
    from . import certificates

    _instructor(request)
    if not instructor_perms.for_user(request.user.id)["can_issue_certificates"]:
        raise ServiceError("forbidden", "Your account can't create certificate templates.", status=403)
    t = certificates.create_template(by=request.user, **body.dict())
    return _template_out(t)


@router.patch("/certificate-templates/{template_id}", response=StudioCertTemplateOut)
def update_certificate_template(request, template_id: UUID, body: StudioCertTemplateIn):
    from . import certificates
    from .models import CertificateTemplate

    _instructor(request)
    t = get_object_or_404(CertificateTemplate.objects.select_related("created_by"), pk=template_id,
                          created_by=request.user, owner_org__isnull=True)  # fmt: skip
    t = certificates.update_template(template=t, by=request.user, **body.dict(exclude_unset=True))
    return _template_out(t)


@router.put("/courses/{course_id}/certificate-template", response=OkOut)
def set_course_certificate_template(request, course_id: str, body: StudioCourseTemplateIn):
    from . import certificates

    c = editable(request, course_id)
    certificates.set_course_template(course=c, template_id=body.template_id, by=request.user)
    return {"ok": True}
