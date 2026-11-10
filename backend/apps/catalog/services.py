"""Catalog writes: courses, curriculum editing, versioning and publishing (decision 6).

Lifecycle of a version:
    draft ──submit──> in_review ──approve──> published ──(next publish)──> retired
      ^                   │
      └── request_changes ┘
Marketplace (instructor) courses go through review; platform-library and
company-private courses publish directly. Only draft / changes_requested versions
can be edited. Publishing never edits the live version: it swaps to a new one.

All functions expect to run inside a request (or core.tenancy.tenant_context), so
RLS applies; company-private content is only writable inside its company.
"""

from contextlib import contextmanager
from functools import wraps
from uuid import UUID

from django.db import connection, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from core import html
from core.db import new_id
from core.errors import ServiceError

from .models import (
    Assignment,
    Category,
    Course,
    CourseInstructor,
    CourseVersion,
    Lecture,
    LectureResource,
    MediaAsset,
    Quiz,
    QuizOption,
    QuizQuestion,
    Section,
)

EDITABLE = {CourseVersion.Status.DRAFT, CourseVersion.Status.CHANGES_REQUESTED}
CHOICE_KINDS = {
    QuizQuestion.Kind.SINGLE_CHOICE,
    QuizQuestion.Kind.MULTIPLE_CHOICE,
    QuizQuestion.Kind.TRUE_FALSE,
}


# ---------------------------------------------------------------- authoring lock
@contextmanager
def authoring():
    """Open the database's write lock for course content for the duration of one
    service call (RLS policy content_*). Restores the previous value on exit, so it can
    never leak into the rest of a request."""
    with connection.cursor() as cur:
        cur.execute("SELECT current_setting('app.author', true)")
        previous = cur.fetchone()[0] or ""
        cur.execute("SELECT set_config('app.author', 'on', true)")
    yield
    # Restore only on success: on an error the enclosing atomic block rolls back, which
    # undoes set_config by itself (and the failed transaction would reject a query here).
    with connection.cursor() as cur:
        cur.execute("SELECT set_config('app.author', %s, true)", [previous])


