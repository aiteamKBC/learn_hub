"""Console > Reports (mockup 02): read-only reports with filters (date range, category,
instructor) and a CSV export. Course numbers come from order items, so the category and
instructor filters apply to them; subscription numbers are platform-wide (a plan is not
one course)."""

import csv
from datetime import date, datetime
from uuid import UUID

from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.db.models.functions import TruncDate
from django.http import StreamingHttpResponse
from django.utils import timezone
from ninja import Schema

from apps.catalog.models import Course, CourseInstructor
from apps.commerce.models import Invoice, OrderItem, Plan, Subscription, SubscriptionEvent
from apps.learning.models import Enrollment

from ..services import audit_request
from . import metrics
from .common import ConsoleKpiOut, ConsolePointOut, ConsoleRangeOut, kpi, parse_range, router, staff

TOP = 10


class ConsoleReportSliceOut(Schema):
    key: str
    label: str
    value: int  # a count, or GBP pence for money slices


class ConsoleReportCourseOut(Schema):
    id: UUID
    title: str
    category: str
    enrolments: int
    completions: int
    revenue_gbp_minor: int
    rating: float
    rating_count: int


class ConsoleReportSaleOut(Schema):
    id: UUID
    kind: str  # order | subscription
    reference: str
    customer: str
    product: str
    amount_minor: int
    currency: str
    gbp_minor: int | None
    payment_method: str
    at: datetime
    status: str
    url: str


class ConsoleReportPlanOut(Schema):
    id: UUID
    name: str
    active: int
    started: int
    cancelled: int
    revenue_gbp_minor: int


class ConsoleAnalyticsOut(Schema):
    range: ConsoleRangeOut
    filtered: bool  # a category or instructor filter applies to the course numbers
    revenue_gbp_minor: ConsoleKpiOut  # courses + subscriptions
    course_revenue_gbp_minor: ConsoleKpiOut
    subscription_revenue_gbp_minor: ConsoleKpiOut
    refunds_gbp_minor: ConsoleKpiOut
    orders: ConsoleKpiOut
    average_order_gbp_minor: ConsoleKpiOut
    students: ConsoleKpiOut  # totals at the end of each period
    new_students: ConsoleKpiOut
    active_learners: ConsoleKpiOut
    courses: ConsoleKpiOut
    enrolments: ConsoleKpiOut
    completions: ConsoleKpiOut
    active_subscriptions: ConsoleKpiOut
    revenue_series: list[ConsolePointOut]
    orders_series: list[ConsolePointOut]
    subscription_series: list[ConsolePointOut]
    students_series: list[ConsolePointOut]
    enrolments_series: list[ConsolePointOut]
    enrolments_by_type: list[ConsoleReportSliceOut]
    sales_by_product: list[ConsoleReportSliceOut]
    revenue_by_currency: list[ConsoleReportSliceOut]  # in each currency's minor units
    top_courses: list[ConsoleReportCourseOut]
    recent_sales: list[ConsoleReportSaleOut]
    plans: list[ConsoleReportPlanOut]


class Filters:
    def __init__(
        self, range: str, start: date | None, end: date | None, category: UUID | None, instructor: UUID | None
    ):
        self.r = parse_range(range, start, end)
        self.category, self.instructor = category, instructor

    @property
    def filtered(self) -> bool:
        return bool(self.category or self.instructor)

    def courses(self, prefix: str = ""):
        """Q for rows whose course matches the filters (prefix = path to the course)."""
        q = Q()
        if self.category:
            q &= Q(**{f"{prefix}category_id": self.category})
        if self.instructor:
            teaches = CourseInstructor.objects.filter(course_id=OuterRef(f"{prefix}id" if prefix else "id"),
                                                      user_id=self.instructor)  # fmt: skip
            q &= Q(Exists(teaches)) | Q(**{f"{prefix}created_by_id": self.instructor})
        return q


