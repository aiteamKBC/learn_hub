"""Pydantic In/Out schemas for the learning API (my learning, player, quizzes,
assignments, notes, certificates)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from ninja import Field, Schema

from apps.catalog.schemas import PlaybackOut, VideoMomentOut, VideoPartOut
from apps.identity.schemas import OkOut  # noqa: F401 - shared response shape


class MyCourse(Schema):
    enrollment_id: UUID
    course_id: UUID
    slug: str
    title: str
    thumbnail_url: str
    instructors: list[str]
    progress_pct: float
    status: str
    source: str
    org_id: UUID | None  # set: assigned by a company
    org_name: str | None
    enrolled_at: datetime
    last_accessed_at: datetime | None
    last_lecture_key: UUID | None
    access_expires_at: datetime | None
    certificate_id: UUID | None


class MyCoursePage(Schema):
    items: list[MyCourse]
    next_cursor: str | None


class PlayerLecture(Schema):
    key: UUID
    title: str
    kind: str
    duration_sec: int
    completed: bool
    position_sec: int
    locked: bool = False  # the prerequisite lesson isn't finished yet
    prerequisite_key: UUID | None = None
    prerequisite_title: str | None = None


class PlayerSection(Schema):
    id: UUID
    title: str
    lectures: list[PlayerLecture]


class PlayerOut(Schema):
    enrollment_id: UUID
    course_id: UUID
    slug: str
    title: str
    progress_pct: float
    status: str
    last_lecture_key: UUID | None
    certificate_id: UUID | None
    sections: list[PlayerSection]


class LiveOut(Schema):
    starts_at: datetime | None
    duration_min: int | None
    join_url: str | None  # appears 15 minutes before the start
    provider: str = "manual"


class ResourceOut(Schema):
    id: UUID
    title: str
    position: int
    kind: str
    filename: str
    size_bytes: int | None
    mime_type: str


class AttemptSummary(Schema):
    id: UUID
    attempt_no: int
    status: str
    score_pct: float | None
    passed: bool | None
    submitted_at: datetime | None


class LectureQuizOut(Schema):
    mode: str
    pass_mark_pct: int
    time_limit_sec: int | None
    max_attempts: int | None
    question_count: int
    attempts: list[AttemptSummary]


class SubmittedFile(Schema):
    filename: str
    size_bytes: int | None


class SubmissionOut(Schema):
    id: UUID
    attempt_no: int
    status: str
    submitted_at: datetime
    is_late: bool
    score: int | None
    passed: bool | None
    feedback: str
    text: str = ""
    url: str = ""
    files: list[SubmittedFile] = []


class RubricItem(Schema):
    criterion: str = ""
    points: int = 0


class LectureAssignmentOut(Schema):
    instructions: str
    max_score: int
    pass_score: int
    submission_types: list[str]
    due_at: datetime | None
    allow_late: bool
    rubric: list[RubricItem]
    submissions: list[SubmissionOut]


class LectureContent(Schema):
    key: UUID
    title: str
    kind: str
    duration_sec: int
    completed: bool
    position_sec: int
    prev_key: UUID | None
    next_key: UUID | None
    body: str = ""  # readings
    external_url: str = ""
    video: PlaybackOut | None = None  # signed playback
    parts: list[VideoPartOut] = []  # the video's named parts and key moments (from Bunny)
    moments: list[VideoMomentOut] = []
    live: LiveOut | None = None
    resources: list[ResourceOut] = []
    quiz: LectureQuizOut | None = None
    assignment: LectureAssignmentOut | None = None


class HeartbeatIn(Schema):
    lecture_key: UUID
    position_sec: int = Field(..., ge=0, le=86400)
    watched_sec: int = Field(..., ge=0, le=600)
    ended: bool = False  # the video reached its end: write now and say if it completed


class HeartbeatOut(Schema):
    ok: bool
    completed: bool  # this lecture is complete (always false until the video's end beat)


class LearnerOption(Schema):
    id: str
    body: str


class LearnerQuestion(Schema):
    """A question as the learner sees it: never the correct answers."""

    id: str
    kind: str
    prompt: str
    points: int
    options: list[LearnerOption] | None = None  # choice questions
    left: list[LearnerOption] | None = None  # matching: items to pair...
    right: list[str] | None = None  # ...with these (shuffled)
    blanks: int | None = None  # fill_blank: how many "___"


class LearnerQuiz(Schema):
    id: str
    time_limit_sec: int | None
    questions: list[LearnerQuestion]


class ReviewItem(Schema):
    """One question of a submitted attempt, self-contained so the review page can be
    reloaded: the prompt and choices come back with the result."""

    question_id: str
    kind: str
    prompt: str
    options: list[LearnerOption] = []
    points: float | None
    max: float
    explanation: str
    your_answer: Any = None
    correct_option_ids: list[str] | None = None


class AttemptOut(Schema):
    id: UUID
    attempt_no: int
    status: str
    started_at: datetime
    expires_at: datetime | None
    submitted_at: datetime | None
    score_pct: float | None
    passed: bool | None
    quiz: LearnerQuiz | None = None  # questions, while in progress (never with answers)
    review: list[ReviewItem] | None = None  # per question, only when the quiz allows revealing


class SubmitAnswersIn(Schema):
    answers: dict[str, Any] = Field(default_factory=dict)


class SubmissionIn(Schema):
    text: str = Field("", max_length=50000)
    url: str = Field("", max_length=500)
    asset_ids: list[UUID] = Field([], max_length=5)  # from submission-uploads


class SubmissionUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., gt=0)


class SubmissionUploadOut(Schema):
    asset_id: UUID
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class NotePatchIn(Schema):
    timestamp_sec: int | None = Field(None, ge=0, le=86400)
    clear_timestamp: bool = False  # unpin the note from the video
    body: str | None = Field(None, min_length=1, max_length=10000)


class NoteIn(Schema):
    lecture_key: UUID
    timestamp_sec: int | None = Field(None, ge=0, le=86400)
    body: str = Field(..., min_length=1, max_length=10000)


class NoteOut(Schema):
    id: UUID
    lecture_key: UUID
    timestamp_sec: int | None
    body: str
    created_at: datetime


class CertificateOut(Schema):
    id: UUID
    verification_code: str
    course_id: UUID
    course_title: str
    recipient_name: str
    instructor_names: str
    cpd_hours: float | None
    issued_at: datetime
    org_id: UUID | None


class DownloadOut(Schema):
    url: str
    expires_in: int


class ProgressOut(Schema):
    progress_pct: float
    status: str


class VerifyOut(Schema):
    """Public certificate check: only safe fields."""

    verification_code: str
    recipient_name: str
    course_title: str
    cpd_hours: float | None
    issued_at: datetime
    is_revoked: bool
    expires_at: datetime | None = None
    is_expired: bool = False