def authored(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with transaction.atomic(), authoring():
            return fn(*args, **kwargs)

    return wrapper


def create_media(**fields) -> MediaAsset:
    """A media record (video or file) for course content."""
    with transaction.atomic(), authoring():
        return MediaAsset.objects.create(**fields)


# ---------------------------------------------------------------- courses
@authored
def create_course(
    *, title: str, slug: str, ownership: str, created_by, owner_org_id=None, **fields
) -> Course:
    if (ownership == Course.Ownership.ORGANIZATION) != (owner_org_id is not None):
        raise ServiceError("ownership", "Company-private courses need an owner company, and only they do.")
    course = Course.objects.create(
        title=title,
        slug=slug,
        ownership=ownership,
        created_by=created_by,
        owner_org_id=owner_org_id,
        **fields,
    )
    share = 10000 if ownership == Course.Ownership.INSTRUCTOR else 0
    CourseInstructor.objects.create(course=course, user=created_by, revenue_share_bps=share)
    CourseVersion.objects.create(course=course, number=1)
    return course


def _editable(version: CourseVersion) -> None:
    if version.status not in EDITABLE:
        raise ServiceError("version_locked", "Only a draft version can be edited. Create a draft first.")


# ---------------------------------------------------------------- curriculum
@authored
def add_section(*, version: CourseVersion, title: str, description: str = "") -> Section:
    _editable(version)
    last = version.sections.aggregate(m=Max("position"))["m"]
    return Section.objects.create(
        version=version, title=title, description=description, position=(last or 0) + 1
    )


@authored
def add_lecture(*, section: Section, kind: str, title: str, **fields) -> Lecture:
    """Adds any kind of content. Quizzes and assignments get their settings row now,
    so the builder can open them straight away."""
    version = section.version
    _editable(version)
    if kind == Lecture.Kind.EXTERNAL_LINK and not fields.get("external_url"):
        raise ServiceError("missing_url", "An external link needs a URL.")
    if "body" in fields:
        fields["body"] = html.clean(fields["body"])
    last = section.lectures.aggregate(m=Max("position"))["m"]
    lecture = Lecture.objects.create(
        version=version,
        section=section,
        kind=kind,
        title=title,
        lecture_key=new_id(),
        position=(last or 0) + 1,
        **fields,
    )
    if kind == Lecture.Kind.QUIZ:
        Quiz.objects.create(lecture=lecture)
    elif kind == Lecture.Kind.ASSIGNMENT:
        Assignment.objects.create(lecture=lecture, instructions="", submission_types=["text", "file"])
    return lecture


@authored
def add_question(
    *, quiz: Quiz, kind: str, prompt: str, options: list[dict] | None = None, **fields
) -> QuizQuestion:
    """options: [{"body": "...", "is_correct": bool, "match_text": "...", "blank_index": 0}, ...]"""
    _editable(quiz.lecture.version)
    if "explanation" in fields:
        fields["explanation"] = html.clean(fields["explanation"], 5000)
    last = quiz.questions.aggregate(m=Max("position"))["m"]
    question = QuizQuestion.objects.create(
        quiz=quiz, kind=kind, prompt=html.clean(prompt, 5000), position=(last or 0) + 1, **fields
    )
    QuizOption.objects.bulk_create(
        QuizOption(question=question, position=i + 1, **opt) for i, opt in enumerate(options or [])
    )
    return question


# ---------------------------------------------------------------- publish checklist
def publish_checklist(version: CourseVersion) -> list[str]:
    """Problems blocking publication (the builder's completion checklist, screen 21).
    Empty list = ready."""
    problems: list[str] = []
    # one query per level, whatever the course size
    lectures = list(
        version.lectures.select_related("video", "quiz", "assignment").prefetch_related(
            "quiz__questions__options"
        )
    )
    if not lectures:
        problems.append("Add at least one lecture.")
    order = _course_order(version)
    for lec in lectures:
        where = f"'{lec.title}'"
        # a prerequisite can break later (the other lesson was deleted or moved below this one)
        if lec.prerequisite_key and (
            lec.prerequisite_key not in order
            or order.index(lec.prerequisite_key) > order.index(lec.lecture_key)
        ):
            problems.append(f"Lesson {where} needs a prerequisite that comes before it.")
        if lec.kind == Lecture.Kind.VIDEO and (
            lec.video is None or lec.video.status not in (MediaAsset.Status.PLAYABLE, MediaAsset.Status.READY)
        ):
            problems.append(f"Video lecture {where} has no finished video.")
        elif lec.kind == Lecture.Kind.ARTICLE and not lec.body.strip():
            problems.append(f"Reading {where} is empty.")
        elif lec.kind == Lecture.Kind.ASSIGNMENT and not lec.assignment.instructions.strip():
            problems.append(f"Assignment {where} has no instructions.")
        elif lec.kind == Lecture.Kind.LIVE_SESSION and not lec.live_starts_at:
            problems.append(f"Live session {where} has no start time.")
        elif lec.kind == Lecture.Kind.QUIZ:
            questions = sorted(lec.quiz.questions.all(), key=lambda q: q.position)
            if not questions:
                problems.append(f"Quiz {where} has no questions.")
            for q in questions:
                opts = list(q.options.all())
                if q.kind in CHOICE_KINDS and not any(o.is_correct for o in opts):
                    problems.append(f"Quiz {where}: question {q.position} has no correct answer.")
                elif q.kind == QuizQuestion.Kind.MATCHING and (
                    len(opts) < 2 or any(not o.match_text for o in opts)
                ):
                    problems.append(
                        f"Quiz {where}: matching question {q.position} needs at least two complete pairs."
                    )
                elif q.kind in (QuizQuestion.Kind.FILL_BLANK, QuizQuestion.Kind.SHORT_ANSWER) and not any(
                    o.is_correct for o in opts
                ):
                    problems.append(f"Quiz {where}: question {q.position} has no accepted answer.")
    return problems


# ---------------------------------------------------------------- versioning
@authored
def create_draft(*, course: Course, by) -> CourseVersion:
    """Return the open draft, or copy the live version into a new draft. Everything is
    copied (sections, lectures with the SAME lecture keys, quizzes, questions, options,
    assignments, resources); videos are shared, never re-uploaded."""
    course = Course.objects.select_for_update().get(pk=course.pk)  # one draft at a time
    open_version = course.versions.filter(status__in=["draft", "in_review", "changes_requested"]).first()
    if open_version:
        return open_version
    source = course.live_version
    if source is None:  # never live: start again from the last version staff rejected
        source = course.versions.filter(status=CourseVersion.Status.REJECTED).order_by("-number").first()
    if source is None:
        raise ServiceError("no_live_version", "This course has no published version to copy.")
    number = (course.versions.aggregate(m=Max("number"))["m"] or 0) + 1
    draft = CourseVersion.objects.create(course=course, number=number, based_on=source)
    _copy_content(source, draft)
    return draft


def _copy_content(source: CourseVersion, draft: CourseVersion) -> None:
    """Copy a version's curriculum into an empty draft (lecture keys kept)."""
    section_map = {}
    for sec in source.sections.all():
        section_map[sec.id] = Section.objects.create(
            version=draft, title=sec.title, description=sec.description, position=sec.position
        )
    copy_fields = [
        "prerequisite_key",
        "kind",
        "title",
        "position",
        "is_preview",
        "is_required",
        "duration_sec",
        "video_id",
        "body",
        "external_url",
        "live_starts_at",
        "live_duration_min",
        "live_join_url",
        "min_watch_pct",
        "lecture_key",
    ]
    for lec in source.lectures.select_related("quiz", "assignment").prefetch_related("resources"):
        new_lec = Lecture.objects.create(
            version=draft, section=section_map[lec.section_id], **{f: getattr(lec, f) for f in copy_fields}
        )
        LectureResource.objects.bulk_create(
            LectureResource(lecture=new_lec, asset_id=r.asset_id, title=r.title, position=r.position)
            for r in lec.resources.all()
        )
        if lec.kind == Lecture.Kind.QUIZ and hasattr(lec, "quiz"):
            _copy_quiz(lec.quiz, new_lec)
        if lec.kind == Lecture.Kind.ASSIGNMENT and hasattr(lec, "assignment"):
            _copy_assignment(lec.assignment, new_lec)


def _copy_quiz(quiz: Quiz, lecture: Lecture) -> None:
    new_quiz = Quiz.objects.create(
        lecture=lecture,
        mode=quiz.mode,
        pass_mark_pct=quiz.pass_mark_pct,
        time_limit_sec=quiz.time_limit_sec,
        max_attempts=quiz.max_attempts,
        shuffle_questions=quiz.shuffle_questions,
        shuffle_options=quiz.shuffle_options,
        reveal_answers=quiz.reveal_answers,
    )
    for q in quiz.questions.prefetch_related("options"):
        new_q = QuizQuestion.objects.create(
            quiz=new_quiz,
            kind=q.kind,
            prompt=q.prompt,
            explanation=q.explanation,
            points=q.points,
            position=q.position,
            case_sensitive=q.case_sensitive,
            media_id=q.media_id,
        )
        QuizOption.objects.bulk_create(
            QuizOption(
                question=new_q,
                body=o.body,
                is_correct=o.is_correct,
                match_text=o.match_text,
                blank_index=o.blank_index,
                position=o.position,
            )
            for o in q.options.all()
        )


def _copy_assignment(a: Assignment, lecture: Lecture) -> None:
    new_a = Assignment.objects.create(
        lecture=lecture,
        instructions=a.instructions,
        submission_types=a.submission_types,
        max_score=a.max_score,
        pass_score=a.pass_score,
        rubric=a.rubric,
        due_days_after_enrolment=a.due_days_after_enrolment,
        allow_late=a.allow_late,
        max_resubmissions=a.max_resubmissions,
        max_file_mb=a.max_file_mb,
        allowed_file_types=a.allowed_file_types,
    )
    new_a.attachments.set(a.attachments.all())


@authored
def submit(*, version: CourseVersion, by, change_summary: str = "", requires_recompletion: bool = False,
           is_major_change: bool = False):  # fmt: skip
    """Marketplace courses go to review; platform and company courses publish now.
    `is_major_change` (the instructor's own flag) puts an update in the "Course changes
    (major)" approvals tab; a first release is never a change."""
    _editable(version)
    if problems := publish_checklist(version):
        raise ServiceError("not_ready", "The course is not ready to publish.", details=problems)
    version.change_summary = change_summary
    version.requires_recompletion = requires_recompletion
    version.is_major_change = bool(is_major_change and version.course.live_version_id)
    version.submitted_by, version.submitted_at = by, timezone.now()
    if version.course.ownership == Course.Ownership.INSTRUCTOR:
        version.status = CourseVersion.Status.IN_REVIEW
        version.save()
        _tell_staff("staff_course_submitted", {"course": version.course.title,
                                               "name": by.full_name or by.email.split("@")[0]},
                    url=f"/console/approvals?item={version.id}", dedupe=f"submitted:{version.id}")  # fmt: skip
        return version
    version.save()
    return _publish(version)


def _in_review(version: CourseVersion, verb: str) -> CourseVersion:
    """Lock the version row, so two reviewers can't decide the same submission twice."""
    locked = CourseVersion.objects.select_for_update().select_related("course").get(pk=version.pk)
    if locked.status != CourseVersion.Status.IN_REVIEW:
        raise ServiceError("not_in_review", f"Only versions in review can be {verb}.")
    return locked


@authored
def approve(*, version: CourseVersion, reviewer, notes: str = "") -> CourseVersion:
    version = _in_review(version, "approved")
    version.reviewed_by, version.reviewed_at, version.review_notes = reviewer, timezone.now(), notes
    version.save()
    version = _publish(version)
    _tell_instructors(version.course, "course_approved", {"course": version.course.title},
                      url=f"/studio/courses/{version.course_id}", dedupe=f"approved:{version.id}")  # fmt: skip
    return version


@authored
def request_changes(*, version: CourseVersion, reviewer, notes: str) -> CourseVersion:
    if not notes.strip():
        raise ServiceError("notes_required", "Tell the instructor what to change.")
    version = _in_review(version, "sent back")
    version.status = CourseVersion.Status.CHANGES_REQUESTED
    version.reviewed_by, version.reviewed_at, version.review_notes = reviewer, timezone.now(), notes
    version.save()
    _tell_instructors(version.course, "course_changes_requested", {"course": version.course.title, "notes": notes},
                      url=f"/studio/courses/{version.course_id}/publish", dedupe=f"changes:{version.id}")  # fmt: skip
    return version


@authored
def reject(*, version: CourseVersion, reviewer, reason: str) -> CourseVersion:
    """Close a submission for good (it never goes live). The live version, if any, stays;
    the instructor can start a new draft later."""
    if len(reason.strip()) < 3:
        raise ServiceError("reason_required", "Give the instructor a reason.")
    version = _in_review(version, "rejected")
    version.status = CourseVersion.Status.REJECTED
    version.reviewed_by, version.reviewed_at, version.review_notes = reviewer, timezone.now(), reason
    version.save()
    _tell_instructors(version.course, "course_rejected", {"course": version.course.title, "reason": reason},
                      url=f"/studio/courses/{version.course_id}/publish", dedupe=f"rejected:{version.id}")  # fmt: skip
    return version


# ---------------------------------------------------------------- notifications (engagement, imported late)
def instructor_ids(course) -> list:
    return list(
        CourseInstructor.objects.filter(course=course, can_edit=True).values_list("user_id", flat=True)
    )


def _tell_instructors(course, code: str, context: dict, *, url: str, dedupe: str) -> None:
    if course.ownership != Course.Ownership.INSTRUCTOR:
        return  # platform and company courses have no marketplace instructor to tell
    from apps.engagement import notify

    notify.notify(instructor_ids(course), code, context, url=url, dedupe=dedupe)


def _tell_staff(code: str, context: dict, *, url: str, dedupe: str) -> None:
    from apps.engagement import notify

    notify.notify_staff(code, context, url=url, dedupe=dedupe)


def _publish(version: CourseVersion) -> CourseVersion:
    course = Course.objects.select_for_update().get(pk=version.course_id)
    now = timezone.now()
    CourseVersion.objects.filter(course=course, status=CourseVersion.Status.PUBLISHED).update(
        status=CourseVersion.Status.RETIRED
    )
    version.status, version.published_at = CourseVersion.Status.PUBLISHED, now
    version.save(update_fields=["status", "published_at", "updated_at"])
    stats = version.lectures.filter(is_required=True).aggregate(d=Sum("duration_sec"))
    course.live_version = version
    course.lecture_count = version.lectures.count()
    course.total_duration_sec = stats["d"] or 0
    if course.status == Course.Status.DRAFT:
        course.status, course.published_at = Course.Status.PUBLISHED, now
    course.save()
    return version


# ---------------------------------------------------------------- editing (studio)
COURSE_TEXT = {"title": 160, "subtitle": 240}
# Course languages offered in the editors (ISO 639-1); the label is for people.
LANGUAGES = {"en": "English (UK)", "ar": "Arabic", "fr": "French", "de": "German", "es": "Spanish",
             "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "tr": "Turkish",
             "ur": "Urdu", "hi": "Hindi", "zh": "Chinese"}  # fmt: skip


@authored
def update_course(*, course: Course, **changes) -> Course:
    """Landing-page details. Text is sanitised; the slug never changes once published."""
    for field, limit in COURSE_TEXT.items():
        if field in changes:
            value = html.plain(changes.pop(field), limit).strip()
            if field == "title" and len(value) < 3:
                raise ServiceError("title_short", "The title needs at least 3 characters.")
            setattr(course, field, value)
    if "description" in changes:
        course.description = html.clean(changes.pop("description"), 20000)
    if "thumbnail_url" in changes:
        url = changes.pop("thumbnail_url") or ""
        if url and not url.startswith("https://"):
            raise ServiceError("bad_url", "Images must use https://")
        course.thumbnail_url = url
    for field in ("outcomes", "requirements"):  # short plain-text bullet lists
        if field in changes:
            items = [html.plain(v, 200).strip() for v in changes.pop(field) or []]
            setattr(course, field, [v for v in items if v][:20])
    if "language" in changes:
        lang = (changes.pop("language") or "").strip().lower()
        if lang not in LANGUAGES:
            raise ServiceError("bad_language", "Choose a language from the list.")
        course.language = lang
    if "access_days" in changes:
        days = changes.pop("access_days")
        if days is not None and not 1 <= int(days) <= 3650:
            raise ServiceError("bad_access", "Access lasts 1 to 3,650 days, or for life.")
        course.access_days = days
    for field in ("level", "category_id", "cpd_hours", "in_subscription", "in_business"):
        if field in changes:
            setattr(course, field, changes.pop(field))
    if changes:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(changes))}.")
    course.save()
    return course


