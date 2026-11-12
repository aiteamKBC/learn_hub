"""B2C-06 tests: cash package fulfilment — webhook creates course entitlements."""

import uuid

from apps.commerce import webhooks
from apps.commerce.models import CashPackage, CashPackageCourse, PriceTier
from apps.identity.models import User
from apps.platform.access import resolve
from apps.platform.models import ContentEntitlement
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class CashPackageFulfilTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                f"pkg-{tag}@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            self.staff = User.objects.create_user(
                f"pkg-staff-{tag}@learnhub-demo.com",
                "test123",
                is_staff=True,
            )
            self._setup_catalog(tag)
            self._setup_package(tag)

    def _setup_catalog(self, tag):
        from apps.catalog.models import Category, Course, CourseVersion

        self.category = Category.objects.create(
            slug=f"pkg-cat-{tag}",
            name=f"PkgCat {tag}",
            sort_order=0,
        )
        self.course1 = Course.objects.create(
            ownership="platform",
            status="published",
            created_by=self.staff,
            category=self.category,
            slug=f"pkg-c1-{tag}",
            title=f"Course 1 {tag}",
        )
        self.course2 = Course.objects.create(
            ownership="platform",
            status="published",
            created_by=self.staff,
            category=self.category,
            slug=f"pkg-c2-{tag}",
            title=f"Course 2 {tag}",
        )
        v1 = CourseVersion.objects.create(course=self.course1, number=1, status="published")
        v2 = CourseVersion.objects.create(course=self.course2, number=1, status="published")
        self.course1.live_version = v1
        self.course1.save(update_fields=["live_version"])
        self.course2.live_version = v2
        self.course2.save(update_fields=["live_version"])

    def _setup_package(self, tag):
        self.tier = PriceTier.objects.create(name=f"PkgTier {tag}", gbp_minor=8000)
        self.package = CashPackage.objects.create(
            name=f"Bundle {tag}",
            slug=f"bundle-{tag}",
            price_tier=self.tier,
            is_active=True,
        )
        CashPackageCourse.objects.create(
            package=self.package,
            course=self.course1,
            snapshot_gbp_minor=4000,
        )
        CashPackageCourse.objects.create(
            package=self.package,
            course=self.course2,
            snapshot_gbp_minor=6000,
        )

    def _session(self, session_id=None):
        sid = session_id or f"cs_test_{uuid.uuid4().hex[:12]}"
        return {
            "id": sid,
            "payment_status": "paid",
            "amount_total": 8000,
            "currency": "gbp",
            "metadata": {
                "kind": "cash_package",
                "id": str(self.package.id),
                "user_id": str(self.user.id),
                "course_ids": f"{self.course1.id},{self.course2.id}",
            },
        }

    def test_fulfil_creates_entitlements(self):
        session = self._session()
        with tenant_context(staff=True):
            webhooks._fulfil_cash_package(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            ents = ContentEntitlement.objects.filter(
                user=self.user,
                source=ContentEntitlement.Source.CASH_PACKAGE,
            )
            self.assertEqual(ents.count(), 2)
            scopes = set(ents.values_list("scope", flat=True))
            self.assertEqual(scopes, {"course"})

    def test_fulfil_grants_access(self):
        session = self._session()
        with tenant_context(staff=True):
            webhooks._fulfil_cash_package(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            d1 = resolve(self.user, "course", self.course1.id)
            d2 = resolve(self.user, "course", self.course2.id)
        self.assertTrue(d1.allowed)
        self.assertTrue(d2.allowed)
        self.assertEqual(d1.reason_code, "cash_package")

    def test_fulfil_idempotent(self):
        session = self._session(session_id="cs_test_pkg_idem")
        with tenant_context(staff=True):
            webhooks._fulfil_cash_package(session, session["metadata"])
            webhooks._fulfil_cash_package(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            ents = ContentEntitlement.objects.filter(
                user=self.user,
                source=ContentEntitlement.Source.CASH_PACKAGE,
            )
            self.assertEqual(ents.count(), 2)

    def test_fulfil_ignores_unpaid(self):
        session = self._session()
        session["payment_status"] = "unpaid"
        with tenant_context(staff=True):
            webhooks._fulfil_cash_package(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(ContentEntitlement.objects.filter(user=self.user).count(), 0)

    def test_dispatch_routes_cash_package(self):
        session = self._session()
        event = {
            "type": "checkout.session.completed",
            "data": {"object": session},
        }
        with tenant_context(staff=True):
            webhooks.dispatch(event)
        with tenant_context(user_id=str(self.user.id), staff=True):
            ents = ContentEntitlement.objects.filter(
                user=self.user,
                source=ContentEntitlement.Source.CASH_PACKAGE,
            )
            self.assertEqual(ents.count(), 2)
