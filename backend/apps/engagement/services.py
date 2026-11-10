"""Reviews, Q&A, announcements, badges and support tickets (engagement).

Who may write what is decided twice: here (business rules, friendly errors) and by
RLS in the database (authors only; staff for moderation). Writes on someone else's
row (an instructor replying to a review, staff closing a ticket) are narrow,
validated updates done in a staff context, never a general permission.
"""

import secrets
from html import escape

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.catalog.models import Course, CourseInstructor
from apps.learning.models import Enrollment
from core import html
from core.errors import ServiceError
from core.tenancy import tenant_context

from . import notify
from .models import Announcement, Answer, Question, QuestionVote, Review, Ticket, TicketMessage

ACCESS = (Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED)


def _clean(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) > limit:
        raise ServiceError("too_long", f"Keep it under {limit} characters.")
    return text


def _is_instructor(user, course) -> bool:
    return CourseInstructor.objects.filter(course=course, user=user).exists()


def _is_learner(user, course) -> bool:
    return Enrollment.objects.filter(user=user, course=course, status__in=ACCESS).exists()


def _visible_course(course_id) -> Course:
    course = Course.objects.filter(pk=course_id, live_version__isnull=False).first()  # RLS: hidden = None
    if course is None:
        raise ServiceError("not_found", "Course not found.", status=404)
    return course


# ---------------------------------------------------------------- reviews
@transaction.atomic
def write_review(*, user, course_id, rating: int, body: str = "") -> Review:
    """One review per learner per marketplace course; writing again edits it."""
    course = _visible_course(course_id)
    if course.owner_org_id is not None:
        raise ServiceError("no_reviews", "Company courses are not reviewed publicly.")
    if not 1 <= int(rating) <= 5:
        raise ServiceError("bad_rating", "Rate from 1 to 5 stars.")
    if not _is_learner(user, course):
        raise ServiceError("not_enrolled", "Enrol in the course before reviewing it.", status=403)
    review, _ = Review.objects.update_or_create(
        user=user, course=course, defaults={"rating": int(rating), "body": _clean(body, 4000)}
    )
    _award_later(user.id)
    return review


@transaction.atomic
def reply_to_review(*, review: Review, instructor, body: str) -> Review:
    if not _is_instructor(instructor, review.course):
        raise ServiceError("forbidden", "Only the course's instructors can reply.", status=403)
    body, now = _clean(body, 4000), timezone.now()
    with tenant_context(user_id=instructor.id, staff=True):  # narrow write on the learner's row
        Review.objects.filter(pk=review.pk).update(
            instructor_reply=body, replied_at=now, replied_by=instructor, updated_at=now
        )
    notify.notify([review.user_id], "review_reply", {"course": review.course.title},
                  url=f"/courses/{review.course.slug}#reviews", dedupe=f"review-reply:{review.id}:{int(now.timestamp())}")  # fmt: skip
    review.refresh_from_db()
    return review


def moderate_review(*, review: Review, hide: bool) -> None:
    """Staff (console). Hidden reviews leave the course rating (trigger)."""
    Review.objects.filter(pk=review.pk).update(
        status="hidden" if hide else "published", updated_at=timezone.now()
    )


# ---------------------------------------------------------------- Q&A
@transaction.atomic
def ask(*, user, course_id, title: str, body: str, lecture_key=None) -> Question:
    course = _visible_course(course_id)
    if not (_is_learner(user, course) or _is_instructor(user, course)):
        raise ServiceError("not_enrolled", "Enrol in the course to ask a question.", status=403)
    if not title.strip():
        raise ServiceError("title_required", "Give your question a title.")
    q = Question.objects.create(
        user=user, course=course, title=_clean(title, 200), body=_clean(body, 10000), lecture_key=lecture_key
    )
    instructors = (
        CourseInstructor.objects.filter(course=course).exclude(user=user).values_list("user_id", flat=True)
    )
    notify.notify(instructors, "question_posted", {"course": course.title, "title": q.title},
                  url=f"/studio/courses/{course.id}/qa/{q.id}", dedupe=f"question:{q.id}")  # fmt: skip
    return q


