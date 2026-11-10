"""Business logic that WRITES (org). Tree paths are maintained only here."""

import hashlib
import secrets
from datetime import timedelta

from django.db import connection, transaction
from django.utils import timezone

from core.db import new_id
from core.errors import ServiceError
from core.fields import label
from core.tenancy import tenant_context

from .models import Invite, JobRole, MemberJobRole, MemberUnit, Organization, OrgMember, OrgUnit, UnitManager
from .signals import notify_structure_changed


def create_organization(*, name: str, slug: str, owner, billing_currency: str = "GBP") -> Organization:
    """Company + its root unit + the owner's membership, in one transaction.

    The id is taken from the database first so the RLS context (app.org_id) can be
    set before the insert: organizations' WITH CHECK requires id = app.org_id.
    """
    org_id = new_id()
    with tenant_context(org_id=org_id, user_id=owner.id):
        org = Organization.objects.create(
            id=org_id, name=name, slug=slug, billing_currency=billing_currency, created_by=owner
        )
        root_id = new_id()
        root = OrgUnit.objects.create(
            id=root_id, org=org, kind=OrgUnit.Kind.COMPANY, name=name, path=label(root_id), depth=0
        )
        member = OrgMember.objects.create(
            org=org, user=owner, role=OrgMember.Role.OWNER, joined_at=timezone.now()
        )
        MemberUnit.objects.create(org=org, member=member, unit=root, is_primary=True)
    return org


def create_unit(*, parent: OrgUnit, kind: str, name: str, code: str = "") -> OrgUnit:
    if parent.archived_at:
        raise ServiceError("unit_archived", "Cannot add a unit under an archived unit.")
    unit_id = new_id()
    return OrgUnit.objects.create(
        id=unit_id,
        org_id=parent.org_id,
        parent=parent,
        kind=kind,
        name=name,
        code=code,
        path=f"{parent.path}.{label(unit_id)}",
        depth=parent.depth + 1,
    )


@transaction.atomic
def move_unit(*, unit: OrgUnit, new_parent: OrgUnit) -> None:
    """Re-parent a unit and rewrite the paths of its whole subtree in one statement."""
    if unit.parent_id is None:
        raise ServiceError("root_unit", "The company root cannot be moved.")
    if new_parent.org_id != unit.org_id:
        raise ServiceError("cross_org", "Units can only move within their company.")
    if OrgUnit.objects.filter(pk=new_parent.pk, path__descendant_of=unit.path).exists():
        raise ServiceError("cycle", "A unit cannot move under itself or its own descendants.")
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE "org"."org_units"
               SET path = %(new)s::ltree || subpath(path, nlevel(%(old)s::ltree) - 1),
                   depth = nlevel(%(new)s::ltree || subpath(path, nlevel(%(old)s::ltree) - 1)) - 1
             WHERE org_id = %(org)s AND path <@ %(old)s::ltree
            """,
            {"new": new_parent.path, "old": unit.path, "org": unit.org_id},
        )
    OrgUnit.objects.filter(pk=unit.pk).update(parent=new_parent)
    notify_structure_changed(unit.org_id)


def archive_unit(*, unit: OrgUnit) -> None:
    if unit.parent_id is None:
        raise ServiceError("root_unit", "The company root cannot be archived.")
    OrgUnit.objects.filter(org_id=unit.org_id, path__descendant_of=unit.path).update(
        archived_at=timezone.now()
    )
    notify_structure_changed(unit.org_id)


# ---------------------------------------------------------------- people in the tree
@transaction.atomic
def add_member_to_unit(*, member: OrgMember, unit: OrgUnit, primary: bool = False) -> MemberUnit:
    if unit.archived_at:
        raise ServiceError("unit_archived", "Cannot add people to an archived unit.")
    if primary:
        MemberUnit.objects.filter(member=member, is_primary=True).update(is_primary=False)
    link, created = MemberUnit.objects.get_or_create(
        org_id=member.org_id, member=member, unit=unit, defaults={"is_primary": primary}
    )
    if not created and primary and not link.is_primary:
        link.is_primary = True
        link.save(update_fields=["is_primary", "updated_at"])
    notify_structure_changed(member.org_id, [member.id])
    return link


@transaction.atomic
def remove_member_from_unit(*, member: OrgMember, unit: OrgUnit) -> None:
    MemberUnit.objects.filter(member=member, unit=unit).delete()
    notify_structure_changed(member.org_id, [member.id])


@transaction.atomic
def set_job_roles(*, member: OrgMember, job_roles: list[JobRole]) -> None:
    """Replace a member's job roles with exactly this set."""
    wanted = {r.id for r in job_roles}
    MemberJobRole.objects.filter(member=member).exclude(job_role_id__in=wanted).delete()
    have = set(MemberJobRole.objects.filter(member=member).values_list("job_role_id", flat=True))
    MemberJobRole.objects.bulk_create(
        [MemberJobRole(org_id=member.org_id, member=member, job_role_id=r) for r in wanted - have]
    )
    notify_structure_changed(member.org_id, [member.id])


