"""Console > Reviews (pattern 25): moderation of reviews, questions and answers, and the
queue of content learners reported. Hiding needs a reason the author is told; hiding or
dismissing closes the open reports and thanks the reporters."""

from datetime import datetime, timedelta
from uuid import UUID

from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.engagement import moderation
from apps.engagement.models import Answer, ContentReport, Question, Review
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleOkOut, clamp, router, staff


class ConsoleHideIn(Schema):
    hide: bool
    reason: str = Field("", max_length=300)


class ConsoleDismissIn(Schema):
    note: str = Field("", max_length=300)


class ConsoleModItemOut(Schema):
    id: UUID
    kind: str  # review | question | answer
    course: str
    course_slug: str
    author: str
    author_email: str
    rating: int | None
    title: str
    body: str
    hidden: bool
    open_reports: int
    created_at: datetime


class ConsoleModPageOut(Schema):
    items: list[ConsoleModItemOut]
    next_cursor: str | None


class ConsoleModSummaryOut(Schema):
    open_reports: int
    hidden_reviews: int
    hidden_questions: int
    hidden_answers: int
    low_ratings_30d: int


class ConsoleReportOut(Schema):
    id: UUID
    target_type: str
    target_id: UUID
    reason: str
    status: str
    reporter: str
    reporter_email: str
    created_at: datetime
    handled_by: str | None
    handled_at: datetime | None
    resolution_note: str
    content_author: str | None
    content_text: str | None
    content_hidden: bool | None
    course: str | None
    reports_on_target: int


class ConsoleReportPageOut(Schema):
    items: list[ConsoleReportOut]
    next_cursor: str | None


def _open_reports(kind: str):
    return Coalesce(
        Subquery(
            ContentReport.objects.filter(target_type=kind, target_id=OuterRef("pk"), status="open")
            .values("target_id").annotate(n=Count("id")).values("n")[:1]
        ),
        0,
    )  # fmt: skip


@router.get("/moderation/summary", response=ConsoleModSummaryOut)
def summary(request):
    staff(request)
    since = timezone.now() - timedelta(days=30)
    return {
        "open_reports": ContentReport.objects.filter(status="open").count(),
        "hidden_reviews": Review.objects.filter(status="hidden").count(),
        "hidden_questions": Question.objects.filter(hidden_at__isnull=False).count(),
        "hidden_answers": Answer.objects.filter(hidden_at__isnull=False).count(),
        "low_ratings_30d": Review.objects.filter(rating__lte=2, created_at__gte=since).count(),
    }


@router.get("/moderation/items", response=ConsoleModPageOut)
def items(request, kind: str = "review", status: str | None = None, q: str | None = None,
          max_rating: int | None = None, reported: bool = False, cursor: str | None = None, limit: int = 25):  # fmt: skip
    """Reviews, questions or answers, newest first. status = visible | hidden."""
    staff(request)
    if kind == "review":
        qs = Review.objects.select_related("user", "course")
        hidden = Q(status="hidden")
        if max_rating:
            qs = qs.filter(rating__lte=max_rating)
    elif kind == "question":
        qs = Question.objects.select_related("user", "course")
        hidden = Q(hidden_at__isnull=False)
    elif kind == "answer":
        qs = Answer.objects.select_related("user", "question__course")
        hidden = Q(hidden_at__isnull=False)
    else:
        raise ServiceError("bad_kind", "Choose reviews, questions or answers.")
    if status == "hidden":
        qs = qs.filter(hidden)
    elif status == "visible":
        qs = qs.exclude(hidden)
    if q and q.strip():
        term = q.strip()[:100]
        course_field = "question__course__title" if kind == "answer" else "course__title"
        cond = (
            Q(body__icontains=term)
            | Q(user__email__icontains=term)
            | Q(**{f"{course_field}__icontains": term})
        )
        if kind == "question":
            cond |= Q(title__icontains=term)
        qs = qs.filter(cond)
    qs = qs.annotate(reports=_open_reports(kind))
    if reported:
        qs = qs.filter(reports__gt=0)
    limit = clamp(limit, 100)
    after = keyset.decode(cursor, 2)
    if after:
        qs = qs.filter(Q(created_at__lt=after[0]) | Q(created_at=after[0], id__lt=after[1]))
    rows = list(qs.order_by("-created_at", "-id")[: limit + 1])
    page = rows[:limit]
    out = []
    for r in page:
        course = r.question.course if kind == "answer" else r.course
        out.append({
            "id": r.id, "kind": kind, "course": course.title, "course_slug": course.slug,
            "author": r.user.full_name or r.user.email, "author_email": r.user.email,
            "rating": r.rating if kind == "review" else None,
            "title": r.title if kind == "question" else (r.question.title if kind == "answer" else ""),
            "body": html.plain(r.body, 2000), "hidden": moderation.is_hidden(kind, r), "open_reports": r.reports,
            "created_at": r.created_at,
        })  # fmt: skip
    nxt = keyset.encode(page[-1].created_at.isoformat(), str(page[-1].id)) if len(rows) > limit else None
    return {"items": out, "next_cursor": nxt}


