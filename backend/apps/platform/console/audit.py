"""Console > Audit log: every staff and company action, newest first (keyset), with
filters (actor, company, action, dates, target) and a CSV export of the same view."""

import csv
import json
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from django.db import connection
from django.http import HttpResponse
from django.utils import timezone
from ninja import Schema

from core import cursor as keyset
from core.errors import ServiceError

from ..services import audit_request
from .common import clamp, router, staff


class ConsoleAuditRowOut(Schema):
    id: int
    created_at: datetime
    actor_id: UUID | None
    actor_email: str | None
    actor_name: str | None
    org_id: UUID | None
    company: str | None
    action: str
    target_type: str
    target_id: str
    ip: str | None
    request_id: str
    data: dict[str, Any]


class ConsoleAuditPageOut(Schema):
    items: list[ConsoleAuditRowOut]
    next_cursor: str | None


class ConsoleAuditActionOut(Schema):
    action: str
    count: int


def _day(d: date, end: bool = False) -> datetime:
    tz = timezone.get_current_timezone()
    return timezone.make_aware(datetime.combine(d + timedelta(days=1) if end else d, time.min), tz)


def _where(*, org_id, actor, action, start, end, target, q) -> tuple[list[str], list]:
    sql, params = ["WHERE true"], []
    if org_id:
        sql.append("AND a.org_id = %s")
        params.append(str(org_id))
    if actor:
        term = actor.strip()[:100]
        try:
            UUID(term)
            sql.append("AND a.actor_id = %s")
            params.append(term)
        except ValueError:
            sql.append("AND (u.email ILIKE %s OR u.full_name ILIKE %s)")
            params += [f"%{term}%", f"%{term}%"]
    if action:
        sql.append("AND a.action LIKE %s")
        params.append(action.replace("%", "").replace("_", r"\_")[:80] + "%")
    if start:
        sql.append("AND a.created_at >= %s")
        params.append(_day(start))
    if end:
        sql.append("AND a.created_at < %s")
        params.append(_day(end, end=True))
    if target:
        sql.append("AND (a.target_id = %s OR a.target_type = %s)")
        params += [target.strip()[:64], target.strip()[:60]]
    if q and q.strip():
        sql.append("AND (a.action ILIKE %s OR a.target_id ILIKE %s OR a.data::text ILIKE %s)")
        term = f"%{q.strip()[:100]}%"
        params += [term, term, term]
    if start and end and end < start:
        raise ServiceError("bad_range", "Choose a start date before the end date.")
    return sql, params


SELECT = (
    "SELECT a.id, a.created_at, a.actor_id, u.email, u.full_name, a.org_id, o.name, a.action, a.target_type,"
    " a.target_id, a.ip, a.request_id, a.data FROM platform.audit_logs a"
    " LEFT JOIN identity.users u ON u.id = a.actor_id LEFT JOIN org.organizations o ON o.id = a.org_id"
)


def _row(r) -> dict:
    return {"id": r[0], "created_at": r[1], "actor_id": r[2], "actor_email": r[3], "actor_name": r[4] or None,
            "org_id": r[5], "company": r[6], "action": r[7], "target_type": r[8], "target_id": r[9],
            "ip": str(r[10]) if r[10] else None, "request_id": r[11],
            "data": r[12] if isinstance(r[12], dict) else json.loads(r[12] or "{}")}  # fmt: skip


@router.get("/audit", response=ConsoleAuditPageOut)
def audit(request, org_id: UUID | None = None, actor: str | None = None, action: str | None = None,
          start: date | None = None, end: date | None = None, target: str | None = None, q: str | None = None,
          cursor: str | None = None, limit: int = 50):  # fmt: skip
    staff(request)
    limit = clamp(limit, 200)
    where, params = _where(
        org_id=org_id, actor=actor, action=action, start=start, end=end, target=target, q=q
    )
    after = keyset.decode(cursor, 2)
    if after:
        where.append("AND (a.created_at, a.id) < (%s::timestamptz, %s::bigint)")
        params += after
    with connection.cursor() as cur:
        cur.execute(
            " ".join([SELECT, *where, "ORDER BY a.created_at DESC, a.id DESC LIMIT %s"]), [*params, limit + 1]
        )
        rows = cur.fetchall()
    page = rows[:limit]
    return {
        "items": [_row(r) for r in page],
        "next_cursor": keyset.encode(page[-1][1].isoformat(), page[-1][0]) if len(rows) > limit else None,
    }


@router.get("/audit/actions", response=list[ConsoleAuditActionOut])
def actions(request):
    """The action names used in the last 90 days (for the filter), most common first."""
    staff(request)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT action, COUNT(*) FROM platform.audit_logs WHERE created_at >= now() - interval '90 days'"
            " GROUP BY action ORDER BY COUNT(*) DESC, action LIMIT 200"
        )
        return [{"action": a, "count": n} for a, n in cur.fetchall()]


@router.get("/audit/export.csv", include_in_schema=False)
def export(request, org_id: UUID | None = None, actor: str | None = None, action: str | None = None,
           start: date | None = None, end: date | None = None, target: str | None = None, q: str | None = None):  # fmt: skip
    """The same view as the table, up to 10,000 rows. The export itself is audited."""
    staff(request)
    where, params = _where(
        org_id=org_id, actor=actor, action=action, start=start, end=end, target=target, q=q
    )
    with connection.cursor() as cur:
        cur.execute(" ".join([SELECT, *where, "ORDER BY a.created_at DESC, a.id DESC LIMIT 10000"]), params)
        rows = [_row(r) for r in cur.fetchall()]
    audit_request(
        request, "audit.export", "audit_log", "-", {"rows": len(rows), "action": action, "actor": actor}
    )
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="audit-log.csv"'
    response["Cache-Control"] = "no-store"
    w = csv.writer(response)
    w.writerow(["When (UTC)", "Actor", "Company", "Action", "Target type", "Target", "IP", "Details"])
    for r in rows:
        cells = [r["created_at"].isoformat(), r["actor_email"] or "system", r["company"] or "", r["action"],
                 r["target_type"], r["target_id"], r["ip"] or "", json.dumps(r["data"], default=str)]  # fmt: skip
        w.writerow([("'" + c) if c[:1] in ("=", "+", "-", "@") else c for c in map(str, cells)])
    return response
