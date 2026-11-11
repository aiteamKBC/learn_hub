"""B2C-01 Unified Content Access Engine — resolver precedence, grandfathering, RLS, B2B isolation.

Covers:
    * cash_package → ALLOW for course + its lectures/materials
    * expired entitlement → DENY
    * revoked entitlement → DENY
    * multiple simultaneous sources → highest-precedence wins, others preserved
    * full_course_token_unlock behaves like cash; audit log tags it differently
    * free preview lecture → ALLOW regardless
    * admin_grant → ALLOW
    * legacy Enrollment (pre-backfill) → ALLOW via legacy_purchase branch
    * backfill migration logic → legacy_purchase ContentEntitlement + same enrolment, no double grant
    * B2B isolation: corporate assignment never writes a personal ContentEntitlement
    * RLS: user B cannot read user A's ContentEntitlement / AccessAuditLog rows
"""

from datetime import timedelta

from django.db import connection
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import VideoLibrary
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.org import services as org_services
from apps.org.models import OrgMember
from apps.platform import access
from apps.platform.models import AccessAuditLog, ContentEntitlement
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class AccessBase(SchemaTransactionTestCase):
    def setUp(self):
        self.sara = User.objects.create_user("sara@learnhub-demo.com", "x", full_name="Sara S")
        self.bob = User.objects.create_user("bob@learnhub-demo.com", "x", full_name="Bob B")
        self.teacher = User.objects.create_user("t@learnhub-demo.com", "x", full_name="Teacher T")
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.library = VideoLibrary.objects.create(
                name="L", environment="test", bunny_library_id=1, cdn_hostname="vz.test", is_default=True
            )
        self.course, self.lectures = self._course("fire-safety")
        self.SARA = {"user_id": self.sara.id}
        self.BOB = {"user_id": self.bob.id}

    def _course(self, slug: str):
        course = cat.create_course(
            title=f"C-{slug}", slug=slug, ownership="platform", created_by=self.staff, owner_org_id=None
        )
        v = course.versions.get()
        sec = cat.add_section(version=v, title="S")
        lectures = {
            "intro": cat.add_lecture(section=sec, kind="article", title="Intro", body="hi"),
            "paid": cat.add_lecture(section=sec, kind="article", title="Paid", body="x"),
            "preview": cat.add_lecture(
                section=sec, kind="article", title="Preview", body="free", is_preview=True
            ),
        }
        cat.submit(version=v, by=self.staff)  # platform ownership publishes on submit
        course.refresh_from_db()
        return course, lectures

    # ---- factories
    def _ent(self, *, user=None, scope="course", target_id=None, source="cash_package",
             expires_at=None, revoked_at=None):
        user = user or self.sara
        with tenant_context(user_id=self.staff.id, staff=True):
            return ContentEntitlement.objects.create(
                user=user,
                scope=scope,
                target_id=target_id or self.course.id,
                source=source,
                granted_at=timezone.now() - timedelta(days=1),
                expires_at=expires_at,
                revoked_at=revoked_at,
            )


class ResolverPrecedenceTest(AccessBase):
    def test_cash_package_allows_course_and_lectures(self):
        self._ent(source="cash_package")
        with tenant_context(**self.SARA):
            d_course = access.resolve(self.sara, "course", self.course.id)
            d_lec = access.resolve(self.sara, "lecture", self.lectures["paid"].id)
        self.assertTrue(d_course.allowed)
        self.assertEqual(d_course.reason_code, "cash_package")
        self.assertTrue(d_lec.allowed)
        self.assertEqual(d_lec.reason_code, "cash_package")

    def test_expired_entitlement_denies(self):
        self._ent(source="cash_package", expires_at=timezone.now() - timedelta(hours=1))
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
        self.assertFalse(d.allowed)
        self.assertEqual(d.reason_code, "no_access")

    def test_revoked_entitlement_denies(self):
        self._ent(source="cash_package", revoked_at=timezone.now())
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
        self.assertFalse(d.allowed)

    def test_admin_revoke_overrides_other_sources(self):
        self._ent(source="cash_package")  # still active
        self._ent(source="admin_grant", revoked_at=timezone.now())
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
        self.assertFalse(d.allowed)
        self.assertEqual(d.reason_code, "admin_revoked")

    def test_preview_lecture_always_allows(self):
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "lecture", self.lectures["preview"].id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "preview")

    def test_admin_grant_allows(self):
        self._ent(source="admin_grant")
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "admin_grant")

    def test_full_course_token_unlock_tagged_distinct_in_audit(self):
        self._ent(source="full_course_token_unlock")
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
            row = AccessAuditLog.objects.filter(user=self.sara, scope="course").order_by("-checked_at").first()
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "full_course_token_unlock")
        self.assertIsNotNone(row)
        self.assertEqual(row.resolved_source, "full_course_token_unlock")

    def test_multiple_sources_preserved_precedence_picked(self):
        # cash_package wins over token_unlock; both rows survive.
        self._ent(source="cash_package")
        self._ent(source="token_unlock", scope="lecture", target_id=self.lectures["paid"].id)
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "lecture", self.lectures["paid"].id)
            count = ContentEntitlement.objects.filter(user=self.sara).count()
        self.assertEqual(d.reason_code, "cash_package")
        self.assertEqual(count, 2)

    def test_no_entitlement_denies(self):
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
            row = AccessAuditLog.objects.filter(user=self.sara, decision="deny").first()
        self.assertFalse(d.allowed)
        self.assertEqual(d.reason_code, "no_access")
        self.assertIsNotNone(row)


