"""Give the instalment demo company its own owner, separate from platform staff.

Development-only, idempotent data repair for the specific fictional company.
"""

import os

from allauth.account.models import EmailAddress
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context

COMPANY_SLUG = "instalment-demo-company"
STAFF_EMAIL = "admin@learnhub.example.com"
OWNER_EMAIL = "instalment.owner@learnhub.example"


class Command(BaseCommand):
    help = "Separate the fictional instalment company owner from the platform demo admin."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=os.getenv("DEMO_PASSWORD", "Demo1234!"))

    def handle(self, *args, password, **options):
        if not settings.DEBUG or os.getenv("DJANGO_SETTINGS_MODULE") == "config.settings.prod":
            raise CommandError("This demo account repair runs only in development.")
        if not password:
            raise CommandError("Supply a password for the new demo owner.")

        with transaction.atomic(), tenant_context(staff=True):
            org = Organization.objects.select_for_update().get(slug=COMPANY_SLUG)
            staff = User.objects.get(email=STAFF_EMAIL, is_staff=True, is_active=True)
            staff_member = (
                OrgMember.objects.select_for_update()
                .filter(org=org, user=staff, removed_at__isnull=True)
                .first()
            )
            if staff_member and staff_member.role != OrgMember.Role.OWNER:
                raise CommandError("The platform admin has an unexpected company role.")

            owner = User.objects.filter(email=OWNER_EMAIL).first()
            if owner is None:
                owner = User.objects.create_user(OWNER_EMAIL, password, full_name="Instalment Demo Owner")
            elif owner.is_staff or not owner.is_active or not owner.check_password(password):
                raise CommandError("The proposed owner account exists with unexpected settings.")

            EmailAddress.objects.update_or_create(
                user=owner,
                email=OWNER_EMAIL,
                defaults={"verified": True, "primary": True},
            )
            owner_member = OrgMember.objects.filter(org=org, user=owner, removed_at__isnull=True).first()
            if owner_member is None or owner_member.role != OrgMember.Role.OWNER:
                org_services.staff_set_admin(org=org, user=owner, role=OrgMember.Role.OWNER)

            if staff_member:
                org_services.remove_member(member=staff_member, by_role=OrgMember.Role.OWNER)

        self.stdout.write(
            self.style.SUCCESS(f"{OWNER_EMAIL} owns {org.name}; {STAFF_EMAIL} has no active membership.")
        )
