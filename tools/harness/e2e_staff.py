"""HARNESS ONLY: throw-away accounts for one M5 console E2E run (e2e database only).

Prints one JSON line: a staff member, a learner and an approved instructor, all verified,
all with the password given as the first argument (the harness test password, never the
demo staff password)."""

import json
import os
import sys
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
import django

django.setup()
from allauth.account.models import EmailAddress
from apps.identity.models import InstructorProfile, User

stamp = int(time.time())
password = sys.argv[1]


def make(kind: str, name: str, *, staff: bool = False, instructor: str = "") -> str:
    email = f"e2e.m5.{kind}.{stamp}@learnhub.example.com"
    u = User.objects.create_user(email, password, full_name=name, is_staff=staff)
    EmailAddress.objects.create(user=u, email=email, verified=True, primary=True)
    if instructor:
        InstructorProfile.objects.create(
            user=u, status=instructor, headline="E2E instructor"
        )
    return email


print(
    json.dumps(
        {
            "staff": make("staff", "Erin Staff", staff=True),
            "learner": make("learner", "Leo Learner"),
            "teacher": make("teacher", "Tia Teacher", instructor="approved"),
            "applicant": make("applicant", "Ari Applicant", instructor="pending"),
        }
    )
)
