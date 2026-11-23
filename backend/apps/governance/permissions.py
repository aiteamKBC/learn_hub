"""Governance authorization helpers.

`require_governance_admin` gates all authoring (strategy, policies, allocation,
question bank — admin/owner, matching the other domains' D3 rule). Members read the
policies allocated to them and record their own read / acknowledge / check.
"""

from __future__ import annotations

from uuid import UUID

from django.core.exceptions import PermissionDenied

from core.permissions import ROLE_RANK, OrgRole, require_org


def active_member_id(request) -> UUID:
    require_org(request)
    member_id = getattr(request, "member_id", None)
    if member_id is None:
        raise PermissionDenied("You are not a member of this organization.")
    return member_id


def is_governance_admin(request) -> bool:
    role = getattr(request, "org_role", None)
    if role is not None and ROLE_RANK[OrgRole(role)] >= ROLE_RANK[OrgRole.ADMIN]:
        return True
    from apps.org.access import has_responsibility

    return has_responsibility(request, ("hr_admin", "executive"), company_wide=True)


def require_governance_admin(request) -> None:
    if not is_governance_admin(request):
        raise PermissionDenied("Only company admins can manage governance content.")
