"""Durable package checkout reservation; provider work runs only after commit."""

from datetime import timedelta

from django.db import connection, transaction
from django.utils import timezone

from apps.platform import outbox
from apps.platform.models import OutboxEvent
from core.errors import ServiceError
from core.tenancy import tenant_context

from . import gateway
from .models import Order, PriceSnapshot

TOPIC = "package.checkout_requested"


def lock_checkout(user_id, package_id):
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                       [f"package-checkout:{user_id}:{package_id}"])


def existing_checkout(user_id, package_id):
    """A reservation never silently becomes a replacement charge, even after expiry."""
    refs = PriceSnapshot.objects.filter(scope="pack", target_id=str(package_id), source_ref_kind="order")
    # Source refs are strings, so avoid a PostgreSQL UUID/text comparison.
    orders = Order.objects.filter(user_id=user_id, org__isnull=True, pk__in=list(refs.values_list("source_ref", flat=True)))
    order = orders.order_by("created_at").first()
    if order is None:
        # Older package checkouts have course snapshots but no package marker.
        # Their relationship cannot safely be reconstructed from today's bundle.
        legacy = PriceSnapshot.objects.filter(source_ref_kind="order", scope="course")
        if Order.objects.filter(user_id=user_id, status="pending", pk__in=list(
            legacy.values_list("source_ref", flat=True)
        )).exists():
            raise ServiceError("package_checkout_review", "An earlier package checkout needs review before another can start.", status=409)
        return None
    if order.status != "pending":
        raise ServiceError("package_checkout_closed", "This package already has a purchase attempt. Contact support before buying again.", status=409)
    event = OutboxEvent.objects.filter(topic=TOPIC, payload__order_id=str(order.id)).first()
    if event is None or (not order.stripe_session_id and timezone.now() - order.created_at >= timedelta(hours=1)):
        raise ServiceError("package_checkout_review", "Checkout status needs review. No replacement payment was started.", status=409)
    url = event.payload.get("checkout_url") if order.stripe_session_id else None
    return {"url": url, "pending": not bool(url)}


def reserve(*, order, package_id, request):
    PriceSnapshot.objects.create(scope="pack", target_id=str(package_id), amount_minor=order.total_minor,
                                 currency=order.currency_id, source_ref_kind="order", source_ref=str(order.id))
    outbox.publish(TOPIC, {"order_id": str(order.id), "request": request})
    return {"url": None, "pending": True}


@transaction.atomic
def dispatch_checkout(payload):
    """Reuse immutable provider arguments and key; never retry an ambiguous old attempt."""
    with tenant_context(staff=True):
        order = Order.objects.select_for_update().get(pk=payload["order_id"])
        if order.stripe_session_id or order.status != "pending":
            return
        # Short bounded retry window; older uncertain attempts require provider review.
        if timezone.now() - order.created_at >= timedelta(hours=1):
            raise ServiceError("package_checkout_review", "Ambiguous package checkout requires reconciliation.", status=409)
        session = gateway.create_checkout_session(**payload["request"])
        Order.objects.filter(pk=order.id).update(stripe_session_id=session["id"])
        OutboxEvent.objects.filter(topic=TOPIC, payload__order_id=str(order.id)).update(
            payload=payload | {"checkout_url": session["url"]},
        )
