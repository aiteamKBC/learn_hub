"""Console > Reports (mockup 02): read-only reports with filters (date range, category,
instructor) and a CSV export. Course numbers come from order items, so the category and
instructor filters apply to them; subscription numbers are platform-wide (a plan is not
one course)."""

import csv
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from django.db.models import Avg, Count, Exists, OuterRef, Q, Sum
from django.http import StreamingHttpResponse
from django.utils import timezone
from ninja import Schema

from apps.catalog.models import Course, CourseInstructor
from apps.commerce.models import OrderItem, Plan, Subscription, SubscriptionEvent
from apps.engagement.models import Review
from apps.learning.models import Enrollment
from core.errors import ServiceError

from ..services import audit_request
from . import metrics
from .common import ConsoleKpiOut, ConsolePointOut, ConsoleRangeOut, Range, kpi, parse_range, router, staff

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
    exponent: int = 2
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
    scope: str
    notices: list[str]
    gross_list_gbp_minor: ConsoleKpiOut
    discounts_gbp_minor: ConsoleKpiOut
    net_collected_gbp_minor: ConsoleKpiOut
    subscription_statuses: list[ConsoleReportSliceOut]
    currency_exponents: dict[str, int]
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
        self,
        range: str,
        start: date | None,
        end: date | None,
        category: UUID | None,
        instructor: UUID | None,
        scope: str = "all",
        as_of: datetime | None = None,
    ):
        if scope not in ("all", "personal", "company"):
            raise ServiceError("bad_filter", "Unknown reporting scope.")
        self.scope = scope
        self.r = parse_range(range, start, end)
        if as_of is not None:
            if timezone.is_naive(as_of) or as_of > timezone.now():
                raise ServiceError("bad_range", "Report cutoff must be a past timestamp with a time zone.")
            if range == "custom":
                self.r = Range(self.r.start, min(self.r.end, as_of))
            else:
                self.r = Range(as_of - (self.r.end - self.r.start), as_of)
        if self.r.start >= self.r.end:
            raise ServiceError("bad_range", "Choose a reporting period that has already started.")
        self.category, self.instructor = category, instructor

    def scope_q(self, prefix: str = ""):
        if self.scope == "all":
            return Q()
        return Q(**{f"{prefix}org__isnull": self.scope == "personal"})

    @property
    def filtered(self) -> bool:
        return bool(self.category or self.instructor)

    def courses(self, prefix: str = ""):
        """Q for rows whose course matches the filters (prefix = path to the course)."""
        q = Q()
        if self.category:
            q &= Q(**{f"{prefix}category_id": self.category}) | Q(
                **{f"{prefix}category__parent_id": self.category}
            )
        if self.instructor:
            teaches = CourseInstructor.objects.filter(course_id=OuterRef(f"{prefix}id" if prefix else "id"),
                                                      user_id=self.instructor)  # fmt: skip
            q &= Q(Exists(teaches)) | Q(**{f"{prefix}created_by_id": self.instructor})
        return q


def _items(f: Filters, start, end):
    return OrderItem.objects.filter(
        f.courses("course__"),
        f.scope_q("order__"),
        order__status__in=metrics.PAID,
        order__paid_at__gte=start,
        order__paid_at__lt=end,
    )


def _current_subscriptions(f):
    return Subscription.objects.filter(f.scope_q())


def _live_subscriptions(f):
    # Current billing statuses only; this is not a content-access eligibility check.
    return (
        _current_subscriptions(f)
        .filter(status__in=("active", "trialing", "past_due"))
        .filter(Q(current_period_end__isnull=True) | Q(current_period_end__gt=timezone.now()))
    )


def _payment_method(brand: str, last4: str, kind: str) -> str:
    if brand and last4:
        return f"{brand.title()} •••• {last4}"
    return (kind or "card").replace("_", " ").title() if kind else ""


def top_courses(f: Filters, limit: int | None = TOP) -> list[dict]:
    r = f.r
    window = Q(enrollments__enrolled_at__gte=r.start, enrollments__enrolled_at__lt=r.end)
    window &= f.scope_q("enrollments__")
    done = Q(enrollments__completed_at__gte=r.start, enrollments__completed_at__lt=r.end) & f.scope_q(
        "enrollments__"
    )
    rows = list(
        Course.objects.filter(f.courses())
        .annotate(n=Count("enrollments", filter=window), c=Count("enrollments", filter=done))
        .filter(Q(n__gt=0) | Q(c__gt=0) | Q(id__in=_items(f, r.start, r.end).values("course_id")))
        .select_related("category")
        .order_by("-n", "title")[:limit]
    )
    revenue = dict(
        _items(f, r.start, r.end)
        .filter(course_id__in=[c.id for c in rows])
        .values_list("course_id")
        .annotate(gbp=Sum("gbp_gross_minor"))
    )
    ratings = {
        row["course_id"]: row
        for row in Review.objects.filter(course_id__in=[c.id for c in rows], status="published")
        .values("course_id")
        .annotate(rating=Avg("rating"), n=Count("id"))
    }
    return [
        {"id": c.id, "title": c.title, "category": c.category.name if c.category_id else "",
         "enrolments": c.n, "completions": c.c, "revenue_gbp_minor": revenue.get(c.id, 0),
         "rating": float(ratings.get(c.id, {}).get("rating", 0)), "rating_count": ratings.get(c.id, {}).get("n", 0)}
        for c in rows
    ]  # fmt: skip


