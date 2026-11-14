"""B2B-05 tests: Zoom webhook signature verification and attendance processing."""

import hashlib
import hmac
import uuid
from unittest.mock import patch

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.corporate.attendance import process_participant_event, reject_attendance, verify_attendance
from apps.corporate.models import (
    CohortCompany,
    LiveAttendee,
    LiveCohort,
    Session,
    SessionAttendance,
    ZoomEvent,
)
from apps.corporate.zoom import verify_signature
from apps.identity.models import User
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class ZoomSignatureTest(SchemaTransactionTestCase):
    @patch("apps.corporate.zoom.settings")
    def test_valid_signature_passes(self, mock_settings):
        mock_settings.ZOOM_WEBHOOK_SECRET = "test_secret_123"
        payload = b'{"event":"meeting.participant_joined"}'
        timestamp = "1234567890"
        message = f"v0:{timestamp}:{payload.decode('utf-8')}"
        expected = (
            "v0="
            + hmac.new(
                b"test_secret_123",
                message.encode(),
                hashlib.sha256,
            ).hexdigest()
        )
        self.assertTrue(verify_signature(payload, expected, timestamp))

    @patch("apps.corporate.zoom.settings")
    def test_invalid_signature_fails(self, mock_settings):
        mock_settings.ZOOM_WEBHOOK_SECRET = "test_secret_123"
        self.assertFalse(verify_signature(b"data", "v0=bad", "123"))

    @patch("apps.corporate.zoom.settings")
    def test_empty_secret_fails(self, mock_settings):
        mock_settings.ZOOM_WEBHOOK_SECRET = ""
        self.assertFalse(verify_signature(b"data", "v0=anything", "123"))


class AttendanceProcessingTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(user_id=None, staff=True):
            self.staff = User.objects.create_user(
                f"att-staff-{tag}@test.com",
                "test123",
                is_staff=True,
            )
            self.org = Organization.objects.create(
                name=f"AttCorp {tag}",
                slug=f"attcorp-{tag}",
                status="active",
            )
            self.learner = User.objects.create_user(
                f"att-learner-{tag}@test.com",
                "test123",
            )
            OrgMember.objects.create(org=self.org, user=self.learner, role="learner", joined_at=now)

            self.category = Category.objects.create(
                slug=f"att-cat-{tag}",
                name=f"AttCat {tag}",
                sort_order=0,
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.category,
                slug=f"att-c-{tag}",
                title=f"Attendance Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])

            self.cohort = LiveCohort.objects.create(
                course=self.course,
                delivery_mode="online",
                max_learners=20,
                status="in_progress",
            )
            self.placement = CohortCompany.objects.create(
                org=self.org,
                cohort=self.cohort,
                approved_seats=5,
                status="active",
            )
            LiveAttendee.objects.create(
                org=self.org, cohort_company=self.placement, cohort=self.cohort,
                user=self.learner, status="active", added_by=self.staff,
            )
            self.session = Session.objects.create(
                cohort=self.cohort,
                sequence=1,
                title="Session 1",
                scheduled_at=now,
                duration_min=60,
                delivery_mode="online",
                zoom_meeting_id="zoom_123_test",
            )
            self.zoom_event = ZoomEvent.objects.create(
                event_id=f"test_event_{tag}",
                event_type="meeting.participant_joined",
                meeting_id="zoom_123_test",
                payload={},
            )

    def test_000_warmup(self):
        """Warm up Neon pooler schema cache."""
        with tenant_context(staff=True):
            count = SessionAttendance.objects.count()
        self.assertGreaterEqual(count, 0)

    def test_process_join_creates_attendance(self):
        data = {
            "event": "meeting.participant_joined",
            "payload": {
                "object": {
                    "id": "zoom_123_test",
                    "participant": {
                        "email": self.learner.email,
                        "user_name": "Test Learner",
                        "join_time": timezone.now().isoformat(),
                    },
                },
            },
        }
        with tenant_context(staff=True):
            process_participant_event(self.zoom_event, data)
            att = SessionAttendance.objects.filter(
                session=self.session,
                user=self.learner,
            ).first()
        self.assertIsNotNone(att)
        self.assertEqual(att.match_status, "verified")
        self.assertEqual(att.source, "zoom_webhook")

    def test_process_leave_updates_duration(self):
        join_time = timezone.now()
        with tenant_context(staff=True):
            SessionAttendance.objects.create(
                session=self.session,
                user=self.learner,
                org=self.org,
                source="zoom_webhook",
                match_status="verified",
                join_at=join_time,
                zoom_event=self.zoom_event,
            )

        leave_time = join_time + timezone.timedelta(minutes=45)
        data = {
            "event": "meeting.participant_left",
            "payload": {
                "object": {
                    "id": "zoom_123_test",
                    "participant": {
                        "email": self.learner.email,
                        "leave_time": leave_time.isoformat(),
                    },
                },
            },
        }
        with tenant_context(staff=True):
            process_participant_event(self.zoom_event, data)
            att = SessionAttendance.objects.filter(
                session=self.session,
                user=self.learner,
            ).first()
        self.assertIsNotNone(att.leave_at)
        self.assertGreater(att.duration_seconds, 0)

    def test_unknown_email_ignored(self):
        data = {
            "event": "meeting.participant_joined",
            "payload": {
                "object": {
                    "id": "zoom_123_test",
                    "participant": {
                        "email": "nobody@unknown.com",
                        "user_name": "Unknown",
                    },
                },
            },
        }
        with tenant_context(staff=True):
            process_participant_event(self.zoom_event, data)
            count = SessionAttendance.objects.filter(session=self.session).count()
        self.assertEqual(count, 0)

    def test_no_matching_session_ignored(self):
        data = {
            "event": "meeting.participant_joined",
            "payload": {
                "object": {
                    "id": "nonexistent_meeting_999",
                    "participant": {
                        "email": self.learner.email,
                    },
                },
            },
        }
        with tenant_context(staff=True):
            process_participant_event(self.zoom_event, data)
            count = SessionAttendance.objects.count()
        self.assertEqual(count, 0)

    def test_verify_attendance(self):
        from unittest.mock import MagicMock

        with tenant_context(staff=True):
            att = SessionAttendance.objects.create(
                session=self.session,
                user=self.learner,
                org=self.org,
                source="zoom_webhook",
                match_status="unresolved",
                join_at=timezone.now(),
                zoom_event=self.zoom_event,
            )
            req = MagicMock()
            req.user = self.staff
            verified = verify_attendance(req, str(att.id))
        self.assertTrue(verified.is_verified)
        self.assertEqual(verified.match_status, "verified")

    def test_reject_attendance(self):
        from unittest.mock import MagicMock

        with tenant_context(staff=True):
            att = SessionAttendance.objects.create(
                session=self.session,
                user=self.learner,
                org=self.org,
                source="zoom_webhook",
                match_status="unresolved",
                join_at=timezone.now(),
                zoom_event=self.zoom_event,
            )
            req = MagicMock()
            req.user = self.staff
            rejected = reject_attendance(req, str(att.id))
        self.assertEqual(rejected.match_status, "rejected")
