"""B2B-08: Multi-company RLS isolation verification.

Confirms that Company A cannot see Company B's seats, allocations,
attendance records, or training data — even in a shared cohort.
"""

import uuid
from unittest.mock import MagicMock

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.models import (
    CohortCompany,
    CorporateOffering,
    LiveCohort,
    SeatAllocation,
    SeatPurchase,
    Session,
    SessionAttendance,
    ZoomEvent,
)
from apps.corporate.services import allocate_seat
from apps.identity.models import User
from apps.org.models import OrgMember, Organization
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class MultiCompanyRLSTest(SchemaTransactionTestCase):
    """Two companies in a shared cohort — data must be strictly isolated."""

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff = User.objects.create_user(
                f"rls-staff-{tag}@test.com", "test123", is_staff=True,
            )

            # Company A
            self.org_a = Organization.objects.create(
                name=f"CompanyA {tag}", slug=f"company-a-{tag}", status="active",
            )
            self.buyer_a = User.objects.create_user(f"rls-buyer-a-{tag}@test.com", "test123")
            self.emp_a = User.objects.create_user(f"rls-emp-a-{tag}@test.com", "test123")
            OrgMember.objects.create(org=self.org_a, user=self.buyer_a, role="owner", joined_at=now)
            OrgMember.objects.create(org=self.org_a, user=self.emp_a, role="learner", joined_at=now)

            # Company B
            self.org_b = Organization.objects.create(
                name=f"CompanyB {tag}", slug=f"company-b-{tag}", status="active",
            )
            self.buyer_b = User.objects.create_user(f"rls-buyer-b-{tag}@test.com", "test123")
            self.emp_b = User.objects.create_user(f"rls-emp-b-{tag}@test.com", "test123")
            OrgMember.objects.create(org=self.org_b, user=self.buyer_b, role="owner", joined_at=now)
            OrgMember.objects.create(org=self.org_b, user=self.emp_b, role="learner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"rls-cat-{tag}", name=f"RLSCat {tag}", sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform", status="published",
                created_by=self.staff, category=self.category,
                slug=f"rls-c-{tag}", title=f"RLS Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"RLSTier-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course, delivery_type="recorded",
                price_tier=self.tier, is_active=True,
            )

            # Both companies buy seats for the same offering
            self.purchase_a = SeatPurchase.objects.create(
                org=self.org_a, offering=self.offering, buyer=self.buyer_a,
                quantity=2, unit_price_minor=5000, currency="GBP",
                total_minor=10000, gbp_total_minor=10000,
                status="paid", paid_at=now,
            )
            self.purchase_b = SeatPurchase.objects.create(
                org=self.org_b, offering=self.offering, buyer=self.buyer_b,
                quantity=2, unit_price_minor=5000, currency="GBP",
                total_minor=10000, gbp_total_minor=10000,
                status="paid", paid_at=now,
            )

            # Both in a shared cohort
            self.cohort = LiveCohort.objects.create(
                course=self.course, delivery_mode="online", max_learners=50, status="in_progress",
            )
            CohortCompany.objects.create(
                org=self.org_a, cohort=self.cohort, approved_seats=5, status="active",
            )
            CohortCompany.objects.create(
                org=self.org_b, cohort=self.cohort, approved_seats=5, status="active",
            )
            self.session = Session.objects.create(
                cohort=self.cohort, sequence=1, title="Shared Session",
                scheduled_at=now, duration_min=60, delivery_mode="online",
                zoom_meeting_id="shared_zoom_meeting",
            )
            self.zoom_event = ZoomEvent.objects.create(
                event_id=f"rls_evt_{tag}", event_type="meeting.participant_joined",
                meeting_id="shared_zoom_meeting", payload={},
            )
            # Attendance for each company's employee
            self.att_a = SessionAttendance.objects.create(
                session=self.session, user=self.emp_a, org=self.org_a,
                source="zoom_webhook", match_status="verified",
                join_at=now, zoom_event=self.zoom_event,
            )
            self.att_b = SessionAttendance.objects.create(
                session=self.session, user=self.emp_b, org=self.org_b,
                source="zoom_webhook", match_status="verified",
                join_at=now, zoom_event=self.zoom_event,
            )

    def test_000_warmup(self):
        """Warm up Neon pooler schema cache."""
        with tenant_context(staff=True):
            count = SeatPurchase.objects.count()
        self.assertGreaterEqual(count, 0)

    def test_company_a_cannot_see_company_b_purchases(self):
        with tenant_context(org_id=self.org_a.id, user_id=self.buyer_a.id):
            purchases = SeatPurchase.objects.all()
            org_ids = {p.org_id for p in purchases}
        self.assertIn(self.org_a.id, org_ids)
        self.assertNotIn(self.org_b.id, org_ids)

    def test_company_b_cannot_see_company_a_purchases(self):
        with tenant_context(org_id=self.org_b.id, user_id=self.buyer_b.id):
            purchases = SeatPurchase.objects.all()
            org_ids = {p.org_id for p in purchases}
        self.assertIn(self.org_b.id, org_ids)
        self.assertNotIn(self.org_a.id, org_ids)

    def test_company_a_attendance_scoped_to_own_employees(self):
        with tenant_context(org_id=self.org_a.id, user_id=self.buyer_a.id):
            attendance_org_ids = {a.org_id for a in SessionAttendance.objects.all()}
        self.assertNotIn(self.org_b.id, attendance_org_ids)

    def test_company_b_attendance_scoped_to_own_employees(self):
        with tenant_context(org_id=self.org_b.id, user_id=self.buyer_b.id):
            attendance_org_ids = {a.org_id for a in SessionAttendance.objects.all()}
        self.assertNotIn(self.org_a.id, attendance_org_ids)

    def test_staff_sees_all_companies(self):
        with tenant_context(staff=True):
            purchase_org_ids = {p.org_id for p in SeatPurchase.objects.all()}
        self.assertIn(self.org_a.id, purchase_org_ids)
        self.assertIn(self.org_b.id, purchase_org_ids)

    def test_seat_accounting_per_company(self):
        req_a = MagicMock()
        req_a.user = self.buyer_a
        req_a.auth = self.buyer_a
        req_a.org_id = self.org_a.id
        req_a.META = {"REMOTE_ADDR": "127.0.0.1"}

        req_b = MagicMock()
        req_b.user = self.buyer_b
        req_b.auth = self.buyer_b
        req_b.org_id = self.org_b.id
        req_b.META = {"REMOTE_ADDR": "127.0.0.1"}

        with tenant_context(staff=True):
            alloc_a = allocate_seat(req_a, self.purchase_a.id, self.emp_a.id)
            alloc_b = allocate_seat(req_b, self.purchase_b.id, self.emp_b.id)

        # Each company sees only its own allocations
        with tenant_context(org_id=self.org_a.id, user_id=self.buyer_a.id):
            alloc_orgs = {a.org_id for a in SeatAllocation.objects.all()}
        self.assertNotIn(self.org_b.id, alloc_orgs)