def _items(f: Filters, start, end):
    return OrderItem.objects.filter(
        f.courses("course__"),
        order__status__in=metrics.PAID,
        order__paid_at__gte=start,
        order__paid_at__lt=end,
    )


def _item_totals(f: Filters, start, end) -> dict:
    row = _items(f, start, end).aggregate(gbp=Sum("gbp_gross_minor"), orders=Count("order_id", distinct=True))
    return {"gbp": row["gbp"] or 0, "orders": row["orders"]}


def _refunds(f: Filters, start, end) -> int:
    rows = OrderItem.objects.filter(f.courses("course__"), refunded_at__gte=start, refunded_at__lt=end)
    return rows.aggregate(gbp=Sum("gbp_gross_minor"))["gbp"] or 0


def _active_subscriptions(when) -> int:
    cancelled = SubscriptionEvent.objects.filter(
        subscription_id=OuterRef("id"), kind="cancelled", at__lt=when
    )
    return (
        Subscription.objects.filter(created_at__lt=when)
        .exclude(status__in=("incomplete",))
        .exclude(Exists(cancelled))
        .count()
    )


def _payment_method(brand: str, last4: str, kind: str) -> str:
    if brand and last4:
        return f"{brand.title()} •••• {last4}"
    return (kind or "card").replace("_", " ").title() if kind else ""


def recent_sales(f: Filters, limit: int = TOP) -> list[dict]:
    r = f.r
    items = (
        _items(f, r.start, r.end)
        .select_related("order", "order__user", "course")
        .order_by("-order__paid_at")[: limit * 3]
    )
    by_order: dict = {}
    for it in items:
        row = by_order.setdefault(it.order_id, {"order": it.order, "titles": []})
        row["titles"].append(it.course.title)
    out = []
    for row in list(by_order.values())[:limit]:
        o = row["order"]
        more = len(row["titles"]) - 1
        out.append({
            "id": o.id, "kind": "order", "reference": str(o.id)[-8:].upper(),
            "customer": o.user.full_name or o.user.email,
            "product": row["titles"][0] + (f" and {more} more" if more > 0 else ""),
            "amount_minor": o.total_minor, "currency": o.currency_id, "gbp_minor": o.gbp_total_minor,
            "payment_method": _payment_method(o.card_brand, o.card_last4, o.payment_method_type),
            "at": o.paid_at, "status": o.status, "url": f"/console/sales?order={o.id}",
        })  # fmt: skip
    if not f.filtered:
        for inv in (
            metrics.subscription_invoices(r.start, r.end)
            .select_related("user", "subscription__plan")
            .order_by("-issued_at")[:limit]
        ):
            out.append({
                "id": inv.id, "kind": "subscription", "reference": inv.number or str(inv.id)[-8:].upper(),
                "customer": inv.user.full_name or inv.user.email if inv.user_id else "",
                "product": f"{inv.subscription.plan.name} subscription", "amount_minor": inv.amount_minor,
                "currency": inv.currency_id, "gbp_minor": None, "payment_method": "Stripe",
                "at": inv.issued_at, "status": "paid" if inv.status == "paid" else inv.status,
                "url": f"/console/subscriptions?subscription={inv.subscription_id}",
            })  # fmt: skip
    out.sort(key=lambda s: s["at"], reverse=True)
    return out[:limit]


def top_courses(f: Filters, limit: int = TOP) -> list[dict]:
    r = f.r
    window = Q(enrollments__enrolled_at__gte=r.start, enrollments__enrolled_at__lt=r.end)
    done = window & Q(enrollments__completed_at__isnull=False)
    rows = list(
        Course.objects.filter(f.courses(), deleted_at__isnull=True)
        .annotate(n=Count("enrollments", filter=window), c=Count("enrollments", filter=done))
        .filter(n__gt=0)
        .select_related("category")
        .order_by("-n", "title")[:limit]
    )
    revenue = dict(
        _items(f, r.start, r.end)
        .filter(course_id__in=[c.id for c in rows])
        .values_list("course_id")
        .annotate(gbp=Sum("gbp_gross_minor"))
    )
    return [
        {"id": c.id, "title": c.title, "category": c.category.name if c.category_id else "",
         "enrolments": c.n, "completions": c.c, "revenue_gbp_minor": revenue.get(c.id, 0),
         "rating": float(c.rating_avg), "rating_count": c.rating_count}
        for c in rows
    ]  # fmt: skip


