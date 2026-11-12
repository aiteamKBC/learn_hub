"""Learner endpoints: my learning, the course player, progress, quizzes, assignments,
notes and certificates.

Every player endpoint loads the enrolment with user=request.user. RLS would also let
a company admin SEE a member's company enrolment (for reports); this check makes
sure nobody can PLAY, SUBMIT or GRADE-THEMSELVES as another person.
"""

from datetime import timedelta

from django.db.models import F, Prefetch, Q
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router

from apps.catalog import media, resources
from apps.catalog.models import CourseInstructor, Lecture, QuizQuestion
from apps.catalog.selectors import curriculum, learner_quiz
from core import cursor as keyset
from core import html
from core.auth import session_auth
from core.errors import ServiceError

from . import progress, services, uploads
from .models import Certificate, Enrollment, LectureProgress, Note, QuizAttempt, Submission
from .schemas import (
    AttemptOut,
    CertificateOut,
    DownloadOut,
    HeartbeatIn,
    HeartbeatOut,
    LectureContent,
    MyCoursePage,
    NoteIn,
    NoteOut,
    NotePatchIn,
    OkOut,
    PlayerOut,
    ProgressOut,
    SubmissionIn,
    SubmissionOut,
    SubmissionUploadIn,
    SubmissionUploadOut,
    SubmitAnswersIn,
    VerifyOut,
)

router = Router(tags=["learning"], auth=session_auth)
LIVE = ("active", "completed")


def _mine(request, enrollment_id) -> Enrollment:
    e = get_object_or_404(
        Enrollment.objects.select_related("course__live_version"), pk=enrollment_id, user=request.user
    )
    if e.status not in LIVE:
        raise ServiceError("no_access", "This enrolment is not active.", status=403)
    if e.access_expires_at and e.access_expires_at < timezone.now():
        raise ServiceError("access_expired", "Your access to this course has ended.", status=403)
    return e


def _lecture(e: Enrollment, key) -> Lecture:
    lec = (
        Lecture.objects.select_related("section", "video__library")
        .filter(version_id=e.course.live_version_id, lecture_key=key)
        .first()
    )
    if lec is None:
        raise ServiceError("not_found", "Lecture not found.", status=404)
    _check_unlocked(e, lec)
    return lec


def _check_unlocked(e: Enrollment, lec: Lecture) -> None:
    """Two gates run here:

    1. Prerequisite lesson: a lesson with ``prerequisite_key`` stays locked until that
       earlier lesson is complete. A prerequisite missing from the live version (deleted
       later) does not lock anything (fail-open — learners are never stuck).
    2. B2C content-access resolver (milestone B2C-01 / M9): delegates to
       :func:`apps.platform.access.resolve`. Company enrolments (``org_id`` set) and
       legacy personal enrolments both resolve through the new engine, which recognises
       the existing enrolment as a ``legacy_purchase`` ALLOW. A deny from the resolver
       becomes a stable 403 with ``reason_code`` the frontend can key upgrade hints on.
    """
    # 1) prerequisite (unchanged legacy behaviour)
    if lec.prerequisite_key:
        before = (
            Lecture.objects.filter(version_id=lec.version_id, lecture_key=lec.prerequisite_key)
            .only("title")
            .first()
        )
        if before is not None:
            done = LectureProgress.objects.filter(
                enrollment=e, lecture_key=lec.prerequisite_key, completed_at__isnull=False
            ).exists()
            if not done:
                raise ServiceError("locked", f"Finish “{before.title}” first.", status=403)

    # 2) content-access resolver. Company (B2B) enrolments bypass the B2C resolver:
    #    their access is controlled by the org assignment itself, unchanged.
    if e.org_id is not None:
        return
    from apps.platform import access as _access

    decision = _access.resolve(e.user, _access.SCOPE_LECTURE, lec.id, lecture_hint=lec)
    if not decision.allowed:
        raise ServiceError(
            decision.reason_code or "no_access",
            "You don't have access to this lecture.",
            status=403,
        )


