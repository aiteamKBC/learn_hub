"""Engagement endpoints: reviews, Q&A, announcements, notifications and support."""

from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router

from apps.catalog.models import Course
from apps.identity.schemas import OkOut
from apps.learning.models import Enrollment
from core import cursor as keyset
from core.auth import session_auth
from core.errors import ServiceError

from . import moderation, notify, services
from . import tickets as ticket_files
from .models import (
    Announcement,
    Badge,
    Notification,
    NotificationPreference,
    Question,
    QuestionVote,
    Review,
    Ticket,
    TicketMessage,
    UserBadge,
)
from .schemas import (
    AnnouncementOut,
    AnswerCreatedOut,
    BadgeOut,
    ClosedOut,
    IdOut,
    MarkedOut,
    MarkReadIn,
    MyReviewOut,
    NotificationPage,
    PreferenceIn,
    PreferenceOut,
    QuestionDetail,
    QuestionIn,
    QuestionPage,
    ReportIn,
    ReportOut,
    ReviewIn,
    ReviewOut,
    ReviewPage,
    TextIn,
    TicketDetail,
    TicketFileUrlOut,
    TicketIn,
    TicketOut,
    UnreadOut,
    VoteOut,
)

router = Router(tags=["engagement"])


def _author(user) -> dict:
    return {"id": user.id, "name": user.full_name or "Learner", "avatar_url": user.avatar_url}


def _page(qs, cursor, limit, encode=lambda row: (row.id,)):
    """Newest-first keyset paging on uuidv7 ids."""
    limit = max(1, min(limit, 50))
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return page, (keyset.encode(*encode(page[-1])) if len(rows) > limit else None)


# ---------------------------------------------------------------- reviews
@router.get("/courses/{course_id}/reviews", response=ReviewPage, auth=None)
def reviews(request, course_id: str, rating: int | None = None, cursor: str | None = None, limit: int = 10):
    qs = Review.objects.filter(course_id=course_id, status="published").select_related("user")
    if rating:
        qs = qs.filter(rating=rating)
    page, nxt = _page(qs, cursor, limit)
    return {"items": [{**r.__dict__, "author": _author(r.user)} for r in page], "next_cursor": nxt}


@router.put("/courses/{course_id}/review", response=ReviewOut, auth=session_auth)
def write_review(request, course_id: str, body: ReviewIn):
    r = services.write_review(user=request.user, course_id=course_id, rating=body.rating, body=body.body)
    return {**r.__dict__, "author": _author(request.user)}


@router.get("/courses/{course_id}/my-review", response=MyReviewOut, auth=session_auth)
def my_review(request, course_id: str):
    course = services._visible_course(course_id)
    can = course.owner_org_id is None and services._is_learner(request.user, course)
    r = Review.objects.filter(user=request.user, course=course).first()
    return {"can_review": can, "review": {**r.__dict__, "author": _author(request.user)} if r else None}


@router.post("/reviews/{review_id}/reply", response=ReviewOut, auth=session_auth)
def reply_to_review(request, review_id: str, body: TextIn):
    review = get_object_or_404(Review.objects.select_related("course", "user"), pk=review_id)
    r = services.reply_to_review(review=review, instructor=request.user, body=body.body)
    return {**r.__dict__, "author": _author(review.user)}


# ---------------------------------------------------------------- Q&A
def _can_see_course(request, course_id) -> Course:
    course = Course.objects.filter(pk=course_id).first()  # RLS hides other companies' courses
    if course is None:
        raise ServiceError("not_found", "Course not found.", status=404)
    return course


def _question_out(q, voted=False) -> dict:
    return {
        "id": q.id, "title": q.title, "body": q.body, "lecture_key": q.lecture_key, "author": _author(q.user),
        "answer_count": q.answer_count, "vote_count": q.vote_count, "has_instructor_answer": q.has_instructor_answer,
        "resolved": q.resolved_at is not None, "voted": voted, "created_at": q.created_at,
    }  # fmt: skip


@router.get("/courses/{course_id}/questions", response=QuestionPage, auth=session_auth)
def questions(request, course_id: str, lecture_key: str | None = None, q: str | None = None,
              unanswered: bool = False, cursor: str | None = None, limit: int = 20):  # fmt: skip
    _can_see_course(request, course_id)
    qs = (
        Question.objects.filter(course_id=course_id, hidden_at__isnull=True)
        .select_related("user")
        .annotate(voted=Exists(QuestionVote.objects.filter(question=OuterRef("pk"), user=request.user)))
    )
    if lecture_key:
        qs = qs.filter(lecture_key=lecture_key)
    if q:
        qs = qs.filter(Q(title__icontains=q[:100]) | Q(body__icontains=q[:100]))
    if unanswered:
        qs = qs.filter(answer_count=0)
    page, nxt = _page(qs, cursor, limit)
    return {"items": [_question_out(x, x.voted) for x in page], "next_cursor": nxt}


