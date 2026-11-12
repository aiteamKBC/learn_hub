"""Create a safe, repeatable two-account Teams live-session demo.

The command deliberately does not send mail and it never creates a Teams meeting by
itself.  The host signs into Studio and presses "Create Teams meeting" after Graph
has been configured; that makes the external side effect explicit and auditable.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.catalog import services
from apps.catalog.models import Course, Lecture
from apps.learning.models import Enrollment


class Command(BaseCommand):
    help = "Create a Teams live demo course and enrol a host and learner account."

    def add_arguments(self, parser):
        parser.add_argument("--host-email", required=True, help="Existing Microsoft 365 host/login email")
        parser.add_argument("--learner-email", required=True, help="Existing learner/login email")
        parser.add_argument("--password", default="DemoPass!2026", help="Password only for newly-created local users")
        parser.add_argument("--start-in-minutes", type=int, default=20)

    def handle(self, *args, **opts):
        host_email = opts["host_email"].strip().lower()
        learner_email = opts["learner_email"].strip().lower()
        if host_email == learner_email:
            raise CommandError("Use two different email addresses for the host and learner.")
        User = get_user_model()
        host, host_new = User.objects.get_or_create(email=host_email, defaults={"full_name": "Teams Demo Host"})
        learner, learner_new = User.objects.get_or_create(email=learner_email, defaults={"full_name": "Teams Demo Learner"})
        for user, is_new in ((host, host_new), (learner, learner_new)):
            if is_new:
                user.set_password(opts["password"])
                user.save(update_fields=["password"])

        slug = "teams-live-demo"
        course = Course.objects.filter(slug=slug).first()
        if course is None:
            course = services.create_course(
                title="Microsoft Teams Live Classroom — Demo",
                slug=slug,
                ownership=Course.Ownership.PLATFORM,
                created_by=host,
                is_free=True,
                description="A two-account test course for Microsoft Teams live sessions.",
            )
            section = services.add_section(version=course.versions.get(number=1), title="Live classroom")
            services.add_lecture(
                section=section,
                kind=Lecture.Kind.LIVE_SESSION,
                title="Teams live test session",
                live_starts_at=timezone.now() + timedelta(minutes=max(16, opts["start_in_minutes"])),
                live_duration_min=45,
            )
            # Platform courses publish immediately once the minimal curriculum exists.
            services.submit(version=course.versions.get(number=1), by=host)

        for user in (host, learner):
            Enrollment.objects.get_or_create(
                user=user, course=course, org=None,
                defaults={"source": Enrollment.Source.ADMIN_GRANT, "status": Enrollment.Status.ACTIVE,
                          "enrolled_at": timezone.now()},
            )
        self.stdout.write(self.style.SUCCESS(f"Ready: /learn/{course.slug}"))
        self.stdout.write("Host: open Studio, edit ‘Teams live test session’, save it, then create the Teams meeting.")
        self.stdout.write("Learner: the Teams join button appears exactly 15 minutes before the scheduled time.")
        if host_new or learner_new:
            self.stdout.write(self.style.WARNING("One or more local accounts were created with the supplied demo password; change it after testing."))