def _reorder(model, ids: list, **scope) -> None:
    """New positions for siblings in ONE statement; ids must be exactly the siblings."""
    current = {str(i) for i in model.objects.filter(**scope).values_list("id", flat=True)}
    ids = [str(i) for i in ids]
    if set(ids) != current or len(ids) != len(current):
        raise ServiceError("bad_order", "Send every item exactly once.")
    with connection.cursor() as cur:
        cur.execute(
            f"UPDATE {connection.ops.quote_name(model._meta.db_table)} AS t SET position = o.pos "  # noqa: S608
            "FROM unnest(%s::uuid[]) WITH ORDINALITY AS o(id, pos) WHERE t.id = o.id",
            [[str(i) for i in ids]],
        )


@authored
def reorder_sections(*, version: CourseVersion, ids: list) -> None:
    _editable(version)
    _reorder(Section, ids, version=version)


@authored
def reorder_lectures(*, section: Section, ids: list) -> None:
    _editable(section.version)
    _reorder(Lecture, ids, section=section)


@authored
def update_section(*, section: Section, title: str | None = None, description: str | None = None) -> Section:
    _editable(section.version)
    if title is not None:
        section.title = html.plain(title, 200).strip() or section.title
    if description is not None:
        section.description = html.plain(description, 2000)
    section.save()
    return section


