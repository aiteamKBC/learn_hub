"""Notifications: one way to tell people something, in-app and (optionally) by email.

    notify(user_ids, "answer_posted", {"course": "...", ...}, url="/learn/...", dedupe="answer:<id>")

* rows are created by one INSERT ... SELECT for any number of recipients (announcements
  to 50,000 learners are one statement), as a platform job;
* `dedupe` makes repeats harmless (a retried task never notifies twice);
* wording comes from editable templates; {placeholders} are filled by plain text
  substitution, never str.format (no attribute access from template text);
* emails go out in batches after commit, honouring each person's preferences.
"""

import re

from django.conf import settings
from django.core.mail import send_mass_mail
from django.db import connection, transaction
from django.utils import timezone

from core.tenancy import tenant_context

from .models import Notification, NotificationTemplate

_PLACEHOLDER = re.compile(r"\{([a-z_]{1,40})\}")


def render(text: str, context: dict) -> str:
    return _PLACEHOLDER.sub(lambda m: str(context.get(m.group(1), "")), text)


def _safe_url(url: str) -> str:
    return url if url.startswith("/") and not url.startswith("//") else ""


def notify(
    user_ids, code: str, context: dict, *, url: str = "", dedupe: str = "", email: bool | None = None
) -> list:
    """Returns the ids of the notifications created (already-sent duplicates are skipped).
    `email` overrides the template's email switch for this call (a broadcast chooses);
    the platform switch "Send email copies" (notifications.email_enabled) always wins."""
    ids = list({str(u) for u in user_ids})
    if not ids:
        return []
    with tenant_context(staff=True):
        tpl = NotificationTemplate.objects.filter(code=code, is_active=True).first()
        if tpl is None:
            return []
        from apps.platform.services import get_setting

        context = {"platform": get_setting("general.platform_name"), **context}
        title, body = render(tpl.title, context)[:200], render(tpl.body, context)[:5000]
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO engagement.notifications
                       (id, created_at, updated_at, user_id, kind, title, body, url, dedupe_key)
                SELECT uuidv7(), now(), now(), u.id, %(code)s, %(title)s, %(body)s, %(url)s, %(dedupe)s
                  FROM identity.users u
                  LEFT JOIN engagement.notification_preferences p ON p.user_id = u.id AND p.kind = %(code)s
                 WHERE u.id = ANY(%(ids)s::uuid[]) AND u.is_active AND COALESCE(p.in_app, true)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                {
                    "code": code,
                    "title": title,
                    "body": body,
                    "url": _safe_url(url),
                    "dedupe": dedupe,
                    "ids": ids,
                },
            )
            created = [r[0] for r in cur.fetchall()]
        wants_email = tpl.email_enabled if email is None else email
        send_email = wants_email and get_setting("notifications.email_enabled")
    if created and send_email:
        from .tasks import email_notifications_task

        batch = [str(i) for i in created]
        transaction.on_commit(lambda: email_notifications_task.delay(batch))
    return created


def email_notifications(notification_ids: list) -> int:
    """Send the email copy for these notifications (people who opted out are skipped).

    Rows are CLAIMED first (emailed_at set in one UPDATE ... RETURNING), so a retried or
    duplicated job can never email anyone twice. If sending fails, the claim is released
    and the job retries.
    """
    with tenant_context(staff=True), connection.cursor() as cur:
        cur.execute(
            """
            UPDATE engagement.notifications n SET emailed_at = now()
             WHERE n.id = ANY(%s::uuid[]) AND n.emailed_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM engagement.notification_preferences p
                                WHERE p.user_id = n.user_id AND p.kind = n.kind AND NOT p.email)
            RETURNING n.id
            """,
            [[str(i) for i in notification_ids]],
        )
        ids = [r[0] for r in cur.fetchall()]
        rows = list(
            Notification.objects.filter(id__in=ids).values_list("title", "body", "url", "user__email")
        )
    messages = [
        (title, f"{body}\n\n{settings.FRONTEND_URL}{url}" if url else body, None, [email])
        for title, body, url, email in rows
    ]
    try:
        return send_mass_mail(messages, fail_silently=False) if messages else 0
    except Exception:
        with tenant_context(staff=True):
            Notification.objects.filter(id__in=ids).update(emailed_at=None)
        raise


def mark_read(*, user, ids=None) -> int:
    qs = Notification.objects.filter(user=user, read_at__isnull=True)
    if ids is not None:
        qs = qs.filter(id__in=ids)
    return qs.update(read_at=timezone.now(), updated_at=timezone.now())


def notify_staff(code: str, context: dict, *, url: str = "", dedupe: str = "") -> list:
    """Tell every active platform staff member (their own preferences still apply)."""
    from apps.identity.models import User

    with tenant_context(staff=True):
        staff = list(User.objects.filter(is_staff=True, is_active=True).values_list("id", flat=True))
    return notify(staff, code, context, url=url, dedupe=dedupe)
