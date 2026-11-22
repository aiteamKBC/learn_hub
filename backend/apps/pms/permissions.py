"""PMS authorization helpers.

RLS already scopes rows to the caller's org and (for reviews) to the member + their
managers. These helpers answer "may this user run this PMS action?":
`require_pms_admin` gates the KPI approval route, review-cycle management and creating
reviews (admin/owner — same simplification as frameworks D3).
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


def is_pms_admin(request) -> bool:
    role = getattr(request, "org_role", None)
    if role is not None and ROLE_RANK[OrgRole(role)] >= ROLE_RANK[OrgRole.ADMIN]:
        return True
    from apps.org.access import has_responsibility

    return has_responsibility(request, ("hr_admin", "executive"), company_wide=True)


def require_pms_admin(request) -> None:
    if not is_pms_admin(request):
        raise PermissionDenied("Only company admins can do this.")


def _company_role(request, code: str | tuple[str, ...]) -> bool:
    from apps.org.access import has_responsibility

    return has_responsibility(request, code, company_wide=True)


def can_review_proposal(request, proposal) -> bool:
    """Enforce the configured HoD → HR → Executive approval stage."""
    role = getattr(request, "org_role", None)
    if role is not None and ROLE_RANK[OrgRole(role)] >= ROLE_RANK[OrgRole.ADMIN]:
        return True
    stage = proposal.stage
    if stage == "hod_review":
        from apps.org.models import OrgRoleAssignment

        return OrgRoleAssignment.objects.filter(
            org_id=proposal.org_id, member_id=getattr(request, "member_id", None),
            code="department_head", unit__name__iexact=proposal.dept, revoked_at__isnull=True,
        ).exists()
    if stage == "hr_alignment":
        return _company_role(request, "hr_admin")
    if stage == "exec_approval":
        return _company_role(request, "executive")
    return _company_role(request, ("hr_admin", "executive"))


def require_proposal_reviewer(request, proposal) -> None:
    if not can_review_proposal(request, proposal):
        raise PermissionDenied("This proposal is assigned to another approval role.")


def require_proposal_author(request, dept: str) -> None:
    if is_pms_admin(request):
        return
    from apps.org.models import OrgRoleAssignment

    if OrgRoleAssignment.objects.filter(
        org_id=getattr(request, "org_id", None), member_id=getattr(request, "member_id", None),
        code="department_head", unit__name__iexact=dept, revoked_at__isnull=True,
    ).exists():
        return
    raise PermissionDenied("Only HR, Executive or the department head can draft this KPI.")


def can_view_proposal(request, proposal) -> bool:
    if is_pms_admin(request):
        return True
    from apps.org.models import OrgRoleAssignment

    return OrgRoleAssignment.objects.filter(
        org_id=proposal.org_id, member_id=getattr(request, "member_id", None),
        code="department_head", unit__name__iexact=proposal.dept, revoked_at__isnull=True,
    ).exists()
