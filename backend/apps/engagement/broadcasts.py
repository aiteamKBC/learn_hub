"""Broadcasts and platform announcements (console > Communications).

A broadcast goes to an audience (everyone, learners, instructors, company admins, one
company) in-app and/or by email. In-app copies are one INSERT ... SELECT through
notify(); email-only broadcasts are mailed in batches by a job. An announcement is a
broadcast that can also show as a site banner between two dates.
"""

from django.conf import settings
from django.core.mail import send_mass_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.identity.models import InstructorProfile, User
from apps.org.models import Organization, OrgMember
from core import html
from core.errors import ServiceError
from core.tenancy import tenant_context

from . import notify
from .models import Broadcast

ADMIN_ROLES = (OrgMember.Role.OWNER, OrgMember.Role.ADMIN)


def audience_ids(audience: str, org_id=None) -> list:
    """The active people in an audience. Learners are everyone who is not staff and not
    an approved instructor; company admins are owners and admins of live companies."""
    with tenant_context(staff=True):
        users = User.objects.filter(is_active=True)
        instructors = InstructorProfile.objects.filter(status=InstructorProfile.Status.APPROVED).values(
            "user_id"
        )
        live = ~Q(org__status__in=(Organization.Status.SUSPENDED, Organization.Status.CANCELLED))
        if audience == Broadcast.Audience.EVERYONE:
            qs = users
        elif audience == Broadcast.Audience.LEARNERS:
            qs = users.filter(is_staff=False).exclude(id__in=instructors)
        elif audience == Broadcast.Audience.INSTRUCTORS:
            qs = users.filter(id__in=instructors)
        elif audience == Broadcast.Audience.COMPANY_ADMINS:
            admins = OrgMember.objects.filter(live, removed_at__isnull=True, role__in=ADMIN_ROLES).values(
                "user_id"
            )
            qs = users.filter(id__in=admins)
        elif audience == Broadcast.Audience.COMPANY:
            if not org_id:
                raise ServiceError("org_required", "Choose the company.")
            members = OrgMember.objects.filter(org_id=org_id, removed_at__isnull=True).values("user_id")
            qs = users.filter(id__in=members)
        else:
            raise ServiceError("bad_audience", "Choose who receives it.")
        return list(qs.values_list("id", flat=True))


def _safe_url(url: str) -> str:
    url = (url or "").strip()
    if url and (not url.startswith("/") or url.startswith("//")):
        raise ServiceError("bad_url", "Use a link inside the platform, starting with /.")
    return url[:500]


@transaction.atomic
def send(
    *, by, kind: str, title: str, body: str, audience: str, org_id=None, send_in_app: bool = True,
    send_email: bool = False, url: str = "", show_as_banner: bool = False, banner_starts_at=None,
    banner_ends_at=None,
) -> Broadcast:  # fmt: skip
    """Create and send at once. Returns the broadcast with its recipient count."""
    if kind not in Broadcast.Kind.values:
        raise ServiceError("bad_kind", "Unknown kind.")
    title, body = html.plain(title, 200).strip(), html.plain(body, 5000).strip()
    if not title or not body:
        raise ServiceError("required", "Add a title and a message.")
    if kind == Broadcast.Kind.BROADCAST:
        show_as_banner = False
    if not (send_in_app or send_email or show_as_banner):
        raise ServiceError("no_channel", "Choose in-app, email or a site banner.")
    if show_as_banner:
        banner_starts_at = banner_starts_at or timezone.now()
        if banner_ends_at and banner_ends_at <= banner_starts_at:
            raise ServiceError("bad_dates", "The banner must end after it starts.")
    if audience == Broadcast.Audience.COMPANY and not Organization.objects.filter(pk=org_id).exists():
        raise ServiceError("org_required", "Choose the company.")
    ids = audience_ids(audience, org_id) if (send_in_app or send_email) else []
    now = timezone.now()
    with tenant_context(user_id=by.id, staff=True):
        b = Broadcast.objects.create(
            kind=kind, title=title, body=body, audience=audience,
            org_id=org_id if audience == Broadcast.Audience.COMPANY else None, send_in_app=send_in_app,
            send_email=send_email, url=_safe_url(url), show_as_banner=show_as_banner,
            banner_starts_at=banner_starts_at if show_as_banner else None,
            banner_ends_at=banner_ends_at if show_as_banner else None, sent_by=by, sent_at=now,
            recipient_count=len(ids),
        )  # fmt: skip
    context = {"title": title, "body": body}
    if send_in_app:
        notify.notify(ids, "broadcast", context, url=b.url, dedupe=f"broadcast:{b.id}", email=send_email)
    elif send_email and ids and notify_email_enabled():
        bid = str(b.id)
        transaction.on_commit(lambda: _email_task().delay(bid))
    return b


def notify_email_enabled() -> bool:
    from apps.platform.services import get_setting

    return bool(get_setting("notifications.email_enabled"))


def _email_task():
    from .tasks import email_broadcast_task

    return email_broadcast_task


def email_broadcast(broadcast_id) -> int:
    """Email-only broadcasts: plain emails in batches of 500 (people who switched off
    broadcast emails are skipped)."""
    from .models import NotificationPreference

    with tenant_context(staff=True):
        b = Broadcast.objects.get(pk=broadcast_id)
        ids = audience_ids(b.audience, b.org_id)
        opted_out = set(
            NotificationPreference.objects.filter(kind="broadcast", email=False).values_list(
                "user_id", flat=True
            )
        )
        emails = list(
            User.objects.filter(id__in=[i for i in ids if i not in opted_out]).values_list("email", flat=True)
        )
    body = f"{b.body}\n\n{settings.FRONTEND_URL}{b.url}" if b.url else b.body
    sent = 0
    for i in range(0, len(emails), 500):
        sent += send_mass_mail([(b.title, body, None, [e]) for e in emails[i : i + 500]], fail_silently=False)
    return sent


def end_banner(*, broadcast: Broadcast, by) -> None:
    if not broadcast.show_as_banner:
        raise ServiceError("no_banner", "This announcement has no banner.")
    now = timezone.now()
    with tenant_context(user_id=by.id, staff=True):
        Broadcast.objects.filter(pk=broadcast.pk).update(banner_ends_at=now, updated_at=now)


def current_banner() -> Broadcast | None:
    """The newest announcement whose banner is showing now (public: the site header)."""
    now = timezone.now()
    with tenant_context(staff=True):
        return (
            Broadcast.objects.filter(
                kind=Broadcast.Kind.ANNOUNCEMENT, show_as_banner=True, banner_starts_at__lte=now
            )
            .filter(Q(banner_ends_at__isnull=True) | Q(banner_ends_at__gt=now))
            .order_by("-banner_starts_at")
            .first()
        )
