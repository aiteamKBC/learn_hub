"""Commerce background jobs (Celery)."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from core.tenancy import tenant_context

from . import pricing
from .models import Order


@shared_task(name="commerce.refresh_fx", bind=True, max_retries=6)
def refresh_fx_task(self) -> dict:
    """Daily: ECB rates, then re-price tiers that drifted. Off when the setting
    pricing.fx_auto_refresh is off; staff hear about it when every retry failed."""
    from apps.platform.services import get_setting

    if not get_setting("pricing.fx_auto_refresh"):
        return {"rates": 0, "repriced": 0, "skipped": True}
    try:
        with tenant_context(staff=True):  # reference tables are staff-write only
            stored = pricing.fetch_ecb()
            return {"rates": stored, "repriced": pricing.refresh_tier_amounts()}
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            from apps.engagement.notify import notify_staff

            notify_staff("staff_fx_failed", {"detail": type(exc).__name__}, url="/console/pricing?tab=currencies",
                         dedupe=f"fx-failed:{timezone.now():%Y%m%d}")  # fmt: skip
            raise
        raise self.retry(exc=exc, countdown=600 * 2**self.request.retries) from exc


@shared_task(name="commerce.expire_checkouts")
def expire_checkouts_task() -> int:
    """Stripe Checkout sessions last 24 h; close our side if the expiry webhook was missed."""
    cutoff = timezone.now() - timedelta(hours=25)
    with tenant_context(staff=True):
        return Order.objects.filter(status=Order.Status.PENDING, created_at__lt=cutoff).update(
            status=Order.Status.EXPIRED, updated_at=timezone.now()
        )
