"""Org background jobs (Celery)."""

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail


@shared_task(name="org.send_invite", autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def send_invite_task(email: str, org_name: str, inviter: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/invite/{token}"
    send_mail(
        f"{inviter} invited you to {org_name} on LearnHub",
        f"Hello,\n\n{inviter} has invited you to join {org_name} on LearnHub.\n\n"
        "Open the invitation to continue. New to LearnHub? Create your account and confirm your email; "
        "we will finish joining you to the company when you return. Already have an account? Sign in "
        "with your existing password. You do not need to reset it just to accept an invitation.\n\n"
        f"This invitation is valid for 7 days:\n{link}\n\nIf you were not expecting this, ignore this email.",
        None,
        [email],
    )
