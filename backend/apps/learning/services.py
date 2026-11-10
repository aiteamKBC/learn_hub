"""Learning writes: enrolment, progress, completion, quizzes, assignments, certificates.

Everything runs under RLS inside a request or core.tenancy.tenant_context. A company
enrolment needs that company's context; a personal one needs only the user.
"""

from datetime import timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Max
from django.utils import timezone

from apps.catalog.models import Assignment, CourseInstructor, Lecture, Quiz
from core import html
from core.errors import ServiceError

from . import uploads
from .grading import grade_question
from .models import Certificate, Enrollment, LectureProgress, QuizAttempt, Submission, SubmissionFile
from .signals import notify_course_completed

TIME_LIMIT_GRACE = timedelta(seconds=30)  # network delay allowance on timed quizzes


# ---------------------------------------------------------------- enrolment
def enrol(*, user, course, source: str, org_id=None, source_ref=None, access_expires_at=None) -> Enrollment:
    """Idempotent: returns the existing enrolment for this user, course and space."""
    if course.live_version_id is None:
        raise ServiceError("not_published", "This course is not published yet.")
    existing = (
        Enrollment.objects.filter(user=user, course=course, org_id=org_id)
        .exclude(status=Enrollment.Status.SUPERSEDED)
        .first()
    )
    if existing:
        return existing
    if (
        access_expires_at is None
        and course.access_days
        and source
        in (
            Enrollment.Source.PURCHASE,
            Enrollment.Source.FREE,
        )
    ):  # staff set a limited access period on this course (console > Courses)
        access_expires_at = timezone.now() + timedelta(days=course.access_days)
    return Enrollment.objects.create(
        user=user,
        org_id=org_id,
        course=course,
        source=source,
        source_ref=source_ref,
        enrolled_at=timezone.now(),
        access_expires_at=access_expires_at,
    )


def _live_lecture(enrollment: Enrollment, lecture_key) -> Lecture:
    lecture = Lecture.objects.filter(
        version_id=enrollment.course.live_version_id, lecture_key=lecture_key
    ).first()
    if lecture is None:
        raise ServiceError("not_in_course", "This lecture is not part of the course.")
    return lecture


def _check_access(enrollment: Enrollment) -> None:
    if enrollment.status not in (Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED):
        raise ServiceError("no_access", "This enrolment is not active.", status=403)
    if enrollment.access_expires_at and enrollment.access_expires_at < timezone.now():
        raise ServiceError("access_expired", "Access to this course has ended.", status=403)


# ---------------------------------------------------------------- completion
@transaction.atomic
def complete_lecture(*, enrollment: Enrollment, lecture_key) -> None:
    _check_access(enrollment)
    _live_lecture(enrollment, lecture_key)
    progress, _ = LectureProgress.objects.get_or_create(enrollment=enrollment, lecture_key=lecture_key)
    if progress.completed_at is None:
        progress.completed_at = timezone.now()
        progress.save(update_fields=["completed_at", "updated_at"])
    refresh_course_progress(enrollment)


def refresh_course_progress(enrollment: Enrollment) -> None:
    """Progress = completed required lectures of the LIVE version (by lecture key)."""
    required = set(
        Lecture.objects.filter(version_id=enrollment.course.live_version_id, is_required=True).values_list(
            "lecture_key", flat=True
        )
    )
    done = set(
        enrollment.progress.filter(completed_at__isnull=False, lecture_key__in=required).values_list(
            "lecture_key", flat=True
        )
    )
    pct = (
        Decimal(100) if not required else (Decimal(len(done)) * 100 / len(required)).quantize(Decimal("0.01"))
    )
    Enrollment.objects.filter(pk=enrollment.pk).update(progress_pct=pct, updated_at=timezone.now())
    enrollment.progress_pct = pct
    if required and done == required and enrollment.status == Enrollment.Status.ACTIVE:
        complete_course(enrollment)


def complete_course(enrollment: Enrollment) -> Certificate:
    now = timezone.now()
    enrollment.status = Enrollment.Status.COMPLETED
    enrollment.completed_at = now
    enrollment.completed_version_id = enrollment.course.live_version_id
    enrollment.save(update_fields=["status", "completed_at", "completed_version", "updated_at"])
    certificate = issue_certificate(enrollment)
    notify_course_completed(enrollment)
    _tell(enrollment.user_id, "certificate_issued", {"course": enrollment.course.title},
          url="/learn/certificates", dedupe=f"certificate:{certificate.id}")  # fmt: skip
    _award_badges_later(enrollment.user_id)  # personal and company learning both count
    return certificate


