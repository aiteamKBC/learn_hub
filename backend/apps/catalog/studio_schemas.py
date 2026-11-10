"""Response schemas for the studio API (`/api/v1/studio/`, `apps/catalog/studio.py`).

Names are prefixed `Studio` to stay unique across the project (core/tests/test_api_contract.py
enforces this). These only describe what the endpoints already return; they do not change
behaviour."""

from datetime import date, datetime
from uuid import UUID

from ninja import Schema

from .schemas import VideoMomentOut, VideoPartOut


# ---------------------------------------------------------------- becoming an instructor
class StudioStatusOut(Schema):
    status: str


# ---------------------------------------------------------------- courses (list / create)
class StudioCourseRow(Schema):
    id: UUID
    slug: str
    title: str
    ownership: str
    status: str
    students: int
    rating_avg: float
    rating_count: int
    has_draft: bool
    draft_status: str | None = None
    earned_gbp_minor: int
    updated_at: datetime


class StudioCourseCreateOut(Schema):
    id: UUID
    slug: str


# ---------------------------------------------------------------- course builder (editor tree)
class StudioEditorResourceOut(Schema):
    id: UUID
    title: str
    position: int
    kind: str
    filename: str
    size_bytes: int | None = None
    mime_type: str


class StudioEditorVideoOut(Schema):
    id: UUID
    status: str
    duration_sec: int
    encode_progress: int
    filename: str = ""
    size_bytes: int | None = None  # unknown until Bunny reports it


class StudioEditorOptionOut(Schema):
    body: str
    is_correct: bool
    match_text: str
    blank_index: int


class StudioEditorQuestionOut(Schema):
    id: UUID
    kind: str
    prompt: str
    points: int
    explanation: str
    options: list[StudioEditorOptionOut]


class StudioEditorQuizOut(Schema):
    id: UUID
    mode: str
    pass_mark_pct: int
    time_limit_sec: int | None = None
    max_attempts: int | None = None
    shuffle_questions: bool
    shuffle_options: bool
    reveal_answers: str
    questions: list[StudioEditorQuestionOut]


class StudioEditorAssignmentOut(Schema):
    id: UUID
    instructions: str
    max_score: int
    pass_score: int
    rubric: list[dict]
    due_days_after_enrolment: int | None = None
    allow_late: bool
    max_resubmissions: int
    submission_types: list[str]


class StudioEditorLectureOut(Schema):
    id: UUID
    key: UUID
    kind: str
    title: str
    position: int
    is_preview: bool
    is_required: bool
    duration_sec: int
    body: str
    external_url: str
    live_starts_at: datetime | None = None
    live_duration_min: int | None = None
    live_join_url: str
    min_watch_pct: int
    prerequisite_key: UUID | None = None  # an earlier lesson learners must finish first
    resources: list[StudioEditorResourceOut]
    video: StudioEditorVideoOut | None = None
    quiz: StudioEditorQuizOut | None = None
    assignment: StudioEditorAssignmentOut | None = None


class StudioEditorSectionOut(Schema):
    id: UUID
    title: str
    description: str
    position: int
    lectures: list[StudioEditorLectureOut]


class StudioVersionSummaryOut(Schema):
    id: UUID
    number: int
    status: str
    published_at: datetime | None = None
    review_notes: str


class StudioWorkingVersionOut(Schema):
    id: UUID
    number: int
    status: str
    editable: bool
    checklist: list[str]
    sections: list[StudioEditorSectionOut]


class StudioCoursePriceOut(Schema):
    free: bool
    tier_id: UUID | None = None
    tier: str | None = None
    gbp_minor: int


class StudioCourseDetailOut(Schema):
    id: UUID
    slug: str
    title: str
    subtitle: str
    description: str
    level: str
    category_id: UUID | None = None
    certificate_template_id: UUID | None = None
    outcomes: list[str]
    requirements: list[str]
    thumbnail_url: str
    status: str
    ownership: str
    cpd_hours: float | None = None
    in_subscription: bool
    in_business: bool
    price: StudioCoursePriceOut | None = None
    versions: list[StudioVersionSummaryOut]
    working_version: StudioWorkingVersionOut | None = None


# ---------------------------------------------------------------- pricing
class StudioPriceTierOut(Schema):
    id: UUID
    name: str
    gbp_minor: int


# ---------------------------------------------------------------- drafts / publishing
class StudioDraftOut(Schema):
    version_id: UUID
    number: int


class StudioSectionCreateOut(Schema):
    id: UUID
    position: int


class StudioLectureCreateOut(Schema):
    id: UUID
    key: UUID


class StudioQuestionCreateOut(Schema):
    id: UUID