@transaction.atomic
def answer(*, user, question: Question, body: str) -> Answer:
    course = question.course
    instructor = _is_instructor(user, course)
    if not (instructor or _is_learner(user, course)):
        raise ServiceError("not_enrolled", "Enrol in the course to answer.", status=403)
    a = Answer.objects.create(
        user=user, question=question, body=_clean(body, 10000), is_instructor=instructor
    )
    if question.user_id != user.id:
        notify.notify([question.user_id], "answer_posted", {"course": course.title, "title": question.title},
                      url=f"/learn/{course.slug}/qa/{question.id}", dedupe=f"answer:{a.id}")  # fmt: skip
    _award_later(user.id)
    return a


def toggle_vote(*, user, question: Question) -> bool:
    """True if the user now upvotes the question. Own questions cannot be upvoted."""
    if question.user_id == user.id:
        raise ServiceError("own_question", "You cannot upvote your own question.")
    deleted, _ = QuestionVote.objects.filter(user=user, question=question).delete()
    if deleted:
        return False
    try:
        with transaction.atomic():
            QuestionVote.objects.create(user=user, question=question)
    except IntegrityError:  # a double click raced us: already voted
        pass
    return True


def resolve_question(*, user, question: Question) -> None:
    if question.user_id != user.id:
        raise ServiceError("forbidden", "Only the person who asked can mark it answered.", status=403)
    Question.objects.filter(pk=question.pk).update(resolved_at=timezone.now(), updated_at=timezone.now())


# ---------------------------------------------------------------- announcements
@transaction.atomic
def announce(*, user, course_id, title: str, body: str) -> Announcement:
    """An instructor's message to every current learner of the course: one INSERT for
    the announcement and one set-based fan-out of notifications, after commit."""
    course = _visible_course(course_id)
    if not _is_instructor(user, course):
        raise ServiceError("forbidden", "Only the course's instructors can post announcements.", status=403)
    a = Announcement.objects.create(
        user=user, course=course, title=_clean(title, 200), body=_clean(body, 10000)
    )
    aid = str(a.id)
    transaction.on_commit(lambda: _announce_task().delay(aid))
    return a


def _announce_task():
    from .tasks import send_announcement_task

    return send_announcement_task


def send_announcement(announcement_id) -> int:
    with tenant_context(staff=True):
        a = Announcement.objects.select_related("course").get(pk=announcement_id)
        if a.sent_at:
            return 0
        learners = list(
            Enrollment.objects.filter(course=a.course, status__in=ACCESS)
            .exclude(user_id=a.user_id)
            .values_list("user_id", flat=True)
            .distinct()
        )
    created = notify.notify(learners, "announcement", {"course": a.course.title, "title": a.title},
                            url=f"/learn/{a.course.slug}/announcements/{a.id}", dedupe=f"announcement:{a.id}")  # fmt: skip
    with tenant_context(staff=True):
        Announcement.objects.filter(pk=a.pk).update(
            sent_at=timezone.now(), recipient_count=len(created), updated_at=timezone.now()
        )
    return len(created)


# ---------------------------------------------------------------- badges
def _award_later(user_id) -> None:
    from .tasks import award_badges_task

    uid = str(user_id)
    transaction.on_commit(lambda: award_badges_task.delay(uid))