@router.get("/questions/{question_id}", response=QuestionDetail, auth=session_auth)
def question(request, question_id: str):
    q = get_object_or_404(Question.objects.select_related("user"), pk=question_id, hidden_at__isnull=True)
    voted = QuestionVote.objects.filter(question=q, user=request.user).exists()
    answers = (
        q.answers.filter(hidden_at__isnull=True)
        .select_related("user")
        .order_by("-is_instructor", "created_at")
    )
    return {
        **_question_out(q, voted),
        "answers": [{"id": a.id, "body": a.body, "author": _author(a.user), "is_instructor": a.is_instructor,
                     "created_at": a.created_at} for a in answers],
    }  # fmt: skip


@router.post("/courses/{course_id}/questions", response=QuestionDetail, auth=session_auth)
def ask(request, course_id: str, body: QuestionIn):
    q = services.ask(user=request.user, course_id=course_id, title=body.title, body=body.body,
                     lecture_key=body.lecture_key)  # fmt: skip
    return {**_question_out(q), "answers": []}


@router.post("/questions/{question_id}/answers", response=AnswerCreatedOut, auth=session_auth)
def answer(request, question_id: str, body: TextIn):
    q = get_object_or_404(Question.objects.select_related("course"), pk=question_id, hidden_at__isnull=True)
    a = services.answer(user=request.user, question=q, body=body.body)
    return {"id": a.id, "is_instructor": a.is_instructor}


@router.post("/questions/{question_id}/vote", response=VoteOut, auth=session_auth)
def vote(request, question_id: str):
    q = get_object_or_404(Question, pk=question_id, hidden_at__isnull=True)
    return {"voted": services.toggle_vote(user=request.user, question=q)}


@router.post("/questions/{question_id}/resolve", response=OkOut, auth=session_auth)
def resolve(request, question_id: str):
    q = get_object_or_404(Question, pk=question_id)
    services.resolve_question(user=request.user, question=q)
    return {"ok": True}


# ---------------------------------------------------------------- announcements
@router.get("/courses/{course_id}/announcements", response=list[AnnouncementOut], auth=session_auth)
def announcements(request, course_id: str):
    """For learners of the course (and its instructors)."""
    course = _can_see_course(request, course_id)
    allowed = Enrollment.objects.filter(
        user=request.user, course=course, status__in=["active", "completed"]
    ).exists()
    if not allowed and not services._is_instructor(request.user, course):
        raise ServiceError("not_enrolled", "Enrol to see announcements.", status=403)
    rows = Announcement.objects.filter(course=course).select_related("user").order_by("-created_at")[:50]
    return [{"id": a.id, "title": a.title, "body": a.body, "author": _author(a.user), "created_at": a.created_at}
            for a in rows]  # fmt: skip


@router.post("/courses/{course_id}/announcements", response=IdOut, auth=session_auth)
def announce(request, course_id: str, body: QuestionIn):
    a = services.announce(user=request.user, course_id=course_id, title=body.title, body=body.body)
    return {"id": a.id}


# ---------------------------------------------------------------- notifications
@router.get("/notifications", response=NotificationPage, auth=session_auth)
def notifications(request, unread_only: bool = False, cursor: str | None = None, limit: int = 20):
    qs = Notification.objects.filter(user=request.user)
    if unread_only:
        qs = qs.filter(read_at__isnull=True)
    page, nxt = _page(qs, cursor, limit)
    unread = Notification.objects.filter(user=request.user, read_at__isnull=True).count()
    return {"items": page, "next_cursor": nxt, "unread": unread}


@router.get("/my/badges", response=list[BadgeOut], auth=session_auth)
def my_badges(request):
    """Every active badge, earned ones first (with the date), the rest still to unlock."""
    earned = dict(UserBadge.objects.filter(user=request.user).values_list("badge_id", "awarded_at"))
    rows = [
        {
            "code": b.code,
            "name": b.name,
            "description": b.description,
            "icon": b.icon,
            "earned_at": earned.get(b.id),
        }
        for b in Badge.objects.filter(is_active=True).order_by("criterion", "threshold")
    ]
    return sorted(rows, key=lambda r: r["earned_at"] is None)