# ---------------------------------------------------------------- lecture files (Azure Blob)
class StudioResourceUploadOut(Schema):
    asset_id: UUID
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class StudioResourceOut(Schema):
    id: UUID
    title: str
    position: int
    kind: str
    filename: str
    size_bytes: int | None = None
    mime_type: str


class StudioResourceDownloadOut(Schema):
    url: str
    expires_in: int


# ---------------------------------------------------------------- video uploads (Bunny)
class StudioBunnyUploadOut(Schema):
    endpoint: str
    headers: dict[str, str]
    expires_at: int


class StudioVideoUploadOut(Schema):
    asset_id: UUID
    upload: StudioBunnyUploadOut


class StudioVideoMetaOut(Schema):
    parts: list[VideoPartOut]
    moments: list[VideoMomentOut]


class StudioThumbFrameOut(Schema):
    name: str
    url: str


class StudioThumbnailsOut(Schema):
    current: str
    frames: list[StudioThumbFrameOut]


class StudioCaptionOut(Schema):
    srclang: str
    label: str


class StudioVideoFetchOut(Schema):
    asset_id: UUID


class StudioVideoDetailsOut(StudioVideoMetaOut):
    duration_sec: int
    resolutions: list[str]
    captions: list[StudioCaptionOut]
    thumbnails: StudioThumbnailsOut


class StudioMediaStatusOut(Schema):
    id: UUID
    status: str
    encode_progress: int
    duration_sec: int
    preview_url: str | None = None


# ---------------------------------------------------------------- coupons
class StudioCouponOut(Schema):
    id: UUID
    code: str
    percent_off: int
    max_redemptions: int | None = None
    redeemed_count: int
    starts_at: datetime
    ends_at: datetime | None = None
    is_active: bool


class StudioCouponCreateOut(Schema):
    id: UUID
    code: str


# ---------------------------------------------------------------- students, inbox & grading
class StudioStudentOut(Schema):
    name: str
    progress_pct: float
    status: str
    enrolled_at: datetime
    last_accessed_at: datetime | None = None


class StudioQuestionInboxOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    title: str
    body: str
    author: str
    answer_count: int
    has_instructor_answer: bool
    created_at: datetime


class StudioReviewInboxOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    rating: int
    body: str
    author: str
    instructor_reply: str
    created_at: datetime


class StudioSubmissionFileOut(Schema):
    id: UUID
    filename: str
    size_bytes: int


class StudioGradingSubmissionOut(Schema):
    id: UUID
    learner: str
    course: str
    lecture: str
    attempt_no: int
    text: str
    url: str
    submitted_at: datetime
    is_late: bool
    course_id: UUID
    max_score: int
    pass_score: int
    rubric: list[dict]
    files: list[StudioSubmissionFileOut]


class StudioEssayQuestionOut(Schema):
    id: UUID
    prompt: str
    points: int


class StudioGradingAttemptOut(Schema):
    id: UUID
    learner: str
    course: str
    quiz: str
    submitted_at: datetime | None = None
    course_id: UUID
    answers: dict
    results: dict
    essays: list[StudioEssayQuestionOut]


class StudioGradingQueueOut(Schema):
    submissions: list[StudioGradingSubmissionOut]
    attempts: list[StudioGradingAttemptOut]


class StudioGradeOut(Schema):
    status: str
    passed: bool | None = None


class StudioEssayGradeOut(Schema):
    status: str
    passed: bool | None = None
    score_pct: float


# ---------------------------------------------------------------- dashboard
class StudioDashboardOut(Schema):
    courses: int
    published: int
    students: int
    rating_avg: float
    rating_count: int
    earned_this_month_gbp_minor: int
    to_mark: int
    unanswered: int


# ---------------------------------------------------------------- revenue & payouts
class StudioRevenueBalanceOut(Schema):
    available: int
    pending: int
    paid: int


class StudioRevenueMonthOut(Schema):
    month: date
    channel: str
    amount: int


class StudioRevenueCourseOut(Schema):
    course_id: UUID
    course__title: str
    amount: int


class StudioRevenueOut(Schema):
    balance: StudioRevenueBalanceOut
    by_month: list[StudioRevenueMonthOut]
    by_course: list[StudioRevenueCourseOut]
    platform_fee_pct: float  # the platform's cut of a marketplace sale for this instructor
    fee_is_custom: bool


class StudioPayoutOut(Schema):
    id: UUID
    period_end: date
    amount_gbp_minor: int
    status: str
    method: str
    paid_at: datetime | None = None
    failure_reason: str


class StudioPayoutAccountOut(Schema):
    configured: bool
    method: str | None = None
    paypal_email: str | None = None
    country: str | None = None
    verified: bool | None = None
    stripe_connected: bool | None = None


class StudioPayoutAccountSetOut(Schema):
    verified: bool
