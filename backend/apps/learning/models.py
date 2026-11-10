"""Learning: what learners do (decisions 2, 5, 6, 7).

Postgres schema: learning. Every table is MIXED (core.rls.mixed):
    org_id set    company enrolment (assigned by Acme)  -> visible to Acme and the learner
    org_id NULL   personal enrolment (bought by Sara)   -> visible to Sara only, never a company
If Sara has both for one course they are two enrolments with separate progress, so a
company never sees personal learning.

Child rows (progress, attempts, submissions, notes, certificates) copy org_id and
user_id from their enrolment through a database trigger: they can never disagree.

Progress is saved against catalog.Lecture.lecture_key (stable across versions), so
republishing a course never loses anyone's progress.
"""

import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import MixedTenantModel

SCHEMA = "learning"
User = settings.AUTH_USER_MODEL


def certificate_code() -> str:
    """Public verification code, e.g. LH-7K2Q-9WXM-4TPA (unguessable, no ambiguous chars)."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"LH-{raw[:4]}-{raw[4:8]}-{raw[8:]}"


class Enrollment(MixedTenantModel):
    class Source(models.TextChoices):
        PURCHASE = "purchase", "Purchased"
        FREE = "free", "Free course"
        SUBSCRIPTION = "subscription", "Subscription"
        ORGANIZATION = "organization", "Assigned by company"
        ADMIN_GRANT = "admin_grant", "Granted by staff"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        EXPIRED = "expired", "Expired"  # subscription / seat ended
        REVOKED = "revoked", "Revoked"  # refund, removal
        SUPERSEDED = "superseded", "Superseded"  # kept as evidence; a renewal retake replaced it

    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="enrollments")
    source = models.CharField(max_length=16, choices=Source.choices)
    source_ref = models.UUIDField(null=True, blank=True)  # order item / subscription / assignment id
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    enrolled_at = models.DateTimeField()
    access_expires_at = models.DateTimeField(null=True, blank=True)  # NULL = lifetime
    last_accessed_at = models.DateTimeField(null=True, blank=True)
    last_lecture_key = models.UUIDField(null=True, blank=True)  # "continue where you left off"
    progress_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_version = models.ForeignKey(
        "catalog.CourseVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )  # exactly what was completed (compliance evidence)

    class Meta:
        db_table = table(SCHEMA, "enrollments")
        constraints = [
            # One CURRENT enrolment per course and space; superseded ones (completed
            # before a compliance renewal) stay as evidence beside the new one.
            models.UniqueConstraint(
                fields=["user", "course"],
                condition=Q(org__isnull=True) & ~Q(status="superseded"),
                name="uq_enrol_personal",
            ),
            models.UniqueConstraint(
                fields=["org", "user", "course"],
                condition=Q(org__isnull=False) & ~Q(status="superseded"),
                name="uq_enrol_company",
            ),
            # Target of compliance's composite FKs: a record can only cite this company's enrolment
            models.UniqueConstraint(fields=["org", "id"], name="uq_enrol_org_id"),
        ]
        indexes = [
            models.Index(fields=["user", "-last_accessed_at"], name="ix_enrol_my_learning"),
            models.Index(fields=["org", "course", "status"], name="ix_enrol_org_course"),
            models.Index(fields=["course", "status"], name="ix_enrol_course"),
        ]


class LectureProgress(MixedTenantModel):
    """One row per enrolment and lecture. HOT table: written in batches by the
    heartbeat flush job, never once per heartbeat."""

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="progress")
    lecture_key = models.UUIDField()
    last_position_sec = models.PositiveIntegerField(default=0)
    watched_sec = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "lecture_progress")
        constraints = [
            models.UniqueConstraint(fields=["enrollment", "lecture_key"], name="uq_progress_lecture")
        ]


class ProgressEvent(models.Model):
    """Append-only watch log (subscription revenue split, analytics). PARTITIONED BY
    MONTH (pg_partman on Neon), created by migration SQL, so Django does not manage it."""

    id = models.BigIntegerField(primary_key=True)
    created_at = models.DateTimeField()
    enrollment_id = models.UUIDField()
    org_id = models.UUIDField(null=True)
    user_id = models.UUIDField()
    course_id = models.UUIDField()
    lecture_key = models.UUIDField()
    seconds = models.PositiveIntegerField()

    class Meta:
        managed = False
        db_table = table(SCHEMA, "progress_events")

    def __str__(self) -> str:
        return f"{self.seconds}s on {self.lecture_key}"


class QuizAttempt(MixedTenantModel):
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "In progress"
        NEEDS_GRADING = "needs_grading", "Waiting for the instructor"  # contains essays
        GRADED = "graded", "Graded"

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="quiz_attempts")
    quiz = models.ForeignKey("catalog.Quiz", on_delete=models.PROTECT, related_name="+")
    lecture_key = models.UUIDField()
    attempt_no = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IN_PROGRESS)
    started_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)  # time-limited quizzes
    submitted_at = models.DateTimeField(null=True, blank=True)
    answers = models.JSONField(default=dict, blank=True)  # {question_id: response}
    results = models.JSONField(
        default=dict, blank=True
    )  # {question_id: {"points": n, "max": m, "feedback": ""}}
    score_points = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    max_points = models.PositiveIntegerField(default=0)
    score_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)  # NULL until fully graded
    graded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "quiz_attempts")
        constraints = [
            models.UniqueConstraint(fields=["enrollment", "quiz", "attempt_no"], name="uq_attempt_no"),
            models.UniqueConstraint(
                fields=["enrollment", "quiz"], condition=Q(status="in_progress"), name="uq_one_open_attempt"
            ),
        ]
        indexes = [
            models.Index(
                fields=["quiz", "status"],
                name="ix_attempts_grading_queue",
                condition=Q(status="needs_grading"),
            ),
        ]


class Submission(MixedTenantModel):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        GRADED = "graded", "Graded"
        RETURNED = "returned", "Returned for resubmission"

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="submissions")
    assignment = models.ForeignKey("catalog.Assignment", on_delete=models.PROTECT, related_name="+")
    lecture_key = models.UUIDField()
    attempt_no = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    text_body = models.TextField(blank=True, max_length=50000)  # sanitised rich text
    url = models.URLField(blank=True)
    submitted_at = models.DateTimeField()
    is_late = models.BooleanField(default=False)
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    rubric_scores = models.JSONField(default=list, blank=True)  # [{"criterion": "...", "points": 20}]
    feedback = models.TextField(blank=True, max_length=20000)
    graded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    graded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "submissions")
        constraints = [
            models.UniqueConstraint(
                fields=["enrollment", "assignment", "attempt_no"], name="uq_submission_no"
            )
        ]
        indexes = [
            models.Index(fields=["assignment", "status", "submitted_at"], name="ix_submissions_queue"),
        ]


class SubmissionFile(MixedTenantModel):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="files")
    asset = models.ForeignKey("catalog.MediaAsset", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "submission_files")
        constraints = [models.UniqueConstraint(fields=["submission", "asset"], name="uq_submission_file")]


class Note(MixedTenantModel):
    """A learner's own note, optionally pinned to a moment in a video."""

    enrollment = models.ForeignKey(Enrollment, on_delete=models.CASCADE, related_name="notes")
    lecture_key = models.UUIDField()
    timestamp_sec = models.PositiveIntegerField(null=True, blank=True)
    body = models.TextField(max_length=10000)

    class Meta:
        db_table = table(SCHEMA, "notes")
        indexes = [models.Index(fields=["enrollment", "lecture_key"], name="ix_notes_lecture")]


