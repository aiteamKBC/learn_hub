"""Corporate background jobs."""

from celery import shared_task


@shared_task(name="corporate.live_renewal_reminders")
def live_renewal_reminders() -> int:
    """Daily: remind buyers a week before the months they paid for on a live course end."""
    from .live_renewals import send_due_reminders

    return send_due_reminders()