def _award_badges_later(user_id) -> None:
    from apps.engagement.tasks import award_badges_task

    uid = str(user_id)
    transaction.on_commit(lambda: award_badges_task.delay(uid))


def _tell(user_id, code: str, context: dict, *, url: str, dedupe: str) -> None:
    """A notification to the learner (engagement owns them; imported late, no cycle)."""
    from apps.engagement import notify

    notify.notify([user_id], code, context, url=url, dedupe=dedupe)


def issue_certificate(enrollment: Enrollment) -> Certificate:
    existing = Certificate.objects.filter(enrollment=enrollment).first()
    if existing:
        return existing
    course, user = enrollment.course, enrollment.user
    names = [
        link.user.full_name or link.user.email.split("@")[0]
        for link in CourseInstructor.objects.filter(course=course, is_visible=True).select_related("user")
    ]
    from apps.catalog.certificates import template_for

    template = template_for(course)
    return Certificate.objects.create(
        enrollment=enrollment,
        course=course,
        course_version_id=enrollment.completed_version_id,
        template_id=template.id if template else None,  # the design at issue time, kept as a record
        recipient_name=user.full_name or user.email.split("@")[0],
        course_title=course.title,
        instructor_names=", ".join(names)[:400],
        cpd_hours=course.cpd_hours,
        issued_at=timezone.now(),
    )


def verify_certificate(code: str) -> dict | None:
    """Public check (screen 23): returns only the safe fields, via a SECURITY DEFINER
    function (the M5 one adds the expiry date)."""
    with connection.cursor() as cur:
        cur.execute("SELECT * FROM learning.verify_certificate_v2(%s)", [code])
        row = cur.fetchone()
        if row is None:
            return None
        cols = [c.name for c in cur.description]
        return dict(zip(cols, row, strict=True))


# ---------------------------------------------------------------- certificates (console)
@transaction.atomic
def revoke_certificate(*, certificate: Certificate, reason: str) -> Certificate:
    """Withdraw a certificate: /verify then says revoked and the learner no longer sees it.
    The row stays as evidence."""
    reason = html.plain(reason, 300).strip()
    if len(reason) < 3:
        raise ServiceError("reason_required", "Give a reason for revoking.")
    cert = Certificate.objects.select_for_update().get(pk=certificate.pk)
    if cert.revoked_at:
        raise ServiceError("already_revoked", "This certificate is already revoked.")
    cert.revoked_at, cert.revoke_reason = timezone.now(), reason
    cert.save(update_fields=["revoked_at", "revoke_reason", "updated_at"])
    _tell(cert.user_id, "certificate_revoked", {"course": cert.course_title, "reason": reason},
          url="/learn/certificates", dedupe=f"cert-revoked:{cert.id}")  # fmt: skip
    return cert


@transaction.atomic
def set_certificate_expiry(*, certificate: Certificate, expires_at) -> Certificate:
    """None = never expires. A date in the past makes /verify say expired at once."""
    cert = Certificate.objects.select_for_update().get(pk=certificate.pk)
    if cert.revoked_at:
        raise ServiceError("revoked", "A revoked certificate can't be changed.")
    if expires_at is not None and expires_at <= cert.issued_at:
        raise ServiceError("bad_expiry", "The expiry date must be after the issue date.")
    cert.expires_at = expires_at
    cert.save(update_fields=["expires_at", "updated_at"])
    return cert


def certificate_expiry_reminders(days: int = 30) -> int:
    """Daily job: tell learners whose certificate expires within `days` (once each)."""
    now = timezone.now()
    rows = Certificate.objects.filter(
        revoked_at__isnull=True, expires_at__gt=now, expires_at__lte=now + timedelta(days=days)
    ).values_list("id", "user_id", "course_title", "expires_at")
    sent = 0
    for cert_id, user_id, title, expires in rows.iterator(chunk_size=500):
        _tell(user_id, "certificate_expiring", {"course": title, "date": expires.strftime("%d %b %Y").lstrip("0")},
              url="/learn/certificates", dedupe=f"cert-expiring:{cert_id}:{expires.date()}")  # fmt: skip
        sent += 1
    return sent


