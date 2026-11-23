"""Frameworks authorization helpers.

RLS already scopes rows to the caller's org. These helpers answer "may this user
*edit* framework definitions?" — reserved for company admins/owners (decision D3:
HR approver = members with role `admin` or `owner`; no new role enum value).
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


def is_framework_admin(request) -> bool:
    role = getattr(request, "org_role", None)
    if role is not None and ROLE_RANK[OrgRole(role)] >= ROLE_RANK[OrgRole.ADMIN]:
        return True
    from apps.org.access import has_responsibility

    return has_responsibility(request, "hr_admin", company_wide=True)


def require_framework_admin(request) -> None:
    if not is_framework_admin(request):
        raise PermissionDenied("Only company admins can manage frameworks.")
