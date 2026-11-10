"""Console > Communications (mockup 36): support tickets, notifications (sent log and the
broadcast composer), announcements (with an optional site banner) and notification
templates (wording checked against apps.engagement.wording)."""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from django.db import connection
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.engagement import broadcasts, notify, wording
from apps.engagement import services as social
from apps.engagement import tickets as ticket_files
from apps.engagement.models import Broadcast, Notification, NotificationTemplate, Ticket, TicketMessage
from apps.identity.models import User
from apps.org.models import Organization
from core import cursor as keyset
from core import html
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleIdOut, ConsoleKpiOut, ConsoleOkOut, clamp, kpi, router, staff


# ---------------------------------------------------------------- schemas
class ConsoleStaffReplyIn(Schema):
    body: str = Field("", max_length=20000)  # rich text (cleaned)
    internal: bool = False
    attachment_id: UUID | None = None


class ConsoleTicketPatch(Schema):
    status: str | None = None
    priority: str | None = None
    assign_to_me: bool = False


class ConsoleTicketCreateIn(Schema):
    user_email: str = Field(..., max_length=320)
    subject: str = Field(..., min_length=3, max_length=200)
    category: str
    priority: str = "normal"
    body: str = Field(..., min_length=1, max_length=20000)


class ConsoleTicketRowOut(Schema):
    id: UUID
    reference: str
    subject: str
    category: str
    status: str
    priority: str
    requester: str
    requester_name: str
    assigned_to: str | None
    created_at: datetime
    last_message_at: datetime


class ConsoleTicketPageOut(Schema):
    items: list[ConsoleTicketRowOut]
    next_cursor: str | None
    total: int


class ConsoleTicketKpisOut(Schema):
    open: int
    in_progress: int
    waiting: int
    resolved_month: ConsoleKpiOut
    avg_first_response_minutes: int | None
    avg_first_response_previous: int | None


class ConsoleRequesterOut(Schema):
    id: UUID
    email: str
    name: str


class ConsoleTicketFileOut(Schema):
    id: UUID
    name: str
    size_bytes: int


class ConsoleTicketMessageOut(Schema):
    id: UUID
    author: str
    is_staff: bool
    body: str
    body_html: str
    internal: bool
    attachment: ConsoleTicketFileOut | None
    created_at: datetime


class ConsoleTicketOut(Schema):
    id: UUID
    reference: str
    subject: str
    category: str
    status: str
    priority: str
    created_at: datetime
    assigned_to: str | None
    requester: ConsoleRequesterOut
    messages: list[ConsoleTicketMessageOut]


class ConsoleUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., ge=1)


class ConsoleUploadOut(Schema):
    asset_id: UUID
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class ConsoleFileUrlOut(Schema):
    url: str


class ConsoleNotificationRowOut(Schema):
    id: UUID
    kind: str
    title: str
    recipient: str
    created_at: datetime
    read: bool
    emailed: bool


class ConsoleNotificationPageOut(Schema):
    items: list[ConsoleNotificationRowOut]
    next_cursor: str | None


class ConsoleNotificationStatOut(Schema):
    sent_30d: int
    read_pct: float | None
    emailed_30d: int
    broadcasts_30d: int


class ConsoleBroadcastIn(Schema):
    kind: str = "broadcast"
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=5000)
    audience: str
    org_id: UUID | None = None
    send_in_app: bool = True
    send_email: bool = False
    url: str = Field("", max_length=500)
    show_as_banner: bool = False
    banner_starts_at: datetime | None = None
    banner_ends_at: datetime | None = None


class ConsoleAudienceOut(Schema):
    audience: str
    count: int


class ConsoleBroadcastOut(Schema):
    id: UUID
    kind: str
    title: str
    body: str
    audience: str
    company: str | None
    send_in_app: bool
    send_email: bool
    url: str
    show_as_banner: bool
    banner_starts_at: datetime | None
    banner_ends_at: datetime | None
    banner_live: bool
    sent_by: str
    sent_at: datetime | None
    recipient_count: int
    read_count: int


class ConsoleTemplateIn(Schema):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=5000)
    email_enabled: bool = True
    is_active: bool = True