def plans(f: Filters) -> list[dict]:
    r = f.r
    events = SubscriptionEvent.objects.filter(at__gte=r.start, at__lt=r.end)
    started = dict(events.filter(kind="created").values_list("subscription__plan_id").annotate(n=Count("id")))
    cancelled = dict(
        events.filter(kind="cancelled").values_list("subscription__plan_id").annotate(n=Count("id"))
    )
    active = dict(
        Subscription.objects.filter(status__in=("active", "trialing", "past_due"))
        .values_list("plan_id")
        .annotate(n=Count("id"))
    )
    cache: dict = {}
    out = []
    for p in Plan.objects.order_by("name"):
        rows = (
            Invoice.objects.filter(subscription__plan=p, issued_at__gte=r.start, issued_at__lt=r.end)
            .exclude(status__in=("void", "uncollectible", "draft"))
            .values_list("currency_id")
            .annotate(m=Sum("amount_minor"))
        )
        out.append({"id": p.id, "name": p.name, "active": active.get(p.id, 0), "started": started.get(p.id, 0),
                    "cancelled": cancelled.get(p.id, 0), "revenue_gbp_minor": metrics._to_gbp(rows, cache)})  # fmt: skip
    return out


def build(f: Filters) -> dict:
    r = f.r
    s, e, ps, pe = r.start, r.end, r.previous_start, r.previous_end
    cur, prev = _item_totals(f, s, e), _item_totals(f, ps, pe)
    sub_cur, sub_prev = metrics.subscription_revenue_gbp(s, e), metrics.subscription_revenue_gbp(ps, pe)
    students = metrics.students().filter(is_active=True)
    enrol = Enrollment.objects.filter(f.courses("course__"))
    courses = Course.objects.filter(f.courses(), status="published", deleted_at__isnull=True)

    def avg(t):
        return t["gbp"] // t["orders"] if t["orders"] else 0

    def series_items(start, end, value):
        rows = _items(f, start, end).annotate(day=TruncDate("order__paid_at")).values("day").annotate(v=value)
        return metrics._fill(start, end, {x["day"]: x["v"] or 0 for x in rows})

    by_type = (
        enrol.filter(enrolled_at__gte=s, enrolled_at__lt=e).values_list("source").annotate(n=Count("id"))
    )
    labels = dict(Enrollment.Source.choices)
    by_currency = (
        OrderItem.objects.filter(f.courses("course__"), order__status__in=metrics.PAID, order__paid_at__gte=s,
                                 order__paid_at__lt=e)
        .values_list("order__currency_id")
        .annotate(m=Sum("gross_minor"))
        .order_by("-m")
    )  # fmt: skip
    active_window = Q(last_accessed_at__gte=s, last_accessed_at__lt=e)
    active_prev = Q(last_accessed_at__gte=ps, last_accessed_at__lt=pe)
    return {
        "range": r.out(),
        "filtered": f.filtered,
        "revenue_gbp_minor": kpi(cur["gbp"] + (0 if f.filtered else sub_cur), prev["gbp"] + (0 if f.filtered else sub_prev)),
        "course_revenue_gbp_minor": kpi(cur["gbp"], prev["gbp"]),
        "subscription_revenue_gbp_minor": kpi(sub_cur, sub_prev),
        "refunds_gbp_minor": kpi(_refunds(f, s, e), _refunds(f, ps, pe)),
        "orders": kpi(cur["orders"], prev["orders"]),
        "average_order_gbp_minor": kpi(avg(cur), avg(prev)),
        "students": kpi(students.filter(created_at__lt=e).count(), students.filter(created_at__lt=pe).count()),
        "new_students": kpi(students.filter(created_at__gte=s, created_at__lt=e).count(),
                            students.filter(created_at__gte=ps, created_at__lt=pe).count()),
        "active_learners": kpi(enrol.filter(active_window).values("user_id").distinct().count(),
                               enrol.filter(active_prev).values("user_id").distinct().count()),
        "courses": kpi(courses.filter(published_at__lt=e).count(), courses.filter(published_at__lt=pe).count()),
        "enrolments": kpi(enrol.filter(enrolled_at__gte=s, enrolled_at__lt=e).count(),
                          enrol.filter(enrolled_at__gte=ps, enrolled_at__lt=pe).count()),
        "completions": kpi(enrol.filter(completed_at__gte=s, completed_at__lt=e).count(),
                           enrol.filter(completed_at__gte=ps, completed_at__lt=pe).count()),
        "active_subscriptions": kpi(_active_subscriptions(e), _active_subscriptions(pe)),
        "revenue_series": series_items(s, e, Sum("gbp_gross_minor")),
        "orders_series": series_items(s, e, Count("order_id", distinct=True)),
        "subscription_series": metrics.subscription_series(s, e),
        "students_series": metrics.created_series(students, "created_at", s, e),
        "enrolments_series": metrics.created_series(enrol, "enrolled_at", s, e),
        "enrolments_by_type": [{"key": k, "label": labels.get(k, k), "value": n} for k, n in sorted(by_type, key=lambda x: -x[1])],
        "sales_by_product": [{"key": "courses", "label": "Courses", "value": cur["gbp"]}]
        + ([] if f.filtered else [{"key": "subscriptions", "label": "Subscriptions", "value": sub_cur}]),
        "revenue_by_currency": [{"key": c, "label": c, "value": m or 0} for c, m in by_currency],
        "top_courses": top_courses(f),
        "recent_sales": recent_sales(f),
        "plans": [] if f.filtered else plans(f),
    }  # fmt: skip