# ---------------------------------------------------------------- quizzes
@transaction.atomic
def start_attempt(*, enrollment: Enrollment, quiz: Quiz) -> QuizAttempt:
    _check_access(enrollment)
    lecture = quiz.lecture
    if lecture.version_id != enrollment.course.live_version_id:
        raise ServiceError("not_in_course", "This quiz is not part of the live course.")
    open_attempt = QuizAttempt.objects.filter(enrollment=enrollment, quiz=quiz, status="in_progress").first()
    if open_attempt:
        return open_attempt
    used = (
        QuizAttempt.objects.filter(enrollment=enrollment, quiz=quiz).aggregate(m=Max("attempt_no"))["m"] or 0
    )
    if quiz.max_attempts and used >= quiz.max_attempts:
        raise ServiceError("no_attempts_left", "You have used all attempts for this quiz.")
    now = timezone.now()
    return QuizAttempt.objects.create(
        enrollment=enrollment,
        quiz=quiz,
        lecture_key=lecture.lecture_key,
        attempt_no=used + 1,
        started_at=now,
        expires_at=now + timedelta(seconds=quiz.time_limit_sec) if quiz.time_limit_sec else None,
        max_points=sum(q.points for q in quiz.questions.all()),
    )


@transaction.atomic
def submit_attempt(*, attempt: QuizAttempt, answers: dict) -> QuizAttempt:
    attempt = QuizAttempt.objects.select_for_update().get(pk=attempt.pk)  # no double submit
    if attempt.status != QuizAttempt.Status.IN_PROGRESS:
        raise ServiceError("already_submitted", "This attempt was already submitted.")
    now = timezone.now()
    late = attempt.expires_at is not None and now > attempt.expires_at + TIME_LIMIT_GRACE
    questions = list(attempt.quiz.questions.prefetch_related("options"))
    results, manual = {}, False
    for q in questions:
        response = None if late else answers.get(str(q.id))  # over time: nothing counts
        points, needs_manual = grade_question(q, response)
        manual |= needs_manual
        results[str(q.id)] = {
            "points": None if points is None else str(points),
            "max": q.points,
            "feedback": "",
        }
    attempt.answers = {str(q.id): answers.get(str(q.id)) for q in questions}
    attempt.results = results
    attempt.submitted_at = now
    _finalise(attempt, manual)
    return attempt


def grade_manual(*, attempt: QuizAttempt, question_id, points, feedback: str, grader) -> QuizAttempt:
    """Instructor grades an essay (or overrides a score)."""
    attempt = QuizAttempt.objects.select_for_update().get(pk=attempt.pk)
    key = str(question_id)
    if key not in attempt.results:
        raise ServiceError("unknown_question", "That question is not in this attempt.")
    maximum = attempt.results[key]["max"]
    if not 0 <= Decimal(points) <= maximum:
        raise ServiceError("invalid_points", f"Points must be between 0 and {maximum}.")
    attempt.results[key].update(points=str(Decimal(points)), feedback=feedback)
    attempt.graded_by = grader
    _finalise(attempt, any(r["points"] is None for r in attempt.results.values()))
    if attempt.status == QuizAttempt.Status.GRADED:  # the last hand-marked answer is in
        course = attempt.enrollment.course
        _tell(attempt.enrollment.user_id, "work_marked", {"course": course.title, "title": attempt.quiz.lecture.title},
              url=f"/learn/{course.slug}/lecture/{attempt.lecture_key}", dedupe=f"attempt-marked:{attempt.id}")  # fmt: skip
    return attempt


def _finalise(attempt: QuizAttempt, pending_manual: bool) -> None:
    if pending_manual:
        attempt.status = QuizAttempt.Status.NEEDS_GRADING
        attempt.passed = None
    else:
        total = sum(Decimal(r["points"]) for r in attempt.results.values())
        attempt.score_points = total
        attempt.score_pct = (
            (total * 100 / attempt.max_points).quantize(Decimal("0.01"))
            if attempt.max_points
            else Decimal(100)
        )
        attempt.passed = attempt.score_pct >= attempt.quiz.pass_mark_pct
        attempt.status = QuizAttempt.Status.GRADED
    attempt.save()
    if attempt.passed and attempt.quiz.mode == Quiz.Mode.GRADED:
        complete_lecture(enrollment=attempt.enrollment, lecture_key=attempt.lecture_key)
    elif attempt.passed is not None and attempt.quiz.mode == Quiz.Mode.PRACTICE:
        complete_lecture(enrollment=attempt.enrollment, lecture_key=attempt.lecture_key)