@router.get("/notifications/unread-count", response=UnreadOut, auth=session_auth)
def unread_count(request):
    """Polled by the bell icon: one indexed count (partial index on unread)."""
    return {"unread": Notification.objects.filter(user=request.user, read_at__isnull=True).count()}


@router.post("/notifications/read", response=MarkedOut, auth=session_auth)
def mark_read(request, body: MarkReadIn):
    return {"marked": notify.mark_read(user=request.user, ids=body.ids)}


@router.get("/notifications/preferences", response=list[PreferenceOut], auth=session_auth)
def preferences(request):
    from .models import NotificationTemplate

    saved = {p.kind: p for p in NotificationPreference.objects.filter(user=request.user)}
    return [
        {"kind": t.code, "title": t.title, "email": saved[t.code].email if t.code in saved else True,
         "in_app": saved[t.code].in_app if t.code in saved else True, "email_available": t.email_enabled}
        for t in NotificationTemplate.objects.filter(is_active=True).order_by("code")
    ]  # fmt: skip


@router.put("/notifications/preferences", response=OkOut, auth=session_auth)
def set_preference(request, body: PreferenceIn):
    NotificationPreference.objects.update_or_create(
        user=request.user, kind=body.kind, defaults={"email": body.email, "in_app": body.in_app}
    )
    return {"ok": True}


# ---------------------------------------------------------------- support
def _ticket_out(t: Ticket) -> dict:
    return {"id": t.id, "reference": t.reference, "subject": t.subject, "category": t.category, "status": t.status,
            "last_message_at": t.last_message_at, "created_at": t.created_at}  # fmt: skip


@router.get("/tickets", response=list[TicketOut], auth=session_auth)
def tickets(request):
    return [
        _ticket_out(t) for t in Ticket.objects.filter(user=request.user).order_by("-last_message_at")[:100]
    ]


@router.post("/tickets", response=TicketOut, auth=session_auth)
def open_ticket(request, body: TicketIn):
    t = services.open_ticket(user=request.user, subject=body.subject, category=body.category, body=body.body,
                             org_id=getattr(request, "org_id", None))  # fmt: skip
    return _ticket_out(t)


@router.get("/tickets/{ticket_id}", response=TicketDetail, auth=session_auth)
def ticket(request, ticket_id: str):
    t = get_object_or_404(Ticket, pk=ticket_id, user=request.user)
    msgs = (
        TicketMessage.objects.filter(ticket=t).select_related("author", "attachment").order_by("created_at")
    )  # RLS hides notes
    return {**_ticket_out(t), "messages": [
        {"id": m.id, "author": _author(m.author), "body": m.body, "body_html": services.message_html(m.body),
         "is_staff": m.author.is_staff, "attachment": ticket_files.attachment_out(m),
         "created_at": m.created_at} for m in msgs]}  # fmt: skip


@router.get("/tickets/{ticket_id}/messages/{message_id}/file", response=TicketFileUrlOut, auth=session_auth)
def ticket_file(request, ticket_id: str, message_id: str):
    """A 1-hour signed link to a file staff attached (internal notes are invisible: RLS)."""
    t = get_object_or_404(Ticket, pk=ticket_id, user=request.user)
    m = get_object_or_404(TicketMessage.objects.select_related("attachment"), pk=message_id, ticket=t,
                          is_internal=False)  # fmt: skip
    return {"url": ticket_files.download_link(m)}


@router.post("/tickets/{ticket_id}/messages", response=IdOut, auth=session_auth)
def reply(request, ticket_id: str, body: TextIn):
    t = get_object_or_404(Ticket, pk=ticket_id, user=request.user)
    m = services.reply(ticket=t, author=request.user, body=body.body)
    return {"id": m.id}


@router.post("/tickets/{ticket_id}/close", response=ClosedOut, auth=session_auth)
def close(request, ticket_id: str):
    t = get_object_or_404(Ticket, pk=ticket_id, user=request.user)
    services.set_ticket_status(ticket=t, status="closed", by=request.user)
    return {"ok": True, "closed_at": timezone.now()}


# ---------------------------------------------------------------- reporting content
@router.post("/reports", response=ReportOut, auth=session_auth)
def report(request, body: ReportIn):
    """Report a review, question or answer to the moderators (once per person)."""
    r = moderation.report(user=request.user, target_type=body.target_type, target_id=body.target_id,
                          reason=body.reason)  # fmt: skip
    return {"id": r.id, "status": r.status}
