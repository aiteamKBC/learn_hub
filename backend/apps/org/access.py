"""Company responsibility checks shared by workforce domain permissions."""

from __future__ import annotations

from collections.abc import Iterable

from .models import OrgRoleAssignment


def has_responsibility(request, codes: str | Iterable[str], *, company_wide: bool = False) -> bool:
    org_id = getattr(request, "org_id", None)
    member_id = getattr(request, "member_id", None)
    if org_id is None or member_id is None:
        return False
    values = [codes] if isinstance(codes, str) else list(codes)
    qs = OrgRoleAssignment.objects.filter(
        org_id=org_id, member_id=member_id, code__in=values, revoked_at__isnull=True,
    )
    if company_wide:
        qs = qs.filter(unit__isnull=True)
    return qs.exists()
