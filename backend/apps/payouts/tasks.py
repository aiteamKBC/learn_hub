"""Payout background jobs (Celery)."""

from celery import shared_task

from . import services


@shared_task(name="payouts.monthly_run")
def monthly_run_task() -> dict:
    return services.monthly_run()


@shared_task(name="payouts.scheduled_run")
def scheduled_run_task() -> dict:
    return services.scheduled_run()
