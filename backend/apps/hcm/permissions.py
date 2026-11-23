"""HCM-specific authorization helpers on top of `core.permissions`.

RLS already answers "which org's rows can this request see?". These helpers
answer "may this user perform this HCM action against this member?".
"""

from __future__ import annotations

from uuid import UUID

from django.core.exceptions import PermissionDenied

from core.permissions import ROLE_RANK, OrgRole, require_org


def active_member_id(request) -> UUID:
    """The caller's OrgMember.id in the current org, as set by TenantMiddleware."""
    require_org(request)
    member_id = getattr(request, "member_id", None)
    if member_id is None:
        raise PermissionDenied("You are not a member of this organization.")
    return member_id


def is_self(request, member_id: UUID) -> bool:
    return getattr(request, "member_id", None) == member_id


def is_hr_admin(request) -> bool:
    role = getattr(request, "org_role", None)
    if role is not None and ROLE_RANK[OrgRole(role)] >= ROLE_RANK[OrgRole.ADMIN]:
        return True
    org_id, member_id = getattr(request, "org_id", None), getattr(request, "member_id", None)
    if org_id is None or member_id is None:
        return False
    from apps.org.models import OrgRoleAssignment

    return OrgRoleAssignment.objects.filter(
        org_id=org_id,
        member_id=member_id,
        code=OrgRoleAssignment.Code.HR_ADMIN,
        unit__isnull=True,
        revoked_at__isnull=True,
    ).exists()


def require_hr_admin(request) -> None:
    if not is_hr_admin(request):
        raise PermissionDenied("Only company admins can do this.")


def require_self_or_hr(request, member_id: UUID) -> None:
    """Members manage their own records; HR admins may act on anyone's."""
    if not is_self(request, member_id) and not is_hr_admin(request):
        raise PermissionDenied("You may only act on your own record.")