def plans(f: Filters, revenue: dict) -> list[dict]:
    r = f.r
    events = SubscriptionEvent.objects.filter(f.scope_q("subscription__"), at__gte=r.start, at__lt=r.end)
    started = dict(
        events.filter(kind="created")
        .values_list("subscription__plan_id")
        .annotate(n=Count("subscription_id", distinct=True))
    )
    cancelled = dict(
        events.filter(kind="cancelled")
        .values_list("subscription__plan_id")
        .annotate(n=Count("subscription_id", distinct=True))
    )
    active = dict(_live_subscriptions(f).values_list("plan_id").annotate(n=Count("id")))
    qs = Plan.objects.order_by("name")
    if f.scope == "personal":
        qs = qs.filter(Q(audience="personal") | Q(id__in=_current_subscriptions(f).values("plan_id")))
    elif f.scope == "company":
        qs = qs.filter(id__in=_current_subscriptions(f).values("plan_id"))
    return [
        {
            "id": p.id,
            "name": p.name,
            "active": active.get(p.id, 0),
            "started": started.get(p.id, 0),
            "cancelled": cancelled.get(p.id, 0),
            "revenue_gbp_minor": revenue.get(p.id, 0),
        }
        for p in qs
    ]


def build(f: Filters, *, complete: bool = False) -> dict:
    from .report_data import activity_users, financials, series, snapshot_kpi

    r = f.r
    s, e, ps, pe = r.start, r.end, r.previous_start, r.previous_end
    cur = financials(f, s, e, detail_limit=None if complete else TOP)
    prev = financials(f, ps, pe, detail_limit=0, exponents=cur["exponents"])
    from apps.identity.models import User

    students = User.objects.filter(is_staff=False, anonymized_at__isnull=True)
    enrol = Enrollment.objects.filter(f.courses("course__"), f.scope_q())
    previous_students = students
    # Scoped populations use enrolment evidence available by each period end.
    if f.filtered or f.scope != "all":
        previous_students = students.filter(id__in=enrol.filter(enrolled_at__lt=pe).values("user_id"))
        students = students.filter(id__in=enrol.filter(enrolled_at__lt=e).values("user_id"))
    courses = Course.objects.filter(f.courses(), status="published", deleted_at__isnull=True)
    by_type = (
        enrol.filter(enrolled_at__gte=s, enrolled_at__lt=e).values_list("source").annotate(n=Count("id"))
    )
    labels = dict(Enrollment.Source.choices)
    receipts = cur["receipts"]
    notices = list(dict.fromkeys(cur["notices"] + prev["notices"]))
    notices.extend(
        [
            "Published courses (across personal and company catalogues) and current billing subscriptions are current snapshots; historical comparisons are unavailable. Billing status does not establish content access.",
            "Subscription revenue uses paid invoice amounts by issue date and the currently linked plan; settlement dates and historical plan changes are not stored.",
            "Gross list value and discounts cover orders only. Collected revenue is after discounts and before successful refunds.",
            "Course revenue uses stored order-item allocations only; legacy packages without allocations cannot be assigned to courses.",
        ]
    )
    if f.filtered:
        notices.append(
            "Category and instructor filters apply to course allocations and learning. Subscription metrics are unavailable with these filters."
        )
    if f.filtered or f.scope != "all":
        notices.append(
            "Student totals and sign-ups describe accounts with enrolments in the selected scope by each period end, not all registered accounts."
        )
    live = _live_subscriptions(f)
    status_rows = (
        _current_subscriptions(f).values_list("status", "current_period_end") if not f.filtered else []
    )
    statuses = {}
    now = timezone.now()
    for status, expires in status_rows:
        key = (
            "expired"
            if status in ("active", "trialing", "past_due") and expires and expires <= now
            else status
        )
        statuses[key] = statuses.get(key, 0) + 1

    def financial_kpi(key):
        return kpi(cur[key], prev[key])

    return {
        "range": r.out(),
        "scope": f.scope,
        "filtered": f.filtered,
        "notices": notices,
        "currency_exponents": cur["exponents"],
        "gross_list_gbp_minor": financial_kpi("gross"),
        "discounts_gbp_minor": financial_kpi("discounts"),
        "net_collected_gbp_minor": kpi(cur["gbp"] - cur["refunds"], prev["gbp"] - prev["refunds"]),
        "revenue_gbp_minor": financial_kpi("gbp"),
        "course_revenue_gbp_minor": financial_kpi("course_gbp"),
        "subscription_revenue_gbp_minor": financial_kpi("subscription_gbp"),
        "refunds_gbp_minor": financial_kpi("refunds"),
        "orders": financial_kpi("orders"),
        "average_order_gbp_minor": kpi(
            cur["order_gbp"] // cur["orders"] if cur["orders"] else 0,
            prev["order_gbp"] // prev["orders"] if prev["orders"] else 0,
        ),
        "students": kpi(
            students.filter(created_at__lt=e).count(), previous_students.filter(created_at__lt=pe).count()
        ),
        "new_students": kpi(
            students.filter(created_at__gte=s, created_at__lt=e).count(),
            previous_students.filter(created_at__gte=ps, created_at__lt=pe).count(),
        ),
        "active_learners": kpi(activity_users(enrol, s, e), activity_users(enrol, ps, pe)),
        "courses": snapshot_kpi(courses.count()),
        "enrolments": kpi(
            enrol.filter(enrolled_at__gte=s, enrolled_at__lt=e).count(),
            enrol.filter(enrolled_at__gte=ps, enrolled_at__lt=pe).count(),
        ),
        "completions": kpi(
            enrol.filter(completed_at__gte=s, completed_at__lt=e).count(),
            enrol.filter(completed_at__gte=ps, completed_at__lt=pe).count(),
        ),
        "active_subscriptions": snapshot_kpi(live.count() if not f.filtered else 0),
        "subscription_statuses": [
            {"key": key, "label": key.replace("_", " ").title(), "value": value}
            for key, value in sorted(statuses.items())
        ],
        "revenue_series": series(s, e, cur["daily"]),
        "orders_series": series(s, e, cur["daily"], kind="order", counts=True),
        "subscription_series": series(s, e, cur["daily"], kind="subscription"),
        "students_series": metrics.created_series(students, "created_at", s, e),
        "enrolments_series": metrics.created_series(enrol, "enrolled_at", s, e),
        "enrolments_by_type": [
            {"key": key, "label": labels.get(key, key), "value": n}
            for key, n in sorted(by_type, key=lambda x: -x[1])
        ],
        "sales_by_product": [
            {
                "key": key,
                "label": label,
                "value": cur["by_product"].get(key, 0),
            }
            for key, label in (
                ("order", "Orders (courses and packages)"),
                ("subscription", "Subscriptions"),
                ("instalment", "Instalments"),
            )
        ],
        "revenue_by_currency": [
            {"key": code, "label": code, "value": amount}
            for code, amount in sorted(cur["currencies"].items())
        ],
        "top_courses": top_courses(f, None if complete else TOP),
        "recent_sales": receipts if complete else receipts[:TOP],
        "plans": [] if f.filtered else plans(f, cur["by_plan"]),
    }