@router.post("/moderation/{kind}/{target_id}", response=ConsoleOkOut)
def hide_or_show(request, kind: str, target_id: UUID, body: ConsoleHideIn):
    """Hide (reason required, the author is notified) or show again."""
    staff(request)
    moderation.set_hidden(
        target_type=kind, target_id=target_id, hide=body.hide, reason=body.reason, by=request.user
    )
    audit_request(
        request, f"{kind}.{'hide' if body.hide else 'show'}", kind, target_id, {"reason": body.reason}
    )
    return {"ok": True}


@router.get("/moderation/reports", response=ConsoleReportPageOut)
def reports(request, status: str = "open", target_type: str | None = None, cursor: str | None = None,
            limit: int = 25):  # fmt: skip
    staff(request)
    qs = ContentReport.objects.select_related("reporter", "handled_by")
    if status != "all":
        qs = qs.filter(status=status)
    if target_type:
        qs = qs.filter(target_type=target_type)
    limit = clamp(limit, 100)
    after = keyset.decode(cursor, 2)
    if after:
        qs = qs.filter(Q(created_at__lt=after[0]) | Q(created_at=after[0], id__lt=after[1]))
    rows = list(qs.order_by("-created_at", "-id")[: limit + 1])
    page = rows[:limit]
    counts = dict(
        ContentReport.objects.filter(target_id__in=[r.target_id for r in page])
        .values("target_id").annotate(n=Count("id")).values_list("target_id", "n")
    )  # fmt: skip
    out = []
    for r in page:  # at most 100 rows: one small lookup each
        row = moderation.target(r.target_type, r.target_id)
        course = moderation.course_of(r.target_type, row) if row else None
        out.append({
            "id": r.id, "target_type": r.target_type, "target_id": r.target_id, "reason": r.reason,
            "status": r.status, "reporter": r.reporter.full_name or r.reporter.email,
            "reporter_email": r.reporter.email, "created_at": r.created_at,
            "handled_by": (r.handled_by.full_name or r.handled_by.email) if r.handled_by else None,
            "handled_at": r.handled_at, "resolution_note": r.resolution_note,
            "content_author": (row.user.full_name or row.user.email) if row else None,
            "content_text": moderation.text_of(r.target_type, row) if row else None,
            "content_hidden": moderation.is_hidden(r.target_type, row) if row else None,
            "course": course.title if course else None, "reports_on_target": counts.get(r.target_id, 1),
        })  # fmt: skip
    nxt = keyset.encode(page[-1].created_at.isoformat(), str(page[-1].id)) if len(rows) > limit else None
    return {"items": out, "next_cursor": nxt}


@router.post("/moderation/reports/{report_id}/hide", response=ConsoleOkOut)
def report_hide(request, report_id: UUID, body: ConsoleHideIn):
    """Hide the reported content (closes every open report on it as actioned)."""
    staff(request)
    r = get_object_or_404(ContentReport, pk=report_id)
    moderation.set_hidden(target_type=r.target_type, target_id=r.target_id, hide=True, reason=body.reason,
                          by=request.user)  # fmt: skip
    audit_request(request, f"{r.target_type}.hide", r.target_type, r.target_id,
                  {"reason": body.reason, "report": str(r.id)})  # fmt: skip
    return {"ok": True}


@router.post("/moderation/reports/{report_id}/dismiss", response=ConsoleOkOut)
def report_dismiss(request, report_id: UUID, body: ConsoleDismissIn):
    staff(request)
    r = get_object_or_404(ContentReport, pk=report_id)
    moderation.dismiss(report=r, by=request.user, note=body.note)
    audit_request(
        request, "report.dismiss", "content_report", r.id, {"note": body.note, "target": r.target_type}
    )
    return {"ok": True}
