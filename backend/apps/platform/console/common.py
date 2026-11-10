"""Shared pieces of the console API: the router, the staff check, date ranges and money."""

from datetime import date, datetime, time, timedelta
from uuid import UUID

from django.utils import timezone
from ninja import Field, Router, Schema
from ninja.security import SessionAuth

from core.errors import ServiceError
from core.permissions import require_staff


class StaffSessionAuth(SessionAuth):
    """The session cookie, and platform staff only: a learner, instructor or company admin
    is refused (403) before any request body is even read."""

    def authenticate(self, request, key):
        user = super().authenticate(request, key)
        if user and not user.is_staff:
            raise ServiceError("forbidden", "Staff only.", status=403)
        return user


router = Router(tags=["console"], auth=StaffSessionAuth())


def staff(request) -> None:
    """Every console endpoint starts with this: platform staff, on the console path only."""
    require_staff(request)
    if not getattr(request, "platform_staff", False):  # belt and braces: must be the console path
        raise ServiceError("forbidden", "Console only.", status=403)


def pct(bps):
    return None if bps is None else round(bps / 100, 2)


def clamp(limit: int, top: int = 200) -> int:
    return max(1, min(limit, top))


# ---------------------------------------------------------------- date ranges
class ConsoleRangeOut(Schema):
    start: datetime
    end: datetime
    previous_start: datetime
    previous_end: datetime
    days: int


class Range:
    """A reporting window and the window of the same length just before it (for
    "vs previous period"). `range` is 7d / 30d / 90d / 12m or custom with from/to dates."""

    def __init__(self, start: datetime, end: datetime):
        self.start, self.end = start, end
        span = end - start
        self.previous_start, self.previous_end = start - span, start
        self.days = max(1, round(span.total_seconds() / 86400))

    def out(self) -> dict:
        return {"start": self.start, "end": self.end, "previous_start": self.previous_start,
                "previous_end": self.previous_end, "days": self.days}  # fmt: skip


def parse_range(range: str = "30d", start: date | None = None, end: date | None = None) -> Range:
    now = timezone.now()
    if range == "custom":
        if not start or not end or end < start:
            raise ServiceError("bad_range", "Choose a start date before the end date.")
        if (end - start).days > 730:
            raise ServiceError("bad_range", "Choose at most two years.")
        tz = timezone.get_current_timezone()
        s = timezone.make_aware(datetime.combine(start, time.min), tz)
        e = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), tz)
        return Range(s, min(e, now))
    days = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}.get(range)
    if days is None:
        raise ServiceError("bad_range", "Unknown date range.")
    return Range(now - timedelta(days=days), now)


def change_pct(current: int | float, previous: int | float) -> float | None:
    """% change vs the previous period; None when there was nothing before."""
    if not previous:
        return None
    return round((current - previous) * 100 / previous, 1)


# ---------------------------------------------------------------- small shared schemas
class ConsoleOkOut(Schema):
    ok: bool = True


class ConsoleIdOut(Schema):
    id: UUID


class ConsoleStatusOut(Schema):
    status: str


class ConsoleReasonIn(Schema):
    reason: str = Field(..., min_length=3, max_length=300)


class ConsoleKpiOut(Schema):
    """One KPI with its value in the previous period (for the change badge)."""

    value: int
    previous: int
    change_pct: float | None


def kpi(current: int, previous: int) -> dict:
    return {
        "value": int(current or 0),
        "previous": int(previous or 0),
        "change_pct": change_pct(current or 0, previous or 0),
    }


class ConsolePointOut(Schema):
    """One point of a daily series (day = ISO date)."""

    day: date
    value: int
