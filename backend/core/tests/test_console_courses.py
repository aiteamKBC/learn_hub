"""M5 P5 console courses: list (tabs, KPIs, filters), the detail panel, status changes with
reasons and notifications, bulk actions, duplicate, soft delete, company courses,
categories, access duration; and that M1-M4 behaviour stays the same when unused."""

from datetime import timedelta

from django.utils import timezone

from apps.catalog.models import Category, Course
from apps.commerce.models import CoursePrice, Plan, PlanCourse, Subscription
from apps.engagement.models import Notification
from apps.identity.models import InstructorProfile
from apps.learning import services as learning
from apps.platform.models import AuditLog
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/console"


class ConsoleCoursesTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        self.dev = f.money(self.staff)
        InstructorProfile.objects.create(user=self.teacher, status="approved")
        self.py = f.course(
            staff=self.staff, owner=self.teacher, slug="py", title="Python basics", category=self.dev
        )
        self.git = f.course(
            staff=self.staff, owner=self.staff, slug="git", title="Git at work", ownership="platform"
        )
        self.client.force_login(self.staff)

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def patch(self, path, data):
        return self.client.patch(API + path, data=data, content_type="application/json")

    def get(self, path):
        return self.client.get(API + path)

    def staff_read(self, fn):
        with tenant_context(staff=True):
            return fn()

    def test_list_tabs_kpis_filters_and_detail(self):
        r = self.get("/courses").json()
        self.assertEqual(r["kpis"]["total"], 2)
        self.assertEqual(r["kpis"]["published"], 2)
        self.assertEqual({i["title"] for i in r["items"]}, {"Python basics", "Git at work"})
        self.assertEqual(
            [i["title"] for i in self.get("/courses?tab=company").json()["items"]], ["Git at work"]
        )
        self.assertEqual(
            [i["title"] for i in self.get("/courses?tab=instructor").json()["items"]], ["Python basics"]
        )
        self.assertEqual([i["title"] for i in self.get("/courses?q=tom").json()["items"]], ["Python basics"])
        self.assertEqual([i["title"] for i in self.get(f"/courses?category={self.dev.id}").json()["items"]],
                         ["Python basics"])  # fmt: skip
        self.assertEqual(self.get("/courses?tab=bogus").status_code, 400)
        page = self.get("/courses?limit=1").json()
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(len(self.get(f"/courses?limit=1&cursor={page['next_cursor']}").json()["items"]), 1)
        row = next(i for i in r["items"] if i["title"] == "Python basics")
        self.assertEqual(
            (row["owner_name"], row["category"], row["status"]), ("Tom Teacher", "Development", "published")
        )
        self.assertGreater(row["price_gbp_minor"], 0)

        d = self.get(f"/courses/{self.py.id}").json()
        self.assertEqual(d["language"], "en")
        self.assertIsNone(d["access_days"])
        self.assertEqual(d["sections"][0]["lessons"], 4)
        self.assertEqual(d["performance"]["enrolments"], 0)
        self.assertEqual([v["status"] for v in d["versions"]], ["published"])
        self.assertTrue(d["tiers"])

    def test_pricing_access_and_access_duration(self):
        self.assertEqual(self.patch(f"/courses/{self.py.id}", {"language": "xx"}).status_code, 400)
        self.patch(f"/courses/{self.py.id}", {"language": "fr", "access_days": 90, "in_subscription": False})
        c = Course.objects.get(pk=self.py.id)
        self.assertEqual((c.language, c.access_days, c.in_subscription), ("fr", 90, False))
        with tenant_context(user_id=self.sara.id):
            e = learning.enrol(user=self.sara, course=c, source="purchase")
        self.assertAlmostEqual(
            e.access_expires_at, timezone.now() + timedelta(days=90), delta=timedelta(minutes=1)
        )
        self.patch(f"/courses/{self.py.id}", {"lifetime_access": True})
        self.assertIsNone(Course.objects.get(pk=self.py.id).access_days)
        tier = self.get(f"/courses/{self.py.id}").json()["tiers"][0]
        self.assertEqual(self.client.put(f"{API}/courses/{self.py.id}/price", data={"tier_id": tier["id"]},
                                         content_type="application/json").status_code, 200)  # fmt: skip
        self.assertEqual(
            self.staff_read(lambda: str(CoursePrice.objects.get(course=self.py).tier_id)), tier["id"]
        )
        self.assertTrue(self.staff_read(lambda: AuditLog.objects.filter(action="course.price").exists()))

    def test_lifetime_access_is_unchanged_when_not_set(self):  # M1 behaviour
        with tenant_context(user_id=self.sara.id):
            e = learning.enrol(user=self.sara, course=self.py, source="purchase")
        self.assertIsNone(e.access_expires_at)

    def test_unpublish_needs_reason_relist_and_notifications(self):
        self.assertEqual(self.post(f"/courses/{self.py.id}/status", {"action": "unpublish"}).status_code, 400)
        self.post(f"/courses/{self.py.id}/status", {"action": "unpublish", "reason": "Out of date"})
        self.assertEqual(Course.objects.get(pk=self.py.id).status, "unlisted")
        self.post(f"/courses/{self.py.id}/status", {"action": "relist"})
        self.assertEqual(Course.objects.get(pk=self.py.id).status, "published")
        kinds = self.staff_read(
            lambda: list(Notification.objects.filter(user=self.teacher).values_list("kind", flat=True))
        )
        self.assertIn("course_unpublished", kinds)
        self.assertIn("course_relisted", kinds)
        actions = self.staff_read(
            lambda: set(AuditLog.objects.filter(target_id=str(self.py.id)).values_list("action", flat=True))
        )
        self.assertTrue({"course.unpublish", "course.relist"} <= actions)
        # platform courses have no marketplace instructor to tell
        self.post(f"/courses/{self.git.id}/status", {"action": "unpublish", "reason": "Rewrite"})
        self.assertFalse(
            self.staff_read(
                lambda: Notification.objects.filter(user=self.staff, kind="course_unpublished").exists()
            )
        )

    def test_bulk_actions_duplicate_and_soft_delete(self):
        ux = Category.objects.create(name="Design", slug="design")
        r = self.post("/courses/bulk", {"ids": [str(self.py.id), str(self.git.id)], "action": "category",
                                        "category_id": str(ux.id)}).json()  # fmt: skip
        self.assertEqual((r["done"], r["failed"]), (2, []))
        self.assertEqual(Course.objects.filter(category=ux).count(), 2)
        self.assertEqual(
            self.post("/courses/bulk", {"ids": [str(self.py.id)], "action": "unpublish"}).status_code, 400
        )

        copy_id = self.post(f"/courses/{self.py.id}/duplicate").json()["id"]
        copy = Course.objects.get(pk=copy_id)
        self.assertEqual((copy.title, copy.status), ("Copy of Python basics", "draft"))
        self.assertEqual(copy.versions.get().lectures.count(), 4)
        self.assertTrue(self.staff_read(lambda: CoursePrice.objects.filter(course=copy).exists()))
        # a draft can't be published before review: reported per course, others still done
        r = self.post("/courses/bulk", {"ids": [copy_id, str(self.git.id)], "action": "archive"}).json()
        self.assertEqual(r["done"], 2)
        r = self.post("/courses/bulk", {"ids": [copy_id, str(self.git.id)], "action": "publish"}).json()
        self.assertEqual(r["done"], 1)
        self.assertEqual(r["failed"][0]["title"], "Copy of Python basics")

        # soft delete: refused while learners are enrolled, allowed for the draft
        with tenant_context(user_id=self.sara.id):
            learning.enrol(user=self.sara, course=self.py, source="purchase")
        r = self.post("/courses/bulk", {"ids": [str(self.py.id), copy_id], "action": "delete"}).json()
        self.assertEqual(r["done"], 1)
        self.assertIn("Archive it instead", r["failed"][0]["message"])
        self.assertIsNotNone(Course.objects.get(pk=copy_id).deleted_at)  # the row stays
        self.assertNotIn(copy_id, [i["id"] for i in self.get("/courses").json()["items"]])
        archived = self.get("/courses?tab=archived").json()["items"]
        self.assertTrue(next(i for i in archived if i["id"] == copy_id)["deleted"])

    def test_company_course_and_categories(self):
        cid = self.post("/courses/company", {"title": "Fire safety"}).json()["id"]
        c = Course.objects.get(pk=cid)
        self.assertEqual((c.ownership, c.status), ("platform", "draft"))
        # the studio builder opens it for staff
        self.assertEqual(self.client.get(f"/api/v1/studio/courses/{cid}").status_code, 200)

        a = self.post("/categories", {"name": "Business", "icon": "briefcase"}).json()["id"]
        self.assertEqual(self.post("/categories", {"name": "X"}).status_code, 422)
        self.assertEqual(self.post("/categories", {"name": "Bad icon", "icon": "<svg>"}).status_code, 400)
        self.patch(f"/categories/{a}", {"is_active": False, "name": "Business skills"})
        cat = Category.objects.get(pk=a)
        self.assertEqual((cat.name, cat.is_active), ("Business skills", False))
        top = [
            str(i)
            for i in Category.objects.filter(parent__isnull=True)
            .order_by("sort_order")
            .values_list("id", flat=True)
        ]
        self.assertEqual(self.post("/categories/reorder", {"ids": top[::-1]}).status_code, 200)
        self.assertEqual(
            [
                str(i)
                for i in Category.objects.filter(parent__isnull=True)
                .order_by("sort_order")
                .values_list("id", flat=True)
            ],
            top[::-1],
        )
        self.assertEqual(self.post("/categories/reorder", {"ids": top[:1]}).status_code, 400)
        rows = self.get("/categories").json()
        self.assertEqual(next(r for r in rows if r["slug"] == "development")["course_count"], 1)

    def test_non_staff_refused(self):
        for user in (self.teacher, self.sara):
            self.client.force_login(user)
            self.assertEqual(self.get("/courses").status_code, 403)
            self.assertEqual(
                self.post("/courses/bulk", {"ids": [str(self.py.id)], "action": "archive"}).status_code, 403
            )
        self.assertEqual(Course.objects.get(pk=self.py.id).status, "published")

    def test_course_page_plan_access_follows_the_plans_courses(self):
        def access(slug):
            return self.client.get(f"/api/v1/catalog/courses/{slug}").json()["viewer"]["plan_access"]

        with tenant_context(staff=True):
            Course.objects.filter(pk__in=[self.py.id, self.git.id]).update(in_subscription=True)
            plan = Plan.objects.create(
                code="personal-m", name="Personal", audience="personal", interval="month"
            )
        self.client.force_login(self.sara)
        self.assertFalse(access("py"))  # no plan yet
        with tenant_context(user_id=self.sara.id):
            Subscription.objects.create(
                user=self.sara,
                plan=plan,
                currency_id="GBP",
                status="active",
                current_period_end=timezone.now() + timedelta(days=30),
            )
        # a plan with no course list covers every course marked "in subscription"
        self.assertTrue(access("py"))
        self.assertTrue(access("git"))
        # once the plan lists its courses, only those are covered
        with tenant_context(staff=True):
            PlanCourse.objects.create(plan=plan, course=self.git)
        self.assertFalse(access("py"))
        self.assertTrue(access("git"))