class ConsoleTemplatePreviewIn(Schema):
    title: str = Field(..., max_length=200)
    body: str = Field(..., max_length=5000)


class ConsoleTemplatePreviewOut(Schema):
    title: str
    body: str


class ConsoleTemplateOut(Schema):
    code: str
    audience: str
    title: str
    body: str
    email_enabled: bool
    is_active: bool
    placeholders: list[str]
    sample: dict[str, Any]
    default_title: str
    default_body: str
    updated_at: datetime


# ---------------------------------------------------------------- tickets
def _month_start(now):
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _first_response_minutes(start, end) -> int | None:
    """Average minutes from a ticket being opened to the first staff reply (not a note),
    for tickets opened in [start, end)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT AVG(EXTRACT(EPOCH FROM (f.first_at - t.created_at)) / 60)
              FROM engagement.tickets t
              JOIN LATERAL (
                   SELECT MIN(m.created_at) AS first_at
                     FROM engagement.ticket_messages m JOIN identity.users u ON u.id = m.author_id
                    WHERE m.ticket_id = t.id AND NOT m.is_internal AND u.is_staff AND m.author_id <> t.user_id
                   ) f ON f.first_at IS NOT NULL
             WHERE t.created_at >= %s AND t.created_at < %s
            """,
            [start, end],
        )
        v = cur.fetchone()[0]
    return None if v is None else round(float(v))


@router.get("/tickets/kpis", response=ConsoleTicketKpisOut)
def ticket_kpis(request):
    staff(request)
    now = timezone.now()
    month = _month_start(now)
    prev = _month_start(month - timedelta(days=1))
    counts = Ticket.objects.aggregate(
        open=Count("id", filter=Q(status="open")), progress=Count("id", filter=Q(status="progress")),
        waiting=Count("id", filter=Q(status="waiting")),
        res_now=Count("id", filter=Q(resolved_at__gte=month, status__in=("resolved", "closed"))),
        res_prev=Count("id", filter=Q(resolved_at__gte=prev, resolved_at__lt=month, status__in=("resolved", "closed"))),
    )  # fmt: skip
    return {
        "open": counts["open"], "in_progress": counts["progress"], "waiting": counts["waiting"],
        "resolved_month": kpi(counts["res_now"], counts["res_prev"]),
        "avg_first_response_minutes": _first_response_minutes(month, now),
        "avg_first_response_previous": _first_response_minutes(prev, month),
    }  # fmt: skip


@router.get("/tickets", response=ConsoleTicketPageOut)
def tickets(request, status: str | None = None, category: str | None = None, priority: str | None = None,
            q: str | None = None, mine: bool = False, cursor: str | None = None, limit: int = 25):  # fmt: skip
    """The queue, newest activity first (keyset). `status=active` is open + in progress +
    waiting; search matches the reference, subject or the requester's name or email."""
    staff(request)
    qs = Ticket.objects.select_related("user", "assigned_to")
    if status == "active":
        qs = qs.filter(status__in=("open", "progress", "waiting"))
    elif status:
        qs = qs.filter(status=status)
    if category:
        qs = qs.filter(category=category)
    if priority:
        qs = qs.filter(priority=priority)
    if mine:
        qs = qs.filter(assigned_to=request.user)
    if q and q.strip():
        term = q.strip()[:100]
        qs = qs.filter(Q(reference__iexact=term) | Q(subject__icontains=term) | Q(user__email__icontains=term)
                       | Q(user__full_name__icontains=term))  # fmt: skip
    total = qs.count()
    limit = clamp(limit, 100)
    after = keyset.decode(cursor, 2)
    if after:
        qs = qs.filter(Q(last_message_at__lt=after[0]) | Q(last_message_at=after[0], id__lt=after[1]))
    rows = list(qs.order_by("-last_message_at", "-id")[: limit + 1])
    page = rows[:limit]
    items = [{"id": t.id, "reference": t.reference, "subject": t.subject, "category": t.category, "status": t.status,
              "priority": t.priority, "requester": t.user.email, "requester_name": t.user.full_name or t.user.email,
              "assigned_to": t.assigned_to.full_name if t.assigned_to else None, "created_at": t.created_at,
              "last_message_at": t.last_message_at} for t in page]  # fmt: skip
    nxt = keyset.encode(page[-1].last_message_at.isoformat(), str(page[-1].id)) if len(rows) > limit else None
    return {"items": items, "next_cursor": nxt, "total": total}


