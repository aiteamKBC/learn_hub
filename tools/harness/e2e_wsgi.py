"""HARNESS ONLY (not part of the app): run Django with Stripe replaced by a local fake, so
the end-to-end tests can go through checkout without real keys. The fake 'hosted page'
sends the browser straight back to the success URL; payments are then confirmed by
tools/e2e_stripe.py delivering a webhook event, exactly as Stripe would.

Also captures the one-time invite token the M3 E2E needs: `core.mail.SafeConsoleBackend`
deliberately never logs email bodies (they can contain sign-in links), and the invite
token itself is never stored (only its SHA-256 hash, `apps/org/services.py`), so there is
no safe way to read it back from the database. The harness instead wraps the Celery task
at the point the API enqueues it (same process either way: eager or forwarded to a
worker) and appends `email<TAB>token` to invite.log, next to this file. Nothing fake is
sent in its place - the real task still runs and the real email is still "sent" (logged,
per MAIL_MODE=console)."""

import os
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()

from apps.commerce import gateway  # noqa: E402
from apps.org import tasks as org_tasks  # noqa: E402


def create_checkout_session(*, mode, line_items, metadata, customer_email, success_url, cancel_url, idempotency_key, trial_days=0, customer=""):
    return {"id": f"cs_e2e_{metadata['id']}", "url": success_url}


gateway.create_checkout_session = create_checkout_session
gateway.refund = lambda *, payment_intent, amount, idempotency_key: f"re_e2e_{idempotency_key[:12]}"
gateway.billing_portal = lambda *, customer, return_url: return_url
gateway.cancel_at_period_end = lambda subscription_id: None
# the fake sessions are completed by e2e_stripe.py's webhook, so polling never finds them paid
gateway.retrieve_checkout_session = lambda session_id: {"id": session_id, "payment_status": "unpaid", "metadata": {}}

_INVITE_LOG = Path(__file__).resolve().parent / "invite.log"
_orig_invite_delay = org_tasks.send_invite_task.delay


def _invite_delay(email, org_name, inviter, token):
    with open(_INVITE_LOG, "a", encoding="utf-8") as f:
        f.write(f"{email}\t{token}\n")
    return _orig_invite_delay(email, org_name, inviter, token)


org_tasks.send_invite_task.delay = _invite_delay
