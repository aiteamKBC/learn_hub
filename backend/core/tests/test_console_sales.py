"""M5 P7: console sales (KPIs, orders with filters, detail, refunds, invoices, export) and
the Stripe webhook details it shows (card brand / last 4, the order's invoice)."""

from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.commerce import services
from apps.commerce.models import Invoice, Order, Payment
from apps.commerce.tests.test_commerce import CommerceBase, fake_session
from apps.engagement.models import Notification
from apps.learning.models import Enrollment
from apps.platform.models import AuditLog
from core.tenancy import tenant_context

API = "/api/v1/console"


@mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session)
class ConsoleSalesTest(CommerceBase):
    def paid_order(self, ids, event="evt_1"):
        with tenant_context(user_id=self.sara.id):
            order = services.create_order(user=self.sara, course_ids=ids, currency="GBP")["order"]
        self.deliver(self.paid_event(order, event_id=event))
        return order

    def test_card_details_invoice_and_receipt_from_stripe(self, _s):
        order = self.paid_order([self.python.id])
        self.deliver({"id": "evt_ch", "type": "charge.succeeded", "data": {"object": {
            "id": "ch_1", "payment_intent": "pi_123", "metadata": {"kind": "order", "id": str(order.id)},
            "payment_method_details": {"type": "card", "card": {"brand": "visa", "last4": "4242"}}}}})  # fmt: skip
        self.deliver({"id": "evt_inv", "type": "invoice.paid", "data": {"object": {
            "id": "in_1", "number": "LH-0001", "status": "paid", "invoice_pdf": "https://pay.stripe.com/inv.pdf",
            "hosted_invoice_url": "https://invoice.stripe.com/i", "created": int(timezone.now().timestamp()),
            "metadata": {"kind": "order", "id": str(order.id)}}}})  # fmt: skip
        with tenant_context(**self.STAFF):
            o = Order.objects.get(pk=order.pk)
            self.assertEqual((o.card_brand, o.card_last4, o.payment_method_type), ("visa", "4242", "card"))
            self.assertEqual(Payment.objects.get(order=o).card_last4, "4242")
            self.assertEqual(Invoice.objects.get(order=o).pdf_url, "https://pay.stripe.com/inv.pdf")
            self.assertTrue(Notification.objects.filter(user=self.sara, kind="order_receipt").exists())

        self.client.force_login(self.staff)
        page = self.client.get(f"{API}/orders?method=card").json()
        self.assertEqual(page["total"], 1)
        row = page["items"][0]
        self.assertEqual(row["card_brand"], "visa")
        self.assertTrue(row["number"].startswith("ORD-"))
        self.assertEqual(self.client.get(f"{API}/orders?q={row['number']}").json()["total"], 1)
        self.assertEqual(self.client.get(f"{API}/orders?currency=USD").json()["total"], 0)
        detail = self.client.get(f"{API}/orders/{order.id}").json()
        self.assertEqual(detail["invoice_url"], "https://pay.stripe.com/inv.pdf")
        self.assertEqual(detail["customer_orders"], 1)
        self.assertEqual(
            self.client.get(f"{API}/invoices?kind=order").json()["items"][0]["number"], "LH-0001"
        )
        csv = self.client.get(f"{API}/orders/export.csv")
        self.assertEqual(csv["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("visa 4242", csv.content.decode())

    def test_staff_refund_any_time_with_reason_audit_and_notice(self, _s):
        order = self.paid_order([self.python.id, self.sql.id])
        with tenant_context(**self.STAFF):
            Order.objects.filter(pk=order.pk).update(paid_at=timezone.now() - timedelta(days=90))
            item = order.items.get(course=self.python)
        self.client.force_login(self.staff)
        url = f"{API}/orders/items/{item.id}/refund"
        self.assertEqual(
            self.client.post(url, {"reason": ""}, content_type="application/json").status_code, 422
        )
        with mock.patch("apps.commerce.gateway.refund", return_value="re_1"):
            r = self.client.post(url, {"reason": "Duplicate purchase"}, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(**self.STAFF):
            self.assertEqual(Order.objects.get(pk=order.pk).status, "partially_refunded")
            self.assertEqual(Enrollment.objects.get(user=self.sara, course=self.python).status, "revoked")
            self.assertTrue(Notification.objects.filter(user=self.sara, kind="refund_issued").exists())
            self.assertFalse(Notification.objects.filter(kind="staff_self_refund").exists())  # staff did it
            self.assertTrue(AuditLog.objects.filter(action="order.refund", target_id=str(item.id)).exists())
        refunds = self.client.get(f"{API}/refunds").json()["items"]
        self.assertEqual(refunds[0]["reason"], "Duplicate purchase")
        self.assertTrue(refunds[0]["by_staff"])
        overview = self.client.get(f"{API}/sales/overview?range=7d").json()
        self.assertEqual(overview["kpis"]["refunds"]["value"], 3499)

    def test_learner_self_refund_tells_staff_and_window_is_a_setting(self, _s):
        order = self.paid_order([self.python.id])
        with (
            tenant_context(user_id=self.sara.id),
            mock.patch("apps.commerce.gateway.refund", return_value="re_2"),
        ):
            services.request_refund(item=order.items.get(), by=self.sara, reason="Not for me")
        with tenant_context(**self.STAFF):
            self.assertTrue(Notification.objects.filter(user=self.staff, kind="staff_self_refund").exists())
        self.assertEqual(services.refund_window_days(), 30)  # client question default

    def test_overview_kpis(self, _s):
        self.paid_order([self.python.id])
        self.client.force_login(self.staff)
        r = self.client.get(f"{API}/sales/overview?range=30d").json()
        self.assertEqual(r["kpis"]["total_sales"]["value"], 1)
        self.assertEqual(r["kpis"]["course_sales"]["value"], 3499)
        self.assertEqual(r["kpis"]["average_order"]["value"], 3499)
        self.assertEqual(sum(p["value"] for p in r["series"]), 3499)
        self.assertEqual(r["by_type"][0]["value"], 3499)