# ---------------------------------------------------------------- assignments
@transaction.atomic
def submit_assignment(
    *, enrollment: Enrollment, assignment: Assignment, text_body: str = "", url: str = "", asset_ids=()
) -> Submission:
    _check_access(enrollment)
    lecture = assignment.lecture
    if lecture.version_id != enrollment.course.live_version_id:
        raise ServiceError("not_in_course", "This assignment is not part of the live course.")
    allowed = set(assignment.submission_types)
    if (
        (text_body and "text" not in allowed)
        or (url and "url" not in allowed)
        or (asset_ids and "file" not in allowed)
    ):
        raise ServiceError("type_not_allowed", "That kind of submission is not allowed for this assignment.")
    if not (text_body.strip() or url or asset_ids):
        raise ServiceError("empty", "Add your answer, a link or a file before submitting.")
    files = (
        uploads.claim(enrollment=enrollment, user=enrollment.user, asset_ids=asset_ids) if asset_ids else []
    )
    previous = (
        Submission.objects.filter(enrollment=enrollment, assignment=assignment)
        .order_by("-attempt_no")
        .first()
    )
    if previous:
        if previous.status == Submission.Status.SUBMITTED:
            raise ServiceError("awaiting_grade", "Your previous submission is still being graded.")
        if previous.passed:
            raise ServiceError("already_passed", "You have already passed this assignment.")
        if previous.attempt_no > assignment.max_resubmissions:
            raise ServiceError("no_resubmissions_left", "No resubmissions left for this assignment.")
    now = timezone.now()
    due = (
        enrollment.enrolled_at + timedelta(days=assignment.due_days_after_enrolment)
        if assignment.due_days_after_enrolment
        else None
    )
    if due and now > due and not assignment.allow_late:
        raise ServiceError("past_due", "The deadline for this assignment has passed.")
    submission = Submission.objects.create(
        enrollment=enrollment,
        assignment=assignment,
        lecture_key=lecture.lecture_key,
        attempt_no=(previous.attempt_no + 1) if previous else 1,
        text_body=text_body,
        url=url,
        submitted_at=now,
        is_late=bool(due and now > due),
    )
    SubmissionFile.objects.bulk_create(SubmissionFile(submission=submission, asset=a) for a in files)
    return submission


@transaction.atomic
def grade_submission(
    *,
    submission: Submission,
    score: int,
    grader,
    feedback: str = "",
    rubric_scores=None,
    return_for_resubmission=False,
) -> Submission:
    submission = Submission.objects.select_for_update().get(pk=submission.pk)
    max_score = submission.assignment.max_score
    if not 0 <= score <= max_score:
        raise ServiceError("invalid_score", f"Score must be between 0 and {max_score}.")
    submission.score = score
    submission.passed = score >= submission.assignment.pass_score
    submission.feedback = feedback
    submission.rubric_scores = rubric_scores or []
    submission.graded_by, submission.graded_at = grader, timezone.now()
    submission.status = (
        Submission.Status.RETURNED
        if return_for_resubmission and not submission.passed
        else Submission.Status.GRADED
    )
    submission.save()
    if submission.passed:
        complete_lecture(enrollment=submission.enrollment, lecture_key=submission.lecture_key)
    course = submission.enrollment.course
    _tell(submission.enrollment.user_id, "work_marked", {"course": course.title, "title": submission.assignment.lecture.title},
          url=f"/learn/{course.slug}/lecture/{submission.lecture_key}",
          dedupe=f"submission-marked:{submission.id}:{submission.graded_at.timestamp():.0f}")  # fmt: skip
    return submission


# ---------------------------------------------------------------- company assignment
def assign_to_members(*, org_id, course, user_ids: list, assigned_by) -> list:
    """Give a course to many members at once (one INSERT). People who already have a
    current company enrolment are skipped. Returns the user ids newly enrolled."""
    if course.live_version_id is None:
        raise ServiceError("not_published", "This course is not published yet.")
    if not user_ids:
        return []
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO learning.enrollments
                   (id, created_at, updated_at, org_id, user_id, course_id, source, source_ref, status,
                    enrolled_at, progress_pct)
            SELECT uuidv7(), now(), now(), %(org)s, m.user_id, %(course)s, 'organization', %(by)s, 'active', now(), 0
              FROM org.org_members m
             WHERE m.org_id = %(org)s AND m.removed_at IS NULL AND m.user_id = ANY(%(users)s::uuid[])
            ON CONFLICT DO NOTHING
            RETURNING user_id
            """,
            {"org": org_id, "course": course.id, "by": assigned_by.id, "users": [str(u) for u in user_ids]},
        )
        return [r[0] for r in cur.fetchall()]
