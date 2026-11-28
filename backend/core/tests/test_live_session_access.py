"""Live-session listings must honour the same access rules as the player."""

from datetime import timedelta
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from apps.catalog import services as catalog
from apps.catalog.models import Lecture
from apps.learning import services as learning
from apps.learning.models import Enrollment
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase


class LiveSessionAccessTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.learner, _ = f.users()
        category = f.money(self.staff)
        self.course = f.course(
            staff=self.staff, owner=self.teacher, slug="live-access", title="Live access", category=category
        )
        with tenant_context(user_id=self.staff.id, staff=True), transaction.atomic(), catalog.authoring():
            self.session = Lecture.objects.create(
                lecture_key=uuid4(),
                version_id=self.course.live_version_id,
                section=self.course.live_version.sections.first(),
                kind=Lecture.Kind.LIVE_SESSION,
                title="Office hours",
                position=20,
                live_starts_at=timezone.now() + timedelta(minutes=5),
                live_duration_min=60,
                live_provider="manual",
                live_join_url="https://meet.example.com/live-access",
            )
        with tenant_context(user_id=self.learner.id):
            self.enrollment = learning.enrol(
                user=self.learner, course=self.course, source=Enrollment.Source.PURCHASE
            )
        self.client.force_login(self.learner)

    def sessions(self):
        response = self.client.get("/api/v1/learning/my/live-sessions")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_join_link_is_only_available_inside_the_existing_join_window(self):
        with tenant_context(user_id=self.staff.id, staff=True), transaction.atomic(), catalog.authoring():
            Lecture.objects.filter(pk=self.session.pk).update(
                live_starts_at=timezone.now() + timedelta(minutes=20)
            )
        self.assertIsNone(self.sessions()[0]["join_url"])
        with tenant_context(user_id=self.staff.id, staff=True), transaction.atomic(), catalog.authoring():
            Lecture.objects.filter(pk=self.session.pk).update(
                live_starts_at=timezone.now() + timedelta(minutes=5)
            )
        result = self.sessions()[0]
        self.assertEqual(result["join_url"], self.session.live_join_url)
        self.assertEqual(result["course_slug"], self.course.slug)

    def test_expired_course_access_does_not_expose_join_links(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            Enrollment.objects.filter(pk=self.enrollment.pk).update(
                access_expires_at=timezone.now() - timedelta(minutes=1)
            )
        self.assertEqual(self.sessions(), [])

    def test_subscription_enrollment_without_current_entitlement_does_not_expose_join_links(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            Enrollment.objects.filter(pk=self.enrollment.pk).update(source=Enrollment.Source.SUBSCRIPTION)
        self.assertEqual(self.sessions(), [])