@authored
def delete_section(*, section: Section) -> None:
    _editable(section.version)
    if section.lectures.exists():
        raise ServiceError("not_empty", "Move or delete the lectures in this section first.")
    section.delete()


def _course_order(version) -> list:
    """Lecture keys in the order learners meet them."""
    return list(
        Lecture.objects.filter(version=version)
        .order_by("section__position", "position")
        .values_list("lecture_key", flat=True)
    )


def _check_prerequisite(lecture: Lecture, key) -> None:
    order = _course_order(lecture.version)
    key = UUID(str(key))
    if key == lecture.lecture_key:
        raise ServiceError("bad_prerequisite", "A lesson can't be its own prerequisite.")
    if key not in order:
        raise ServiceError("bad_prerequisite", "Pick a lesson from this course.")
    if order.index(key) > order.index(lecture.lecture_key):
        raise ServiceError("bad_prerequisite", "The prerequisite must come before this lesson.")


LECTURE_FIELDS = {"title", "body", "is_preview", "is_required", "duration_sec", "external_url", "live_starts_at",
                  "live_duration_min", "live_join_url", "min_watch_pct", "video_id", "section_id",
                  "prerequisite_key"}  # fmt: skip


@authored
def update_lecture(*, lecture: Lecture, **changes) -> Lecture:
    _editable(lecture.version)
    unknown = set(changes) - LECTURE_FIELDS
    if unknown:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(unknown))}.")
    if "title" in changes:
        changes["title"] = html.plain(changes["title"], 200).strip() or lecture.title
    if "body" in changes:
        changes["body"] = html.clean(changes["body"])
    for url_field in ("external_url", "live_join_url"):
        if changes.get(url_field) and not changes[url_field].startswith("https://"):
            raise ServiceError("bad_url", "Links must use https://")
    if "video_id" in changes and changes["video_id"]:
        asset = MediaAsset.objects.filter(pk=changes["video_id"], kind="video").first()
        if asset is None:
            raise ServiceError("bad_video", "That video does not exist.")
        changes.setdefault("duration_sec", asset.duration_sec)
    if changes.get("prerequisite_key"):
        _check_prerequisite(lecture, changes["prerequisite_key"])
    if "section_id" in changes:
        target = Section.objects.filter(pk=changes["section_id"], version=lecture.version).first()
        if target is None:
            raise ServiceError("bad_section", "Lectures can only move within the same course version.")
        changes["position"] = (target.lectures.aggregate(m=Max("position"))["m"] or 0) + 1
    for k, v in changes.items():
        setattr(lecture, k, v)
    lecture.save()
    return lecture


