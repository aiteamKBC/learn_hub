"""Catalog: all course content (decisions 2, 6).

Postgres schema: catalog

Content lives in published VERSIONS (decision 6):
    Course ─ CourseVersion (draft / in_review / published / retired)
               └ Section └ Lecture (video, article, quiz, assignment, live session,
                                    external link, download)
                                 ├ Quiz └ QuizQuestion └ QuizOption
                                 ├ Assignment
                                 └ LectureResource (downloads)
A lecture keeps the same `lecture_key` in every version, so learner progress,
saved against the key, survives republishing.

Visibility (core.rls.scoped_content on owner_org_id):
    owner_org_id NULL   marketplace or platform-library content, visible to all
    owner_org_id set    company-private (e.g. Acme's own induction), Acme only
Child rows copy owner_org_id from their parent through a database trigger
(core.rls.inherit_owner), so RLS checks one column per row, never a join.

Prices live in commerce.course_prices (commerce may reference catalog, never the reverse).
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel

SCHEMA = "catalog"
User = settings.AUTH_USER_MODEL


class OwnedContent(BaseModel):
    """Content that may be private to one company. Never set owner_org on child rows
    by hand: the inherit-owner trigger copies it from the parent."""

    owner_org = models.ForeignKey(
        "org.Organization", on_delete=models.PROTECT, null=True, blank=True, related_name="+", db_index=False
    )

    class Meta:
        abstract = True


# ---------------------------------------------------------------- taxonomy
class Category(BaseModel):
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, unique=True)
    icon = models.CharField(max_length=48, blank=True)  # lucide icon name
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "categories")
        indexes = [models.Index(fields=["parent", "sort_order"], name="ix_categories_parent")]

    def __str__(self) -> str:
        return self.name


class Topic(BaseModel):
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=80, unique=True)

    class Meta:
        db_table = table(SCHEMA, "topics")

    def __str__(self) -> str:
        return self.name


# ---------------------------------------------------------------- courses
class Course(OwnedContent):
    """The listing: landing-page details, ownership, counters. The curriculum is
    in its versions; `live_version` is what learners see."""

    class Ownership(models.TextChoices):
        PLATFORM = "platform", "Platform library"  # the client's own compliance / CPD courses
        INSTRUCTOR = "instructor", "Marketplace instructor"
        ORGANIZATION = "organization", "Company private"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"  # never published
        PUBLISHED = "published", "Published"
        UNLISTED = "unlisted", "Unlisted"  # reachable by link, hidden from search
        ARCHIVED = "archived", "Archived"

    class Level(models.TextChoices):
        BEGINNER = "beginner", "Beginner"
        INTERMEDIATE = "intermediate", "Intermediate"
        ADVANCED = "advanced", "Advanced"
        ALL = "all", "All levels"

    ownership = models.CharField(max_length=16, choices=Ownership.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, null=True, blank=True, related_name="courses"
    )
    slug = models.SlugField(max_length=120, unique=True)
    title = models.CharField(max_length=160)
    subtitle = models.CharField(max_length=240, blank=True)
    description = models.TextField(blank=True, max_length=20000)  # sanitised rich text
    level = models.CharField(max_length=16, choices=Level.choices, default=Level.ALL)
    outcomes = ArrayField(models.CharField(max_length=200), default=list, blank=True)
    requirements = ArrayField(models.CharField(max_length=200), default=list, blank=True)
    target_audience = ArrayField(models.CharField(max_length=200), default=list, blank=True)
    thumbnail_url = models.URLField(blank=True)
    promo_video = models.ForeignKey(
        "MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    live_version = models.ForeignKey(
        "CourseVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    certificate_template = models.ForeignKey(
        "CertificateTemplate", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    topics = models.ManyToManyField(Topic, through="CourseTopic", related_name="courses")
    is_free = models.BooleanField(default=False)
    in_subscription = models.BooleanField(default=True)  # included in personal plans
    in_business = models.BooleanField(default=True)  # included in business plans
    cpd_hours = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    language = models.CharField(max_length=10, default="en")  # ISO 639-1 (en, ar, fr...)
    access_days = models.PositiveIntegerField(null=True, blank=True)  # purchase access; NULL = lifetime
    published_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # Denormalised, refreshed on publish / by jobs: catalog pages never COUNT(*)
    lecture_count = models.PositiveIntegerField(default=0)
    total_duration_sec = models.PositiveIntegerField(default=0)
    student_count = models.PositiveIntegerField(default=0)
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    rating_count = models.PositiveIntegerField(default=0)
    # B2C-03 (M8 / M13): cash tier (parallel to CoursePrice.tier — lets staff set the tier
    # without declaring is_free; null preserves existing behaviour). Full-course token price
    # NULL means the "pay full course in tokens" path is DISABLED for the course (T10).
    cash_price_tier = models.ForeignKey(
        "commerce.PriceTier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    full_course_token_price = models.PositiveIntegerField(null=True, blank=True)

    class TokenPricingMode(models.TextChoices):
        MANUAL = "manual", "Manual per-lecture pricing"
        AUTO_WEIGHTED = "auto_weighted", "Auto-distributed from course total"

    token_pricing_mode = models.CharField(
        max_length=16, choices=TokenPricingMode.choices, default=TokenPricingMode.MANUAL
    )

    class Meta:
        db_table = table(SCHEMA, "courses")
        constraints = [
            models.CheckConstraint(
                condition=Q(ownership="organization", owner_org__isnull=False)
                | (~Q(ownership="organization") & Q(owner_org__isnull=True)),
                name="ck_courses_owner_matches_ownership",
            ),
        ]
        indexes = [
            # Catalog listing: published, not deleted, newest first (keyset on id)
            models.Index(
                fields=["category", "-id"],
                name="ix_courses_catalog",
                condition=Q(status="published", deleted_at__isnull=True),
            ),
            models.Index(fields=["owner_org", "status"], name="ix_courses_owner_org"),
            models.Index(fields=["created_by"], name="ix_courses_created_by"),
        ]

    def __str__(self) -> str:
        return self.title


class CourseTopic(BaseModel):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE)

    class Meta:
        db_table = table(SCHEMA, "course_topics")
        constraints = [models.UniqueConstraint(fields=["course", "topic"], name="uq_course_topic")]


class CourseInstructor(BaseModel):
    """Co-instructors and how a marketplace sale is split between them."""

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="instructor_links")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="course_links")
    revenue_share_bps = models.PositiveIntegerField(
        default=0, validators=[MaxValueValidator(10000)]
    )  # 3700 = 37%
    can_edit = models.BooleanField(default=True)
    is_visible = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "course_instructors")
        constraints = [models.UniqueConstraint(fields=["course", "user"], name="uq_course_instructor")]


# ---------------------------------------------------------------- versions
class CourseVersion(OwnedContent):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        IN_REVIEW = "in_review", "In review"  # marketplace only
        CHANGES_REQUESTED = "changes_requested", "Changes requested"
        PUBLISHED = "published", "Published"  # exactly one per course: the live one
        RETIRED = "retired", "Retired"  # previously live, kept as evidence
        REJECTED = "rejected", "Rejected"  # closed by staff with a reason; never goes live

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    based_on = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    change_summary = models.TextField(blank=True, max_length=2000)
    requires_recompletion = models.BooleanField(default=False)  # compliance: redo after this publish
    is_major_change = models.BooleanField(default=False)  # instructor flags it on submit (approvals tab)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True, max_length=4000)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "course_versions")
        constraints = [
            models.UniqueConstraint(fields=["course", "number"], name="uq_version_number"),
            models.UniqueConstraint(
                fields=["course"],
                condition=Q(status__in=["draft", "in_review", "changes_requested"]),
                name="uq_one_open_version",
            ),
            models.UniqueConstraint(
                fields=["course"], condition=Q(status="published"), name="uq_one_live_version"
            ),
        ]
        indexes = [models.Index(fields=["status", "submitted_at"], name="ix_versions_review_queue")]


class Section(OwnedContent):
    version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name="sections")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, max_length=2000)
    position = models.PositiveIntegerField()

    class Meta:
        db_table = table(SCHEMA, "sections")
        indexes = [models.Index(fields=["version", "position"], name="ix_sections_version")]


class Lecture(OwnedContent):
    class Kind(models.TextChoices):
        VIDEO = "video", "Video lesson"
        ARTICLE = "article", "Reading"
        QUIZ = "quiz", "Quiz"
        ASSIGNMENT = "assignment", "Assignment"
        LIVE_SESSION = "live_session", "Live session"
        EXTERNAL_LINK = "external_link", "External link"
        DOWNLOAD = "download", "Download"

    version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name="lectures")
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name="lectures")
    lecture_key = models.UUIDField()  # stable across versions; progress is saved against it
    kind = models.CharField(max_length=16, choices=Kind.choices)
    title = models.CharField(max_length=200)
    position = models.PositiveIntegerField()
    is_preview = models.BooleanField(default=False)  # free sample on the course page
    is_required = models.BooleanField(default=True)  # counts towards course completion
    duration_sec = models.PositiveIntegerField(default=0)
    video = models.ForeignKey("MediaAsset", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    body = models.TextField(blank=True, max_length=100000)  # sanitised HTML for readings
    external_url = models.URLField(blank=True)
    live_starts_at = models.DateTimeField(null=True, blank=True)  # UTC (decision 12)
    live_duration_min = models.PositiveSmallIntegerField(null=True, blank=True)
    live_join_url = models.URLField(blank=True)
    min_watch_pct = models.PositiveSmallIntegerField(
        default=90, validators=[MaxValueValidator(100)]
    )  # video counts as complete after this share watched
    # Learners must finish this lecture first. A lecture_key (stable across versions), and
    # always an EARLIER lecture of the same version, so there can be no loops.
    prerequisite_key = models.UUIDField(null=True, blank=True)
    # B2C-03 (M8): token price for individual-lecture unlock. NULL = not individually unlockable
    # via tokens (full-course unlock may still cover it). `is_free_preview` is additive to the
    # existing `is_preview` flag — kept separate because the resolver treats them differently.
    token_price = models.PositiveIntegerField(null=True, blank=True)
    is_free_preview = models.BooleanField(default=False)
    excluded_from_subscription = models.BooleanField(default=False)

    class Meta:
        db_table = table(SCHEMA, "lectures")
        constraints = [
            models.UniqueConstraint(fields=["version", "lecture_key"], name="uq_lecture_key_per_version"),
            models.CheckConstraint(
                condition=~Q(kind="external_link") | ~Q(external_url=""), name="ck_external_link_has_url"
            ),
        ]
        indexes = [
            models.Index(fields=["version", "section", "position"], name="ix_lectures_order"),
            models.Index(fields=["lecture_key"], name="ix_lectures_key"),
        ]


class LectureResource(OwnedContent):
    """Downloadable files attached to a lecture (slides, worksheets)."""

    lecture = models.ForeignKey(Lecture, on_delete=models.CASCADE, related_name="resources")
    asset = models.ForeignKey("MediaAsset", on_delete=models.PROTECT, related_name="+")
    title = models.CharField(max_length=200)
    position = models.PositiveIntegerField(default=0)

    # B2C-03 (M8): materials behave as separately-unlockable artefacts (T06). Token price
    # NULL = not individually unlockable via tokens.
    token_price = models.PositiveIntegerField(null=True, blank=True)
    is_free_preview = models.BooleanField(default=False)

    class Meta:
        db_table = table(SCHEMA, "lecture_resources")
        indexes = [models.Index(fields=["lecture", "position"], name="ix_resources_lecture")]


# ---------------------------------------------------------------- media (Bunny)
class VideoLibrary(BaseModel):
    """A Bunny Stream library. Keys are NEVER stored here: `api_key_env` names the
    environment variable that holds this library's key."""

    class Protection(models.TextChoices):
        STANDARD = "standard", "Standard (signed links)"
        DRM = "drm", "Protected (MediaCage Enterprise DRM)"

    name = models.CharField(max_length=120)
    environment = models.CharField(max_length=16)  # dev / staging / production
    protection_level = models.CharField(
        max_length=16, choices=Protection.choices, default=Protection.STANDARD
    )
    bunny_library_id = models.PositiveIntegerField()
    cdn_hostname = models.CharField(max_length=253)
    api_key_env = models.CharField(max_length=64, default="BUNNY_STREAM_API_KEY")
    token_key_env = models.CharField(max_length=64, default="BUNNY_STREAM_TOKEN_KEY")
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = table(SCHEMA, "video_libraries")
        constraints = [
            models.UniqueConstraint(fields=["environment", "bunny_library_id"], name="uq_library_env"),
            models.UniqueConstraint(
                fields=["environment", "protection_level"],
                condition=Q(is_default=True),
                name="uq_default_library",
            ),
        ]