# ---------------------------------------------------------------- my learning
@router.get("/my/courses", response=MyCoursePage)
def my_courses(
    request, status: str = "all", slug: str | None = None, cursor: str | None = None, limit: int = 24
):
    """Personal and company learning together, most recently used first. `slug` finds the
    enrolment behind a course page or player URL (bought and assigned may both exist: the
    most recently used comes first)."""
    limit = max(1, min(limit, 60))
    qs = (
        Enrollment.objects.filter(user=request.user, status__in=LIVE)
        .annotate(seen=Coalesce("last_accessed_at", "enrolled_at"))
        .select_related("course", "org")
        .prefetch_related(
            Prefetch(
                "course__instructor_links",
                queryset=CourseInstructor.objects.filter(is_visible=True).select_related("user"),
                to_attr="visible_instructors",
            )
        )
        .order_by(F("seen").desc(), "-id")
    )
    if slug:
        qs = qs.filter(course__slug=slug[:120])
    if status == "completed":
        qs = qs.filter(status="completed")
    elif status == "in_progress":
        qs = qs.filter(status="active")
    after = keyset.decode(cursor, 2)
    if after:
        seen, last_id = after
        qs = qs.filter(Q(seen__lt=seen) | Q(seen=seen, id__lt=last_id))
    rows = list(qs[: limit + 1])
    page = rows[:limit]
    certs = dict(Certificate.objects.filter(enrollment__in=page).values_list("enrollment_id", "id"))
    items = [
        {
            "enrollment_id": e.id, "course_id": e.course_id, "slug": e.course.slug, "title": e.course.title,
            "thumbnail_url": e.course.thumbnail_url,
            "instructors": [i.user.full_name for i in e.course.visible_instructors],
            "progress_pct": float(e.progress_pct), "status": e.status, "source": e.source, "org_id": e.org_id,
            "org_name": e.org.name if e.org_id else None, "enrolled_at": e.enrolled_at,
            "last_accessed_at": e.last_accessed_at, "last_lecture_key": e.last_lecture_key,
            "access_expires_at": e.access_expires_at, "certificate_id": certs.get(e.id),
        }
        for e in page
    ]  # fmt: skip
    nxt = keyset.encode(page[-1].seen.isoformat(), page[-1].id) if len(rows) > limit else None
    return {"items": items, "next_cursor": nxt}


# ---------------------------------------------------------------- player
@router.get("/enrollments/{enrollment_id}", response=PlayerOut)
def player(request, enrollment_id: str):
    """Everything the player sidebar needs, in a fixed number of queries."""
    e = _mine(request, enrollment_id)
    done = {
        p.lecture_key: p
        for p in LectureProgress.objects.filter(enrollment=e).only(
            "lecture_key", "completed_at", "last_position_sec"
        )
    }
    tree = curriculum(e.course.live_version)
    titles = {lec.lecture_key: lec.title for s in tree for lec in s.lectures.all()}

    def finished(key):
        return bool(done.get(key) and done[key].completed_at)

    def prereq(lec):  # the same rule as _check_unlocked, without extra queries
        return lec.prerequisite_key if lec.prerequisite_key in titles else None

    sections = [
        {"id": s.id, "title": s.title, "lectures": [
            {"key": lec.lecture_key, "title": lec.title, "kind": lec.kind, "duration_sec": lec.duration_sec,
             "completed": finished(lec.lecture_key),
             "position_sec": done[lec.lecture_key].last_position_sec if lec.lecture_key in done else 0,
             "prerequisite_key": prereq(lec), "prerequisite_title": titles.get(prereq(lec)),
             "locked": bool(prereq(lec)) and not finished(prereq(lec))}
            for lec in s.lectures.all()]}
        for s in tree
    ]  # fmt: skip
    cert = Certificate.objects.filter(enrollment=e).values_list("id", flat=True).first()
    return {"enrollment_id": e.id, "course_id": e.course_id, "slug": e.course.slug, "title": e.course.title,
            "progress_pct": float(e.progress_pct), "status": e.status, "last_lecture_key": e.last_lecture_key,
            "certificate_id": cert, "sections": sections}  # fmt: skip


