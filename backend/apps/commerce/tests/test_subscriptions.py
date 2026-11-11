"""B2C-07 tests: unlimited personal subscription — resolver, plan query, exclusion."""

import uuid

from django.utils import timezone

from apps.commerce.models import Plan, PlanPrice, Subscription
from apps.commerce.subscriptions import get_active_subscription, list_unlimited_plans
from apps.identity.models import User
from apps.platform.access import resolve
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class UnlimitedSubscriptionTest(SchemaTransactionTestCase):

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                f"sub-{tag}@learnhub-demo.com", "test123", is_staff=False,
            )
            self.staff = User.objects.create_user(
                f"sub-staff-{tag}@learnhub-demo.com", "test123", is_staff=True,
            )
            self._setup_catalog(tag)
            self._setup_plan(tag)

    def _setup_catalog(self, tag):
        from apps.catalog.models import Category, Course, CourseVersion, Lecture, Section

        self.category = Category.objects.create(
            slug=f"sub-cat-{tag}", name=f"SubCat {tag}", sort_order=0,
        )
        self.course = Course.objects.create(
            ownership="platform", status="published", created_by=self.staff,
            category=self.category, slug=f"sub-c1-{tag}", title=f"Sub Course {tag}",
            in_subscription=True,
        )
        self.course_excluded = Course.objects.create(
            ownership="platform", status="published", created_by=self.staff,
            category=self.category, slug=f"sub-c2-{tag}", title=f"Excluded Course {tag}",
            in_subscription=False,
        )
        v = CourseVersion.objects.create(course=self.course, number=1, status="published")
        self.course.live_version = v
        self.course.save(update_fields=["live_version"])
        v2 = CourseVersion.objects.create(course=self.course_excluded, number=1, status="published")
        self.course_excluded.live_version = v2
        self.course_excluded.save(update_fields=["live_version"])
        sec = Section.objects.create(version=v, title="S1", position=0)
        self.lecture = Lecture.objects.create(
            version=v, section=sec, lecture_key=uuid.uuid4(),
            kind="video", title="L1", position=0,
        )
        self.lecture_excluded = Lecture.objects.create(
            version=v, section=sec, lecture_key=uuid.uuid4(),
            kind="video", title="L2 excluded", position=1,
            excluded_from_subscription=True,
        )

    def _setup_plan(self, tag):
        self.plan = Plan.objects.create(
            code=f"unlimited-{tag}", name=f"Unlimited {tag}",
            audience="personal", kind="unlimited_b2c",
            interval="month", trial_days=7, is_active=True,
        )
        PlanPrice.objects.create(
            plan=self.plan, currency_id="GBP",
            amount_minor=999, stripe_price_id=f"price_{tag}",
        )

    def _subscribe(self, status="active"):
        return Subscription.objects.create(
            user=self.user, plan=self.plan, currency_id="GBP",
            status=status,
            current_period_end=timezone.now() + timezone.timedelta(days=30),
        )

    def test_active_sub_grants_course_access(self):
        with tenant_context(staff=True):
            self._subscribe()
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "course", self.course.id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "subscription")

    def test_active_sub_grants_lecture_access(self):
        with tenant_context(staff=True):
            self._subscribe()
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "lecture", self.lecture.id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "subscription")

    def test_sub_denied_for_excluded_course(self):
        with tenant_context(staff=True):
            self._subscribe()
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "course", self.course_excluded.id)
        self.assertFalse(d.allowed)

    def test_sub_denied_for_excluded_lecture(self):
        with tenant_context(staff=True):
            self._subscribe()
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "lecture", self.lecture_excluded.id)
        self.assertFalse(d.allowed)

    def test_no_sub_no_access(self):
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "course", self.course.id)
        self.assertFalse(d.allowed)

    def test_canceled_sub_no_access(self):
        with tenant_context(staff=True):
            self._subscribe(status="canceled")
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "course", self.course.id)
        self.assertFalse(d.allowed)

    def test_list_unlimited_plans(self):
        with tenant_context(staff=True):
            plans = list_unlimited_plans("GBP")
        self.assertTrue(any(p["code"] == self.plan.code for p in plans))
        plan = next(p for p in plans if p["code"] == self.plan.code)
        self.assertEqual(plan["amount_minor"], 999)

    def test_get_active_subscription(self):
        with tenant_context(staff=True):
            self._subscribe()
            result = get_active_subscription(self.user)
        self.assertIsNotNone(result)
        self.assertEqual(result["plan_code"], self.plan.code)
        self.assertEqual(result["status"], "active")

    def test_get_no_subscription(self):
        with tenant_context(staff=True):
            result = get_active_subscription(self.user)
        self.assertIsNone(result)

    def test_trialing_sub_grants_access(self):
        with tenant_context(staff=True):
            self._subscribe(status="trialing")
        with tenant_context(user_id=str(self.user.id), staff=True):
            d = resolve(self.user, "course", self.course.id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "subscription")
