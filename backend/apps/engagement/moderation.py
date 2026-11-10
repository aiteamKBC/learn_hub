"""Moderation: learners report reviews, questions and answers; staff hide or show them
(with a reason the author is told) and close reports as actioned or dismissed.

Writes on other people's rows happen in a narrow staff context, after the checks here.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Course
from core import html
from core.errors import ServiceError
from core.tenancy import tenant_context

from . import notify
from .models import Answer, ContentReport, Question, Review

KINDS = ("review", "question", "answer")
NOUN = {"review": "review", "question": "question", "answer": "answer"}


def target(target_type: str, target_id):
    """The reported row (or None), with the course it belongs to."""
    if target_type == "review":
        return Review.objects.select_related("course", "user").filter(pk=target_id).first()
    if target_type == "question":
        return Question.objects.select_related("course", "user").filter(pk=target_id).first()
    if target_type == "answer":
        return Answer.objects.select_related("question__course", "user").filter(pk=target_id).first()
    raise ServiceError("bad_target", "You can report reviews, questions and answers.")


def course_of(target_type: str, row) -> Course:
    return row.question.course if target_type == "answer" else row.course


def is_hidden(target_type: str, row) -> bool:
    return row.status == "hidden" if target_type == "review" else row.hidden_at is not None


def text_of(target_type: str, row) -> str:
    if target_type == "question":
        return f"{row.title}\n{html.plain(row.body, 2000)}".strip()
    return html.plain(row.body, 2000)


@transaction.atomic
def report(*, user, target_type: str, target_id, reason: str) -> ContentReport:
    """A signed-in person reports something they can see (RLS decides what that is)."""
    if target_type not in KINDS:
        raise ServiceError("bad_target", "You can report reviews, questions and answers.")
    reason = html.plain(reason, 300).strip()
    if len(reason) < 3:
        raise ServiceError("reason_required", "Tell us what is wrong (at least 3 characters).")
    row = target(target_type, target_id)
    if row is None or is_hidden(target_type, row):
        raise ServiceError("not_found", "That content is no longer available.", status=404)
    if row.user_id == user.id:
        raise ServiceError("own_content", "You cannot report your own post.")
    try:
        with transaction.atomic():
            rep = ContentReport.objects.create(
                reporter=user, target_type=target_type, target_id=row.id, reason=reason
            )
    except IntegrityError as exc:
        raise ServiceError(
            "already_reported", "You have already reported this. We'll look at it soon."
        ) from exc
    course = course_of(target_type, row)
    notify.notify_staff("staff_content_reported", {"kind": NOUN[target_type], "course": course.title, "reason": reason},
                        url=f"/console/reviews?tab=reported&report={rep.id}", dedupe=f"report:{rep.id}")  # fmt: skip
    return rep


def _close_reports(target_type: str, target_id, *, status: str, by, note: str) -> list:
    """Close every open report on this content; returns the reporters to thank."""
    now = timezone.now()
    with tenant_context(user_id=by.id, staff=True):
        reports = ContentReport.objects.filter(target_type=target_type, target_id=target_id, status="open")
        reporters = list(reports.values_list("reporter_id", flat=True))
        reports.update(
            status=status, handled_by=by, handled_at=now, resolution_note=note[:300], updated_at=now
        )
    return reporters


@transaction.atomic
def set_hidden(*, target_type: str, target_id, hide: bool, reason: str, by) -> None:
    """Staff hide (reason required, the author is told) or show again. Hiding closes open
    reports as actioned and thanks the reporters."""
    if target_type not in KINDS:
        raise ServiceError("bad_target", "Unknown content type.")
    reason = html.plain(reason, 300).strip()
    if hide and len(reason) < 3:
        raise ServiceError("reason_required", "Give a reason (the author will see it).")
    with tenant_context(user_id=by.id, staff=True):
        row = target(target_type, target_id)
        if row is None:
            raise ServiceError("not_found", "Not found.", status=404)
        was_hidden = is_hidden(target_type, row)
        now = timezone.now()
        model = {"review": Review, "question": Question, "answer": Answer}[target_type]
        if target_type == "review":
            changes = {"status": "hidden" if hide else "published"}
        else:
            changes = {"hidden_at": now if hide else None}
        model.objects.filter(pk=row.pk).update(**changes, updated_at=now)  # counters: triggers
    course = course_of(target_type, row)
    if hide and not was_hidden:
        notify.notify([row.user_id], "content_hidden", {"kind": NOUN[target_type], "course": course.title,
                      "reason": reason}, url=f"/courses/{course.slug}", dedupe=f"hidden:{target_type}:{row.id}:{int(now.timestamp())}")  # fmt: skip
    if hide:
        reporters = _close_reports(target_type, row.id, status="actioned", by=by, note=reason)
        notify.notify(reporters, "report_handled", {"kind": NOUN[target_type], "outcome": "hid it"},
                      url=f"/courses/{course.slug}", dedupe=f"report-handled:{target_type}:{row.id}")  # fmt: skip


@transaction.atomic
def dismiss(*, report: ContentReport, by, note: str = "") -> None:
    """Staff decide the content can stay: close every open report on it."""
    if report.status != "open":
        raise ServiceError("already_handled", "This report was already handled.")
    row = target(report.target_type, report.target_id)
    reporters = _close_reports(report.target_type, report.target_id, status="dismissed", by=by,
                               note=html.plain(note, 300))  # fmt: skip
    course = course_of(report.target_type, row) if row else None
    notify.notify(reporters, "report_handled", {"kind": NOUN[report.target_type], "outcome": "decided it can stay"},
                  url=f"/courses/{course.slug}" if course else "", dedupe=f"report-dismissed:{report.id}")  # fmt: skip