@authored
def delete_lecture(*, lecture: Lecture) -> None:
    """Only from a draft: the live version (and everyone's progress on it) is untouched."""
    _editable(lecture.version)
    lecture.delete()


QUIZ_FIELDS = {"mode", "pass_mark_pct", "time_limit_sec", "max_attempts", "shuffle_questions", "shuffle_options",
               "reveal_answers"}  # fmt: skip


@authored
def update_quiz(*, quiz: Quiz, **changes) -> Quiz:
    _editable(quiz.lecture.version)
    unknown = set(changes) - QUIZ_FIELDS
    if unknown:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(unknown))}.")
    for k, v in changes.items():
        setattr(quiz, k, v)
    quiz.full_clean(exclude=["lecture"])
    quiz.save()
    return quiz


@authored
def replace_question(*, question: QuizQuestion, prompt: str, options: list[dict], explanation: str = "",
                     points: int | None = None) -> QuizQuestion:  # fmt: skip
    """Edit a question and replace its options in one go (the builder sends the whole question)."""
    _editable(question.quiz.lecture.version)
    question.prompt = html.clean(prompt, 5000)
    question.explanation = html.clean(explanation, 5000)
    if points is not None:
        question.points = max(1, min(int(points), 100))
    question.save()
    question.options.all().delete()
    QuizOption.objects.bulk_create(
        QuizOption(question=question, position=i + 1, **{k: v for k, v in o.items()
                                                          if k in ("body", "is_correct", "match_text", "blank_index")})
        for i, o in enumerate(options)
    )  # fmt: skip
    return question


