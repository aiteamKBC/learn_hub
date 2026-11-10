"""Console > Dashboard (mockup 26): KPIs for a date range vs the period before, sales,
pending approvals, payout requests, needs attention, recent activity and health tiles."""

from datetime import date, datetime, timedelta
from uuid import UUID

from django.db.models import Count, Q, Sum
from django.utils import timezone
from ninja import Schema

from apps.catalog.models import CertificateTemplate, Course, CourseVersion
from apps.commerce import pricing
from apps.commerce.models import Order, StripeEvent, SubscriptionEvent
from apps.engagement.models import ContentReport, Ticket
from apps.identity.models import InstructorProfile
from apps.learning.models import Enrollment
from apps.payouts.models import Payout, PayoutRequest

from ..models import OutboxEvent, WebhookEvent
from . import healthchecks, metrics
from .common import ConsoleKpiOut, ConsolePointOut, ConsoleRangeOut, kpi, parse_range, router, staff


class ConsoleSalesSummaryOut(Schema):
    revenue_gbp_minor: ConsoleKpiOut
    sales: ConsoleKpiOut
    subscription_revenue_gbp_minor: ConsoleKpiOut
    series: list[ConsolePointOut]  # GBP pence per day


class ConsoleApprovalCountsOut(Schema):
    new_courses: int
    certificate_templates: int
    major_changes: int
    other_changes: int
    total: int


class ConsolePayoutRequestSummaryOut(Schema):
    pending: int
    total_gbp_minor: int


class ConsoleAttentionOut(Schema):
    key: str
    count: int
    title: str
    detail: str
    url: str
    tone: str  # danger | warning


class ConsoleOverviewOut(Schema):
    range: ConsoleRangeOut
    students: ConsoleKpiOut
    instructors: ConsoleKpiOut
    courses: ConsoleKpiOut
    enrolments: ConsoleKpiOut
    sales: ConsoleSalesSummaryOut
    approvals: ConsoleApprovalCountsOut
    payout_requests: ConsolePayoutRequestSummaryOut
    attention: list[ConsoleAttentionOut]


class ConsoleDashboardActivityOut(Schema):
    kind: str  # course_submitted | course_published | instructor_applied | payout_requested | order | ticket | subscription
    text: str
    at: datetime
    url: str


class ConsoleDashboardActivityListOut(Schema):
    items: list[ConsoleDashboardActivityOut]


class ConsoleOutboxFailOut(Schema):
    id: UUID
    topic: str
    attempts: int
    last_error: str


class ConsoleStripeFailOut(Schema):
    event_id: str
    type: str
    error: str


class ConsoleHealthTileOut(Schema):
    key: str
    label: str
    status: str  # ok | warning | down
    detail: str
    latency_ms: int | None


class ConsoleHealthOut(Schema):
    tiles: list[ConsoleHealthTileOut]
    outbox_pending: int
    outbox_stuck: int
    outbox_failing: list[ConsoleOutboxFailOut]
    stripe_failing: list[ConsoleStripeFailOut]
    webhooks_unprocessed: int
    fx_latest: date | None


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def approval_counts() -> dict:
    """What waits for staff in Approvals (also drives the nav badge)."""
    waiting = CourseVersion.objects.filter(status="in_review")
    rows = waiting.aggregate(
        new=Count("id", filter=Q(course__status="draft")),
        major=Count("id", filter=~Q(course__status="draft") & Q(is_major_change=True)),
        other=Count("id", filter=~Q(course__status="draft") & Q(is_major_change=False)),
    )
    templates = CertificateTemplate.objects.filter(status="pending").count()
    return {
        "new_courses": rows["new"], "major_changes": rows["major"], "other_changes": rows["other"],
        "certificate_templates": templates, "total": rows["new"] + rows["major"] + rows["other"] + templates,
    }  # fmt: skip


