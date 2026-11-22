"""Authorization on top of Row-Level Security.

RLS answers "which company's rows can this request see?". These helpers answer
"is this user allowed to do this action inside that company?".
"""

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from django.core.exceptions import PermissionDenied
from django.db.models import Exists, OuterRef

from core.errors import ServiceError


class OrgRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    LEARNER = "learner"


ROLE_RANK = {OrgRole.LEARNER: 0, OrgRole.MANAGER: 1, OrgRole.ADMIN: 2, OrgRole.OWNER: 3}


def require_org(request):
    """The request must carry a verified org context (set by TenantMiddleware)."""
    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise PermissionDenied("No organization selected.")
    return org_id


def require_org_role(request, minimum: OrgRole) -> OrgRole:
    """Allow members whose role is at least `minimum` (owner > admin > manager > learner)."""
    org_id = require_org(request)
    from apps.org.selectors import member_role

    role = member_role(user_id=request.user.id, org_id=org_id)
    if role is None or ROLE_RANK[OrgRole(role)] < ROLE_RANK[minimum]:
        raise PermissionDenied("Insufficient role.")
    return OrgRole(role)


def require_staff(request) -> None:
    if not (request.user.is_authenticated and request.user.is_staff):
        raise PermissionDenied("Staff only.")


# ---------------------------------------------------------------- company scope


@dataclass(frozen=True)
class Scope:
    """Who an HR request may see inside the current company.

    unit_paths None  -> the whole company (owner / admin)
    unit_paths [...] -> only people in these units or below (a manager's sites/teams)
    """

    org_id: UUID
    role: OrgRole
    member_id: UUID
    unit_paths: tuple[str, ...] | None

    @property
    def is_admin(self) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[OrgRole.ADMIN]

    def members(self, qs):
        """Filter an OrgMember queryset to this scope (one indexed EXISTS, any size)."""
        qs = qs.filter(org_id=self.org_id)
        if self.unit_paths is None:
            return qs
        from apps.org.models import MemberUnit

        in_scope = MemberUnit.objects.filter(
            member_id=OuterRef("pk"), unit__path__descendant_of_any=list(self.unit_paths)
        )
        return qs.filter(Exists(in_scope))

    def check_unit(self, unit) -> None:
        """A manager may only look at (or below) the units they manage."""
        if self.unit_paths is None:
            return
        if not any(unit.path == p or unit.path.startswith(p + ".") for p in self.unit_paths):
            raise PermissionDenied("That unit is outside your area.")

    def require_admin(self) -> None:
        if not self.is_admin:
            raise PermissionDenied("Only company admins can do this.")


def org_scope(request, minimum: OrgRole = OrgRole.MANAGER) -> Scope:
    org_id = require_org(request)
    if getattr(request, "platform_staff", False):
        # Platform staff enter through the explicit console workforce chooser;
        # they are not added to the customer's employee directory.
        return Scope(org_id, OrgRole.OWNER, UUID(int=0), None)
    from apps.org.models import OrgMember
    from apps.org.selectors import managed_unit_paths

    m = OrgMember.objects.filter(org_id=org_id, user_id=request.user.id, removed_at__isnull=True).first()
    if m is None:
        raise PermissionDenied("Insufficient role.")
    role = OrgRole(m.role)
    if ROLE_RANK[role] >= ROLE_RANK[OrgRole.ADMIN]:
        return Scope(org_id, role, m.id, None)
    if minimum == OrgRole.MANAGER:
        from apps.org.models import OrgRoleAssignment

        company_responsibilities = set(OrgRoleAssignment.objects.filter(
            org_id=org_id, member=m, unit__isnull=True, revoked_at__isnull=True,
            code__in=("hr_admin", "executive"),
        ).values_list("code", flat=True))
        if company_responsibilities:
            # Company-wide readers can open the business workspace; authoring endpoints
            # still require the domain-specific HR/Executive permission helper.
            return Scope(org_id, OrgRole.MANAGER, m.id, None)
    paths = set(managed_unit_paths(member_id=m.id))
    if minimum == OrgRole.MANAGER:
        from apps.org.models import OrgRoleAssignment

        assigned_paths = OrgRoleAssignment.objects.filter(
            org_id=org_id,
            member=m,
            code__in=("department_head", "line_manager"),
            unit__isnull=False,
            revoked_at__isnull=True,
        ).values_list("unit__path", flat=True)
        paths.update(assigned_paths)
    if ROLE_RANK[role] < ROLE_RANK[minimum] and not (minimum == OrgRole.MANAGER and paths):
        raise PermissionDenied("Insufficient role.")
    if not paths:
        raise ServiceError("no_units", "You are not set as manager of any unit yet.", status=403)
    # A unit-scoped HoD/line manager gets manager-level workspace access without
    # changing their underlying membership role.
    return Scope(org_id, OrgRole.MANAGER if ROLE_RANK[role] < ROLE_RANK[OrgRole.MANAGER] else role, m.id, tuple(paths))
