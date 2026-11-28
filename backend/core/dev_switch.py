"""Development only: switch between test actors without the login screen.

Mounted by core.api only when DEBUG and DEV_ACTOR_SWITCH are both on (config/settings/dev.py).
Production settings never turn it on, so the route does not exist there. It signs in real
seeded demo accounts with a real session: every permission and RLS rule still applies.
No password is read or stored here.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model, login, logout
from ninja import Router, Schema

from core.errors import ServiceError

router = Router(tags=["dev"])

# key -> (label, demo account, company workspace to open, landing page)
ACTORS: dict[str, tuple[str, str, str | None, str]] = {
    "b2b_learner": ("Learner B2B", "workforce.learner@learnhub.example", "LearnHub Workforce Demo", "/learn"),
    "b2c_learner": ("Learner B2C", "priya.nair@learnhub.example.com", None, "/learn"),
    "employer": ("Employer", "workforce.owner@learnhub.example", "LearnHub Workforce Demo", "/business"),
    "admin": ("Admin", "admin@learnhub.example.com", None, "/console"),
}


class DevActorOut(Schema):
    key: str
    label: str
    email: str
    org_name: str | None
    home: str
    available: bool


class DevSwitchIn(Schema):
    actor: str


def _out(key: str, available: bool) -> dict:
    label, email, org, home = ACTORS[key]
    return {"key": key, "label": label, "email": email, "org_name": org, "home": home, "available": available}


@router.get("/actors", response=list[DevActorOut], auth=None)
def actors(request):
    """The test actors and whether each demo account exists in this database."""
    found = set(
        get_user_model()
        .objects.filter(email__in=[a[1] for a in ACTORS.values()], is_active=True)
        .values_list("email", flat=True)
    )
    return [_out(k, ACTORS[k][1] in found) for k in ACTORS]


@router.post("/switch", response=DevActorOut, auth=None)
def switch(request, body: DevSwitchIn):
    """Sign in as one of the test actors (replaces the current session)."""
    if body.actor not in ACTORS:
        raise ServiceError("unknown_actor", "Choose one of the test actors.", status=400)
    email = ACTORS[body.actor][1]
    user = get_user_model().objects.filter(email=email, is_active=True).first()
    if user is None:
        raise ServiceError(
            "actor_missing",
            f"The demo account for {ACTORS[body.actor][0]} is not in this database.",
            status=404,
        )
    logout(request)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return _out(body.actor, True)
