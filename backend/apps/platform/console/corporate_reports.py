"""Console > Corporate Reports: admin dashboard aggregations and reporting."""

from datetime import date
from uuid import UUID

from ninja import Schema

from apps.corporate import reports as corp_reports

from .common import ConsoleKpiOut, ConsolePointOut, clamp, kpi, parse_range, router, staff


# ---- Schemas ----

class ConsoleCorporateOverview(Schema):
    revenue: ConsoleKpiOut
    seats_sold: ConsoleKpiOut
    allocations_made: ConsoleKpiOut
    active_cohorts: int
    pending_requests: int
    open_quotes: int


class ConsoleRevenuePoint(Schema):
    day: date
    revenue: int
    seats: int


class ConsoleCompanyRanking(Schema):
    org_id: UUID
    org_name: str
    total_spend: int
    total_seats: int
    purchase_count: int


class ConsoleAttendanceOut(Schema):
    id: UUID
    session_id: UUID
    session_sequence: int
    session_title: str
    user_id: UUID
    user_email: str
    user_name: str
    org_id: UUID
    org_name: str
    join_at: str
    leave_at: str | None = None
    duration_seconds: int
    match_status: str
    is_verified: bool
    source: str


# ---- Endpoints ----

@router.get("/corporate/reports/overview", response=ConsoleCorporateOverview)
def corporate_overview(request, range: str = "30d",
                       start: date | None = None, end: date | None = None):
    staff(request)
    r = parse_range(range, start, end)
    current = corp_reports.admin_overview(r.start, r.end)
    previous = corp_reports.admin_overview(r.previous_start, r.previous_end)

    return {
        "revenue": kpi(current["revenue_minor"], previous["revenue_minor"]),
        "seats_sold": kpi(current["seats_sold"], previous["seats_sold"]),
        "allocations_made": kpi(current["allocations_made"], previous["allocations_made"]),
        "active_cohorts": current["active_cohorts"],
        "pending_requests": current["pending_requests"],
        "open_quotes": current["open_quotes"],
    }


@router.get("/corporate/reports/revenue-series", response=list[ConsoleRevenuePoint])
def revenue_series(request, range: str = "30d",
                   start: date | None = None, end: date | None = None):
    staff(request)
    r = parse_range(range, start, end)
    return corp_reports.admin_revenue_series(r.start, r.end)


@router.get("/corporate/reports/company-rankings", response=list[ConsoleCompanyRanking])
def company_rankings(request, limit: int = 20):
    staff(request)
    data = corp_reports.admin_company_rankings(clamp(limit))
    return [
        {
            "org_id": row["org_id"],
            "org_name": row["org__name"],
            "total_spend": row["total_spend"],
            "total_seats": row["total_seats"],
            "purchase_count": row["purchase_count"],
        }
        for row in data
    ]


@router.get("/corporate/reports/attendance", response=list[ConsoleAttendanceOut])
def attendance_report(request, cohort_id: UUID | None = None,
                      session_id: UUID | None = None,
                      match_status: str | None = None,
                      limit: int = 100, offset: int = 0):
    staff(request)
    from apps.corporate.models import SessionAttendance
    qs = SessionAttendance.objects.select_related(
        "session", "user", "org",
    ).order_by("-join_at")
    if cohort_id:
        qs = qs.filter(session__cohort_id=cohort_id)
    if session_id:
        qs = qs.filter(session_id=session_id)
    if match_status:
        qs = qs.filter(match_status=match_status)
    items = qs[offset : offset + clamp(limit)]
    return [
        {
            "id": a.id,
            "session_id": a.session_id,
            "session_sequence": a.session.sequence,
            "session_title": a.session.title or f"Session {a.session.sequence}",
            "user_id": a.user_id,
            "user_email": a.user.email,
            "user_name": getattr(a.user, "full_name", a.user.email),
            "org_id": a.org_id,
            "org_name": a.org.name,
            "join_at": a.join_at.isoformat(),
            "leave_at": a.leave_at.isoformat() if a.leave_at else None,
            "duration_seconds": a.duration_seconds,
            "match_status": a.match_status,
            "is_verified": a.is_verified,
            "source": a.source,
        }
        for a in items
    ]


@router.post("/corporate/reports/attendance/{attendance_id}/verify")
def verify_attendance(request, attendance_id: UUID):
    staff(request)
    from apps.corporate.attendance import verify_attendance as _verify
    _verify(request, str(attendance_id))
    return {"ok": True}


@router.post("/corporate/reports/attendance/{attendance_id}/reject")
def reject_attendance(request, attendance_id: UUID):
    staff(request)
    from apps.corporate.attendance import reject_attendance as _reject
    _reject(request, str(attendance_id))
    return {"ok": True}
