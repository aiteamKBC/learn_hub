"""Pydantic In/Out schemas for the engagement API."""

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema


class Author(Schema):
    id: UUID
    name: str
    avatar_url: str = ""


class ReviewOut(Schema):
    id: UUID
    rating: int
    body: str
    author: Author
    created_at: datetime
    updated_at: datetime
    instructor_reply: str
    replied_at: datetime | None


class ReviewPage(Schema):
    items: list[ReviewOut]
    next_cursor: str | None


class ReviewIn(Schema):
    rating: int = Field(..., ge=1, le=5)
    body: str = Field("", max_length=4000)


class QuestionOut(Schema):
    id: UUID
    title: str
    body: str
    lecture_key: UUID | None
    author: Author
    answer_count: int
    vote_count: int
    has_instructor_answer: bool
    resolved: bool
    voted: bool = False
    created_at: datetime


class QuestionPage(Schema):
    items: list[QuestionOut]
    next_cursor: str | None


class AnswerOut(Schema):
    id: UUID
    body: str
    author: Author
    is_instructor: bool
    created_at: datetime


class QuestionDetail(QuestionOut):
    answers: list[AnswerOut]


class QuestionIn(Schema):
    title: str = Field(..., min_length=3, max_length=200)
    body: str = Field("", max_length=10000)
    lecture_key: UUID | None = None


class TextIn(Schema):
    body: str = Field(..., min_length=1, max_length=10000)


class AnnouncementOut(Schema):
    id: UUID
    title: str
    body: str
    author: Author
    created_at: datetime


class NotificationOut(Schema):
    id: UUID
    kind: str
    title: str
    body: str
    url: str
    read_at: datetime | None
    created_at: datetime


class NotificationPage(Schema):
    items: list[NotificationOut]
    next_cursor: str | None
    unread: int


class MarkReadIn(Schema):
    ids: list[UUID] | None = Field(None, max_length=200)  # None = all


class PreferenceIn(Schema):
    kind: str = Field(..., max_length=60)
    email: bool
    in_app: bool


class TicketIn(Schema):
    subject: str = Field(..., min_length=3, max_length=200)
    category: str
    body: str = Field(..., min_length=5, max_length=10000)


class TicketAttachmentOut(Schema):
    id: UUID
    name: str
    size_bytes: int


class TicketMessageOut(Schema):
    id: UUID
    author: Author
    body: str
    body_html: str  # safe HTML (staff replies are rich text)
    is_staff: bool
    attachment: TicketAttachmentOut | None = None
    created_at: datetime


class TicketOut(Schema):
    id: UUID
    reference: str
    subject: str
    category: str
    status: str
    last_message_at: datetime
    created_at: datetime


class TicketDetail(TicketOut):
    messages: list[TicketMessageOut]


class IdOut(Schema):
    id: UUID


class AnswerCreatedOut(Schema):
    id: UUID
    is_instructor: bool


class VoteOut(Schema):
    voted: bool


class MyReviewOut(Schema):
    """The learner's own review of a course, for the player's rating prompt."""

    can_review: bool  # enrolled in a marketplace course (company courses are not reviewed)
    review: ReviewOut | None


class BadgeOut(Schema):
    code: str
    name: str
    description: str
    icon: str  # lucide icon name
    earned_at: datetime | None


class UnreadOut(Schema):
    unread: int


class MarkedOut(Schema):
    marked: int


class PreferenceOut(Schema):
    kind: str
    title: str
    email: bool
    in_app: bool
    email_available: bool


class ClosedOut(Schema):
    ok: bool = True
    closed_at: datetime


class TicketFileUrlOut(Schema):
    url: str


class ReportIn(Schema):
    target_type: str = Field(..., pattern=r"^(review|question|answer)$")
    target_id: UUID
    reason: str = Field(..., min_length=3, max_length=300)


class ReportOut(Schema):
    id: UUID
    status: str