class Certificate(MixedTenantModel):
    """Permanent proof of completion of course X, version Y, on date Z (decision 7).
    Never expires itself: whether it is still valid for a company is decided by that
    company's compliance rule. Holds the recipient's name as printed: the one
    documented exception to 'personal details only in identity' (decision 8)."""

    enrollment = models.OneToOneField(Enrollment, on_delete=models.PROTECT, related_name="certificate")
    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    course_version = models.ForeignKey("catalog.CourseVersion", on_delete=models.PROTECT, related_name="+")
    template = models.ForeignKey(
        "catalog.CertificateTemplate", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    verification_code = models.CharField(max_length=20, unique=True, default=certificate_code)
    recipient_name = models.CharField(max_length=200)
    course_title = models.CharField(max_length=160)
    instructor_names = models.CharField(max_length=400, blank=True)
    cpd_hours = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    issued_at = models.DateTimeField()
    pdf_asset = models.ForeignKey(
        "catalog.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoke_reason = models.CharField(max_length=300, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # set by staff; NULL = never

    class Meta:
        db_table = table(SCHEMA, "certificates")
        constraints = [models.UniqueConstraint(fields=["org", "id"], name="uq_certs_org_id")]
        indexes = [
            models.Index(fields=["user", "-issued_at"], name="ix_certs_user"),
            models.Index(fields=["org", "course", "issued_at"], name="ix_certs_org_course"),
        ]
