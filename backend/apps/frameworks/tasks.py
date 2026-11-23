"""Frameworks background jobs (Celery).

`recompute_evidenced` refreshes the denormalised {competency: level} map on each
member's `hcm.MemberProfile` from their completed, competency-tagged courses. It is
cheap and idempotent, so the nightly fan-out can safely re-run the whole estate.
"""

from __future__ import annotations

from uuid import UUID

from celery import shared_task

from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context

from . import scoring


@shared_task(name="frameworks.recompute_evidenced_for_member")
def recompute_evidenced_for_member(org_id: str, member_id: str) -> dict:
    org_uuid = UUID(str(org_id))
    with tenant_context(org_id=org_uuid):
        member = OrgMember.objects.filter(
            org_id=org_uuid, id=UUID(str(member_id)), removed_at__isnull=True
        ).first()
        if member is None:
            return {}
        return scoring.recompute_evidenced(org_id=org_uuid, member=member)


@shared_task(name="frameworks.recompute_all_evidenced")
def recompute_all_evidenced() -> int:
    """Nightly fan-out: refresh every active member's evidenced cache, org by org."""
    with tenant_context(staff=True):
        org_ids = list(Organization.objects.values_list("id", flat=True))

    total = 0
    for org_id in org_ids:
        with tenant_context(org_id=org_id):
            members = list(OrgMember.objects.filter(org_id=org_id, removed_at__isnull=True))
            for member in members:
                scoring.recompute_evidenced(org_id=org_id, member=member)
                total += 1
    return total