@router.post("/tickets", response=ConsoleIdOut)
def create_ticket(request, body: ConsoleTicketCreateIn):
    """Open a ticket on someone's behalf (they are told, and can reply from Help)."""
    staff(request)
    user = User.objects.filter(email__iexact=body.user_email.strip(), is_active=True).first()
    if user is None:
        raise ServiceError("no_user", "No active account uses that email.")
    t = social.open_ticket_for(user=user, by=request.user, subject=body.subject, category=body.category,
                               body=body.body, priority=body.priority)  # fmt: skip
    audit_request(request, "ticket.create", "ticket", t.id, {"for": user.email, "reference": t.reference})
    return {"id": t.id}


@router.get("/tickets/{ticket_id}", response=ConsoleTicketOut)
def ticket(request, ticket_id: UUID):
    staff(request)
    t = get_object_or_404(Ticket.objects.select_related("user", "assigned_to"), pk=ticket_id)
    msgs = (
        TicketMessage.objects.filter(ticket=t).select_related("author", "attachment").order_by("created_at")
    )
    return {"id": t.id, "reference": t.reference, "subject": t.subject, "category": t.category, "status": t.status,
            "priority": t.priority, "created_at": t.created_at,
            "assigned_to": t.assigned_to.full_name if t.assigned_to else None,
            "requester": {"id": t.user_id, "email": t.user.email, "name": t.user.full_name},
            "messages": [{"id": m.id, "author": m.author.full_name or m.author.email, "is_staff": m.author.is_staff,
                          "body": m.body, "body_html": social.message_html(m.body), "internal": m.is_internal,
                          "attachment": ticket_files.attachment_out(m), "created_at": m.created_at}
                         for m in msgs]}  # fmt: skip


@router.post("/tickets/{ticket_id}/uploads", response=ConsoleUploadOut)
def ticket_upload(request, ticket_id: UUID, body: ConsoleUploadIn):
    staff(request)
    t = get_object_or_404(Ticket, pk=ticket_id)
    return ticket_files.start_attachment(ticket=t, user=request.user, filename=body.filename,
                                         size_bytes=body.size_bytes)  # fmt: skip


@router.get("/tickets/{ticket_id}/messages/{message_id}/file", response=ConsoleFileUrlOut)
def ticket_file(request, ticket_id: UUID, message_id: UUID):
    staff(request)
    m = get_object_or_404(
        TicketMessage.objects.select_related("attachment"), pk=message_id, ticket_id=ticket_id
    )
    return {"url": ticket_files.download_link(m)}


@router.post("/tickets/{ticket_id}/messages", response=ConsoleIdOut)
def staff_reply(request, ticket_id: UUID, body: ConsoleStaffReplyIn):
    """A reply (the requester is told) or an internal note (staff only)."""
    staff(request)
    t = get_object_or_404(Ticket, pk=ticket_id)
    m = social.reply(ticket=t, author=request.user, body=body.body, internal=body.internal,
                     attachment_id=body.attachment_id)  # fmt: skip
    audit_request(request, "ticket.note" if body.internal else "ticket.reply", "ticket", t.id,
                  {"reference": t.reference, "attachment": bool(body.attachment_id)})  # fmt: skip
    return {"id": m.id}


@router.patch("/tickets/{ticket_id}", response=ConsoleOkOut)
def update_ticket(request, ticket_id: UUID, body: ConsoleTicketPatch):
    staff(request)
    t = get_object_or_404(Ticket, pk=ticket_id)
    changes: dict = {}
    if body.status and body.status != t.status:
        social.set_ticket_status(ticket=t, status=body.status, by=request.user)
        changes["status"] = body.status
    if body.priority and body.priority != t.priority:
        if body.priority not in Ticket.Priority.values:
            raise ServiceError("bad_priority", "Unknown priority.")
        Ticket.objects.filter(pk=t.pk).update(priority=body.priority, updated_at=timezone.now())
        changes["priority"] = body.priority
    if body.assign_to_me:
        social.assign_ticket(ticket=t, agent=request.user)
        changes["assigned_to"] = request.user.email
    if changes:
        audit_request(request, "ticket.update", "ticket", t.id, {"reference": t.reference, **changes})
    return {"ok": True}


