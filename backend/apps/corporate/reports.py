"""B2B-06: Reporting selectors for corporate dashboards.

Aggregations used by console reporting endpoints and company-facing dashboards.
All queries are read-only; nothing mutates here.
"""

from __future__ import annotations

from datetime import datetime

from django.db.models import Count, Min, Q, Subquery, Sum
from django.db.models.functions import TruncDate

from .models import (
    AllocationEvent,
    CohortCompany,
    CorporateQuote,
    LiveCohort,
    SeatAllocation,
    SeatPurchase,
    Session,
    SessionAttendance,
    StageInstalment,
    TrainingRequest,
)
from .pending import held_count


def company_dashboard(org_id) -> dict:
    paid_purchases = SeatPurchase.objects.filter(org_id=org_id, status="paid")
    seat_purchases = SeatPurchase.objects.filter(org_id=org_id).filter(
        Q(status="paid") | Q(stage_access_enabled=True, status=SeatPurchase.Status.PARTIAL_PAID)
    )
    # Live places are tracked through cohort bookings, not the recorded-seat
    # inventory shown on the company dashboard and Seats page.
    recorded_purchases = seat_purchases.filter(offering__delivery_type="recorded")
    total_seats = recorded_purchases.aggregate(t=Sum("quantity"))["t"] or 0
    active_allocs = SeatAllocation.objects.filter(
        org_id=org_id,
        status__in=["allocated", "active"],
    ).count()

    live_bookings = CohortCompany.objects.filter(org_id=org_id).exclude(
        status__in=["cancelled", "withdrawn"],
    )
    active_cohorts = live_bookings.filter(status__in=["included", "paid", "active"]).count()
    pending_requests = TrainingRequest.objects.filter(
        org_id=org_id,
        status__in=["submitted", "under_review"],
    ).count()

    return {
        "total_seats_purchased": total_seats,
        "seats_allocated": active_allocs,
        # seats held for invited emails are not free to give
        "seats_available": max(0, total_seats - active_allocs - held_count(org_id)),
        "active_cohorts": active_cohorts,
        "pending_requests": pending_requests,
        "total_spend_minor": (
            paid_purchases.filter(stage_access_enabled=False).aggregate(s=Sum("total_minor"))["s"] or 0
        )
        + (
            StageInstalment.objects.filter(
                seat_purchase__org_id=org_id,
                seat_purchase__stage_access_enabled=True,
                status=StageInstalment.Status.PAID,
            ).aggregate(s=Sum("amount_minor"))["s"]
            or 0
        ),
    }


def company_employee_progress(org_id, offering_id=None) -> list[dict]:
    qs = SeatAllocation.objects.filter(
        org_id=org_id,
        status="active",
    ).select_related("user", "seat_purchase__offering__course", "enrollment")

    if offering_id:
        qs = qs.filter(seat_purchase__offering_id=offering_id)

    results = []
    for alloc in qs[:500]:
        enrollment = alloc.enrollment
        results.append(
            {
                "user_id": str(alloc.user_id),
                "user_email": alloc.user.email,
                "user_name": getattr(alloc.user, "full_name", alloc.user.email),
                "course_title": alloc.seat_purchase.offering.course.title,
                "enrollment_status": enrollment.status if enrollment else "pending",
                "progress_pct": int(round(enrollment.progress_pct or 0)) if enrollment else 0,
                "allocated_at": alloc.allocated_at.isoformat() if alloc.allocated_at else None,
                "activated_at": alloc.activated_at.isoformat() if alloc.activated_at else None,
            }
        )
    return results