@router.get("/enrollments/{enrollment_id}/lectures/{lecture_key}", response=LectureContent)
def lecture(request, enrollment_id: str, lecture_key: str):
    e = _mine(request, enrollment_id)
    lec = _lecture(e, lecture_key)
    keys = list(
        Lecture.objects.filter(version_id=e.course.live_version_id)
        .order_by("section__position", "position")
        .values_list("lecture_key", flat=True)
    )
    i = keys.index(lec.lecture_key)
    p = LectureProgress.objects.filter(enrollment=e, lecture_key=lec.lecture_key).first()
    Enrollment.objects.filter(pk=e.pk).update(
        last_lecture_key=lec.lecture_key, last_accessed_at=timezone.now()
    )
    out = {
        "key": lec.lecture_key, "title": lec.title, "kind": lec.kind, "duration_sec": lec.duration_sec,
        "completed": bool(p and p.completed_at), "position_sec": p.last_position_sec if p else 0,
        "prev_key": keys[i - 1] if i > 0 else None, "next_key": keys[i + 1] if i + 1 < len(keys) else None,
        "resources": [resources.payload(r) for r in lec.resources.select_related("asset").order_by("position")],
    }  # fmt: skip
    if lec.kind == Lecture.Kind.VIDEO:
        out["video"] = media.playback(lec.video)
        out.update(media.video_meta(lec.video))
    elif lec.kind == Lecture.Kind.ARTICLE:
        out["body"] = lec.body
    elif lec.kind in (Lecture.Kind.EXTERNAL_LINK,):
        out["external_url"] = lec.external_url
    elif lec.kind == Lecture.Kind.LIVE_SESSION:
        now = timezone.now()
        starts = lec.live_starts_at
        # the join link appears 15 minutes before the start, never earlier
        joinable = bool(starts) and starts - timedelta(minutes=15) <= now
        out["live"] = {"starts_at": starts, "duration_min": lec.live_duration_min,
                       "join_url": lec.live_join_url if joinable else None,
                       "provider": lec.live_provider}  # fmt: skip
    elif lec.kind == Lecture.Kind.QUIZ:
        q = lec.quiz
        attempts = QuizAttempt.objects.filter(enrollment=e, quiz=q).order_by("attempt_no")
        out["quiz"] = {
            "mode": q.mode, "pass_mark_pct": q.pass_mark_pct, "time_limit_sec": q.time_limit_sec,
            "max_attempts": q.max_attempts, "question_count": q.questions.count(),
            "attempts": [{"id": str(a.id), "attempt_no": a.attempt_no, "status": a.status,
                          "score_pct": float(a.score_pct) if a.score_pct is not None else None, "passed": a.passed,
                          "submitted_at": a.submitted_at} for a in attempts],
        }  # fmt: skip
    elif lec.kind == Lecture.Kind.ASSIGNMENT:
        a = lec.assignment
        subs = Submission.objects.filter(enrollment=e, assignment=a).order_by("attempt_no")
        due = (
            e.enrolled_at + timedelta(days=a.due_days_after_enrolment) if a.due_days_after_enrolment else None
        )
        out["assignment"] = {
            "instructions": a.instructions, "max_score": a.max_score, "pass_score": a.pass_score,
            "submission_types": a.submission_types, "due_at": due, "allow_late": a.allow_late,
            "rubric": a.rubric,
            "submissions": [_submission_out(s) for s in subs.prefetch_related("files__asset")],
        }  # fmt: skip
    return out


