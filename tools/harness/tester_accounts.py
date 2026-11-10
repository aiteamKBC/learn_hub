"""HARNESS ONLY: list the seeded demo accounts for the tester guide (emails and roles only).

Read-only. Uses the normal backend/.env database (the one the app you are screenshotting
uses). Run from backend/ with the venv:  python ../tools/harness/tester_accounts.py
Prints one JSON object. Passwords are never read or printed."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
import django  # noqa: E402

django.setup()
from apps.identity.models import InstructorProfile, User  # noqa: E402
from apps.org.models import OrgMember  # noqa: E402
from core.tenancy import tenant_context  # noqa: E402

with tenant_context(staff=True):
    out = {"staff": [], "instructors": [], "companies": [], "learners": []}
    for u in User.objects.filter(is_staff=True, is_active=True, email__endswith="@learnhub.example.com").order_by("email")[:3]:
        out["staff"].append({"email": u.email, "name": u.full_name})
    for p in InstructorProfile.objects.filter(status="approved", user__email__endswith="@learnhub.example.com").select_related("user").order_by("user__email"):
        out["instructors"].append({"email": p.user.email, "name": p.user.full_name})
    orgs = {}
    for m in (OrgMember.objects.filter(removed_at__isnull=True).select_related("user", "org")
              .order_by("org__name", "joined_at")):  # fmt: skip
        o = orgs.setdefault(m.org_id, {"company": m.org.name, "admins": [], "managers": [], "learners": []})
        bucket = {"owner": "admins", "admin": "admins", "manager": "managers"}.get(m.role, "learners")
        if len(o[bucket]) < 2:
            o[bucket].append({"email": m.user.email, "name": m.user.full_name, "role": m.role})
    out["companies"] = list(orgs.values())
    for u in (User.objects.filter(is_active=True, is_staff=False, email__endswith="@learnhub.example.com",
                                  email__regex=r"\.l[0-9]+@").order_by("created_at")[:3]):  # fmt: skip
        out["learners"].append({"email": u.email, "name": u.full_name})
print(json.dumps(out, indent=1))
