"""M5 P17: console reports: KPIs vs the previous period, category and instructor filters,
top courses, recent sales, and the CSV export (audited, no spreadsheet formulas)."""

import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.catalog.models import Category
from apps.commerce.models import Order, OrderItem
from apps.identity.models import InstructorProfile, User
from apps.learning.models import Enrollment
from apps.platform.models import AuditLog
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/console"


class ConsoleReportsTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        self.ana = User.objects.create_user("ana@learnhub.example.com", "x", full_name="Ana Author")
        for u in (self.teacher, self.ana):
            InstructorProfile.objects.create(user=u, status="approved")
        dev = f.money(self.staff)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.design = Category.objects.create(name="Design", slug="design", icon="pen")
        self.py = f.course(
            staff=self.staff, owner=self.teacher, slug="py", title="Python basics", category=dev
        )
        self.ux = f.course(
            staff=self.staff, owner=self.ana, slug="ux", title="=UX design", category=self.design
        )
        self.dev = dev
        self.client.force_login(self.staff)

    def sale(self, course, gbp: int, days_ago: int, buyer=None, card=("visa", "4242")):
        buyer = buyer or self.sara
        when = timezone.now() - timedelta(days=days_ago)
        with tenant_context(user_id=self.staff.id, staff=True):
            o = Order.objects.create(
                user=buyer, currency_id="GBP", subtotal_minor=gbp, total_minor=gbp, fx_rate=Decimal(1),
                gbp_total_minor=gbp, status="paid", paid_at=when, card_brand=card[0], card_last4=card[1],
            )  # fmt: skip
            e = Enrollment.objects.create(user=buyer, course=course, source="purchase", enrolled_at=when)
            OrderItem.objects.create(user=buyer, order=o, course=course, list_minor=gbp, gross_minor=gbp,
                                     gbp_gross_minor=gbp, enrollment=e)  # fmt: skip
        return o

    def test_kpis_and_filters(self):
        self.sale(self.py, 5000, 2)
        self.sale(self.ux, 3000, 3, buyer=self.omar, card=("mastercard", "1188"))
        self.sale(self.py, 2000, 40, buyer=self.omar)  # the 30 days before
        all_ = self.client.get(f"{API}/reports").json()
        self.assertFalse(all_["filtered"])
        self.assertEqual(all_["course_revenue_gbp_minor"]["value"], 8000)
        self.assertEqual(all_["course_revenue_gbp_minor"]["previous"], 2000)
        self.assertEqual(all_["orders"]["value"], 2)
        self.assertEqual(all_["average_order_gbp_minor"]["value"], 4000)
        self.assertEqual(all_["enrolments"]["value"], 2)
        self.assertEqual({r["key"]: r["value"] for r in all_["enrolments_by_type"]}, {"purchase": 2})
        self.assertEqual([c["title"] for c in all_["top_courses"]], ["=UX design", "Python basics"])
        self.assertEqual(all_["recent_sales"][0]["payment_method"], "Visa •••• 4242")
        self.assertEqual(sum(p["value"] for p in all_["revenue_series"]), 8000)

        by_cat = self.client.get(f"{API}/reports?category={self.design.id}").json()
        self.assertTrue(by_cat["filtered"])
        self.assertEqual(by_cat["course_revenue_gbp_minor"]["value"], 3000)
        self.assertEqual([c["title"] for c in by_cat["top_courses"]], ["=UX design"])
        self.assertEqual(by_cat["plans"], [])  # subscriptions are not split by course
        by_teacher = self.client.get(f"{API}/reports?instructor={self.teacher.id}").json()
        self.assertEqual(by_teacher["course_revenue_gbp_minor"]["value"], 5000)
        self.assertEqual(self.client.get(f"{API}/reports?range=nope").status_code, 400)
        choices = self.client.get(f"{API}/reports/filters").json()
        self.assertEqual([c["name"] for c in choices["categories"]], ["Design", "Development"])
        self.assertEqual([i["name"] for i in choices["instructors"]], ["Ana Author", "Tom Teacher"])

    def test_csv_export_is_audited_and_safe(self):
        self.sale(self.ux, 3000, 1)
        r = self.client.get(f"{API}/reports/export.csv?types=courses,sales")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r["Content-Type"].startswith("text/csv"))
        self.assertIn("attachment", r["Content-Disposition"])
        rows = list(csv.reader(io.StringIO(b"".join(r.streaming_content).decode())))
        flat = [c for row in rows for c in row]
        self.assertIn("'=UX design", flat)  # a title starting with "=" cannot run as a formula
        self.assertNotIn("=UX design", flat)
        self.assertIn("Course revenue (GBP)", flat)
        self.assertNotIn("Plan", flat)  # subscriptions section not chosen
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertTrue(AuditLog.objects.filter(action="report.export").exists())
        self.client.force_login(self.sara)
        self.assertEqual(self.client.get(f"{API}/reports/export.csv").status_code, 403)

    def test_completion_date_and_published_reviews(self):
        from apps.engagement.models import Review

        order = self.sale(self.py, 1000, 40)
        with tenant_context(user_id=self.staff.id, staff=True):
            item = order.items.get()
            Enrollment.objects.filter(pk=item.enrollment_id).update(
                completed_at=timezone.now(), status="completed"
            )
            Review.objects.create(course=self.py, user=self.sara, rating=5, status="published")
            Review.objects.create(course=self.py, user=self.omar, rating=1, status="hidden")
        data = self.client.get(f"{API}/reports").json()
        row = next(c for c in data["top_courses"] if c["id"] == str(self.py.id))
        self.assertEqual(row["enrolments"], 0)
        self.assertEqual(row["completions"], 1)
        self.assertEqual(row["rating"], 5)
        self.assertEqual(row["rating_count"], 1)

    def test_export_includes_more_than_ten_and_keeps_deleted_course_receipts(self):
        for n in range(12):
            course = f.course(
                staff=self.staff,
                owner=self.teacher,
                slug=f"report-{n}",
                title=f"Report course {n}",
                category=self.dev,
            )
            self.sale(course, 1000, 2)
        with tenant_context(user_id=self.staff.id, staff=True):
            type(course).objects.filter(pk=course.id).update(deleted_at=timezone.now(), status="draft")
        data = self.client.get(f"{API}/reports").json()
        self.assertEqual(data["orders"]["value"], 12)
        self.assertEqual(data["revenue_gbp_minor"]["value"], 12000)
        self.assertEqual(len(data["recent_sales"]), 10)
        response = self.client.get(f"{API}/reports/export.csv?types=courses,sales")
        rows = list(csv.reader(io.StringIO(b"".join(response.streaming_content).decode())))
        courses = [row for row in rows if row and row[0].startswith("Report course ")]
        self.assertEqual(len(courses), 12)

    def test_rejects_unknown_scope_and_export_sections(self):
        self.assertEqual(self.client.get(f"{API}/reports?scope=unknown").status_code, 400)
        self.assertEqual(self.client.get(f"{API}/reports/export.csv?types=unknown").status_code, 400)
        self.assertEqual(self.client.get(f"{API}/reports/export.csv?types=").status_code, 400)