@authored
def delete_question(*, question: QuizQuestion) -> None:
    _editable(question.quiz.lecture.version)
    question.delete()


ASSIGNMENT_FIELDS = {"instructions", "max_score", "pass_score", "rubric", "due_days_after_enrolment", "allow_late",
                     "max_resubmissions", "max_file_mb", "submission_types"}  # fmt: skip


@authored
def update_assignment(*, assignment: Assignment, **changes) -> Assignment:
    _editable(assignment.lecture.version)
    unknown = set(changes) - ASSIGNMENT_FIELDS
    if unknown:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(unknown))}.")
    if "instructions" in changes:
        changes["instructions"] = html.clean(changes["instructions"], 20000)
    if "submission_types" in changes and not set(changes["submission_types"]) <= {"text", "file", "url"}:
        raise ServiceError("bad_type", "Submission types are text, file and url.")
    for k, v in changes.items():
        setattr(assignment, k, v)
    if assignment.pass_score > assignment.max_score:
        raise ServiceError("bad_score", "The pass mark cannot exceed the maximum score.")
    assignment.save()
    return assignment


# ---------------------------------------------------------------- staff (console > Courses)
# Listing changes made by platform staff. Each one is audited by the console API and, for
# marketplace courses, tells the instructors (section N of the M5 brief).
def _stamp() -> int:
    return int(timezone.now().timestamp())