# ---------------------------------------------------------------- members & roles
ROLE_ORDER = {"learner": 0, "manager": 1, "admin": 2, "owner": 3}


def _owners(org_id) -> int:
    return OrgMember.objects.filter(org_id=org_id, role=OrgMember.Role.OWNER, removed_at__isnull=True).count()


@transaction.atomic
def change_role(*, member: OrgMember, role: str, by_role: str) -> OrgMember:
    """Admins manage learners and managers; only owners create or remove admins and owners.
    A company always keeps at least one owner."""
    if role not in ROLE_ORDER:
        raise ServiceError("bad_role", "Unknown role.")
    if by_role != "owner" and (
        ROLE_ORDER[role] >= ROLE_ORDER["admin"] or ROLE_ORDER[member.role] >= ROLE_ORDER["admin"]
    ):
        raise ServiceError("owner_only", "Only an owner can change admins or owners.", status=403)
    if member.role == "owner" and role != "owner" and _owners(member.org_id) <= 1:
        raise ServiceError("last_owner", "The company needs at least one owner.")
    OrgMember.objects.filter(pk=member.pk).update(role=role, updated_at=timezone.now())
    member.role = role
    return member


@transaction.atomic
def remove_member(*, member: OrgMember, by_role: str) -> None:
    """Never deleted (training history is evidence); marked removed. Their compliance
    rows drop out of the matrix, records stay for audits."""
    if member.role in ("admin", "owner") and by_role != "owner":
        raise ServiceError("owner_only", "Only an owner can remove an admin or owner.", status=403)
    if member.role == "owner" and _owners(member.org_id) <= 1:
        raise ServiceError("last_owner", "The company needs at least one owner.")
    OrgMember.objects.filter(pk=member.pk, removed_at__isnull=True).update(
        removed_at=timezone.now(), updated_at=timezone.now()
    )
    UnitManager.objects.filter(member=member).delete()
    notify_structure_changed(member.org_id, [member.id])


@transaction.atomic
def set_unit_managers(*, unit: OrgUnit, members: list[OrgMember]) -> None:
    wanted = {m.id for m in members}
    if any(m.org_id != unit.org_id or m.removed_at for m in members):
        raise ServiceError("bad_member", "Managers must be active members of this company.")
    UnitManager.objects.filter(unit=unit).exclude(member_id__in=wanted).delete()
    have = set(UnitManager.objects.filter(unit=unit).values_list("member_id", flat=True))
    UnitManager.objects.bulk_create(
        [UnitManager(org_id=unit.org_id, unit=unit, member_id=m) for m in wanted - have]
    )
    OrgMember.objects.filter(id__in=wanted, role="learner").update(role="manager", updated_at=timezone.now())


def rename_unit(*, unit: OrgUnit, name: str, code: str | None = None) -> OrgUnit:
    unit.name = name.strip()[:160]
    if code is not None:
        unit.code = code.strip()[:32]
    unit.save(update_fields=["name", "code", "updated_at"])
    return unit


