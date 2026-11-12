"""B2B-06: Reporting selectors for corporate dashboards.

Aggregations used by console reporting endpoints and company-facing dashboards.
All queries are read-only; nothing mutates here.
"""

from __future__ import annotations

from datetime import datetime

from django.db.models import Count, Sum
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
    TrainingRequest,
)


def company_dashboard(org_id) -> dict:
    paid_purchases = SeatPurchase.objects.filter(org_id=org_id, status="paid")
    total_seats = paid_purchases.aggregate(t=Sum("quantity"))["t"] or 0
    active_allocs = SeatAllocation.objects.filter(
        org_id=org_id,
        status__in=["allocated", "active"],
    ).count()

    live_bookings = CohortCompany.objects.filter(org_id=org_id).exclude(
        status__in=["cancelled", "withdrawn"],
    )
    active_cohorts = live_bookings.filter(status__in=["paid", "active"]).count()
    pending_requests = TrainingRequest.objects.filter(
        org_id=org_id,
        status__in=["submitted", "under_review"],
    ).count()

    return {
        "total_seats_purchased": total_seats,
        "seats_allocated": active_allocs,
        "seats_available": max(0, total_seats - active_allocs),
        "active_cohorts": active_cohorts,
        "pending_requests": pending_requests,
        "total_spend_minor": paid_purchases.aggregate(s=Sum("total_minor"))["s"] or 0,
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
                "progress_pct": getattr(enrollment, "progress_pct", 0) if enrollment else 0,
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
        paid_at__gte=start,
        paid_at__lt=end,
    )
    revenue = period_purchases.aggregate(r=Sum("total_minor"))["r"] or 0
    seats_sold = period_purchases.aggregate(s=Sum("quantity"))["s"] or 0

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
    return list(
        SeatPurchase.objects.filter(status="paid", paid_at__gte=start, paid_at__lt=end)
        .annotate(day=TruncDate("paid_at"))
        .values("day")
        .annotate(revenue=Sum("total_minor"), seats=Sum("quantity"))
        .order_by("day")
    )


def admin_company_rankings(limit=20) -> list[dict]:
    return list(
        SeatPurchase.objects.filter(status="paid")
        .values("org_id", "org__name")
        .annotate(
            total_spend=Sum("total_minor"),
            total_seats=Sum("quantity"),
            purchase_count=Count("id"),
        )
        .order_by("-total_spend")[:limit]
    )


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