def attention() -> list[dict]:
    """Things a member of staff should act on now; empty rows are left out."""
    week = timezone.now() - timedelta(days=7)
    stuck = timezone.now() - timedelta(minutes=10)
    reports = ContentReport.objects.filter(status="open").count()
    disputed = (
        PayoutRequest.objects.filter(status="disputed").count()
        + Payout.objects.filter(status="disputed").count()
    )
    failed = (
        Order.objects.filter(status="failed", created_at__gte=week).count()
        + SubscriptionEvent.objects.filter(kind="payment_failed", at__gte=week).count()
    )
    jobs = OutboxEvent.objects.filter(processed_at__isnull=True, created_at__lt=stuck).count()
    urgent = Ticket.objects.filter(status__in=("open", "progress"), priority="urgent").count()
    rows = [
        ("reports", reports, _plural(reports, "reported item"), "Reviews, questions or answers flagged by learners.",
         "/console/reviews?tab=reported", "warning"),
        ("disputed_payouts", disputed, _plural(disputed, "disputed payout"), "Needs a decision or more detail.",
         "/console/payouts?tab=requests&status=disputed", "warning"),
        ("failed_payments", failed, _plural(failed, "failed payment"), "In the last 7 days, orders and renewals.",
         "/console/sales?tab=orders&status=failed", "danger"),
        ("stuck_jobs", jobs, _plural(jobs, "stuck background job"), "Waiting for more than 10 minutes.",
         "/console#health", "danger"),
        ("urgent_tickets", urgent, _plural(urgent, "urgent ticket"), "Customers waiting for an answer.",
         "/console/communications?tab=tickets", "danger"),
    ]  # fmt: skip
    return [
        {"key": k, "count": n, "title": t, "detail": d, "url": u, "tone": tone}
        for k, n, t, d, u, tone in rows
        if n
    ]


@router.get("/overview", response=ConsoleOverviewOut)
def overview(request, range: str = "30d", start: date | None = None, end: date | None = None):
    staff(request)
    r = parse_range(range, start, end)
    s, e, ps, pe = r.start, r.end, r.previous_start, r.previous_end

    def upto(qs, field, when):  # totals as they stood at the end of a window
        return qs.filter(**{f"{field}__lt": when}).count()

    students = metrics.students().filter(is_active=True)
    instructors = InstructorProfile.objects.filter(status="approved")
    courses = Course.objects.filter(status="published", deleted_at__isnull=True)
    enrolments = Enrollment.objects.all()
    cur, prev = metrics.sales(s, e), metrics.sales(ps, pe)
    payout_waiting = PayoutRequest.objects.filter(status="pending").aggregate(
        n=Count("id"), gbp=Sum("amount_gbp_minor")
    )
    return {
        "range": r.out(),
        "students": kpi(upto(students, "created_at", e), upto(students, "created_at", pe)),
        "instructors": kpi(upto(instructors, "created_at", e), upto(instructors, "created_at", pe)),
        "courses": kpi(upto(courses, "published_at", e), upto(courses, "published_at", pe)),
        "enrolments": kpi(upto(enrolments, "enrolled_at", e), upto(enrolments, "enrolled_at", pe)),
        "sales": {
            "revenue_gbp_minor": kpi(cur["gbp"], prev["gbp"]),
            "sales": kpi(cur["items"], prev["items"]),
            "subscription_revenue_gbp_minor": kpi(metrics.subscription_revenue_gbp(s, e),
                                                  metrics.subscription_revenue_gbp(ps, pe)),
            "series": metrics.revenue_series(s, e),
        },
        "approvals": approval_counts(),
        "payout_requests": {"pending": payout_waiting["n"], "total_gbp_minor": payout_waiting["gbp"] or 0},
        "attention": attention(),
    }  # fmt: skip


def _gbp(minor: int) -> str:
    return f"£{minor / 100:,.2f}"