@router.get("/reports", response=ConsoleAnalyticsOut)
def report(request, range: str = "30d", start: date | None = None, end: date | None = None,
           category: UUID | None = None, instructor: UUID | None = None):  # fmt: skip
    staff(request)
    return build(Filters(range, start, end, category, instructor))


class ConsoleReportOptionOut(Schema):
    id: UUID
    name: str


class ConsoleReportFiltersOut(Schema):
    categories: list[ConsoleReportOptionOut]
    instructors: list[ConsoleReportOptionOut]


@router.get("/reports/filters", response=ConsoleReportFiltersOut)
def report_filters(request):
    """Choices for the category and instructor filters."""
    staff(request)
    from apps.catalog.models import Category
    from apps.identity.models import InstructorProfile

    teachers = InstructorProfile.objects.filter(status__in=("approved", "suspended")).select_related("user")
    return {
        "categories": [{"id": c.id, "name": c.name} for c in Category.objects.order_by("name")],
        "instructors": sorted(({"id": p.user_id, "name": p.user.full_name or p.user.email} for p in teachers),
                              key=lambda r: r["name"].lower()),
    }  # fmt: skip


# ---------------------------------------------------------------- CSV
SECTIONS = ("sales", "students", "courses", "subscriptions")


class _Echo:
    def write(self, value):
        return value


