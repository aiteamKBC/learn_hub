"""Per-request security context for Postgres Row-Level Security (see core/rls.py).

Behind Neon's pooler (PgBouncer, transaction mode) a session-level SET would leak
to the next client, so every key is set with set_config(..., true): local to the
transaction this middleware opens around each authenticated request.
"""

from contextlib import contextmanager
from uuid import UUID

from django.db import connection, transaction

ORG_HEADER = "HTTP_X_ORG_ID"
PLATFORM_ORG_ACCESS_HEADER = "HTTP_X_PLATFORM_ORG_ACCESS"
CONSOLE_PREFIX = "/api/v1/console/"


def _set(cur, key: str, value: str) -> None:
    cur.execute("SELECT set_config(%s, %s, true)", [f"app.{key}", value])


def _set_many(cur, values: dict[str, str]) -> None:
    """Set the request's RLS context in one database round trip.

    The application database is deliberately a transaction-pooled Neon connection.
    Calling ``set_config`` once per value therefore made every authenticated request
    wait for two to five WAN round trips before its view code even started.  The
    settings are still transaction-local; only the transport shape changes.
    """
    if not values:
        return
    selects = ", ".join("set_config(%s, %s, true)" for _ in values)
    params: list[str] = []
    for key, value in values.items():
        params.extend((f"app.{key}", value))
    cur.execute(f"SELECT {selects}", params)


def _parse_org(raw: str | None) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.org_id = None
        request.platform_staff = False
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return self.get_response(request)

        with transaction.atomic():
            with connection.cursor() as cur:
                context = {"user_id": str(user.id)}
                org_id = _parse_org(request.META.get(ORG_HEADER))
                platform_org_access = bool(
                    user.is_staff
                    and org_id is not None
                    and request.META.get(PLATFORM_ORG_ACCESS_HEADER) == "on"
                )
                if platform_org_access:
                    # An explicit platform-console hand-off lets staff inspect a
                    # company without creating a fake employee membership.  The
                    # separate header prevents an ordinary X-Org-Id from silently
                    # becoming elevated access.
                    context.update({"platform_staff": "on", "org_id": str(org_id), "org_role": "owner"})
                    request.org_id = org_id
                    request.org_role = "owner"
                    request.platform_staff = True
                elif org_id is not None:
                    # Runs under RLS: with only app.user_id set, the user can see
                    # nothing but their own memberships, so this cannot be spoofed.
                    from apps.org.selectors import active_member_scope

                    # The membership lookup itself is protected by RLS, so it is
                    # the one case that must see user_id before the final batched
                    # context assignment below.
                    _set_many(cur, context)
                    context = {}
                    scope = active_member_scope(user_id=user.id, org_id=org_id)
                    if scope is not None:
                        member_id, role = scope
                        context.update({"org_id": str(org_id), "member_id": str(member_id), "org_role": role})
                        request.org_id = org_id
                        request.member_id = member_id
                        request.org_role = role
                if user.is_staff and request.path.startswith(CONSOLE_PREFIX):
                    context["platform_staff"] = "on"
                    request.platform_staff = True
                _set_many(cur, context)
            return self.get_response(request)


KEYS = ("user_id", "org_id", "platform_staff", "member_id", "org_role")


@contextmanager
def tenant_context(
    *,
    org_id: UUID | None = None,
    user_id: UUID | None = None,
    staff: bool = False,
    member_id: UUID | None = None,
    org_role: str | None = None,
):
    """For Celery tasks, scripts and narrow elevated writes: run a block with the RLS keys
    a request would have.

        with tenant_context(org_id=org.id):
            Assignment.objects.filter(...)

    Nesting is safe: set_config(..., true) lasts until the end of the WHOLE transaction,
    not the inner block, so the previous values are put back on exit. Without this, a
    nested tenant_context(staff=True) would leave staff mode on for the rest of the request.
    (If the block raises, the savepoint rollback restores them by itself.)

    `member_id` and `org_role` are needed by `core.rls.manager_of_unit` policies.
    """
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(
                "SELECT current_setting('app.user_id', true), current_setting('app.org_id', true),"
                " current_setting('app.platform_staff', true),"
                " current_setting('app.member_id', true), current_setting('app.org_role', true)"
            )
            previous = dict(zip(KEYS, cur.fetchone(), strict=True))
            if user_id is not None:
                _set(cur, "user_id", str(user_id))
            if org_id is not None:
                _set(cur, "org_id", str(org_id))
            if staff:
                _set(cur, "platform_staff", "on")
            if member_id is not None:
                _set(cur, "member_id", str(member_id))
            if org_role is not None:
                _set(cur, "org_role", org_role)
        yield
        with connection.cursor() as cur:
            for key in KEYS:
                _set(cur, key, previous[key] or "")