def company_attendance_summary(org_id, cohort_id=None) -> list[dict]:
    qs = SessionAttendance.objects.filter(org_id=org_id).select_related(
        "session__cohort__course",
        "user",
    )
    if cohort_id:
        qs = qs.filter(session__cohort_id=cohort_id)

    results = []
    for att in qs.order_by("-join_at")[:500]:
        results.append(
            {
                "user_email": att.user.email,
                "user_name": getattr(att.user, "full_name", att.user.email),
                "session_title": att.session.title or f"Session {att.session.sequence}",
                "course_title": att.session.cohort.course.title,
                "join_at": att.join_at.isoformat(),
                "leave_at": att.leave_at.isoformat() if att.leave_at else None,
                "duration_seconds": att.duration_seconds,
                "match_status": att.match_status,
            }
        )
    return results


# ---- Platform admin aggregations ----


def admin_overview(start: datetime, end: datetime) -> dict:
    period_purchases = SeatPurchase.objects.filter(
        status="paid",
        stage_access_enabled=False,
        paid_at__gte=start,
        paid_at__lt=end,
    )
    staged_payments = StageInstalment.objects.filter(
        seat_purchase__stage_access_enabled=True,
        status=StageInstalment.Status.PAID,
        paid_at__gte=start,
        paid_at__lt=end,
    )
    revenue = (period_purchases.aggregate(r=Sum("total_minor"))["r"] or 0) + (
        staged_payments.aggregate(r=Sum("amount_minor"))["r"] or 0
    )
    first_paid_purchase_ids = (
        StageInstalment.objects.filter(
            seat_purchase__stage_access_enabled=True, status=StageInstalment.Status.PAID
        )
        .values("seat_purchase_id")
        .annotate(first_paid=Min("paid_at"))
        .filter(first_paid__gte=start, first_paid__lt=end)
        .values("seat_purchase_id")
    )
    seats_sold = (period_purchases.aggregate(s=Sum("quantity"))["s"] or 0) + (
        SeatPurchase.objects.filter(pk__in=Subquery(first_paid_purchase_ids)).aggregate(s=Sum("quantity"))[
            "s"
        ]
        or 0
    )

    allocations_made = AllocationEvent.objects.filter(
        action="allocated",
        created_at__gte=start,
        created_at__lt=end,
    ).count()

    active_cohorts = LiveCohort.objects.filter(
        status__in=["confirmed", "in_progress"],
    ).count()

    pending_requests = TrainingRequest.objects.filter(
        status__in=["submitted", "under_review"],
    ).count()

    open_quotes = CorporateQuote.objects.filter(status="sent").count()

    return {
        "revenue_minor": revenue,
        "seats_sold": seats_sold,
        "allocations_made": allocations_made,
        "active_cohorts": active_cohorts,
        "pending_requests": pending_requests,
        "open_quotes": open_quotes,
    }


def admin_revenue_series(start: datetime, end: datetime) -> list[dict]:
    legacy_rows = list(
        SeatPurchase.objects.filter(
            status="paid", stage_access_enabled=False, paid_at__gte=start, paid_at__lt=end
        )
        .annotate(day=TruncDate("paid_at"))
        .values("day")
        .annotate(revenue=Sum("total_minor"), seats=Sum("quantity"))
        .order_by("day")
    )
    revenue_by_day = {row["day"]: row for row in legacy_rows}
    for row in (
        StageInstalment.objects.filter(
            seat_purchase__stage_access_enabled=True,
            status=StageInstalment.Status.PAID,
            paid_at__gte=start,
            paid_at__lt=end,
        )
        .annotate(day=TruncDate("paid_at"))
        .values("day")
        .annotate(revenue=Sum("amount_minor"))
    ):
        target = revenue_by_day.setdefault(row["day"], {"day": row["day"], "revenue": 0, "seats": 0})
        target["revenue"] += row["revenue"] or 0
    for row in (
        StageInstalment.objects.filter(
            seat_purchase__stage_access_enabled=True, status=StageInstalment.Status.PAID
        )
        .values("seat_purchase_id")
        .annotate(first_paid=Min("paid_at"))
        .filter(first_paid__gte=start, first_paid__lt=end)
        .annotate(day=TruncDate("first_paid"))
        .values("day")
        .annotate(seats=Sum("seat_purchase__quantity"))
    ):
        target = revenue_by_day.setdefault(row["day"], {"day": row["day"], "revenue": 0, "seats": 0})
        target["seats"] += row["seats"] or 0
    return sorted(revenue_by_day.values(), key=lambda row: row["day"])


