"""Seed realistic compliance states for the local instalment demo company."""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from apps.catalog.models import Course
from apps.compliance import engine
from apps.compliance.models import CompletionRecord, MemberStatus, Requirement, RequirementTarget
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context

COMPANY_SLUG = "instalment-demo-company"
MARK = "[INSTALMENT COMPLIANCE DEMO]"
DEMO_COURSES = (
    ("Fire Safety Awareness", 12),
    ("Manual Handling", 12),
    ("GDPR Essentials", None),
)


class Command(BaseCommand):
    help = "Seed repeatable compliance demo data for Instalment Demo Company (development only)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Compliance demo seeding is allowed only with DEBUG enabled.")

        with tenant_context(staff=True):
            company = Organization.objects.filter(slug=COMPANY_SLUG).first()
            if company is None:
                raise CommandError(f"Company '{COMPANY_SLUG}' does not exist.")
            actor = OrgMember.objects.filter(org=company, role=OrgMember.Role.OWNER, removed_at__isnull=True)
            actor = actor.select_related("user").order_by("joined_at").first()
            if actor is None:
                raise CommandError("The demo company needs an active owner.")

        with tenant_context(org_id=company.id, user_id=actor.user_id, org_role=actor.role):
            with transaction.atomic():
                members = list(
                    OrgMember.objects.filter(org=company, removed_at__isnull=True)
                    .select_related("user")
                    .order_by("user__email", "id")
                )
                if len(members) < 5:
                    raise CommandError("At least five active demo members are needed for varied states.")

                requirements = []
                for title, renewal_months in DEMO_COURSES:
                    course = Course.objects.filter(
                        title__iexact=title,
                        status="published",
                        live_version__isnull=False,
                        deleted_at__isnull=True,
                    ).first()
                    if course is None:
                        raise CommandError(f"Published course '{title}' was not found.")
                    requirement, _ = Requirement.objects.get_or_create(
                        org=company,
                        name=f"{MARK} {title}",
                        defaults={
                            "course": course,
                            "created_by": actor.user,
                            "renewal_months": renewal_months,
                            "due_days": 30,
                            "expiring_soon_days": 30,
                            "reminder_days": [],
                            "overdue_every_days": 0,
                            "description": "Fictional sample data for the local company demo.",
                        },
                    )
                    RequirementTarget.objects.get_or_create(
                        org=company,
                        requirement=requirement,
                        unit=None,
                        job_role=None,
                        defaults={"include_subunits": True},
                    )
                    requirements.append(requirement)

                engine.lock_org(company.id)
                engine.sync_assignments(company.id, requirement_ids=[r.id for r in requirements])
                statuses = list(
                    MemberStatus.objects.filter(org=company, requirement__in=requirements)
                    .select_related("requirement", "member")
                    .order_by("requirement__name", "member__user__email")
                )
                now = timezone.now()
                # One stable sample per member and requirement: valid, expiring, expired,
                # in progress, overdue, and not started.
                for status in statuses:
                    member_index = next(i for i, m in enumerate(members) if m.id == status.member_id)
                    bucket = member_index % 6
                    if bucket in (0, 1, 2):
                        expires = {
                            0: now + timedelta(days=180),
                            1: now + timedelta(days=10),
                            2: now - timedelta(days=20),
                        }[bucket]
                        completed = now - timedelta(days=90 if bucket != 2 else 110)
                        CompletionRecord.objects.update_or_create(
                            org=company,
                            requirement=status.requirement,
                            member=status.member,
                            note=f"{MARK} completion",
                            defaults={
                                "source": CompletionRecord.Source.MANUAL,
                                "completed_at": completed,
                                "expires_at": expires,
                                "recorded_by": actor.user,
                            },
                        )
                    elif bucket == 3:
                        status.initial_due_at = now - timedelta(days=8)
                        status.save(update_fields=["initial_due_at", "updated_at"])
                    elif bucket == 4:
                        from apps.learning.models import Enrollment

                        Enrollment.objects.filter(
                            org=company,
                            user_id=status.member.user_id,
                            course_id=status.requirement.course_id,
                            source_ref=status.requirement_id,
                            status="active",
                        ).update(progress_pct=45)

                engine.recompute(company.id, requirement_ids=[r.id for r in requirements], now=now)
                counts = {
                    row["status"]: row["count"]
                    for row in MemberStatus.objects.filter(org=company, requirement__in=requirements)
                    .values("status")
                    .annotate(count=Count("id"))
                }

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(requirements)} requirements for {len(members)} people at {company.name}."
            )
        )
        self.stdout.write(f"Compliance status counts: {counts}")