# ---------------------------------------------------------------- notifications log
@router.get("/notifications/stats", response=ConsoleNotificationStatOut)
def notification_stats(request):
    staff(request)
    since = timezone.now() - timedelta(days=30)
    agg = Notification.objects.filter(created_at__gte=since).aggregate(
        n=Count("id"), read=Count("id", filter=Q(read_at__isnull=False)),
        emailed=Count("id", filter=Q(emailed_at__isnull=False)),
    )  # fmt: skip
    return {
        "sent_30d": agg["n"], "read_pct": round(agg["read"] * 100 / agg["n"], 1) if agg["n"] else None,
        "emailed_30d": agg["emailed"],
        "broadcasts_30d": Broadcast.objects.filter(sent_at__gte=since).count(),
    }  # fmt: skip


@router.get("/notifications", response=ConsoleNotificationPageOut)
def notification_log(request, kind: str | None = None, q: str | None = None, cursor: str | None = None,
                     limit: int = 50):  # fmt: skip
    """Every notification sent, newest first: what, to whom, read or not, emailed or not."""
    staff(request)
    qs = Notification.objects.select_related("user")
    if kind:
        qs = qs.filter(kind=kind)
    if q and q.strip():
        term = q.strip()[:100]
        qs = qs.filter(Q(user__email__icontains=term) | Q(title__icontains=term))
    limit = clamp(limit, 200)
    after = keyset.decode(cursor, 2)
    if after:
        qs = qs.filter(Q(created_at__lt=after[0]) | Q(created_at=after[0], id__lt=after[1]))
    rows = list(qs.order_by("-created_at", "-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": [{"id": n.id, "kind": n.kind, "title": n.title, "recipient": n.user.email, "created_at": n.created_at,
                   "read": n.read_at is not None, "emailed": n.emailed_at is not None} for n in page],
        "next_cursor": keyset.encode(page[-1].created_at.isoformat(), str(page[-1].id)) if len(rows) > limit else None,
    }  # fmt: skip


# ---------------------------------------------------------------- broadcasts & announcements
def _broadcast_out(b: Broadcast, reads: dict) -> dict:
    now = timezone.now()
    live = bool(b.show_as_banner and b.banner_starts_at and b.banner_starts_at <= now
                and (b.banner_ends_at is None or b.banner_ends_at > now))  # fmt: skip
    return {"id": b.id, "kind": b.kind, "title": b.title, "body": b.body, "audience": b.audience,
            "company": b.org.name if b.org_id else None, "send_in_app": b.send_in_app, "send_email": b.send_email,
            "url": b.url, "show_as_banner": b.show_as_banner, "banner_starts_at": b.banner_starts_at,
            "banner_ends_at": b.banner_ends_at, "banner_live": live,
            "sent_by": b.sent_by.full_name or b.sent_by.email, "sent_at": b.sent_at,
            "recipient_count": b.recipient_count, "read_count": reads.get(f"broadcast:{b.id}", 0)}  # fmt: skip


@router.get("/broadcasts", response=list[ConsoleBroadcastOut])
def broadcast_list(request, kind: str = "broadcast"):
    staff(request)
    rows = list(
        Broadcast.objects.filter(kind=kind).select_related("org", "sent_by").order_by("-created_at")[:100]
    )
    keys = [f"broadcast:{b.id}" for b in rows]
    reads = dict(
        Notification.objects.filter(kind="broadcast", dedupe_key__in=keys, read_at__isnull=False)
        .values("dedupe_key").annotate(n=Count("id")).values_list("dedupe_key", "n")
    )  # fmt: skip
    return [_broadcast_out(b, reads) for b in rows]


@router.get("/broadcasts/audience", response=ConsoleAudienceOut)
def audience_count(request, audience: str, org_id: UUID | None = None):
    """How many people a broadcast would reach (shown in the confirmation)."""
    staff(request)
    return {"audience": audience, "count": len(broadcasts.audience_ids(audience, org_id))}


@router.post("/broadcasts", response=ConsoleBroadcastOut)
def send_broadcast(request, body: ConsoleBroadcastIn):
    staff(request)
    b = broadcasts.send(by=request.user, **body.dict())
    audit_request(request, f"{b.kind}.send", "broadcast", b.id,
                  {"title": b.title, "audience": b.audience, "recipients": b.recipient_count,
                   "in_app": b.send_in_app, "email": b.send_email, "banner": b.show_as_banner})  # fmt: skip
    b = Broadcast.objects.select_related("org", "sent_by").get(pk=b.pk)
    return _broadcast_out(b, {})


@router.post("/broadcasts/{broadcast_id}/end-banner", response=ConsoleOkOut)
def end_banner(request, broadcast_id: UUID):
    staff(request)
    b = get_object_or_404(Broadcast, pk=broadcast_id)
    broadcasts.end_banner(broadcast=b, by=request.user)
    audit_request(request, "announcement.end_banner", "broadcast", b.id, {"title": b.title})
    return {"ok": True}


# ---------------------------------------------------------------- notification templates
def _template_out(t: NotificationTemplate) -> dict:
    d = wording.DEFAULTS.get(t.code)
    return {"code": t.code, "audience": d[0] if d else "other", "title": t.title, "body": t.body,
            "email_enabled": t.email_enabled, "is_active": t.is_active,
            "placeholders": sorted(wording.needed(t.code) | wording.ALWAYS),
            "sample": d[4] if d else {}, "default_title": d[1] if d else t.title,
            "default_body": d[2] if d else t.body, "updated_at": t.updated_at}  # fmt: skip


@router.get("/templates", response=list[ConsoleTemplateOut])
def templates(request):
    staff(request)
    return [_template_out(t) for t in NotificationTemplate.objects.order_by("code")]


@router.post("/templates/{code}/preview", response=ConsoleTemplatePreviewOut)
def preview_template(request, code: str, body: ConsoleTemplatePreviewIn):
    """The wording filled in with sample values (nothing is saved or sent)."""
    staff(request)
    get_object_or_404(NotificationTemplate, code=code)
    wording.check(code, body.title, body.body)
    d = wording.DEFAULTS.get(code)
    from apps.platform.services import get_setting

    context = {"platform": get_setting("general.platform_name"), **(d[4] if d else {})}
    return {"title": notify.render(html.plain(body.title, 200), context),
            "body": notify.render(html.plain(body.body, 5000), context)}  # fmt: skip


@router.put("/templates/{code}", response=ConsoleTemplateOut)
def set_template(request, code: str, body: ConsoleTemplateIn):
    """Refuses wording that drops a placeholder the code fills in or adds an unknown one."""
    staff(request)
    tpl = get_object_or_404(NotificationTemplate, code=code)
    title, text = html.plain(body.title, 200).strip(), html.plain(body.body, 5000).strip()
    wording.check(code, title, text)
    NotificationTemplate.objects.filter(pk=tpl.pk).update(
        title=title, body=text, email_enabled=body.email_enabled, is_active=body.is_active, updated_at=timezone.now()
    )  # fmt: skip
    audit_request(request, "template.update", "notification_template", code,
                  {"title": title, "email": body.email_enabled, "active": body.is_active})  # fmt: skip
    tpl.refresh_from_db()
    return _template_out(tpl)


@router.post("/templates/{code}/reset", response=ConsoleTemplateOut)
def reset_template(request, code: str):
    """Back to the default wording."""
    staff(request)
    tpl = get_object_or_404(NotificationTemplate, code=code)
    d = wording.DEFAULTS.get(code)
    if d is None:
        raise ServiceError("no_default", "This notification has no default wording.")
    NotificationTemplate.objects.filter(pk=tpl.pk).update(title=d[1], body=d[2], updated_at=timezone.now())
    audit_request(request, "template.reset", "notification_template", code)
    tpl.refresh_from_db()
    return _template_out(tpl)


# keep the company list for the broadcast composer small and typed
class ConsoleCompanyOptionOut(Schema):
    id: UUID
    name: str


@router.get("/broadcasts/companies", response=list[ConsoleCompanyOptionOut])
def broadcast_companies(request):
    staff(request)
    return list(Organization.objects.order_by("name").values("id", "name")[:1000])
