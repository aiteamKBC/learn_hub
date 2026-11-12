"""B2B-03 tests: live training requests, cohort lifecycle, scheduling."""

import uuid
from unittest.mock import MagicMock

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.live import (
    add_company_to_cohort,
    cancel_request,
    confirm_cohort,
    create_cohort,
    remove_company_from_cohort,
    submit_request,
)
from apps.corporate.models import (
    CohortCompany,
    CorporateOffering,
)
from apps.corporate.scheduling import add_session
from apps.identity.models import User
from apps.org.models import Organization, OrgMember
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class LiveCohortTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff = User.objects.create_user(
                f"staff-live-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"LiveCorp {tag}",
                slug=f"livecorp-{tag}",
                status="active",
            )
            self.admin_user = User.objects.create_user(
                f"live-admin-{tag}@test.com",
                "test123",
            )
            OrgMember.objects.create(org=self.org, user=self.admin_user, role="admin", joined_at=now)

            self.org2 = Organization.objects.create(
                name=f"OtherLive {tag}",
                slug=f"otherlive-{tag}",
                status="active",
            )
            self.admin2 = User.objects.create_user(
                f"live-admin2-{tag}@test.com",
                "test123",
            )
            OrgMember.objects.create(org=self.org2, user=self.admin2, role="admin", joined_at=now)

            self.category = Category.objects.create(
                slug=f"live-cat-{tag}",
                name=f"LiveCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.category,
                slug=f"live-c-{tag}",
                title=f"Live Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"LiveTier-{tag}", gbp_minor=10000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="live",
                price_tier=self.tier,
                is_active=True,
            )

    def _request(self, user=None, org=None):
        u = user or self.staff
        req = MagicMock()
        req.user = u
        req.auth = u
        req.org_id = (org or self.org).id
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def test_000_warmup(self):
        """Warm up Neon pooler schema cache."""
        with tenant_context(staff=True):
            from apps.corporate.models import TrainingRequest

            count = TrainingRequest.objects.count()
        self.assertGreaterEqual(count, 0)

    def test_submit_training_request(self):
        with tenant_context(staff=True):
            tr = submit_request(
                self._request(self.admin_user),
                self.course.id,
                10,
                preferred_intake="Q1 2027",
            )
        self.assertEqual(tr.status, "submitted")
        self.assertEqual(tr.requested_seats, 10)

    def test_cancel_training_request(self):
        with tenant_context(staff=True):
            tr = submit_request(self._request(self.admin_user), self.course.id, 5)
            cancelled = cancel_request(self._request(self.admin_user), tr.id)
        self.assertEqual(cancelled.status, "cancelled")

    def test_cancel_only_cancellable_statuses(self):
        with tenant_context(staff=True):
            tr = submit_request(self._request(self.admin_user), self.course.id, 5)
            tr.status = "accepted"
            tr.save(update_fields=["status"])
            with self.assertRaises(ServiceError) as cm:
                cancel_request(self._request(self.admin_user), tr.id)
        self.assertEqual(cm.exception.code, "not_cancellable")

    def test_create_cohort(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=20,
            )
        self.assertEqual(cohort.status, "forming")
        self.assertEqual(cohort.max_learners, 20)

    def test_add_company_to_cohort(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=30,
            )
            cc = add_company_to_cohort(
                self._request(),
                cohort.id,
                self.org.id,
                10,
            )
        self.assertEqual(cc.approved_seats, 10)
        self.assertEqual(cc.status, "interested")
        with tenant_context(staff=True):
            cohort.refresh_from_db()
        self.assertEqual(cohort.current_seats, 10)

    def test_add_company_exceeds_capacity(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=10,
            )
            add_company_to_cohort(self._request(), cohort.id, self.org.id, 8)
            with self.assertRaises(ServiceError) as cm:
                add_company_to_cohort(self._request(), cohort.id, self.org2.id, 5)
        self.assertEqual(cm.exception.code, "cohort_full")

    def test_add_duplicate_company_rejected(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=30,
            )
            add_company_to_cohort(self._request(), cohort.id, self.org.id, 5)
            with self.assertRaises(ServiceError) as cm:
                add_company_to_cohort(self._request(), cohort.id, self.org.id, 5)
        self.assertEqual(cm.exception.code, "already_in_cohort")

    def test_remove_company_updates_seat_count(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=30,
            )
            add_company_to_cohort(self._request(), cohort.id, self.org.id, 10)
            remove_company_from_cohort(self._request(), cohort.id, self.org.id)
            cohort.refresh_from_db()
        self.assertEqual(cohort.current_seats, 0)

    def test_confirm_cohort_requires_session(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=5,
                min_learners=1,
            )
            add_company_to_cohort(self._request(), cohort.id, self.org.id, 3)
            with self.assertRaises(ServiceError) as cm:
                confirm_cohort(self._request(), cohort.id)
        self.assertEqual(cm.exception.code, "no_sessions")

    def test_confirm_cohort_updates_companies(self):
        with tenant_context(staff=True):
            cohort = create_cohort(
                self._request(),
                course_id=self.course.id,
                delivery_mode="online",
                max_learners=20,
                min_learners=1,
            )
            add_company_to_cohort(self._request(), cohort.id, self.org.id, 5)
            add_session(
                self._request(),
                cohort.id,
                sequence=1,
                scheduled_at=timezone.now(),
                duration_min=60,
            )
            confirmed = confirm_cohort(self._request(), cohort.id)
        self.assertEqual(confirmed.status, "confirmed")
        with tenant_context(staff=True):
            cc = CohortCompany.objects.get(cohort=cohort, org=self.org)
        self.assertEqual(cc.status, "offered")
