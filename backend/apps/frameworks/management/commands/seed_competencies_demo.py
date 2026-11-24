"""Seed a commercial, platform-level competency library, tag published courses with
it, and complete a few company enrolments so the competence / KSB screens show real
evidence instead of empty states.

Why this exists: the migration seed ships care/construction competencies but tags no
courses, so `scoring.evidenced_levels` (which reads completed, tagged courses) always
returns nothing and every learner sits at level 0. This adds commercial competencies
that match the commercial catalogue (Excel, APIs, project management, security, …),
links them to real courses, and gives demo learners completed enrolments.

Additive and idempotent (get_or_create, keyed by code / natural keys). DEBUG-only;
never truncates or edits existing rows.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Course
from apps.frameworks.models import Competency, CourseCompetency
from apps.learning.models import Enrollment
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context

# Platform-wide commercial competencies (owner_org NULL). code -> (kind, name, description)
COMPETENCIES: dict[str, tuple[str, str, str]] = {
    "COM-DATA": ("S", "Data analysis & spreadsheets", "Clean, model and present data to support decisions."),
    "COM-API": ("S", "Backend & API development", "Design and build reliable server-side APIs."),
    "COM-PM": ("S", "Project planning & delivery", "Plan, schedule and deliver work to time and scope."),
    "COM-DESIGN": ("S", "Visual & brand design", "Produce clear, consistent visual and brand work."),
    "COM-SEC": ("K", "Cybersecurity fundamentals", "Recognise threats and apply everyday security practice."),
    "COM-CLOUD": (
        "K",
        "Cloud computing foundations",
        "Understand core cloud services and deployment models.",
    ),
    "COM-GDPR": ("K", "Data protection & GDPR", "Handle personal data lawfully and protect privacy."),
    "COM-HS": ("B", "Workplace health & safety", "Work safely and look after yourself and others."),
    "COM-COMMS": ("B", "Professional communication", "Communicate clearly and inclusively at work."),
    "COM-INTEGRITY": (
        "P",
        "Professional standards & integrity",
        "Act ethically and to professional standards.",
    ),
}

# Exact published course title -> [(competency code, target_level 1..5)]
COURSE_MAP: dict[str, list[tuple[str, int]]] = {
    "Excel for Data Analysis": [("COM-DATA", 4)],
    "Build REST APIs with Django": [("COM-API", 4)],
    "Project Management Essentials": [("COM-PM", 4), ("COM-COMMS", 3)],
    "Brand Identity Design": [("COM-DESIGN", 4)],
    "Cybersecurity Essentials": [("COM-SEC", 4), ("COM-INTEGRITY", 2)],
    "Cloud Computing Fundamentals": [("COM-CLOUD", 4)],
    "GDPR Essentials": [("COM-GDPR", 4)],
    "Health and Safety at Work": [("COM-HS", 4)],
    "Fire Safety Awareness": [("COM-HS", 3)],
    "Manual Handling": [("COM-HS", 3)],
    "Infection Prevention and Control": [("COM-HS", 3)],
}


class Command(BaseCommand):
    help = (
        "Seed commercial platform competencies, tag published courses with them, and "
        "complete demo enrolments so competence screens show evidence."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company",
            default="instalment-demo-company",
            help="Company slug whose members get completed enrolments (evidence source).",
        )
        parser.add_argument(
            "--completed",
            type=int,
            default=6,
            help="How many tagged courses each demo member completes.",
        )
        parser.add_argument(
            "--members",
            type=int,
            default=15,
            help="Maximum number of members to give completed enrolments to.",
        )

    def handle(self, *args, company, completed, members, **options):
        if not settings.DEBUG or os.getenv("DJANGO_SETTINGS_MODULE") == "config.settings.prod":
            raise CommandError("Competency demo seeding is restricted to a DEBUG development environment.")

        now = timezone.now()

        with transaction.atomic(using="default"):
            # ---- 1 & 2: competencies + course tags (platform scope: owner_org NULL) ----
            with tenant_context(staff=True):
                comps: dict[str, Competency] = {}
                for i, (code, (kind, name, desc)) in enumerate(COMPETENCIES.items()):
                    comp, _ = Competency.objects.get_or_create(
                        owner_org=None,
                        code=code,
                        defaults={"name": name, "kind": kind, "description": desc, "sort_order": 100 + i},
                    )
                    comps[code] = comp

                tagged = 0
                tagged_courses: list[Course] = []
                for title, mappings in COURSE_MAP.items():
                    course = Course.objects.filter(title=title, status="published").first()
                    if course is None:
                        continue
                    tagged_courses.append(course)
                    for code, level in mappings:
                        _, created = CourseCompetency.objects.get_or_create(
                            course=course,
                            competency=comps[code],
                            defaults={"owner_org": None, "target_level": level, "weight": 5},
                        )
                        tagged += int(created)

                org = Organization.objects.filter(slug=company).first()
                if org is None:
                    raise CommandError(f"Company '{company}' not found.")
                owner_member = (
                    OrgMember.objects.filter(org=org, role=OrgMember.Role.OWNER, removed_at__isnull=True)
                    .select_related("user")
                    .order_by("joined_at")
                    .first()
                )
                if owner_member is None:
                    raise CommandError(f"Company '{company}' has no active owner to act as.")
                member_users = list(
                    OrgMember.objects.filter(org=org, removed_at__isnull=True)
                    .select_related("user")
                    .order_by("joined_at")[:members]
                )

            # ---- 3: completed enrolments, acting as the company owner (an org member) ----
            enrolled = 0
            courses_to_complete = tagged_courses[: max(0, completed)]
            with tenant_context(
                org_id=org.id,
                user_id=owner_member.user_id,
                member_id=owner_member.id,
                org_role=owner_member.role,
            ):
                for m in member_users:
                    for course in courses_to_complete:
                        _, created = Enrollment.objects.get_or_create(
                            org=org,
                            user=m.user,
                            course=course,
                            defaults={
                                "source": Enrollment.Source.ORGANIZATION,
                                "status": Enrollment.Status.COMPLETED,
                                "enrolled_at": now,
                                "completed_at": now,
                                "progress_pct": 100,
                                "completed_version_id": course.live_version_id,
                            },
                        )
                        enrolled += int(created)

        self.stdout.write(self.style.SUCCESS("Competency demo is ready."))
        self.stdout.write(f"Platform competencies ensured: {len(comps)}")
        self.stdout.write(f"Course tags created: {tagged} (courses tagged: {len(tagged_courses)})")
        self.stdout.write(
            f"Completed enrolments created: {enrolled} "
            f"for {len(member_users)} members in {org.name} across {len(courses_to_complete)} courses"
        )
        self.stdout.write(
            "Open: Business > Frameworks > Competencies, and the learner's My competence / Practise KSBs."
        )