@authored
def staff_publish(*, course: Course) -> Course:
    """List a course that has a live version (a new course must pass review first).
    Also relists an unpublished or archived course."""
    course = Course.objects.select_for_update().get(pk=course.pk, deleted_at__isnull=True)
    if course.live_version_id is None:
        raise ServiceError("no_live_version", f'"{course.title}" has no approved version to publish yet.')
    if course.status != Course.Status.PUBLISHED:
        was_hidden = course.status in (Course.Status.UNLISTED, Course.Status.ARCHIVED)
        course.status = Course.Status.PUBLISHED
        course.published_at = course.published_at or timezone.now()
        course.save(update_fields=["status", "published_at", "updated_at"])
        if was_hidden:
            _tell_instructors(course, "course_relisted", {"course": course.title}, url=f"/studio/courses/{course.id}",
                              dedupe=f"relisted:{course.id}:{_stamp()}")  # fmt: skip
    return course


@authored
def staff_unpublish(*, course: Course, reason: str) -> Course:
    """Off the marketplace (unlisted); learners who have it keep access."""
    if len(reason.strip()) < 3:
        raise ServiceError("reason_required", "Give a reason for unpublishing.")
    course = Course.objects.select_for_update().get(pk=course.pk, deleted_at__isnull=True)
    if course.status != Course.Status.PUBLISHED:
        raise ServiceError("not_published", f'"{course.title}" is not published.')
    course.status = Course.Status.UNLISTED
    course.save(update_fields=["status", "updated_at"])
    _tell_instructors(course, "course_unpublished", {"course": course.title, "reason": reason},
                      url=f"/studio/courses/{course.id}", dedupe=f"unpublished:{course.id}:{_stamp()}")  # fmt: skip
    return course


@authored
def staff_archive(*, course: Course) -> Course:
    """Hidden everywhere except for learners who already have it. Publishing relists it."""
    course = Course.objects.select_for_update().get(pk=course.pk, deleted_at__isnull=True)
    course.status = Course.Status.ARCHIVED
    course.save(update_fields=["status", "updated_at"])
    return course


@authored
def staff_delete(*, course: Course) -> Course:
    """Soft delete (deleted_at): the row and its history stay. Refused while anyone is
    enrolled: archive the course instead."""
    from apps.learning.models import Enrollment

    course = Course.objects.select_for_update().get(pk=course.pk, deleted_at__isnull=True)
    if Enrollment.objects.filter(course=course).exclude(status=Enrollment.Status.REVOKED).exists():
        raise ServiceError("has_learners", f'"{course.title}" has learners. Archive it instead.')
    course.deleted_at = timezone.now()
    if course.status == Course.Status.PUBLISHED:
        course.status = Course.Status.ARCHIVED
    course.save(update_fields=["deleted_at", "status", "updated_at"])
    return course