class MediaAsset(OwnedContent):
    """A video (Bunny Stream) or file (object storage). Uploads go browser -> Bunny
    directly (TUS); this row only tracks status from verified webhooks."""

    class Kind(models.TextChoices):
        VIDEO = "video", "Video"
        IMAGE = "image", "Image"
        DOCUMENT = "document", "Document"
        AUDIO = "audio", "Audio"
        ARCHIVE = "archive", "Archive"

    class Status(models.TextChoices):
        AWAITING_UPLOAD = "awaiting_upload", "Awaiting upload"
        PROCESSING = "processing", "Processing"
        PLAYABLE = "playable", "Playable"  # first resolution ready
        READY = "ready", "Ready"  # fully encoded
        FAILED = "failed", "Failed"

    kind = models.CharField(max_length=16, choices=Kind.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AWAITING_UPLOAD)
    library = models.ForeignKey(
        VideoLibrary, on_delete=models.PROTECT, null=True, blank=True, related_name="assets"
    )
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    bunny_video_guid = models.UUIDField(null=True, blank=True, unique=True)
    bunny_collection_id = models.CharField(max_length=64, blank=True)
    bunny_status = models.SmallIntegerField(null=True, blank=True)  # raw webhook status code
    encode_progress = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(100)])
    storage_key = models.CharField(max_length=500, blank=True)  # non-video files
    original_filename = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=127, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True, validators=[MinValueValidator(0)])
    duration_sec = models.PositiveIntegerField(default=0)
    available_resolutions = ArrayField(models.CharField(max_length=8), default=list, blank=True)
    caption_languages = ArrayField(models.CharField(max_length=10), default=list, blank=True)
    thumbnail_url = models.URLField(blank=True)
    replaced_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = table(SCHEMA, "media_assets")
        constraints = [
            models.CheckConstraint(
                condition=~Q(kind="video") | Q(library__isnull=False), name="ck_video_has_library"
            ),
        ]
        indexes = [
            models.Index(fields=["uploaded_by", "-id"], name="ix_media_uploader"),
            models.Index(
                fields=["status"],
                name="ix_media_in_progress",
                condition=Q(status__in=["awaiting_upload", "processing"]),
            ),
        ]


