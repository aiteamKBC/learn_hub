"""Engagement: the social layer.

Postgres schema: engagement. RLS (migration 0002) by table family:

    reviews                  public read; written only by their author (one per course)
    questions, answers,      read where the course is visible (public course: everyone;
    question_votes,          company course: that company); written only by their author.
    announcements            owner_org_id is copied from the course by trigger.
    notifications            inbox: the user reads and marks read; only jobs create them.
                             The app role may UPDATE nothing but read_at.
    notification_preferences personal
    notification_templates,  reference: everyone reads, staff writes
    badges
    user_badges              personal read-only (awarded by jobs)
    tickets, ticket_messages the requester and staff; staff-only internal notes are
                             invisible to the requester at the database level

Counters (answers, votes, course ratings) are kept by SECURITY DEFINER triggers, so a
learner's vote can update a question they did not write without being allowed to.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel

SCHEMA = "engagement"
User = settings.AUTH_USER_MODEL


class Review(BaseModel):
    class Status(models.TextChoices):
        PUBLISHED = "published", "Published"
        HIDDEN = "hidden", "Hidden by moderation"

    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="reviews")
    rating = models.PositiveSmallIntegerField()
    body = models.TextField(blank=True, max_length=4000)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PUBLISHED)
    instructor_reply = models.TextField(blank=True, max_length=4000)
    replied_at = models.DateTimeField(null=True, blank=True)
    replied_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "reviews")
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="uq_review_once"),
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name="ck_review_rating"),
        ]
        indexes = [
            models.Index(
                fields=["course", "-created_at"], name="ix_reviews_course", condition=Q(status="published")
            )
        ]


class Question(BaseModel):
    """Course Q&A. owner_org_id mirrors the course (trigger) so RLS can scope it."""

    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")
    owner_org_id = models.UUIDField(null=True, blank=True)
    lecture_key = models.UUIDField(null=True, blank=True)  # asked on a specific lecture
    title = models.CharField(max_length=200)
    body = models.TextField(max_length=10000)  # sanitised rich text
    answer_count = models.PositiveIntegerField(default=0)
    vote_count = models.PositiveIntegerField(default=0)
    has_instructor_answer = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    hidden_at = models.DateTimeField(null=True, blank=True)  # moderation

    class Meta:
        db_table = table(SCHEMA, "questions")
        indexes = [
            models.Index(fields=["course", "-created_at"], name="ix_questions_course"),
            models.Index(fields=["course", "-vote_count"], name="ix_questions_top"),
            models.Index(fields=["course", "lecture_key"], name="ix_questions_lecture"),
        ]


class Answer(BaseModel):
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="answers")
    owner_org_id = models.UUIDField(null=True, blank=True)
    body = models.TextField(max_length=10000)
    is_instructor = models.BooleanField(default=False)  # set by the service, from course_instructors
    hidden_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "answers")
        indexes = [models.Index(fields=["question", "created_at"], name="ix_answers_question")]


class QuestionVote(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="votes")
    owner_org_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "question_votes")
        constraints = [models.UniqueConstraint(fields=["question", "user"], name="uq_vote_once")]


class Announcement(BaseModel):
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)  # author
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")
    owner_org_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=200)
    body = models.TextField(max_length=10000)
    sent_at = models.DateTimeField(null=True, blank=True)
    recipient_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "announcements")
        indexes = [models.Index(fields=["course", "-created_at"], name="ix_announcements_course")]


# ---------------------------------------------------------------- notifications
class NotificationTemplate(BaseModel):
    """Editable wording for each notification kind. {placeholders} are filled from a
    fixed context per kind; unknown placeholders render empty (never an error)."""

    code = models.SlugField(max_length=60, unique=True)
    title = models.CharField(max_length=200)  # in-app title and email subject
    body = models.TextField(max_length=5000)
    email_enabled = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "notification_templates")

    def __str__(self) -> str:
        return self.code


class Notification(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    kind = models.CharField(max_length=60)
    title = models.CharField(max_length=200)
    body = models.TextField(max_length=5000, blank=True)
    url = models.CharField(max_length=500, blank=True)  # an in-app path, never an external link
    dedupe_key = models.CharField(max_length=120, blank=True)  # e.g. "answer:<id>": never notify twice
    read_at = models.DateTimeField(null=True, blank=True)
    emailed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "notifications")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "dedupe_key"], condition=~Q(dedupe_key=""), name="uq_notification_once"
            )
        ]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="ix_notifications_user"),
            models.Index(fields=["user"], name="ix_notifications_unread", condition=Q(read_at__isnull=True)),
            models.Index(fields=["created_at"], name="ix_notifications_age"),  # retention job
        ]


class NotificationPreference(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    kind = models.CharField(max_length=60)
    email = models.BooleanField(default=True)
    in_app = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "notification_preferences")
        constraints = [models.UniqueConstraint(fields=["user", "kind"], name="uq_pref_kind")]


# ---------------------------------------------------------------- achievements
class Badge(BaseModel):
    class Criterion(models.TextChoices):
        COURSES_COMPLETED = "courses_completed", "Courses completed"
        CERTIFICATES = "certificates", "Certificates earned"
        REVIEWS = "reviews", "Reviews written"
        ANSWERS = "answers", "Questions answered"

    code = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=300)
    icon = models.CharField(max_length=40, default="award")  # lucide icon name in the React app
    criterion = models.CharField(max_length=20, choices=Criterion.choices)
    threshold = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "badges")
        constraints = [models.UniqueConstraint(fields=["criterion", "threshold"], name="uq_badge_rule")]

    def __str__(self) -> str:
        return self.name


class UserBadge(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    badge = models.ForeignKey(Badge, on_delete=models.CASCADE, related_name="+")
    awarded_at = models.DateTimeField()

    class Meta:
        db_table = table(SCHEMA, "user_badges")
        constraints = [models.UniqueConstraint(fields=["user", "badge"], name="uq_badge_once")]


# ---------------------------------------------------------------- support
class Ticket(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        PROGRESS = "progress", "In progress"
        WAITING = "waiting", "Waiting for you"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"

    class Category(models.TextChoices):
        ACCOUNT = "account", "Account and sign-in"
        PAYMENT = "payment", "Payments and refunds"
        COURSE = "course", "Course content"
        TECHNICAL = "technical", "Technical problem"
        BUSINESS = "business", "Business account"
        INSTRUCTOR = "instructor", "Teaching and payouts"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)  # requester
    org = models.ForeignKey(
        "org.Organization", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reference = models.CharField(max_length=12, unique=True)  # "LH-482913", shown to the customer
    subject = models.CharField(max_length=200)
    category = models.CharField(max_length=12, choices=Category.choices)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    last_message_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "tickets")
        indexes = [
            models.Index(fields=["user", "-last_message_at"], name="ix_tickets_user"),
            models.Index(fields=["status", "priority", "last_message_at"], name="ix_tickets_queue"),
            models.Index(fields=["assigned_to", "status"], name="ix_tickets_agent"),
        ]


class TicketMessage(BaseModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="+", db_index=False
    )  # requester (copied)
    org_id = models.UUIDField(null=True, blank=True)  # copied from the ticket by trigger
    author = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    body = models.TextField(max_length=10000)
    is_internal = models.BooleanField(default=False)  # staff-only note
    attachment = models.ForeignKey(
        "catalog.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = table(SCHEMA, "ticket_messages")
        indexes = [models.Index(fields=["ticket", "created_at"], name="ix_ticket_messages")]


# ---------------------------------------------------------------- moderation & broadcasts
class ContentReport(BaseModel):
    """A learner reports a review, question or answer. Staff action or dismiss it."""

    class TargetType(models.TextChoices):
        REVIEW = "review", "Review"
        QUESTION = "question", "Question"
        ANSWER = "answer", "Answer"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACTIONED = "actioned", "Content hidden"
        DISMISSED = "dismissed", "Dismissed"

    reporter = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+", db_index=False)
    target_type = models.CharField(max_length=10, choices=TargetType.choices)
    target_id = models.UUIDField()
    reason = models.CharField(max_length=300)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    handled_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    handled_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "content_reports")
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "target_type", "target_id"], condition=Q(status="open"),
                name="uq_report_open_once",
            ),
        ]  # fmt: skip
        indexes = [
            models.Index(fields=["status", "-created_at"], name="ix_reports_queue"),
            models.Index(fields=["target_type", "target_id"], name="ix_reports_target"),
        ]


class Broadcast(BaseModel):
    """A message from staff to many people at once (console > Communications), in-app
    and/or by email. Platform announcements are broadcasts too, optionally shown as a
    site banner between two dates."""

    class Audience(models.TextChoices):
        EVERYONE = "everyone", "Everyone"
        LEARNERS = "learners", "Learners"
        INSTRUCTORS = "instructors", "Instructors"
        COMPANY_ADMINS = "company_admins", "Company admins"
        COMPANY = "company", "One company"

    class Kind(models.TextChoices):
        BROADCAST = "broadcast", "Notification"
        ANNOUNCEMENT = "announcement", "Announcement"

    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.BROADCAST)
    title = models.CharField(max_length=200)
    body = models.TextField(max_length=5000)
    audience = models.CharField(max_length=16, choices=Audience.choices)
    org = models.ForeignKey(
        "org.Organization", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    send_in_app = models.BooleanField(default=True)
    send_email = models.BooleanField(default=False)
    url = models.CharField(max_length=500, blank=True)  # optional in-app link
    show_as_banner = models.BooleanField(default=False)
    banner_starts_at = models.DateTimeField(null=True, blank=True)
    banner_ends_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    sent_at = models.DateTimeField(null=True, blank=True)  # NULL = draft
    recipient_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "broadcasts")
        indexes = [
            models.Index(fields=["kind", "-created_at"], name="ix_broadcasts_kind"),
            models.Index(
                fields=["banner_starts_at", "banner_ends_at"], name="ix_broadcasts_banner",
                condition=Q(show_as_banner=True),
            ),
        ]  # fmt: skip