@router.get("/activity", response=ConsoleDashboardActivityListOut)
def activity(request, limit: int = 10):
    """The latest things that happened on the platform, newest first, each with a link."""
    staff(request)
    limit = max(1, min(limit, 30))
    items: list[dict] = []
    for v in (
        CourseVersion.objects.filter(submitted_at__isnull=False)
        .select_related("course")
        .order_by("-submitted_at")[:limit]
    ):
        items.append({"kind": "course_submitted", "at": v.submitted_at, "url": f"/console/approvals?version={v.id}",
                      "text": f"Course submitted for approval: “{v.course.title}”"})  # fmt: skip
    for v in (
        CourseVersion.objects.filter(published_at__isnull=False)
        .select_related("course")
        .order_by("-published_at")[:limit]
    ):
        items.append({"kind": "course_published", "at": v.published_at, "url": f"/console/courses?course={v.course_id}",
                      "text": f"Course approved and published: “{v.course.title}”"})  # fmt: skip
    for p in InstructorProfile.objects.select_related("user").order_by("-created_at")[:limit]:
        items.append({"kind": "instructor_applied", "at": p.created_at, "url": f"/console/instructors?user={p.user_id}",
                      "text": f"New instructor application: {p.user.full_name or p.user.email}"})  # fmt: skip
    for q in PayoutRequest.objects.select_related("user").order_by("-created_at")[:limit]:
        items.append({"kind": "payout_requested", "at": q.created_at, "url": "/console/payouts?tab=requests",
                      "text": f"Payout request from {q.user.full_name or q.user.email} ({_gbp(q.amount_gbp_minor)})"})  # fmt: skip
    for o in Order.objects.filter(paid_at__isnull=False).order_by("-paid_at")[:limit]:
        items.append({"kind": "order", "at": o.paid_at, "url": f"/console/sales?order={o.id}",
                      "text": f"New order {str(o.id)[-8:].upper()} ({_gbp(o.gbp_total_minor)})"})  # fmt: skip
    for t in Ticket.objects.order_by("-created_at")[:limit]:
        items.append({"kind": "ticket", "at": t.created_at, "url": f"/console/communications?ticket={t.id}",
                      "text": f"Support ticket {t.reference}: {t.subject}"})  # fmt: skip
    for ev in SubscriptionEvent.objects.filter(kind__in=("created", "cancelled")).order_by("-at")[:limit]:
        verb = "started" if ev.kind == "created" else "cancelled"
        items.append({"kind": "subscription", "at": ev.at, "url": "/console/subscriptions?tab=changes",
                      "text": f"Subscription {verb}{f': {ev.to_value or ev.from_value}' if ev.to_value or ev.from_value else ''}"})  # fmt: skip
    items.sort(key=lambda i: i["at"], reverse=True)
    return {"items": items[:limit]}


@router.get("/health", response=ConsoleHealthOut)
def health(request):
    """Background machinery and outside services: anything stuck or failing shows up here."""
    staff(request)
    stuck = timezone.now() - timedelta(minutes=10)
    return {
        "tiles": healthchecks.tiles(),
        "outbox_pending": OutboxEvent.objects.filter(processed_at__isnull=True).count(),
        "outbox_stuck": OutboxEvent.objects.filter(processed_at__isnull=True, created_at__lt=stuck).count(),
        "outbox_failing": list(OutboxEvent.objects.filter(processed_at__isnull=True, attempts__gt=0)
                               .values("id", "topic", "attempts", "last_error")[:20]),
        "stripe_failing": list(StripeEvent.objects.filter(processed_at__isnull=True).exclude(error="")
                               .values("event_id", "type", "error")[:20]),
        "webhooks_unprocessed": WebhookEvent.objects.filter(processed_at__isnull=True, created_at__lt=stuck).count(),
        "fx_latest": pricing.FxRate.objects.order_by("-rate_date").values_list("rate_date", flat=True).first(),
    }  # fmt: skip