# ---------------------------------------------------------------- quizzes
class Quiz(OwnedContent):
    """Settings for a lecture of kind 'quiz'. Copied with its version on publish."""

    class Mode(models.TextChoices):
        GRADED = "graded", "Graded"
        PRACTICE = "practice", "Practice"

    class Reveal(models.TextChoices):
        NEVER = "never", "Never"
        AFTER_SUBMIT = "after_submit", "After each attempt"
        AFTER_PASS = "after_pass", "Once passed"

    lecture = models.OneToOneField(Lecture, on_delete=models.CASCADE, related_name="quiz")
    mode = models.CharField(max_length=16, choices=Mode.choices, default=Mode.GRADED)
    pass_mark_pct = models.PositiveSmallIntegerField(default=70, validators=[MaxValueValidator(100)])
    time_limit_sec = models.PositiveIntegerField(null=True, blank=True)
    max_attempts = models.PositiveSmallIntegerField(null=True, blank=True)  # NULL = unlimited
    shuffle_questions = models.BooleanField(default=False)
    shuffle_options = models.BooleanField(default=True)
    reveal_answers = models.CharField(max_length=16, choices=Reveal.choices, default=Reveal.AFTER_SUBMIT)

    class Meta:
        db_table = table(SCHEMA, "quizzes")


