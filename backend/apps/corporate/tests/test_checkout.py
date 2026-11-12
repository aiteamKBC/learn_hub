"""B2B-02 tests: recorded checkout, quote flow, webhook fulfillment."""

import uuid
from unittest.mock import MagicMock, patch

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.checkout import create_recorded_checkout
from apps.corporate.fulfillment import expire_purchase, fail_purchase, fulfil_recorded_purchase
from apps.corporate.models import (
    CorporateOffering,
    CorporateQuote,
    QuoteItem,
    SeatPurchase,
)
from apps.corporate.quotes import fulfil_quote, void_quote
from apps.identity.models import User
from apps.org.models import Organization, OrgMember
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class RecordedCheckoutTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff_user = User.objects.create_user(
                f"b2b-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"CheckoutCorp {tag}",
                slug=f"checkoutcorp-{tag}",
                status="active",
            )
            self.admin = User.objects.create_user(
                f"b2b-admin-{tag}@test.com",
                "test123",
                is_staff=False,
            )
            self.manager = User.objects.create_user(
                f"b2b-mgr-{tag}@test.com",
                "test123",
                is_staff=False,
            )
            OrgMember.objects.create(org=self.org, user=self.admin, role="admin", joined_at=now)
            OrgMember.objects.create(org=self.org, user=self.manager, role="manager", joined_at=now)

            self.category = Category.objects.create(
                slug=f"co-cat-{tag}",
                name=f"COCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff_user,
                category=self.category,
                slug=f"co-c-{tag}",
                title=f"CO Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"COTier-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="recorded",
                price_tier=self.tier,
                is_active=True,
            )

    def _request(self, user=None, org=None):
        req = MagicMock()
        req.user = user or self.admin
        req.auth = user or self.admin
        req.org_id = (org or self.org).id
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def test_000_warmup(self):
        """Warm up Neon pooler schema cache."""
        with tenant_context(staff=True):
            count = SeatPurchase.objects.count()
        self.assertGreaterEqual(count, 0)

    @patch("apps.corporate.checkout.gateway.create_checkout_session")
    def test_checkout_creates_pending_purchase(self, mock_stripe):
        mock_stripe.return_value = {"id": "cs_test_123", "url": "https://checkout.stripe.com/test"}
        with tenant_context(staff=True):
            result = create_recorded_checkout(self._request(), str(self.offering.id), 5)
        self.assertIn("checkout_url", result)
        with tenant_context(staff=True):
            p = SeatPurchase.objects.get(pk=result["purchase_id"])
        self.assertEqual(p.status, "pending")
        self.assertEqual(p.quantity, 5)
        self.assertEqual(p.total_minor, 25000)
        self.assertEqual(p.stripe_session_id, "cs_test_123")

    @patch("apps.corporate.checkout.gateway.create_checkout_session")
    def test_manager_cannot_checkout(self, mock_stripe):
        with tenant_context(staff=True):
            with self.assertRaises(ServiceError) as cm:
                create_recorded_checkout(self._request(user=self.manager), str(self.offering.id), 3)
        self.assertEqual(cm.exception.code, "forbidden")

    def test_inactive_offering_rejected(self):
        with tenant_context(staff=True):
            self.offering.is_active = False
            self.offering.save(update_fields=["is_active"])
            with self.assertRaises(ServiceError) as cm:
                create_recorded_checkout(self._request(), str(self.offering.id), 1)
        self.assertEqual(cm.exception.code, "offering_not_found")


class WebhookFulfillmentTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff_user = User.objects.create_user(
                f"wh-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"WHCorp {tag}",
                slug=f"whcorp-{tag}",
                status="active",
            )
            self.buyer = User.objects.create_user(
                f"wh-buyer-{tag}@test.com",
                "test123",
                is_staff=False,
            )
            OrgMember.objects.create(org=self.org, user=self.buyer, role="admin", joined_at=now)

            self.category = Category.objects.create(
                slug=f"wh-cat-{tag}",
                name=f"WHCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff_user,
                category=self.category,
                slug=f"wh-c-{tag}",
                title=f"WH Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"WHT-{tag}", gbp_minor=5000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="recorded",
                price_tier=self.tier,
                is_active=True,
            )
            self.purchase = SeatPurchase.objects.create(
                org=self.org,
                offering=self.offering,
                buyer=self.buyer,
                quantity=3,
                unit_price_minor=5000,
                currency="GBP",
                total_minor=15000,
                gbp_total_minor=15000,
                status="pending",
                stripe_session_id="cs_wh_test",
            )

    def test_fulfil_marks_paid(self):
        session = {"id": "cs_wh_test", "payment_intent": "pi_test_123", "payment_status": "paid"}
        meta = {"kind": "corporate_recorded", "id": str(self.purchase.id)}
        with tenant_context(staff=True):
            fulfil_recorded_purchase(session, meta)
            self.purchase.refresh_from_db()
        self.assertEqual(self.purchase.status, "paid")
        self.assertEqual(self.purchase.payment_intent, "pi_test_123")

    def test_duplicate_fulfil_is_idempotent(self):
        session = {"id": "cs_wh_test", "payment_intent": "pi_test_123"}
        meta = {"kind": "corporate_recorded", "id": str(self.purchase.id)}
        with tenant_context(staff=True):
            fulfil_recorded_purchase(session, meta)
            fulfil_recorded_purchase(session, meta)
            self.purchase.refresh_from_db()
        self.assertEqual(self.purchase.status, "paid")

    def test_expire_marks_expired(self):
        meta = {"kind": "corporate_recorded", "id": str(self.purchase.id)}
        with tenant_context(staff=True):
            expire_purchase({}, meta)
            self.purchase.refresh_from_db()
        self.assertEqual(self.purchase.status, "expired")

    def test_fail_marks_voided(self):
        meta = {"kind": "corporate_recorded", "id": str(self.purchase.id)}
        with tenant_context(staff=True):
            fail_purchase({}, meta)
            self.purchase.refresh_from_db()
        self.assertEqual(self.purchase.status, "voided")


class QuoteFulfillmentTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff_user = User.objects.create_user(
                f"qf-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"QFCorp {tag}",
                slug=f"qfcorp-{tag}",
                status="active",
                stripe_customer_id="cus_test_qf",
            )
            self.buyer = User.objects.create_user(
                f"qf-buyer-{tag}@test.com",
                "test123",
                is_staff=False,
            )
            OrgMember.objects.create(org=self.org, user=self.buyer, role="owner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"qf-cat-{tag}",
                name=f"QFCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff_user,
                category=self.category,
                slug=f"qf-c-{tag}",
                title=f"QF Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.tier = PriceTier.objects.create(name=f"QFT-{tag}", gbp_minor=7500, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=self.course,
                delivery_type="recorded",
                price_tier=self.tier,
                is_active=True,
            )
            self.quote = CorporateQuote.objects.create(
                org=self.org,
                buyer=self.buyer,
                status="sent",
                currency="GBP",
                total_minor=30000,
                valid_until=timezone.now() + timezone.timedelta(days=30),
                stripe_invoice_id="inv_test_qf",
                created_by_staff=self.staff_user,
            )
            QuoteItem.objects.create(
                org=self.org,
                quote=self.quote,
                offering=self.offering,
                quantity=4,
                unit_price_minor=7500,
                line_total_minor=30000,
            )

    def test_fulfil_quote_creates_purchases(self):
        invoice = {
            "id": "inv_test_qf",
            "metadata": {"kind": "corporate_quote", "id": str(self.quote.id), "org_id": str(self.org.id)},
        }
        with tenant_context(staff=True):
            fulfil_quote(invoice)
            self.quote.refresh_from_db()
        self.assertEqual(self.quote.status, "accepted")
        with tenant_context(staff=True):
            purchases = SeatPurchase.objects.filter(quote=self.quote)
        self.assertEqual(purchases.count(), 1)
        p = purchases.first()
        self.assertEqual(p.status, "paid")
        self.assertEqual(p.quantity, 4)

    def test_duplicate_fulfil_quote_is_idempotent(self):
        invoice = {
            "id": "inv_test_qf",
            "metadata": {"kind": "corporate_quote", "id": str(self.quote.id)},
        }
        with tenant_context(staff=True):
            fulfil_quote(invoice)
            fulfil_quote(invoice)
            purchases = SeatPurchase.objects.filter(quote=self.quote)
        self.assertEqual(purchases.count(), 1)

    def _request(self):
        req = MagicMock()
        req.auth = self.staff_user
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def test_void_draft_quote(self):
        with tenant_context(staff=True):
            draft = CorporateQuote.objects.create(
                org=self.org,
                buyer=self.buyer,
                status="draft",
                currency="GBP",
                total_minor=10000,
                valid_until=timezone.now() + timezone.timedelta(days=7),
                created_by_staff=self.staff_user,
            )
            voided = void_quote(self._request(), draft.id)
        self.assertEqual(voided.status, "voided")

    def test_void_accepted_quote_rejected(self):
        with tenant_context(staff=True):
            self.quote.status = "accepted"
            self.quote.save(update_fields=["status"])
            with self.assertRaises(ServiceError) as cm:
                void_quote(self._request(), self.quote.id)
        self.assertEqual(cm.exception.code, "not_voidable")