@authored
def staff_set_category(*, course_ids: list, category_id) -> int:
    return Course.objects.filter(pk__in=course_ids, deleted_at__isnull=True).update(
        category_id=category_id, updated_at=timezone.now()
    )


@authored
def duplicate(*, course: Course) -> Course:
    """A draft copy: same details, owners and curriculum (from the live version, or the
    newest one), a new slug, never listed until it is published."""
    import secrets

    from django.utils.text import slugify

    title = f"Copy of {course.title}"[:160]
    copy = Course.objects.create(
        title=title, slug=f"{slugify(title)[:100] or 'course'}-{secrets.token_hex(3)}", ownership=course.ownership,
        owner_org_id=course.owner_org_id, created_by_id=course.created_by_id, category_id=course.category_id,
        subtitle=course.subtitle, description=course.description, level=course.level, outcomes=course.outcomes,
        requirements=course.requirements, target_audience=course.target_audience, thumbnail_url=course.thumbnail_url,
        certificate_template_id=course.certificate_template_id, is_free=course.is_free,
        in_subscription=course.in_subscription, in_business=course.in_business, cpd_hours=course.cpd_hours,
        language=course.language, access_days=course.access_days,
    )  # fmt: skip
    CourseInstructor.objects.bulk_create(
        CourseInstructor(course=copy, user_id=link.user_id, revenue_share_bps=link.revenue_share_bps,
                         can_edit=link.can_edit, is_visible=link.is_visible, position=link.position)
        for link in CourseInstructor.objects.filter(course=course)
    )  # fmt: skip
    draft = CourseVersion.objects.create(course=copy, number=1)
    source = course.live_version or course.versions.order_by("-number").first()
    if source is not None:
        _copy_content(source, draft)
    return copy


# ---------------------------------------------------------------- categories (console)
def _category_fields(name: str, icon: str) -> tuple[str, str]:
    name = html.plain(name, 120).strip()
    if len(name) < 2:
        raise ServiceError("name_short", "The name needs at least 2 characters.")
    icon = (icon or "").strip()[:48]
    if icon and not all(ch.isalnum() or ch == "-" for ch in icon):
        raise ServiceError("bad_icon", "Icon names use letters, numbers and dashes.")
    return name, icon


def create_category(*, name: str, icon: str = "", parent_id=None) -> Category:
    import secrets

    from django.utils.text import slugify

    name, icon = _category_fields(name, icon)
    last = Category.objects.filter(parent_id=parent_id).aggregate(m=Max("sort_order"))["m"]
    slug = slugify(name)[:70] or "category"
    if Category.objects.filter(slug=slug).exists():
        slug = f"{slug}-{secrets.token_hex(2)}"
    return Category.objects.create(
        name=name, icon=icon, parent_id=parent_id, slug=slug, sort_order=(last or 0) + 1
    )


def update_category(*, category: Category, name: str | None = None, icon: str | None = None,
                    is_active: bool | None = None) -> Category:  # fmt: skip
    if name is not None or icon is not None:
        category.name, category.icon = _category_fields(name if name is not None else category.name,
                                                        icon if icon is not None else category.icon)  # fmt: skip
    if is_active is not None:
        category.is_active = is_active
    category.save()
    return category


def reorder_categories(*, ids: list) -> None:
    """A new order for one level of categories (top level, or one parent's children)."""
    ids = [str(i) for i in ids]
    parents = set(Category.objects.filter(pk__in=ids).values_list("parent_id", flat=True))
    if len(parents) != 1 or len(ids) != len(set(ids)):
        raise ServiceError("bad_order", "Send the categories of one level, each once.")
    siblings = {str(i) for i in Category.objects.filter(parent_id=parents.pop()).values_list("id", flat=True)}
    if set(ids) != siblings:
        raise ServiceError("bad_order", "Send every category of that level exactly once.")
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE catalog.categories AS t SET sort_order = o.pos, updated_at = now() "
            "FROM unnest(%s::uuid[]) WITH ORDINALITY AS o(id, pos) WHERE t.id = o.id",
            [ids],
        )