# ---------------------------------------------------------------- invites
INVITE_DAYS = 7


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@transaction.atomic
def invite(
    *, org_id, email: str, role: str, invited_by, by_role: str, unit=None, job_role=None
) -> tuple[Invite, str]:
    """Returns (invite, raw_token). The raw token goes into the email link ONCE and is
    never stored: only its SHA-256 hash is, so a database leak cannot be used to join."""
    email = email.strip().lower()
    if role not in ROLE_ORDER or (ROLE_ORDER[role] >= ROLE_ORDER["admin"] and by_role != "owner"):
        raise ServiceError("bad_role", "You cannot invite with that role.", status=403)
    if OrgMember.objects.filter(org_id=org_id, user__email=email, removed_at__isnull=True).exists():
        raise ServiceError("already_member", "This person is already a member.")
    org = Organization.objects.get(pk=org_id)
    if (
        org.seat_limit
        and OrgMember.objects.filter(org_id=org_id, removed_at__isnull=True).count() >= org.seat_limit
    ):
        raise ServiceError("no_seats", "All seats are in use. Add seats to invite more people.")
    Invite.objects.filter(
        org_id=org_id, email__iexact=email, accepted_at__isnull=True, revoked_at__isnull=True
    ).update(revoked_at=timezone.now())  # a new invite replaces any pending one
    token = secrets.token_urlsafe(32)
    inv = Invite.objects.create(
        org_id=org_id, email=email, role=role, unit=unit, job_role=job_role, token_hash=_hash(token),
        invited_by=invited_by, expires_at=timezone.now() + timedelta(days=INVITE_DAYS),
    )  # fmt: skip
    return inv, token


def invite_preview(token: str) -> dict | None:
    """What the accept page shows before signing in (company name only)."""
    with tenant_context(staff=True):
        inv = (
            Invite.objects.select_related("org")
            .filter(
                token_hash=_hash(token),
                accepted_at__isnull=True,
                revoked_at__isnull=True,
                expires_at__gt=timezone.now(),
            )  # fmt: skip
            .first()
        )
        return {"org_name": inv.org.name, "email": inv.email, "role": inv.role} if inv else None


@transaction.atomic
def accept_invite(*, token: str, user) -> OrgMember:
    """The signed-in user must own the invited email address (verified by allauth)."""
    with tenant_context(user_id=user.id, staff=True):  # the invitee is not a member yet
        inv = (
            Invite.objects.select_for_update()
            .filter(token_hash=_hash(token), accepted_at__isnull=True, revoked_at__isnull=True)
            .first()
        )
        if inv is None or inv.expires_at <= timezone.now():
            raise ServiceError("invite_invalid", "This invitation is no longer valid.", status=404)
        if inv.email.lower() != user.email.lower():
            raise ServiceError(
                "wrong_account", f"This invitation is for {inv.email}. Sign in with that address.", status=403
            )
        member = OrgMember.objects.filter(org_id=inv.org_id, user=user, removed_at__isnull=True).first()
        if member is None:
            member = OrgMember.objects.create(
                org_id=inv.org_id, user=user, role=inv.role, joined_at=timezone.now()
            )
        if inv.unit_id:
            MemberUnit.objects.get_or_create(org_id=inv.org_id, member=member, unit_id=inv.unit_id,
                                             defaults={"is_primary": True})  # fmt: skip
        if inv.job_role_id:
            MemberJobRole.objects.get_or_create(org_id=inv.org_id, member=member, job_role_id=inv.job_role_id)
        Invite.objects.filter(pk=inv.pk).update(accepted_at=timezone.now(), updated_at=timezone.now())
    notify_structure_changed(member.org_id, [member.id])
    return member


def revoke_invite(*, invite: Invite) -> None:
    Invite.objects.filter(pk=invite.pk, accepted_at__isnull=True).update(revoked_at=timezone.now())


@transaction.atomic
def staff_set_admin(*, org: Organization, user, role: str) -> OrgMember:
    """Platform staff (console): make someone an admin or owner of a company (adding them
    to it if needed), or move an admin back to learner. The last owner always stays."""
    if role not in ROLE_ORDER:
        raise ServiceError("bad_role", "Unknown role.")
    with tenant_context(org_id=org.id, user_id=user.id, staff=True):
        member = OrgMember.objects.filter(org=org, user=user, removed_at__isnull=True).first()
        if member is None:
            member = OrgMember.objects.create(org=org, user=user, role=role, joined_at=timezone.now())
            root = OrgUnit.objects.filter(org=org, depth=0).first()
            if root is not None:
                MemberUnit.objects.create(org=org, member=member, unit=root, is_primary=True)
            notify_structure_changed(org.id, [member.id])
            return member
        if member.role == "owner" and role != "owner" and _owners(org.id) <= 1:
            raise ServiceError("last_owner", "The company needs at least one owner.")
        OrgMember.objects.filter(pk=member.pk).update(role=role, updated_at=timezone.now())
        member.role = role
    return member