class QuizQuestion(OwnedContent):
    class Kind(models.TextChoices):
        SINGLE_CHOICE = "single_choice", "Multiple choice (one answer)"
        MULTIPLE_CHOICE = "multiple_choice", "Multiple response"
        TRUE_FALSE = "true_false", "True / false"
        MATCHING = "matching", "Matching"
        FILL_BLANK = "fill_blank", "Fill in the blank"
        SHORT_ANSWER = "short_answer", "Short answer"
        ESSAY = "essay", "Essay (graded by instructor)"

    AUTO_GRADED = {
        Kind.SINGLE_CHOICE,
        Kind.MULTIPLE_CHOICE,
        Kind.TRUE_FALSE,
        Kind.MATCHING,
        Kind.FILL_BLANK,
        Kind.SHORT_ANSWER,
    }

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    prompt = models.TextField(max_length=5000)  # sanitised rich text; fill_blank uses ___ markers
    explanation = models.TextField(blank=True, max_length=5000)  # shown according to Quiz.reveal_answers
    points = models.PositiveSmallIntegerField(default=1)
    position = models.PositiveIntegerField()
    case_sensitive = models.BooleanField(default=False)  # fill_blank / short_answer
    media = models.ForeignKey(MediaAsset, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "quiz_questions")
        indexes = [models.Index(fields=["quiz", "position"], name="ix_questions_quiz")]


