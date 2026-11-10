"""M5 P3: console dashboard: date ranges, KPIs vs the previous period, sales series,
approvals, needs attention, recent activity and health tiles (no secrets leak)."""

from datetime import timedelta
from decimal import Decimal

import httpx
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

from apps.commerce.models import Order
from apps.engagement.models import ContentReport, Notification
from apps.identity.models import InstructorProfile
from apps.payouts.models import PayoutRequest
from apps.platform.console import healthchecks
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/console"


class ConsoleDashboardTest(SchemaTransactionTestCase):
    def setUp(self):
        cache.clear()
        self.staff, self.teacher, self.sara, self.omar = f.users()
        InstructorProfile.objects.create(user=self.teacher, status="approved")
        f.money(self.staff)
        self.course = f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python basics")
        self.client.force_login(self.staff)

    def order(self, gbp: int, days_ago: int, status="paid"):
        with tenant_context(user_id=self.staff.id, staff=True):
            return Order.objects.create(
                user=self.sara, currency_id="GBP", subtotal_minor=gbp, total_minor=gbp, fx_rate=Decimal(1),
                gbp_total_minor=gbp, status=status, paid_at=timezone.now() - timedelta(days=days_ago),
            )  # fmt: skip

    def test_overview_compares_with_the_previous_period(self):
        self.order(5000, days_ago=2)
        self.order(3000, days_ago=3)
        self.order(4000, days_ago=10)  # in the 7 days before
        self.order(9999, days_ago=40)  # outside both 7-day windows
        r = self.client.get(f"{API}/overview?range=7d")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["range"]["days"], 7)
        rev = body["sales"]["revenue_gbp_minor"]
        self.assertEqual((rev["value"], rev["previous"], rev["change_pct"]), (8000, 4000, 100.0))
        self.assertEqual(len(body["sales"]["series"]), 8)  # every day in the window, zero-filled
        self.assertEqual(sum(p["value"] for p in body["sales"]["series"]), 8000)
        self.assertEqual(body["courses"]["value"], 1)
        self.assertEqual(body["instructors"]["value"], 1)
        thirty = self.client.get(f"{API}/overview").json()["sales"]["revenue_gbp_minor"]
        self.assertEqual(thirty["value"], 12000)
        self.assertEqual(thirty["previous"], 9999)

    def test_custom_range_and_bad_ranges(self):
        today = timezone.localdate()
        ok = self.client.get(
            f"{API}/overview?range=custom&start={today - timedelta(days=13)}&end={today - timedelta(days=1)}"
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["range"]["days"], 13)  # whole days, both ends included
        bad = self.client.get(f"{API}/overview?range=custom&start={today}&end={today - timedelta(days=3)}")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.client.get(f"{API}/overview?range=5y").status_code, 400)

    def test_attention_payout_requests_and_activity(self):
        self.order(2500, days_ago=0, status="failed")
        with tenant_context(user_id=self.staff.id, staff=True):
            ContentReport.objects.create(
                reporter=self.sara, target_type="review", target_id=self.course.id, reason="Spam"
            )
            PayoutRequest.objects.create(user=self.teacher, amount_gbp_minor=92000, method="stripe")
            PayoutRequest.objects.create(
                user=self.teacher, amount_gbp_minor=1000, method="stripe", status="disputed"
            )
        body = self.client.get(f"{API}/overview").json()
        keys = {a["key"]: a for a in body["attention"]}
        self.assertEqual(keys["reports"]["count"], 1)
        self.assertEqual(keys["disputed_payouts"]["count"], 1)
        self.assertEqual(keys["failed_payments"]["title"], "1 failed payment")
        self.assertNotIn("stuck_jobs", keys)  # nothing stuck: the row is left out
        self.assertEqual(body["payout_requests"], {"pending": 1, "total_gbp_minor": 92000})
        items = self.client.get(f"{API}/activity?limit=20").json()["items"]
        kinds = {i["kind"] for i in items}
        self.assertTrue(
            {"course_published", "course_submitted", "instructor_applied", "payout_requested"} <= kinds
        )
        self.assertEqual([i["at"] for i in items], sorted((i["at"] for i in items), reverse=True))
        self.assertTrue(all(i["url"].startswith("/console") for i in items))

    @override_settings(STRIPE_SECRET_KEY="sk_test_do_not_leak", MAIL_MODE="console")
    def test_health_tiles_never_leak_secrets(self):
        calls = []

        def handler(request):
            calls.append(request.url.host)
            return httpx.Response(
                401, json={"error": {"message": "Invalid API Key provided: sk_test_do_not_leak"}}
            )

        healthchecks.transport = httpx.MockTransport(handler)
        try:
            r = self.client.get(f"{API}/health")
            again = self.client.get(f"{API}/health")
        finally:
            healthchecks.transport = None
        self.assertEqual(r.status_code, 200)
        tiles = {t["key"]: t for t in r.json()["tiles"]}
        self.assertEqual(set(tiles), {"database", "cache", "queue", "storage", "video", "email", "payments"})
        self.assertEqual(tiles["database"]["status"], "ok")
        self.assertEqual(tiles["queue"]["status"], "ok")
        self.assertEqual(tiles["payments"]["status"], "down")
        self.assertEqual(tiles["email"]["status"], "warning")  # console mail mode
        self.assertNotIn("sk_test", r.content.decode())
        self.assertEqual(calls.count("api.stripe.com"), 1)  # the second request used the 60 s cache
        self.assertEqual(again.json()["tiles"][-1]["status"], "down")
        down = sum(t["status"] == "down" for t in r.json()["tiles"])
        with tenant_context(user_id=self.staff.id, staff=True):  # one alert per red service per hour
            alerts = Notification.objects.filter(user=self.staff, kind="staff_health_alert")
            self.assertEqual(alerts.count(), down)  # the second call added none
            self.assertNotIn("sk_test", " ".join(alerts.values_list("body", flat=True)))

    def test_an_instructor_application_alerts_staff(self):
        self.client.force_login(self.omar)
        r = self.client.post("/api/v1/studio/instructor-profile", {"headline": "Data teacher", "bio": "Hello"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 200)
        with tenant_context(user_id=self.staff.id, staff=True):
            alert = Notification.objects.get(user=self.staff, kind="staff_instructor_application")
        self.assertIn("Omar", alert.body)
        self.assertTrue(alert.url.startswith("/console/instructors"))
