"""B2B-07 tests: cancellation requests, departure policies, certificate gate."""

import uuid
from unittest.mock import MagicMock, patch

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.cancellations import (
    process_refund,
    review_cancellation,
    submit_cancellation,
)
from apps.corporate.certificates import ConfigurationBlocked, issue_live_certificate
from apps.corporate.departure import apply_departure, get_or_default_policy, set_policy
from apps.corporate.models import (
    CancellationRequest,
    CorporateOffering,
    SeatPurchase,
)
from apps.corporate.services import allocate_seat
from apps.identity.models import User
from apps.org.models import Organization, OrgMember
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class CancellationTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff = User.objects.create_user(
                f"cancel-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"CancelCorp {tag}",
                slug=f"cancelcorp-{tag}",
                status="active",
            )
            self.admin_user = User.objects.create_user(
                f"cancel-admin-{tag}@test.com",
                "test123",
            )
            self.employee = User.objects.create_user(
                f"cancel-emp-{tag}@test.com",
                "test123",
            )
            OrgMember.objects.create(org=self.org, user=self.admin_user, role="admin", joined_at=now)
            OrgMember.objects.create(org=self.org, user=self.employee, role="learner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"cancel-cat-{tag}",
                name=f"CancelCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.category,
                slug=f"cancel-c-{tag}",
                title=f"Cancel Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"CancelTier-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="recorded",
                price_tier=self.tier,
                is_active=True,
            )
            self.purchase = SeatPurchase.objects.create(
                org=self.org,
                offering=self.offering,
                buyer=self.admin_user,
                quantity=3,
                unit_price_minor=5000,
                currency="GBP",
                total_minor=15000,
                gbp_total_minor=15000,
                status="paid",
                paid_at=timezone.now(),
                payment_intent="pi_test_cancel_123",
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
            count = CancellationRequest.objects.count()
        self.assertGreaterEqual(count, 0)

    def test_submit_cancellation(self):
        with tenant_context(staff=True):
            cr = submit_cancellation(
                self._request(self.admin_user),
                type="recorded_refund",
                reason="No longer needed",
                seat_purchase_id=self.purchase.id,
            )
        self.assertEqual(cr.status, "submitted")
        self.assertEqual(cr.type, "recorded_refund")

    def test_review_approve(self):
        with tenant_context(staff=True):
            cr = submit_cancellation(
                self._request(self.admin_user),
                type="recorded_refund",
                reason="Want refund",
                seat_purchase_id=self.purchase.id,
            )
            reviewed = review_cancellation(
                self._request(),
                str(cr.id),
                approve=True,
                admin_notes="Approved by admin",
            )
        self.assertEqual(reviewed.status, "approved")
        self.assertIsNotNone(reviewed.reviewed_at)

    def test_review_reject(self):
        with tenant_context(staff=True):
            cr = submit_cancellation(
                self._request(self.admin_user),
                type="recorded_refund",
                reason="Want refund",
            )
            reviewed = review_cancellation(
                self._request(),
                str(cr.id),
                approve=False,
            )
        self.assertEqual(reviewed.status, "rejected")

    @patch("apps.commerce.gateway.refund", return_value="re_test_123")
    def test_process_refund(self, mock_refund):
        with tenant_context(staff=True):
            cr = submit_cancellation(
                self._request(self.admin_user),
                type="recorded_refund",
                reason="Refund please",
                seat_purchase_id=self.purchase.id,
            )
            review_cancellation(self._request(), str(cr.id), approve=True)
            processed = process_refund(
                self._request(),
                str(cr.id),
                amount_minor=5000,
                currency="GBP",
            )
        self.assertEqual(processed.status, "processed")
        self.assertEqual(processed.refund_amount_minor, 5000)
        self.assertEqual(processed.stripe_refund_id, "re_test_123")
        mock_refund.assert_called_once()

    def test_refund_requires_approval(self):
        with tenant_context(staff=True):
            cr = submit_cancellation(
                self._request(self.admin_user),
                type="recorded_refund",
                reason="Refund please",
                seat_purchase_id=self.purchase.id,
            )
            with self.assertRaises(ServiceError) as cm:
                process_refund(self._request(), str(cr.id), amount_minor=5000)
        self.assertEqual(cm.exception.code, "not_approved")


class DeparturePolicyTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff = User.objects.create_user(
                f"dep-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"DepCorp {tag}",
                slug=f"depcorp-{tag}",
                status="active",
            )
            self.employee = User.objects.create_user(
                f"dep-emp-{tag}@test.com",
                "test123",
            )
            OrgMember.objects.create(org=self.org, user=self.employee, role="learner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"dep-cat-{tag}",
                name=f"DepCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.category,
                slug=f"dep-c-{tag}",
                title=f"Departure Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"DepTier-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="recorded",
                price_tier=self.tier,
                is_active=True,
            )
            self.purchase = SeatPurchase.objects.create(
                org=self.org,
                offering=self.offering,
                buyer=self.staff,
                quantity=3,
                unit_price_minor=5000,
                currency="GBP",
                total_minor=15000,
                gbp_total_minor=15000,
                status="paid",
                paid_at=timezone.now(),
            )

    def _request(self, user=None):
        u = user or self.staff
        req = MagicMock()
        req.user = u
        req.auth = u
        req.org_id = self.org.id
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def test_default_policy_is_admin_decides(self):
        with tenant_context(staff=True):
            action = get_or_default_policy(self.org.id)
        self.assertEqual(action, "admin_decides")

    def test_set_policy(self):
        with tenant_context(staff=True):
            policy = set_policy(self._request(), self.org.id, "revoke_all")
        self.assertEqual(policy.action, "revoke_all")

    def _leave(self):
        OrgMember.objects.filter(org=self.org, user=self.employee).update(removed_at=timezone.now())

    def test_departure_keeps_paid_access_until_it_expires(self):
        """Leaves on day 0, paid until day 20: access stays, then ends by itself."""
        from datetime import timedelta

        from apps.learning.models import Enrollment
        from apps.learning.services import _check_access

        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee.id)
            Enrollment.objects.filter(pk=alloc.enrollment_id).update(
                access_expires_at=timezone.now() + timedelta(days=20)
            )
            set_policy(self._request(), self.org.id, "revoke_all")  # even the strictest policy
            self._leave()
            result = apply_departure(self._request(), self.org.id, self.employee.id)
            alloc.refresh_from_db()
            enrolment = Enrollment.objects.get(pk=alloc.enrollment_id)
            _check_access(enrolment)  # still allowed: no error

            Enrollment.objects.filter(pk=enrolment.pk).update(
                access_expires_at=timezone.now() - timedelta(seconds=1)
            )
            enrolment.refresh_from_db()
            with self.assertRaises(ServiceError) as cm:
                _check_access(enrolment)
        self.assertEqual(result["revoked"], 0)
        self.assertEqual(result["preserved"], 1)
        self.assertEqual(alloc.status, "active", "the paid seat is not freed or reused")
        self.assertEqual(enrolment.status, "active", "the enrolment and its progress are kept")
        self.assertEqual(cm.exception.code, "access_expired")

    def test_departure_needs_the_person_to_have_left(self):
        with tenant_context(staff=True):
            with self.assertRaises(ServiceError) as cm:
                apply_departure(self._request(), self.org.id, self.employee.id)
        self.assertEqual(cm.exception.code, "still_member")

    def test_departure_with_lifetime_seat_keeps_access(self):
        with tenant_context(staff=True):
            allocate_seat(self._request(), self.purchase.id, self.employee.id)
            self._leave()
            result = apply_departure(self._request(), self.org.id, self.employee.id)
        self.assertEqual(result["courses"][0]["access_expires_at"], None)
        self.assertEqual(result["revoked"], 0)


class LiveCertificateGateTest(SchemaTransactionTestCase):
    def test_live_certificate_blocked(self):
        with self.assertRaises(ConfigurationBlocked):
            issue_live_certificate("fake-enrollment-id", "fake-cohort-id")