def award_badges(user_id) -> list[str]:
    """Count achievements once (one query) and award every badge now earned."""
    with tenant_context(staff=True), connection.cursor() as cur:
        cur.execute(
            """
            WITH stats AS (
                SELECT
                  (SELECT count(*) FROM learning.enrollments WHERE user_id = %(u)s AND completed_at IS NOT NULL)
                    AS courses_completed,
                  (SELECT count(*) FROM learning.certificates WHERE user_id = %(u)s AND revoked_at IS NULL)
                    AS certificates,
                  (SELECT count(*) FROM engagement.reviews WHERE user_id = %(u)s AND status = 'published') AS reviews,
                  (SELECT count(*) FROM engagement.answers WHERE user_id = %(u)s AND hidden_at IS NULL) AS answers
            )
            INSERT INTO engagement.user_badges (id, created_at, updated_at, user_id, badge_id, awarded_at)
            SELECT uuidv7(), now(), now(), %(u)s, b.id, now()
              FROM engagement.badges b, stats s
             WHERE b.is_active AND CASE b.criterion
                     WHEN 'courses_completed' THEN s.courses_completed
                     WHEN 'certificates' THEN s.certificates
                     WHEN 'reviews' THEN s.reviews
                     WHEN 'answers' THEN s.answers END >= b.threshold
            ON CONFLICT (user_id, badge_id) DO NOTHING
            RETURNING badge_id
            """,
            {"u": user_id},
        )
        new = [r[0] for r in cur.fetchall()]
        named: dict = {}
        if new:
            cur.execute("SELECT id, name FROM engagement.badges WHERE id = ANY(%s)", [new])
            named = dict(cur.fetchall())  # by id: the two queries need not return the same order
    for badge_id in new:
        notify.notify([user_id], "badge_awarded", {"badge": named[badge_id]}, url="/learn/achievements",
                      dedupe=f"badge:{badge_id}")  # fmt: skip
    return [named[b] for b in new]


# ---------------------------------------------------------------- support
def _reference() -> str:
    return f"LH-{secrets.randbelow(900000) + 100000}"


@transaction.atomic
def open_ticket(*, user, subject: str, category: str, body: str, org_id=None) -> Ticket:
    if category not in Ticket.Category.values:
        raise ServiceError("bad_category", "Choose a category.")
    if not subject.strip() or not body.strip():
        raise ServiceError("required", "Add a subject and describe the problem.")
    now = timezone.now()
    for _ in range(5):  # a reference clash is astronomically rare; retry anyway
        try:
            with transaction.atomic():
                ticket = Ticket.objects.create(
                    user=user, org_id=org_id, reference=_reference(), subject=_clean(subject, 200),
                    category=category, last_message_at=now,
                )  # fmt: skip
            break
        except IntegrityError:
            continue
    else:
        raise ServiceError("try_again", "Please try again.", status=503)
    TicketMessage.objects.create(ticket=ticket, user=user, author=user, body=_clean(body, 10000))
    _ticket_opened(ticket, user)
    return ticket


def _ticket_opened(ticket: Ticket, requester) -> None:
    context = {"reference": ticket.reference, "subject": ticket.subject}
    notify.notify([requester.id], "ticket_opened", context, url=f"/support/{ticket.id}",
                  dedupe=f"ticket-opened:{ticket.id}")  # fmt: skip
    notify.notify_staff("staff_ticket_new", {**context, "name": requester.full_name or requester.email},
                        url=f"/console/communications?ticket={ticket.id}", dedupe=f"staff-ticket:{ticket.id}")  # fmt: skip


@transaction.atomic
def open_ticket_for(*, user, by, subject: str, category: str, body: str, priority: str = "normal") -> Ticket:
    """Staff open a ticket for someone (a phone call, an email): the first message is
    the staff member's, as rich text, and the person is told."""
    if not by.is_staff:
        raise ServiceError("forbidden", "Staff only.", status=403)
    if category not in Ticket.Category.values:
        raise ServiceError("bad_category", "Choose a category.")
    if priority not in Ticket.Priority.values:
        raise ServiceError("bad_priority", "Unknown priority.")
    text = html.clean(body, 20000)
    if not subject.strip() or not html.plain(text, 20000).strip():
        raise ServiceError("required", "Add a subject and a first message.")
    now = timezone.now()
    with tenant_context(user_id=by.id, staff=True):
        for _ in range(5):
            try:
                with transaction.atomic():
                    ticket = Ticket.objects.create(
                        user=user, reference=_reference(), subject=html.plain(subject, 200), category=category,
                        priority=priority, last_message_at=now, assigned_to=by,
                    )  # fmt: skip
                break
            except IntegrityError:
                continue
        else:
            raise ServiceError("try_again", "Please try again.", status=503)
        TicketMessage.objects.create(ticket=ticket, user=user, author=by, body=_clean(text, 10000))
    notify.notify([user.id], "ticket_opened", {"reference": ticket.reference, "subject": ticket.subject},
                  url=f"/support/{ticket.id}", dedupe=f"ticket-opened:{ticket.id}")  # fmt: skip
    return ticket


