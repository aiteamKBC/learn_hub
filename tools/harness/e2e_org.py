"""HARNESS ONLY: a brand-new company for the M3 E2E, built through the real services.

    python e2e_org.py <password>   -> prints one JSON line

The company has an owner-admin, units (North > Leeds, South), a job role (Carer), three
learners, two company courses and one requirement for everyone, so the matrix has cells
from the start. Every user is verified and uses <password>."""

import json
import os
import sys
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
import django  # noqa: E402

django.setup()
from allauth.account.models import EmailAddress  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.catalog import services as cat  # noqa: E402
from apps.compliance import services as compliance  # noqa: E402
from apps.identity.models import User  # noqa: E402
from apps.org import services as org  # noqa: E402
from apps.org.models import JobRole, OrgMember, OrgUnit  # noqa: E402
from core.tenancy import tenant_context  # noqa: E402

password = sys.argv[1]
stamp = int(time.time())


def user(local: str, name: str) -> User:
    email = f"e2e.{local}.{stamp}@learnhub.example.com"
    u = User.objects.create_user(email, password, full_name=name)
    EmailAddress.objects.create(user=u, email=email, verified=True, primary=True)
    return u


admin = user("hr", "Hana Admin")
people = {k: user(k, n) for k, n in (("sara", "Sara Ahmed"), ("omar", "Omar Ali"), ("lee", "Lee Patel"))}
company = org.create_organization(name=f"E2E Care {stamp}", slug=f"e2e-care-{stamp}", owner=admin)

with tenant_context(org_id=company.id, user_id=admin.id):
    now = timezone.now()
    root = OrgUnit.objects.get(org=company, parent__isnull=True)
    north = org.create_unit(parent=root, kind="region", name="North")
    leeds = org.create_unit(parent=north, kind="site", name="Leeds")
    south = org.create_unit(parent=root, kind="region", name="South")
    carer = JobRole.objects.create(org=company, name="Carer")
    members = {k: OrgMember.objects.create(org=company, user=u, joined_at=now) for k, u in people.items()}
    org.add_member_to_unit(member=members["sara"], unit=leeds, primary=True)
    org.add_member_to_unit(member=members["lee"], unit=leeds, primary=True)
    org.add_member_to_unit(member=members["omar"], unit=south, primary=True)
    org.set_job_roles(member=members["sara"], job_roles=[carer])

    courses = {}
    for slug, title in (("fire", "Fire Safety Basics"), ("hand", "Hand Hygiene")):
        c = cat.create_course(title=title, slug=f"e2e-{slug}-{stamp}", ownership="organization",
                              created_by=admin, owner_org_id=company.id, subtitle="Company training")  # fmt: skip
        v = c.versions.get()
        sec = cat.add_section(version=v, title="Basics")
        cat.add_lecture(section=sec, kind="article", title="Read this", body="<p>Know your exits.</p>", duration_sec=120)
        cat.submit(version=v, by=admin)
        c.refresh_from_db()
        courses[slug] = c

    compliance.create_requirement(org_id=company.id, course=courses["fire"], name="Fire Safety", created_by=admin,
                                  targets=[{}], renewal_months=12, due_days=30)  # fmt: skip

print(json.dumps({
    "org_id": str(company.id), "org_name": company.name, "admin": admin.email,
    "people": {k: {"email": u.email, "name": u.full_name, "member_id": str(members[k].id)} for k, u in people.items()},
    "units": {"north": str(north.id), "leeds": str(leeds.id), "south": str(south.id)},
    "courses": {k: {"id": str(c.id), "slug": c.slug, "title": c.title} for k, c in courses.items()},
}))  # fmt: skip