def _cell(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # no formulas in spreadsheets


def _pounds(minor: int) -> str:
    return f"{(minor or 0) / 100:.2f}"


def csv_rows(data: dict, types: list[str]):
    rng = data["range"]
    yield [
        "LearnHub report",
        f"{rng['start']:%Y-%m-%d} to {rng['end']:%Y-%m-%d}",
        f"generated {timezone.now():%Y-%m-%d %H:%M}",
    ]
    yield []
    yield ["Measure", "This period", "Previous period", "Change %"]
    kpis = [("Total revenue (GBP)", "revenue_gbp_minor", True), ("Course revenue (GBP)", "course_revenue_gbp_minor", True),
            ("Subscription revenue (GBP)", "subscription_revenue_gbp_minor", True), ("Refunds (GBP)", "refunds_gbp_minor", True),
            ("Orders", "orders", False), ("Average order (GBP)", "average_order_gbp_minor", True),
            ("Students", "students", False), ("New students", "new_students", False),
            ("Active learners", "active_learners", False), ("Published courses", "courses", False),
            ("Enrolments", "enrolments", False), ("Completions", "completions", False),
            ("Active subscriptions", "active_subscriptions", False)]  # fmt: skip
    for label, key, money in kpis:
        k = data[key]
        fmt = _pounds if money else str
        yield [label, fmt(k["value"]), fmt(k["previous"]), "" if k["change_pct"] is None else k["change_pct"]]
    if "sales" in types:
        yield []
        yield ["Day", "Course revenue (GBP)", "Orders", "Subscription revenue (GBP)"]
        for rev, orders, subs in zip(
            data["revenue_series"], data["orders_series"], data["subscription_series"], strict=True
        ):
            yield [rev["day"], _pounds(rev["value"]), orders["value"], _pounds(subs["value"])]
        yield []
        yield [
            "Recent sales",
            "Customer",
            "Product",
            "Amount",
            "Currency",
            "Payment method",
            "Date",
            "Status",
        ]
        for s in data["recent_sales"]:
            yield [s["reference"], s["customer"], s["product"], s["amount_minor"], s["currency"], s["payment_method"],
                   f"{s['at']:%Y-%m-%d %H:%M}", s["status"]]  # fmt: skip
    if "students" in types:
        yield []
        yield ["Day", "New students", "Enrolments"]
        for st, en in zip(data["students_series"], data["enrolments_series"], strict=True):
            yield [st["day"], st["value"], en["value"]]
        yield []
        yield ["Enrolment type", "Enrolments"]
        for row in data["enrolments_by_type"]:
            yield [row["label"], row["value"]]
    if "courses" in types:
        yield []
        yield ["Course", "Category", "Enrolments", "Completions", "Revenue (GBP)", "Rating", "Ratings"]
        for c in data["top_courses"]:
            yield [c["title"], c["category"], c["enrolments"], c["completions"], _pounds(c["revenue_gbp_minor"]),
                   f"{c['rating']:.1f}", c["rating_count"]]  # fmt: skip
    if "subscriptions" in types and data["plans"]:
        yield []
        yield ["Plan", "Active now", "Started", "Cancelled", "Revenue (GBP)"]
        for p in data["plans"]:
            yield [p["name"], p["active"], p["started"], p["cancelled"], _pounds(p["revenue_gbp_minor"])]


@router.get("/reports/export.csv")
def export(request, range: str = "30d", start: date | None = None, end: date | None = None,
           category: UUID | None = None, instructor: UUID | None = None, types: str = ",".join(SECTIONS)):  # fmt: skip
    staff(request)
    chosen = [t for t in types.split(",") if t in SECTIONS] or list(SECTIONS)
    f = Filters(range, start, end, category, instructor)
    data = build(f)
    writer = csv.writer(_Echo())
    audit_request(request, "report.export", "report", "console", {"range": range, "types": chosen,
                  "category": str(category or ""), "instructor": str(instructor or "")})  # fmt: skip
    response = StreamingHttpResponse(
        (writer.writerow([_cell(v) for v in row]) for row in csv_rows(data, chosen)),
        content_type="text/csv; charset=utf-8",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="learnhub-report-{timezone.localdate():%Y-%m-%d}.csv"'
    )
    response["Cache-Control"] = "no-store"
    return response