def message_html(body: str) -> str:
    """A ticket message as safe HTML: staff replies are rich text (cleaned on the way in,
    and again here); everything else is plain text, escaped with its line breaks kept."""
    text = body or ""
    if text.lstrip().startswith("<"):
        return html.clean(text)
    return escape(text).replace("\n", "<br>")


@transaction.atomic
def reply(*, ticket: Ticket, author, body: str, internal: bool = False, attachment_id=None) -> TicketMessage:
    """The requester or staff. Only staff may write internal notes (RLS enforces it too).
    Staff write rich text (bold, italic, lists, links), cleaned by nh3; requesters write
    plain text. An attachment must be a finished upload for this ticket."""
    is_staff = author.is_staff
    if not is_staff and (author.id != ticket.user_id or internal):
        raise ServiceError("forbidden", "You cannot post on this ticket.", status=403)
    if ticket.status == Ticket.Status.CLOSED and not is_staff:
        raise ServiceError("closed", "This ticket is closed. Open a new one.")
    text = html.clean(body, 20000) if is_staff and body.lstrip().startswith("<") else body
    if not html.plain(text, 20000).strip() and not attachment_id:
        raise ServiceError("required", "Write a message.")
    asset = None
    if attachment_id:
        from .tickets import claim_attachment

        asset = claim_attachment(ticket=ticket, user=author, asset_id=attachment_id)
    msg = TicketMessage.objects.create(
        ticket=ticket, user_id=ticket.user_id, author=author, body=_clean(text, 10000), is_internal=internal,
        attachment=asset,
    )  # fmt: skip
    context = {"reference": ticket.reference, "subject": ticket.subject}
    if is_staff and not internal:
        notify.notify([ticket.user_id], "ticket_reply", context, url=f"/support/{ticket.id}",
                      dedupe=f"ticket-msg:{msg.id}")  # fmt: skip
    elif not is_staff:
        notify.notify_staff("staff_ticket_reply", {**context, "name": author.full_name or author.email},
                            url=f"/console/communications?ticket={ticket.id}", dedupe=f"staff-ticket-msg:{msg.id}")  # fmt: skip
    return msg


def set_ticket_status(*, ticket: Ticket, status: str, by) -> None:
    """Staff any status; the requester may only close their own ticket."""
    if status not in Ticket.Status.values:
        raise ServiceError("bad_status", "Unknown status.")
    if not by.is_staff and not (by.id == ticket.user_id and status == Ticket.Status.CLOSED):
        raise ServiceError("forbidden", "You cannot change this ticket.", status=403)
    now = timezone.now()
    with tenant_context(user_id=by.id, staff=True):  # narrow, validated status change
        Ticket.objects.filter(pk=ticket.pk).update(
            status=status, updated_at=now, resolved_at=now if status in ("resolved", "closed") else None
        )
    if status == Ticket.Status.RESOLVED and by.is_staff and ticket.status != status:
        notify.notify([ticket.user_id], "ticket_resolved", {"reference": ticket.reference, "subject": ticket.subject},
                      url=f"/support/{ticket.id}", dedupe=f"ticket-resolved:{ticket.id}:{int(now.timestamp())}")  # fmt: skip


def assign_ticket(*, ticket: Ticket, agent) -> None:
    if not agent.is_staff:
        raise ServiceError("not_staff", "Tickets can only be assigned to support staff.")
    Ticket.objects.filter(pk=ticket.pk).update(assigned_to=agent, updated_at=timezone.now())
