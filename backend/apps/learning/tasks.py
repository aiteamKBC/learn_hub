"""Learning background jobs (Celery)."""

from celery import shared_task

from core.tenancy import tenant_context

from .progress import flush_heartbeats
from .services import certificate_expiry_reminders
from .uploads import purge_abandoned


@shared_task(name="learning.flush_heartbeats")
def flush_heartbeats_task() -> int:
    return flush_heartbeats()


@shared_task(name="learning.purge_abandoned_uploads")
def purge_abandoned_uploads_task() -> int:
    with tenant_context(staff=True):
        return purge_abandoned()


@shared_task(name="learning.certificate_expiry_reminders")
def certificate_expiry_reminders_task() -> int:
    with tenant_context(staff=True):
        return certificate_expiry_reminders()
