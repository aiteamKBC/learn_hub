"""B2C-05 tests: token unlock — spend tokens to gain content access."""

import uuid
from decimal import Decimal

from django.utils import timezone

from apps.commerce import wallet
from apps.commerce.unlock import AlreadyUnlocked, NoPriceSet, unlock_course, unlock_lecture
from apps.commerce.wallet import InsufficientTokens
from apps.identity.models import User
from apps.platform.models import ContentEntitlement
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class UnlockTestCase(SchemaTransactionTestCase):

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                f"unlock-{tag}@learnhub-demo.com", "test123", is_staff=False,
            )
            self.staff = User.objects.create_user(
                f"unlock-staff-{tag}@learnhub-demo.com", "test123", is_staff=True,
            )
            self._setup_catalog(tag)

    def _setup_catalog(self, tag):
        from apps.catalog.models import (
            Category,
            Course,
            CourseInstructor,
            CourseVersion,
            Lecture,
            Section,
        )

        self.category = Category.objects.create(
            slug=f"test-cat-{tag}", name=f"Test {tag}", sort_order=0,
        )
        self.course = Course.objects.create(
            ownership="platform",
            status="published",
            created_by=self.staff,
            category=self.category,
            slug=f"test-course-{tag}",
            title=f"Test Course {tag}",
            full_course_token_price=100,
        )
        self.version = CourseVersion.objects.create(
            course=self.course, number=1, status="published",
        )
        self.course.live_version = self.version
        self.course.save(update_fields=["live_version"])

        self.section = Section.objects.create(
            version=self.version, title="Section 1", position=0,
        )
        self.lecture = Lecture.objects.create(
            version=self.version,
            section=self.section,
            lecture_key=uuid.uuid4(),
            kind="video",
            title="Lecture 1",
            position=0,
            token_price=10,
        )
        self.lecture_no_price = Lecture.objects.create(
            version=self.version,
            section=self.section,
            lecture_key=uuid.uuid4(),
            kind="video",
            title="Lecture Free",
            position=1,
            token_price=None,
        )
        CourseInstructor.objects.create(
            course=self.course, user=self.staff, position=0,
        )

    def _grant(self, amount):
        with tenant_context(user_id=str(self.staff.id), staff=True):
            return wallet.grant_tokens(
                user=self.user, source="admin", amount=amount, actor=self.staff,
            )

    # ---------------------------------------------------------------- lecture unlock
    def test_unlock_lecture_spends_tokens(self):
        self._grant(50)
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_lecture(user=self.user, lecture_id=self.lecture.id)
        self.assertEqual(ent.scope, "lecture")
        self.assertEqual(ent.target_id, self.lecture.id)
        self.assertEqual(ent.source, ContentEntitlement.Source.TOKEN_UNLOCK)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 40)

    def test_unlock_lecture_creates_entitlement(self):
        self._grant(50)
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_lecture(user=self.user, lecture_id=self.lecture.id)
        with tenant_context(user_id=str(self.user.id), staff=True):
            from apps.platform.access import resolve
            decision = resolve(self.user, "lecture", self.lecture.id)
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason_code, "token_unlock")

    def test_unlock_lecture_already_unlocked(self):
        self._grant(100)
        with tenant_context(user_id=str(self.user.id), staff=True):
            unlock_lecture(user=self.user, lecture_id=self.lecture.id)
        with self.assertRaises(AlreadyUnlocked):
            with tenant_context(user_id=str(self.user.id), staff=True):
                unlock_lecture(user=self.user, lecture_id=self.lecture.id)

    def test_unlock_lecture_insufficient_tokens(self):
        self._grant(5)
        with self.assertRaises(InsufficientTokens):
            with tenant_context(user_id=str(self.user.id), staff=True):
                unlock_lecture(user=self.user, lecture_id=self.lecture.id)

    def test_unlock_lecture_no_price(self):
        self._grant(50)
        with self.assertRaises(NoPriceSet):
            with tenant_context(user_id=str(self.user.id), staff=True):
                unlock_lecture(user=self.user, lecture_id=self.lecture_no_price.id)

    # ---------------------------------------------------------------- course unlock
    def test_unlock_course_spends_tokens(self):
        self._grant(200)
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_course(user=self.user, course_id=self.course.id)
        self.assertEqual(ent.scope, "course")
        self.assertEqual(ent.source, ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 100)

    def test_unlock_course_grants_lecture_access(self):
        self._grant(200)
        with tenant_context(user_id=str(self.user.id), staff=True):
            unlock_course(user=self.user, course_id=self.course.id)
        with tenant_context(user_id=str(self.user.id), staff=True):
            from apps.platform.access import resolve
            decision = resolve(self.user, "lecture", self.lecture.id)
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason_code, "full_course_token_unlock")

    def test_unlock_course_already_unlocked(self):
        self._grant(300)
        with tenant_context(user_id=str(self.user.id), staff=True):
            unlock_course(user=self.user, course_id=self.course.id)
        with self.assertRaises(AlreadyUnlocked):
            with tenant_context(user_id=str(self.user.id), staff=True):
                unlock_course(user=self.user, course_id=self.course.id)

    def test_unlock_course_insufficient(self):
        self._grant(50)
        with self.assertRaises(InsufficientTokens):
            with tenant_context(user_id=str(self.user.id), staff=True):
                unlock_course(user=self.user, course_id=self.course.id)

    def test_entitlement_links_spend(self):
        self._grant(50)
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_lecture(user=self.user, lecture_id=self.lecture.id)
        self.assertIsNotNone(ent.source_ref)
        self.assertEqual(ent.source_ref_kind, "token_spend")