@router.get(
    "/enrollments/{enrollment_id}/lectures/{lecture_key}/resources/{resource_id}/download",
    response=DownloadOut,
)
def download_resource(request, enrollment_id: str, lecture_key: str, resource_id: str):
    """A 1-hour, read-only link; only for an active enrolment on the live version."""
    lec = _lecture(_mine(request, enrollment_id), lecture_key)
    r = lec.resources.select_related("asset").filter(pk=resource_id).first()
    if r is None:
        raise ServiceError("not_found", "File not found.", status=404)
    return {"url": resources.download_url(r), "expires_in": 3600}


@router.post("/enrollments/{enrollment_id}/heartbeat", response=HeartbeatOut)
def heartbeat(request, enrollment_id: str, body: HeartbeatIn):
    """Every ~30 s while a video plays. Buffered in Redis and written in batches; the
    beat sent when the video ends is written at once and reports whether it completed."""
    e = _mine(request, enrollment_id)
    _lecture(e, body.lecture_key)
    progress.record_heartbeat(
        enrollment=e,
        lecture_key=body.lecture_key,
        position_sec=body.position_sec,
        watched_delta_sec=body.watched_sec,
        ended=body.ended,
    )
    return {"ok": True, "completed": body.ended and progress.is_complete(e, body.lecture_key)}


@router.post("/enrollments/{enrollment_id}/lectures/{lecture_key}/complete", response=ProgressOut)
def complete(request, enrollment_id: str, lecture_key: str):
    """Readings, links, downloads and live sessions are marked done by the learner.
    Videos complete from watch time (or by hand when no video is playable), quizzes by
    passing, assignments by being graded."""
    e = _mine(request, enrollment_id)
    lec = _lecture(e, lecture_key)
    # a video with nothing to play (not uploaded yet) cannot be completed by watching,
    # so the learner may tick it off like a reading
    playable = (media.playback(lec.video) or {}).get("kind") == "bunny"
    unplayable = lec.kind == Lecture.Kind.VIDEO and not playable
    if lec.kind in (Lecture.Kind.VIDEO, Lecture.Kind.QUIZ, Lecture.Kind.ASSIGNMENT) and not unplayable:
        raise ServiceError("not_manual", "This lecture completes automatically.")
    services.complete_lecture(enrollment=e, lecture_key=lec.lecture_key)
    e.refresh_from_db()
    return {"progress_pct": float(e.progress_pct), "status": e.status}


# ---------------------------------------------------------------- quizzes
# question kinds whose stored options are the choices shown to the learner (for matching:
# the left-hand items). Free-text kinds store accepted answers there, which stay hidden.
SHOWS_OPTIONS = {
    QuizQuestion.Kind.SINGLE_CHOICE, QuizQuestion.Kind.MULTIPLE_CHOICE,
    QuizQuestion.Kind.TRUE_FALSE, QuizQuestion.Kind.MATCHING,
}  # fmt: skip


def _attempt_out(attempt: QuizAttempt, *, with_questions: bool) -> dict:
    out = {
        "id": attempt.id, "attempt_no": attempt.attempt_no, "status": attempt.status,
        "started_at": attempt.started_at, "expires_at": attempt.expires_at, "submitted_at": attempt.submitted_at,
        "score_pct": float(attempt.score_pct) if attempt.score_pct is not None else None, "passed": attempt.passed,
    }  # fmt: skip
    quiz = attempt.quiz
    if with_questions and attempt.status == QuizAttempt.Status.IN_PROGRESS:
        out["quiz"] = learner_quiz(quiz, seed=attempt.id.int % 2**31)
    reveal = quiz.reveal_answers
    allowed = attempt.submitted_at and (
        reveal == "after_submit" or (reveal == "after_pass" and attempt.passed)
    )
    if allowed:
        questions = quiz.questions.order_by("position").prefetch_related("options")
        review = []
        for q in questions:
            r = (attempt.results or {}).get(str(q.id), {})
            item = {"question_id": str(q.id), "kind": q.kind, "prompt": q.prompt, "points": r.get("points"),
                    "max": r.get("max", q.points), "explanation": q.explanation,
                    "your_answer": (attempt.answers or {}).get(str(q.id))}  # fmt: skip
            if q.kind in SHOWS_OPTIONS:
                # choices (or the left-hand items of a matching question); never the accepted
                # free-text answers
                item["options"] = [{"id": str(o.id), "body": o.body} for o in q.options.all()]
            if q.kind in (QuizQuestion.Kind.SINGLE_CHOICE, QuizQuestion.Kind.MULTIPLE_CHOICE,
                          QuizQuestion.Kind.TRUE_FALSE):  # fmt: skip
                item["correct_option_ids"] = [str(o.id) for o in q.options.all() if o.is_correct]
            review.append(item)
        out["review"] = review
    return out


