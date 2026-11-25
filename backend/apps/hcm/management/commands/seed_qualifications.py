"""Seed a company's qualification catalogue with real, commercially recognised
qualifications (First Aid, IOSH, PRINCE2, AWS...) so the Qualifications screen shows a
proper catalogue instead of a single placeholder row.

These are the *types* a company can award; awarding one to a person (with dates and a
certificate file) happens from that person's HR profile. Additive and idempotent
(get_or_create keyed by org + name). DEBUG-only; never edits or deletes existing rows.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.hcm.models import Qualification
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context

# name -> short reference code (as a real HR catalogue would list them)
QUALIFICATIONS: list[tuple[str, str]] = [
    ("First Aid at Work", "FAW-3"),
    ("Emergency First Aid at Work", "EFAW-1"),
    ("Mental Health First Aider", "MHFA"),
    ("Fire Marshal / Fire Warden", "FIRE-WARDEN"),
    ("IOSH Managing Safely", "IOSH-MS"),
    ("Food Hygiene Level 2", "FH-L2"),
    ("GDPR Practitioner", "GDPR-P"),
    ("Safeguarding Level 2", "SG-L2"),
    ("PRINCE2 Foundation", "PRINCE2-F"),
    ("ITIL 4 Foundation", "ITIL4-F"),
    ("AWS Certified Cloud Practitioner", "AWS-CCP"),
    ("Professional Scrum Master I", "PSM-I"),
]


class Command(BaseCommand):
    help = "Seed a company's qualification catalogue with real, recognised qualifications."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company",
            default="instalment-demo-company",
            help="Company slug whose qualification catalogue is populated.",
        )

    def handle(self, *args, company, **options):
        if not settings.DEBUG or os.getenv("DJANGO_SETTINGS_MODULE") == "config.settings.prod":
            raise CommandError("Qualification seeding is restricted to a DEBUG development environment.")

        # Look the company up as platform staff — RLS hides other orgs otherwise.
        with tenant_context(staff=True):
            org = Organization.objects.filter(slug=company).first()
            if org is None:
                raise CommandError(f"Company '{company}' not found.")
            owner = (
                OrgMember.objects.filter(org=org, role=OrgMember.Role.OWNER, removed_at__isnull=True)
                .order_by("joined_at")
                .first()
            )
            if owner is None:
                raise CommandError(f"Company '{company}' has no active owner to act as.")

        created = 0
        with tenant_context(org_id=org.id, user_id=owner.user_id, member_id=owner.id, org_role=owner.role):
            for name, code in QUALIFICATIONS:
                _, was_created = Qualification.objects.get_or_create(
                    org_id=org.id, name=name, defaults={"code": code}
                )
                created += int(was_created)

        self.stdout.write(self.style.SUCCESS("Qualification catalogue is ready."))
        self.stdout.write(
            f"Qualifications ensured: {len(QUALIFICATIONS)} (new this run: {created}) in {org.name}"
        )
        self.stdout.write("Open: Business > Qualifications. Award one from a person's HR profile.")