@router.get("/reports", response=ConsoleAnalyticsOut)
def report(request, range: str = "30d", start: date | None = None, end: date | None = None,
           category: UUID | None = None, instructor: UUID | None = None, scope: str = "all", as_of: datetime | None = None):  # fmt: skip
    staff(request)
    return build(Filters(range, start, end, category, instructor, scope, as_of))


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
    return (
        "'" + s if s.lstrip()[:1] in ("=", "+", "-", "@", "\t", "\r", "\n") else s
    )  # no formulas in spreadsheets


def _pounds(minor: int) -> str:
    return f"{Decimal(minor or 0) / 100:.2f}"


def csv_rows(data: dict, types: list[str]):
    rng = data["range"]
    yield [
        "LearnHub report",
        f"{rng['start'].isoformat()} to {rng['end'].isoformat()} (end exclusive)",
        f"generated {timezone.now():%Y-%m-%d %H:%M}",
    ]
    yield ["Scope", data["scope"]]
    for notice in data["notices"]:
        yield ["Reporting note", notice]
    yield []
    yield ["Measure", "This period", "Previous period", "Change %"]
    kpis = [("Collected revenue (GBP; known historical values)", "revenue_gbp_minor", True), ("Course revenue (GBP)", "course_revenue_gbp_minor", True),
            ("Subscription revenue (GBP)", "subscription_revenue_gbp_minor", True), ("Refunds (GBP)", "refunds_gbp_minor", True),
            ("Orders", "orders", False), ("Average order (GBP)", "average_order_gbp_minor", True),
            ("Students", "students", False), ("New students", "new_students", False),
            ("Active learners", "active_learners", False), ("Published courses now", "courses", False),
            ("Enrolments", "enrolments", False), ("Completions", "completions", False),
            ("Current billing subscriptions", "active_subscriptions", False)]  # fmt: skip
    kpis += [
        ("Gross order list value (GBP)", "gross_list_gbp_minor", True),
        ("Order discounts (GBP)", "discounts_gbp_minor", True),
        ("Net collected (GBP; known historical values)", "net_collected_gbp_minor", True),
    ]
    groups = {
        "students": {"students", "new_students", "active_learners", "enrolments", "completions"},
        "courses": {"courses", "course_revenue_gbp_minor", "enrolments", "completions"},
        "subscriptions": {"active_subscriptions", "subscription_revenue_gbp_minor"},
        "sales": {
            "revenue_gbp_minor",
            "course_revenue_gbp_minor",
            "subscription_revenue_gbp_minor",
            "refunds_gbp_minor",
            "orders",
            "average_order_gbp_minor",
            "gross_list_gbp_minor",
            "discounts_gbp_minor",
            "net_collected_gbp_minor",
        },
    }
    selected_metrics = set().union(*(groups[section] for section in types))
    for label, key, money in kpis:
        if key not in selected_metrics or (
            data.get("filtered") and key in ("active_subscriptions", "subscription_revenue_gbp_minor")
        ):
            continue
        k = data[key]
        fmt = _pounds if money else str
        yield [
            label,
            fmt(k["value"]),
            "" if key in ("courses", "active_subscriptions") else fmt(k["previous"]),
            "" if k["change_pct"] is None else k["change_pct"],
        ]
    if "sales" in types:
        yield []
        yield ["Currency", "Collected receipts before refunds (native currency)"]
        for row in data["revenue_by_currency"]:
            exponent = data["currency_exponents"][row["key"]]
            yield [row["key"], f"{Decimal(row['value']) / (Decimal(10) ** exponent):.{exponent}f}"]
        yield []
        yield [
            "Day",
            "Collected revenue (GBP, includes subscriptions)",
            "Orders",
            "Subscription revenue (GBP, included)",
        ]
        for rev, orders, subs in zip(
            data["revenue_series"], data["orders_series"], data["subscription_series"], strict=True
        ):
            yield [rev["day"], _pounds(rev["value"]), orders["value"], _pounds(subs["value"])]
        yield []
        yield [
            "Sale reference",
            "Customer",
            "Product",
            "Amount",
            "Currency",
            "Payment method",
            "Date",
            "Status",
        ]
        for s in data["recent_sales"]:
            yield [s["reference"], s["customer"], s["product"], f'{Decimal(s["amount_minor"]) / (Decimal(10) ** s["exponent"]):.{s["exponent"]}f}', s["currency"], s["payment_method"],
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
    if "subscriptions" in types and not data.get("filtered"):
        yield []
        yield ["Subscription billing status now", "Subscriptions"]
        for row in data.get("subscription_statuses", []):
            yield [row["label"], row["value"]]
    if "subscriptions" in types and data["plans"]:
        yield []
        yield ["Plan", "Current billing", "Started", "Cancelled", "Revenue (GBP)"]
        for p in data["plans"]:
            yield [p["name"], p["active"], p["started"], p["cancelled"], _pounds(p["revenue_gbp_minor"])]


@router.get("/reports/export.csv")
def export(request, range: str = "30d", start: date | None = None, end: date | None = None,
           category: UUID | None = None, instructor: UUID | None = None, scope: str = "all", as_of: datetime | None = None, types: str = ",".join(SECTIONS)):  # fmt: skip
    staff(request)
    chosen = list(dict.fromkeys(types.split(",")))
    if not chosen or any(t not in SECTIONS for t in chosen):
        raise ServiceError("bad_filter", "Choose valid report sections.")
    f = Filters(range, start, end, category, instructor, scope, as_of)
    data = build(f, complete=True)
    writer = csv.writer(_Echo())
    audit_request(request, "report.export", "report", "console", {"range": range, "types": chosen,
                  "category": str(category or ""), "instructor": str(instructor or ""), "scope": scope,
                  "start": data["range"]["start"].isoformat(), "end": data["range"]["end"].isoformat()})  # fmt: skip
    response = StreamingHttpResponse(
        (writer.writerow([_cell(v) for v in row]) for row in csv_rows(data, chosen)),
        content_type="text/csv; charset=utf-8",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="learnhub-report-{timezone.localdate():%Y-%m-%d}.csv"'
    )
    response["Cache-Control"] = "no-store"
    return response
