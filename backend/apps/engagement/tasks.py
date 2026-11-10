"""Engagement background jobs (Celery)."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from core.tenancy import tenant_context

from . import notify, services
from .models import Notification


@shared_task(
    name="engagement.email_notifications", autoretry_for=(Exception,), retry_backoff=True, max_retries=5
)
def email_notifications_task(ids: list) -> int:
    return notify.email_notifications(ids)


@shared_task(
    name="engagement.send_announcement", autoretry_for=(Exception,), retry_backoff=True, max_retries=5
)
def send_announcement_task(announcement_id: str) -> int:
    return services.send_announcement(announcement_id)


@shared_task(name="engagement.email_broadcast", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def email_broadcast_task(broadcast_id: str) -> int:
    from .broadcasts import email_broadcast

    return email_broadcast(broadcast_id)


@shared_task(name="engagement.award_badges")
def award_badges_task(user_id: str) -> list:
    return services.award_badges(user_id)


@shared_task(name="engagement.prune_notifications")
def prune_notifications_task(days: int = 180) -> int:
    """Keep inboxes small: read notifications older than `days` are deleted, in batches."""
    cutoff = timezone.now() - timedelta(days=days)
    total = 0
    while True:
        with tenant_context(staff=True):
            ids = list(
                Notification.objects.filter(created_at__lt=cutoff, read_at__isnull=False).values_list(
                    "id", flat=True
                )[:5000]
            )
            if not ids:
                return total
            total += Notification.objects.filter(id__in=ids).delete()[0]