def admin_company_rankings(limit=20) -> list[dict]:
    legacy_rows = list(
        SeatPurchase.objects.filter(status="paid", stage_access_enabled=False)
        .values("org_id", "org__name")
        .annotate(
            total_spend=Sum("total_minor"),
            total_seats=Sum("quantity"),
            purchase_count=Count("id"),
        )
    )
    by_org = {row["org_id"]: row for row in legacy_rows}
    staged = (
        StageInstalment.objects.filter(
            seat_purchase__stage_access_enabled=True, status=StageInstalment.Status.PAID
        )
        .values("seat_purchase__org_id", "seat_purchase__org__name")
        .annotate(total_spend=Sum("amount_minor"))
    )
    for row in staged:
        org_id = row["seat_purchase__org_id"]
        target = by_org.setdefault(
            org_id,
            {
                "org_id": org_id,
                "org__name": row["seat_purchase__org__name"],
                "total_spend": 0,
                "total_seats": 0,
                "purchase_count": 0,
            },
        )
        target["total_spend"] += row["total_spend"] or 0
    first_paid = (
        StageInstalment.objects.filter(
            seat_purchase__stage_access_enabled=True, status=StageInstalment.Status.PAID
        )
        .values("seat_purchase_id")
        .annotate(first_paid=Min("paid_at"))
        .values("seat_purchase_id")
    )
    for row in SeatPurchase.objects.filter(pk__in=Subquery(first_paid)).values("org_id", "quantity"):
        target = by_org[row["org_id"]]
        target["total_seats"] += row["quantity"]
        target["purchase_count"] += 1
    return sorted(by_org.values(), key=lambda row: row["total_spend"], reverse=True)[:limit]


def tutor_cohort_learners(tutor_user_id, cohort_id) -> list[dict]:
    from .models import TutorAssignment

    if not TutorAssignment.objects.filter(
        tutor__user_id=tutor_user_id,
        cohort_id=cohort_id,
    ).exists():
        from core.errors import ServiceError

        raise ServiceError("forbidden", "Not assigned to this cohort.", status=403)

    companies = (
        CohortCompany.objects.filter(
            cohort_id=cohort_id,
        )
        .exclude(status__in=["cancelled", "withdrawn"])
        .values_list("org_id", flat=True)
    )

    allocs = SeatAllocation.objects.filter(
        org_id__in=companies,
        status="active",
        seat_purchase__offering__course_id=LiveCohort.objects.filter(pk=cohort_id).values("course_id"),
    ).select_related("user")

    return [
        {
            "user_id": str(a.user_id),
            "user_name": getattr(a.user, "full_name", a.user.email),
        }
        for a in allocs[:200]
    ]


def tutor_attendance_report(tutor_user_id, cohort_id) -> list[dict]:
    from .models import TutorAssignment

    if not TutorAssignment.objects.filter(
        tutor__user_id=tutor_user_id,
        cohort_id=cohort_id,
    ).exists():
        from core.errors import ServiceError

        raise ServiceError("forbidden", "Not assigned to this cohort.", status=403)

    sessions = Session.objects.filter(cohort_id=cohort_id).values_list("id", flat=True)
    records = (
        SessionAttendance.objects.filter(
            session_id__in=sessions,
        )
        .select_related("user", "session")
        .order_by("session__sequence", "user__email")
    )

    return [
        {
            "session_sequence": att.session.sequence,
            "session_title": att.session.title or f"Session {att.session.sequence}",
            "user_name": getattr(att.user, "full_name", att.user.email),
            "join_at": att.join_at.isoformat(),
            "duration_seconds": att.duration_seconds,
            "match_status": att.match_status,
        }
        for att in records[:1000]
    ]