@router.post("/enrollments/{enrollment_id}/quizzes/{lecture_key}/attempts", response=AttemptOut)
def start_quiz(request, enrollment_id: str, lecture_key: str):
    e = _mine(request, enrollment_id)
    lec = _lecture(e, lecture_key)
    if lec.kind != Lecture.Kind.QUIZ:
        raise ServiceError("not_quiz", "This lecture is not a quiz.")
    attempt = services.start_attempt(enrollment=e, quiz=lec.quiz)
    return _attempt_out(attempt, with_questions=True)


def _my_attempt(request, attempt_id) -> QuizAttempt:
    return get_object_or_404(
        QuizAttempt.objects.select_related("quiz", "enrollment"), pk=attempt_id, enrollment__user=request.user
    )


@router.get("/attempts/{attempt_id}", response=AttemptOut)
def get_attempt(request, attempt_id: str):
    return _attempt_out(_my_attempt(request, attempt_id), with_questions=True)


@router.post("/attempts/{attempt_id}/submit", response=AttemptOut)
def submit_quiz(request, attempt_id: str, body: SubmitAnswersIn):
    attempt = _my_attempt(request, attempt_id)
    _mine(request, attempt.enrollment_id)  # access still valid
    if len(body.answers) > 500:
        raise ServiceError("too_many_answers", "Too many answers.")
    attempt = services.submit_attempt(attempt=attempt, answers=body.answers)
    return _attempt_out(attempt, with_questions=False)


# ---------------------------------------------------------------- assignments
def _submission_out(s: Submission) -> dict:
    return {
        "id": s.id, "attempt_no": s.attempt_no, "status": s.status, "submitted_at": s.submitted_at,
        "is_late": s.is_late, "score": s.score, "passed": s.passed, "feedback": s.feedback,
        "text": s.text_body, "url": s.url,
        "files": [{"filename": f.asset.original_filename, "size_bytes": f.asset.size_bytes} for f in s.files.all()],
    }  # fmt: skip


def _assignment(request, enrollment_id: str, lecture_key: str):
    e = _mine(request, enrollment_id)
    lec = _lecture(e, lecture_key)
    if lec.kind != Lecture.Kind.ASSIGNMENT:
        raise ServiceError("not_assignment", "This lecture is not an assignment.")
    return e, lec.assignment


@router.post("/enrollments/{enrollment_id}/assignments/{lecture_key}/uploads", response=SubmissionUploadOut)
def start_submission_upload(request, enrollment_id: str, lecture_key: str, body: SubmissionUploadIn):
    """Step 1 of handing in a file: a 15-minute write-only link; the browser PUTs the file
    to it, then lists the asset_id in the submission."""
    e, assignment = _assignment(request, enrollment_id, lecture_key)
    return uploads.start_upload(enrollment=e, assignment=assignment, user=request.user,
                                filename=body.filename, size_bytes=body.size_bytes)  # fmt: skip