class GrandfatheringTest(AccessBase):
    def test_pre_backfill_enrollment_allows_via_legacy_branch(self):
        with tenant_context(**self.SARA):
            Enrollment.objects.create(
                user=self.sara, org=None, course=self.course, source="purchase",
                enrolled_at=timezone.now(), status="active",
            )
            # No ContentEntitlement exists at this point.
            self.assertFalse(ContentEntitlement.objects.filter(user=self.sara).exists())
            d = access.resolve(self.sara, "course", self.course.id)
        self.assertTrue(d.allowed)
        self.assertEqual(d.reason_code, "legacy_purchase")

    def test_backfill_coexists_with_enrollment_no_double_grant(self):
        with tenant_context(**self.SARA):
            enrol = Enrollment.objects.create(
                user=self.sara, org=None, course=self.course, source="purchase",
                enrolled_at=timezone.now(), status="active",
            )
        # Simulate the backfill writing one row.
        with tenant_context(user_id=self.staff.id, staff=True):
            ContentEntitlement.objects.create(
                user=self.sara, scope="course", target_id=self.course.id,
                source="legacy_purchase", source_ref=enrol.id, source_ref_kind="enrollment",
                granted_at=timezone.now(),
            )
        with tenant_context(**self.SARA):
            d = access.resolve(self.sara, "course", self.course.id)
            enrol_count = Enrollment.objects.filter(user=self.sara).count()
            ent_count = ContentEntitlement.objects.filter(user=self.sara).count()
        self.assertTrue(d.allowed)
        # Enrollment is untouched; exactly one entitlement row.
        self.assertEqual(enrol_count, 1)
        self.assertEqual(ent_count, 1)


class B2BIsolationTest(AccessBase):
    def test_corporate_assignment_does_not_create_personal_entitlement(self):
        acme = org_services.create_organization(name="Acme", slug="acme", owner=self.bob)
        with tenant_context(org_id=acme.id, user_id=self.bob.id):
            OrgMember.objects.create(org=acme, user=self.sara, role="learner", joined_at=timezone.now())
            Enrollment.objects.create(
                user=self.sara, org=acme, course=self.course, source="organization",
                enrolled_at=timezone.now(), status="active",
            )
        # (a) B2B path still works — company enrolment row exists.
        with tenant_context(org_id=acme.id, user_id=self.sara.id):
            self.assertTrue(
                Enrollment.objects.filter(user=self.sara, org=acme, course=self.course).exists()
            )
        # (b) No personal ContentEntitlement was ever written for the B2B assignment.
        self.assertEqual(
            ContentEntitlement.objects.filter(user=self.sara).count(),
            0,
            "Corporate B2B assignment leaked into personal ContentEntitlement table",
        )

    def test_b2c_entitlement_table_has_null_org_only(self):
        # Every B2C ContentEntitlement row MUST be user-scoped (org NULL) by design.
        self._ent(source="cash_package")
        self.assertFalse(ContentEntitlement.objects.filter(org__isnull=False).exists())


class RLSTest(AccessBase):
    def test_user_cannot_see_other_users_entitlement_rows(self):
        self._ent(user=self.sara, source="cash_package")
        with tenant_context(**self.SARA):
            self.assertEqual(
                ContentEntitlement.objects.filter(user=self.sara).count(), 1,
                "Owner should see their own row",
            )
        with tenant_context(**self.BOB):
            self.assertEqual(
                ContentEntitlement.objects.filter(user=self.sara).count(), 0,
                "RLS must hide another user's ContentEntitlement",
            )

    def test_user_cannot_see_other_users_audit_rows(self):
        with tenant_context(**self.SARA):
            access.resolve(self.sara, "course", self.course.id)  # writes a DENY row
        with tenant_context(**self.BOB):
            self.assertEqual(AccessAuditLog.objects.filter(user=self.sara).count(), 0)
