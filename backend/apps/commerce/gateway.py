"""The ONLY module that talks to Stripe. Everything else calls these functions, so
tests replace them and a payment provider change touches one file.

Stripe counts some currencies differently from ISO 4217 (e.g. ISK and UGX are
zero-decimal in Stripe, HUF and TWD are two-decimal): `to_stripe_amount` converts.
"""

import stripe
from django.conf import settings

from core.errors import ServiceError

STRIPE_ZERO_DECIMAL = {
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
    "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
}  # fmt: skip
STRIPE_THREE_DECIMAL = {"BHD", "JOD", "KWD", "OMR", "TND"}


def stripe_exponent(code: str) -> int:
    return 0 if code in STRIPE_ZERO_DECIMAL else 3 if code in STRIPE_THREE_DECIMAL else 2


def to_stripe_amount(minor: int, code: str, iso_exponent: int) -> int:
    diff = stripe_exponent(code) - iso_exponent
    return minor * 10**diff if diff >= 0 else minor // 10 ** (-diff)


def _client() -> stripe.StripeClient:
    if not settings.STRIPE_SECRET_KEY:
        raise ServiceError("payments_unavailable", "Payments are not configured.", status=503)
    return stripe.StripeClient(settings.STRIPE_SECRET_KEY, max_network_retries=2)


def create_checkout_session(
    *, mode: str, line_items: list, metadata: dict, customer_email: str, success_url: str,
    cancel_url: str, idempotency_key: str, trial_days: int = 0, customer: str = "", coupon: str = "",
) -> dict:  # fmt: skip
    params = {
        "mode": mode,
        "line_items": line_items,
        "metadata": metadata,
        "client_reference_id": metadata.get("id"),
        **({"customer": customer} if customer else {"customer_email": customer_email}),
        "success_url": success_url,
        "cancel_url": cancel_url,
    }
    if mode == "payment":
        params["payment_intent_data"] = {"metadata": metadata}
        # a Stripe invoice for every paid order: staff and buyers download its hosted PDF
        params["invoice_creation"] = {"enabled": True, "invoice_data": {"metadata": metadata}}
    else:
        params["subscription_data"] = {
            "metadata": metadata,
            **({"trial_period_days": trial_days} if trial_days else {}),
        }
    if coupon:  # a subscription promotion (console > Promotions)
        params["discounts"] = [{"coupon": coupon}]
    session = _client().v1.checkout.sessions.create(
        params=params, options={"idempotency_key": idempotency_key}
    )
    return {"id": session.id, "url": session.url}


def retrieve_checkout_session(session_id: str) -> dict:
    s = _client().v1.checkout.sessions.retrieve(session_id)
    return {"id": s.id, "payment_status": s.payment_status, "payment_intent": s.payment_intent or "",
            "amount_total": s.amount_total, "currency": s.currency or "", "metadata": dict(s.metadata or {})}  # fmt: skip


def refund(*, payment_intent: str, amount: int, idempotency_key: str) -> str:
    r = _client().v1.refunds.create(
        params={"payment_intent": payment_intent, "amount": amount},
        options={"idempotency_key": idempotency_key},
    )
    return r.id


def cancel_at_period_end(subscription_id: str) -> None:
    _client().v1.subscriptions.update(subscription_id, params={"cancel_at_period_end": True})


def construct_event(payload: bytes, signature: str) -> dict:
    """Verifies the Stripe-Signature header against the RAW body (and a 5-minute replay window)."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise ServiceError("payments_unavailable", "Webhook secret not configured.", status=503)
    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise ServiceError("bad_signature", "Invalid webhook signature.", status=400) from exc
    return event.to_dict() if hasattr(event, "to_dict") else dict(event)


def transfer(*, destination: str, amount_gbp_minor: int, idempotency_key: str, description: str = "") -> str:
    """Instructor payout to a connected Stripe account (Stripe Connect)."""
    t = _client().v1.transfers.create(
        params={
            "amount": amount_gbp_minor,
            "currency": "gbp",
            "destination": destination,
            "description": description,
        },
        options={"idempotency_key": idempotency_key},
    )
    return t.id


def billing_portal(*, customer: str, return_url: str) -> str:
    """Stripe-hosted page where customers update cards, see invoices and cancel."""
    session = _client().v1.billing_portal.sessions.create(
        params={"customer": customer, "return_url": return_url}
    )
    return session.url


def create_price(*, product_name: str, product_key: str, currency: str, unit_amount: int, interval: str,
                 idempotency_key: str) -> str:  # fmt: skip
    """A recurring Stripe price for a plan (console > Subscriptions). Stripe prices never
    change: a new amount is a new price, and the old one simply stops being used."""
    price = _client().v1.prices.create(
        params={
            "currency": currency.lower(),
            "unit_amount": unit_amount,
            "recurring": {"interval": interval},
            "product_data": {"name": product_name[:250], "metadata": {"plan": product_key}},
        },
        options={"idempotency_key": idempotency_key},
    )
    return price.id


def create_coupon(*, percent_off: int, name: str, idempotency_key: str) -> str:
    """A Stripe coupon for a subscription promotion: the first invoice gets the discount."""
    coupon = _client().v1.coupons.create(
        params={"percent_off": percent_off, "duration": "once", "name": name[:40]},
        options={"idempotency_key": idempotency_key},
    )
    return coupon.id