class QuizOption(OwnedContent):
    """One choice, accepted answer or matching pair.

        single/multiple choice, true/false   body + is_correct
        matching                             body (left) + match_text (right)
        fill_blank / short_answer            body = an accepted answer (is_correct=True),
                                             blank_index for multi-blank prompts
        essay                                no options; graded by the instructor

    SECURITY: is_correct and match_text are answers. Learner-facing API schemas must
    never include them; grading happens on the server (see selectors.learner_quiz).
    """

    question = models.ForeignKey(QuizQuestion, on_delete=models.CASCADE, related_name="options")
    body = models.CharField(max_length=1000)
    is_correct = models.BooleanField(default=False)
    match_text = models.CharField(max_length=1000, blank=True)
    blank_index = models.PositiveSmallIntegerField(default=0)
    position = models.PositiveIntegerField()

    class Meta:
        db_table = table(SCHEMA, "quiz_options")
        indexes = [models.Index(fields=["question", "position"], name="ix_options_question")]


# ---------------------------------------------------------------- assignments
class Assignment(OwnedContent):
    """Settings for a lecture of kind 'assignment' (screens 29, 32)."""

    class SubmissionType(models.TextChoices):
        TEXT = "text", "Text"
        FILE = "file", "File upload"
        URL = "url", "Link"

    lecture = models.OneToOneField(Lecture, on_delete=models.CASCADE, related_name="assignment")
    instructions = models.TextField(max_length=20000)  # sanitised rich text
    submission_types = ArrayField(
        models.CharField(max_length=8, choices=SubmissionType.choices), default=list
    )
    max_score = models.PositiveSmallIntegerField(default=100)
    pass_score = models.PositiveSmallIntegerField(default=60)
    rubric = models.JSONField(default=list, blank=True)  # [{"criterion": "...", "points": 25}, ...]
    due_days_after_enrolment = models.PositiveSmallIntegerField(null=True, blank=True)  # self-paced deadline
    allow_late = models.BooleanField(default=True)
    max_resubmissions = models.PositiveSmallIntegerField(default=2)
    max_file_mb = models.PositiveSmallIntegerField(default=50)
    allowed_file_types = ArrayField(
        models.CharField(max_length=16), default=list, blank=True
    )  # ["pdf", "zip"]
    attachments = models.ManyToManyField(
        MediaAsset, blank=True, related_name="+", db_table=table(SCHEMA, "assignment_attachments")
    )

    class Meta:
        db_table = table(SCHEMA, "assignments")
        constraints = [
            models.CheckConstraint(
                condition=Q(pass_score__lte=models.F("max_score")), name="ck_assignment_pass_le_max"
            ),
        ]


# ---------------------------------------------------------------- certificates & paths
class CertificateTemplate(OwnedContent):
    """Design of a completion certificate (screens 23, 30). owner NULL = platform template."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"
        PENDING = "pending", "Waiting for approval"  # an instructor's template, before staff approve it
        REJECTED = "rejected", "Rejected"

    name = models.CharField(max_length=120)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    layout = models.JSONField(default=dict)  # background, logo, text blocks and positions
    signatory_name = models.CharField(max_length=120, blank=True)
    signatory_title = models.CharField(max_length=120, blank=True)
    signature_image_url = models.URLField(blank=True)
    show_qr_code = models.BooleanField(default=True)  # links to the public verification page
    is_default = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    decision_reason = models.CharField(max_length=300, blank=True)  # why staff rejected it

    class Meta:
        db_table = table(SCHEMA, "certificate_templates")


class LearningPath(OwnedContent):
    """An ordered track of courses, e.g. 'New starter essentials'."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    title = models.CharField(max_length=160)
    slug = models.SlugField(max_length=120, unique=True)
    description = models.TextField(blank=True, max_length=5000)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "learning_paths")


class LearningPathItem(OwnedContent):
    path = models.ForeignKey(LearningPath, on_delete=models.CASCADE, related_name="items")
    course = models.ForeignKey(Course, on_delete=models.PROTECT, related_name="+")
    position = models.PositiveIntegerField()
    is_required = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "learning_path_items")
        constraints = [models.UniqueConstraint(fields=["path", "course"], name="uq_path_course")]
        indexes = [models.Index(fields=["path", "position"], name="ix_path_items_order")]


# ---------------------------------------------------------------- instructor permissions
class InstructorPermission(BaseModel):
    """What staff allow one instructor to do (console > Instructors > Permissions). No row =
    the defaults below. Enforced by the studio services, never only in the UI."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="instructor_permission")
    can_publish_without_review = models.BooleanField(default=False)
    can_create_coupons = models.BooleanField(default=True)
    can_use_drm = models.BooleanField(default=False)
    can_issue_certificates = models.BooleanField(default=True)
    max_courses = models.PositiveIntegerField(null=True, blank=True)  # NULL = no limit
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "instructor_permissions")
