"""B2B-01 tests: corporate seat ledger — offerings, allocation, release, reassign."""

import uuid
from unittest.mock import MagicMock

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.models import (
    AllocationEvent,
    CorporateOffering,
    SeatAllocation,
    SeatPurchase,
)
from apps.corporate.services import allocate_seat, reassign_seat, release_seat, seat_inventory
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.org.models import OrgMember, Organization
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class SeatLedgerTest(SchemaTransactionTestCase):

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff_user = User.objects.create_user(
                f"b2b-staff-{tag}@test.com", "test123", is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"TestCorp {tag}", slug=f"testcorp-{tag}", status="active",
            )
            self.buyer = User.objects.create_user(
                f"b2b-buyer-{tag}@test.com", "test123", is_staff=False,
            )
            self.employee1 = User.objects.create_user(
                f"b2b-emp1-{tag}@test.com", "test123", is_staff=False,
            )
            self.employee2 = User.objects.create_user(
                f"b2b-emp2-{tag}@test.com", "test123", is_staff=False,
            )
            self.outsider = User.objects.create_user(
                f"b2b-out-{tag}@test.com", "test123", is_staff=False,
            )
            OrgMember.objects.create(org=self.org, user=self.buyer, role="owner", joined_at=now)
            OrgMember.objects.create(org=self.org, user=self.employee1, role="learner", joined_at=now)
            OrgMember.objects.create(org=self.org, user=self.employee2, role="learner", joined_at=now)

            self.org2 = Organization.objects.create(
                name=f"OtherCorp {tag}", slug=f"othercorp-{tag}", status="active",
            )
            OrgMember.objects.create(org=self.org2, user=self.outsider, role="learner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"b2b-cat-{tag}", name=f"B2BCat {tag}", sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform", status="published",
                created_by=self.staff_user, category=self.category,
                slug=f"b2b-c-{tag}", title=f"B2B Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"Tier-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course, delivery_type="recorded",
                price_tier=self.tier, is_active=True,
            )
            self.purchase = SeatPurchase.objects.create(
                org=self.org, offering=self.offering, buyer=self.buyer,
                quantity=2, unit_price_minor=5000, currency="GBP",
                total_minor=10000, gbp_total_minor=10000,
                status="paid", paid_at=timezone.now(),
            )

    def _request(self, user=None):
        u = user or self.staff_user
        req = MagicMock()
        req.user = u
        req.auth = u
        req.org_id = self.org.id
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def test_000_warmup(self):
        """Warm up Neon pooler schema cache — always passes, runs first alphabetically."""
        with tenant_context(staff=True):
            count = SeatPurchase.objects.count()
        self.assertGreaterEqual(count, 0)

    def test_allocate_creates_enrollment(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee1.id)
        self.assertEqual(alloc.status, "active")
        self.assertIsNotNone(alloc.enrollment_id)
        with tenant_context(staff=True):
            enrollment = Enrollment.objects.get(pk=alloc.enrollment_id)
        self.assertEqual(enrollment.source, "organization")
        self.assertEqual(enrollment.org_id, self.org.id)

    def test_allocate_is_idempotent_raises(self):
        with tenant_context(staff=True):
            allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            with self.assertRaises(ServiceError) as cm:
                allocate_seat(self._request(), self.purchase.id, self.employee1.id)
        self.assertEqual(cm.exception.code, "already_allocated")

    def test_over_allocation_prevented(self):
        with tenant_context(staff=True):
            allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            allocate_seat(self._request(), self.purchase.id, self.employee2.id)
            extra = User.objects.create_user(
                f"b2b-extra-{uuid.uuid4().hex[:8]}@test.com", "test123",
            )
            OrgMember.objects.create(org=self.org, user=extra, role="learner", joined_at=timezone.now())
            with self.assertRaises(ServiceError) as cm:
                allocate_seat(self._request(), self.purchase.id, extra.id)
        self.assertEqual(cm.exception.code, "no_seats_available")

    def test_allocate_unpaid_rejected(self):
        with tenant_context(staff=True):
            self.purchase.status = "pending"
            self.purchase.save(update_fields=["status"])
            with self.assertRaises(ServiceError) as cm:
                allocate_seat(self._request(), self.purchase.id, self.employee1.id)
        self.assertEqual(cm.exception.code, "purchase_not_paid")

    def test_allocate_non_member_rejected(self):
        with tenant_context(staff=True):
            with self.assertRaises(ServiceError) as cm:
                allocate_seat(self._request(), self.purchase.id, self.outsider.id)
        self.assertEqual(cm.exception.code, "not_a_member")

    def test_release_revokes_enrollment(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            released = release_seat(self._request(), alloc.id, reason="Left company")
        self.assertEqual(released.status, "revoked")
        with tenant_context(staff=True):
            enrollment = Enrollment.objects.get(pk=alloc.enrollment_id)
        self.assertEqual(enrollment.status, "revoked")

    def test_release_creates_event(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            release_seat(self._request(), alloc.id, reason="Test reason")
            has_revoked = AllocationEvent.objects.filter(
                allocation=alloc, action="revoked",
            ).exists()
        self.assertTrue(has_revoked)

    def test_reassign_creates_new_allocation(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            new_alloc = reassign_seat(self._request(), alloc.id, self.employee2.id, reason="Transfer")
        self.assertNotEqual(alloc.id, new_alloc.id)
        self.assertEqual(new_alloc.status, "active")
        self.assertEqual(new_alloc.user_id, self.employee2.id)
        with tenant_context(staff=True):
            old = SeatAllocation.objects.get(pk=alloc.id)
        self.assertEqual(old.status, "released")

    def test_reassign_event_has_both_users(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self.purchase.id, self.employee1.id)
            new_alloc = reassign_seat(self._request(), alloc.id, self.employee2.id)
            event = AllocationEvent.objects.filter(
                allocation=new_alloc, action="reassigned",
            ).first()
        self.assertIsNotNone(event)
        self.assertEqual(event.previous_user_id, self.employee1.id)
        self.assertEqual(event.target_user_id, self.employee2.id)

    def test_company_isolation(self):
        with tenant_context(staff=True):
            org2_purchase = SeatPurchase.objects.create(
                org=self.org2, offering=self.offering, buyer=self.outsider,
                quantity=5, unit_price_minor=5000, currency="GBP",
                total_minor=25000, gbp_total_minor=25000,
                status="paid", paid_at=timezone.now(),
            )
        with tenant_context(org_id=self.org.id, user_id=self.buyer.id):
            visible = SeatPurchase.objects.all()
            org_ids = set(p.org_id for p in visible)
        self.assertNotIn(self.org2.id, org_ids)