@router.post("/enrollments/{enrollment_id}/assignments/{lecture_key}/submissions", response=SubmissionOut)
def submit_assignment(request, enrollment_id: str, lecture_key: str, body: SubmissionIn):
    e, assignment = _assignment(request, enrollment_id, lecture_key)
    url = body.url.strip()
    if url and not url.startswith("https://"):
        raise ServiceError("bad_url", "Links must start with https://")
    s = services.submit_assignment(enrollment=e, assignment=assignment, text_body=html.plain(body.text, 50000), url=url,
                                   asset_ids=body.asset_ids)  # fmt: skip
    return _submission_out(s)


# ---------------------------------------------------------------- notes
@router.get("/enrollments/{enrollment_id}/notes", response=list[NoteOut])
def notes(request, enrollment_id: str, lecture_key: str | None = None):
    e = _mine(request, enrollment_id)
    qs = Note.objects.filter(enrollment=e).order_by("lecture_key", "timestamp_sec", "created_at")
    return qs.filter(lecture_key=lecture_key) if lecture_key else qs[:500]


@router.post("/enrollments/{enrollment_id}/notes", response=NoteOut)
def add_note(request, enrollment_id: str, body: NoteIn):
    e = _mine(request, enrollment_id)
    _lecture(e, body.lecture_key)
    return Note.objects.create(enrollment=e, user=request.user, org_id=e.org_id, lecture_key=body.lecture_key,
                               timestamp_sec=body.timestamp_sec, body=body.body.strip())  # fmt: skip


@router.patch("/notes/{note_id}", response=NoteOut)
def update_note(request, note_id: str, body: NotePatchIn):
    """Change a note's text or the moment of the video it is pinned to."""
    note = Note.objects.filter(pk=note_id, enrollment__user=request.user).first()
    if note is None:
        raise ServiceError("not_found", "Note not found.", status=404)
    fields = ["updated_at"]
    if body.clear_timestamp:
        note.timestamp_sec = None
        fields.append("timestamp_sec")
    elif body.timestamp_sec is not None:
        note.timestamp_sec = body.timestamp_sec
        fields.append("timestamp_sec")
    if body.body is not None:
        note.body = body.body.strip()
        fields.append("body")
    note.save(update_fields=fields)
    return note


@router.delete("/notes/{note_id}", response=OkOut)
def delete_note(request, note_id: str):
    deleted, _ = Note.objects.filter(pk=note_id, enrollment__user=request.user).delete()
    if not deleted:
        raise ServiceError("not_found", "Note not found.", status=404)
    return {"ok": True}


# ---------------------------------------------------------------- certificates
@router.get("/my/certificates", response=list[CertificateOut])
def my_certificates(request):
    return Certificate.objects.filter(user=request.user, revoked_at__isnull=True).order_by("-issued_at")[:200]


@router.get("/certificates/{certificate_id}", response=CertificateOut)
def certificate(request, certificate_id: str):
    return get_object_or_404(Certificate, pk=certificate_id, user=request.user, revoked_at__isnull=True)


@router.get("/certificates/{certificate_id}/pdf")
def certificate_pdf(request, certificate_id: str):
    from django.http import HttpResponse

    from apps.catalog.certificates import template_for

    from .certificate_pdf import render

    cert = get_object_or_404(Certificate.objects.select_related("template", "course"), pk=certificate_id,
                             user=request.user, revoked_at__isnull=True)  # fmt: skip
    template = template_for(cert.course) or cert.template  # the course's current design
    response = HttpResponse(render(cert, template), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="certificate-{cert.verification_code}.pdf"'
    response["Cache-Control"] = "private, max-age=3600"
    return response


@router.get("/verify/{code}", response=VerifyOut, auth=None)
def verify(request, code: str):
    """Public certificate check (QR code on the PDF). Only safe fields are returned."""
    if len(code) > 20:
        raise ServiceError("not_found", "Certificate not found.", status=404)
    row = services.verify_certificate(code.upper())
    if row is None:
        raise ServiceError("not_found", "Certificate not found.", status=404)
    row["is_expired"] = bool(row["expires_at"] and row["expires_at"] <= timezone.now())
    return row
