"""Optimised READ queries (compliance). Every screen is a fixed, small number of queries
on the precomputed member_status table, whatever the company size, and every one is
limited to the caller's Scope (whole company, or a manager's units)."""

from datetime import timedelta

from django.db import connection
from django.db.models import Count, Q
from django.utils import timezone

from apps.org.models import OrgMember, OrgUnit
from core.permissions import Scope

from .models import CompletionRecord, Exemption, MemberStatus, Requirement

S = MemberStatus.Status
OK = (S.COMPLIANT, S.EXPIRING_SOON)


def scoped_members(scope: Scope, *, unit: OrgUnit | None = None, q: str | None = None, job_role_id=None):
    qs = scope.members(OrgMember.objects.filter(removed_at__isnull=True))
    if unit is not None:
        scope.check_unit(unit)
        qs = qs.filter(
            unit_links__unit__path__descendant_of=unit.path, unit_links__unit__archived_at__isnull=True
        ).distinct()
    if job_role_id:
        qs = qs.filter(job_role_links__job_role_id=job_role_id)
    if q:
        term = q.strip()[:100]
        qs = qs.filter(
            Q(user__full_name__icontains=term) | Q(user__email__icontains=term) | Q(employee_ref=term)
        )
    return qs


def _scoped_status(scope: Scope, **kw):
    members = scoped_members(scope, **kw).values("id")
    return MemberStatus.objects.filter(
        org_id=scope.org_id, requirement__archived_at__isnull=True, member_id__in=members
    )


def matrix(scope: Scope, *, unit=None, q=None, job_role_id=None, status=None, requirement_id=None,
           after=None, limit: int = 50) -> dict:  # fmt: skip
    """A page of people (keyset on name, id: alphabetical) x active requirements. 3 queries.
    `after` is the (name, member id) of the last row of the previous page."""
    limit = max(1, min(limit, 200))
    requirements = list(
        Requirement.objects.filter(org_id=scope.org_id, archived_at__isnull=True)
        .order_by("name")
        .values("id", "name")
    )
    live = MemberStatus.objects.filter(org_id=scope.org_id, requirement__archived_at__isnull=True)
    members_qs = scoped_members(scope, unit=unit, q=q, job_role_id=job_role_id)
    if status or requirement_id:  # people with at least one matching cell
        cells = live
        if status:
            cells = cells.filter(status=status)
        if requirement_id:
            cells = cells.filter(requirement_id=requirement_id)
        members_qs = members_qs.filter(id__in=cells.values("member_id"))
    members_qs = after_name(members_qs.order_by("user__full_name", "id"), after)
    members = list(
        members_qs.values("id", "user__full_name", "user__email", "job_title", "employee_ref")[: limit + 1]
    )
    has_more = len(members) > limit
    members = members[:limit]
    cells = live.filter(member_id__in=[m["id"] for m in members]).values(
        "id", "member_id", "requirement_id", "status", "due_at", "expires_at"
    )
    by_member: dict = {}
    for c in cells:
        by_member.setdefault(c["member_id"], {})[str(c["requirement_id"])] = c
    last = members[-1] if has_more else None
    return {
        "requirements": requirements,
        "rows": [{**m, "cells": by_member.get(m["id"], {})} for m in members],
        "next": (last["user__full_name"], str(last["id"])) if last else None,
    }


def after_name(qs, after):
    """Keyset step for member lists ordered by (user__full_name, id)."""
    if not after:
        return qs
    name, member_id = after
    return qs.filter(Q(user__full_name__gt=name) | Q(user__full_name=name, id__gt=member_id))


def summary(scope: Scope, *, unit=None) -> list[dict]:
    """Per requirement: counts by status and % compliant (exempt people excluded). 1 query."""
    rows = (
        _scoped_status(scope, unit=unit)
        .values("requirement_id", "requirement__name", "requirement__renewal_months")
        .annotate(total=Count("id"), **{s.value: Count("id", filter=Q(status=s)) for s in S})
    )
    out = []
    for r in rows:
        counted = r["total"] - r[S.EXEMPT]
        ok = r[S.COMPLIANT] + r[S.EXPIRING_SOON]
        out.append({**r, "compliance_pct": round(100 * ok / counted, 1) if counted else 100.0})
    return sorted(out, key=lambda r: r["requirement__name"])


def dashboard(scope: Scope) -> dict:
    """The HR home screen: headline numbers, per-unit compliance and what needs attention.
    4 queries regardless of company size."""
    now = timezone.now()
    statuses = _scoped_status(scope)
    totals = statuses.aggregate(
        total=Count("id"),
        exempt=Count("id", filter=Q(status=S.EXEMPT)),
        ok=Count("id", filter=Q(status__in=OK)),
        overdue=Count("id", filter=Q(status=S.OVERDUE)),
        expired=Count("id", filter=Q(status=S.EXPIRED)),
        people_overdue=Count("member_id", distinct=True, filter=Q(status__in=[S.OVERDUE, S.EXPIRED])),
        expiring_30=Count("id", filter=Q(status__in=OK, expires_at__lte=now + timedelta(days=30))),
        due_30=Count(
            "id", filter=Q(status__in=[S.NOT_STARTED, S.IN_PROGRESS], due_at__lte=now + timedelta(days=30))
        ),
    )
    counted = totals["total"] - totals["exempt"]
    members = scoped_members(scope)
    from apps.learning.models import Enrollment

    learning = Enrollment.objects.filter(
        org_id=scope.org_id, user_id__in=members.values("user_id")
    ).aggregate(
        people=Count("user_id", distinct=True),
        active_30=Count("user_id", distinct=True, filter=Q(last_accessed_at__gte=now - timedelta(days=30))),
        completed_30=Count("id", filter=Q(completed_at__gte=now - timedelta(days=30))),
        in_progress=Count("id", filter=Q(status="active", progress_pct__gt=0)),
    )
    return {
        "compliance_pct": round(100 * totals["ok"] / counted, 1) if counted else 100.0,
        "headcount": members.count(),
        **totals,
        "learning": learning,
        "units": unit_compliance(scope),
        "attention": list(
            statuses.filter(status__in=[S.OVERDUE, S.EXPIRED])
            .order_by("due_at")
            .values("id", "status", "due_at", "member_id", "member__user__full_name", "requirement__name")[
                :10
            ]
        ),
    }


def unit_compliance(scope: Scope) -> list[dict]:
    """% compliant for each top-level unit in scope (regions for HR, their sites for a
    manager), grouped by ltree prefix of each person's primary unit. 2 queries."""
    roots = list(
        OrgUnit.objects.filter(org_id=scope.org_id, archived_at__isnull=True, depth=1).values(
            "id", "name", "path"
        )
        if scope.unit_paths is None
        else OrgUnit.objects.filter(org_id=scope.org_id, path__in=list(scope.unit_paths)).values(
            "id", "name", "path"
        )
    )
    if not roots:
        return []
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT r.path::text, count(*) FILTER (WHERE s.status <> 'exempt'),
                   count(*) FILTER (WHERE s.status IN ('compliant', 'expiring_soon')),
                   count(*) FILTER (WHERE s.status IN ('overdue', 'expired'))
              FROM unnest(%s::ltree[]) AS r(path)
              JOIN org.org_units u ON u.org_id = %s AND u.path <@ r.path
              JOIN org.member_units mu ON mu.unit_id = u.id AND mu.is_primary
              JOIN org.org_members m ON m.id = mu.member_id AND m.removed_at IS NULL
              JOIN compliance.member_status s ON s.member_id = m.id
              JOIN compliance.requirements q ON q.id = s.requirement_id AND q.archived_at IS NULL
             GROUP BY 1
            """,
            [[r["path"] for r in roots], scope.org_id],
        )
        stats = {p: (counted, ok, bad) for p, counted, ok, bad in cur.fetchall()}
    out = []
    for r in roots:
        counted, ok, bad = stats.get(str(r["path"]), (0, 0, 0))
        out.append({"unit_id": r["id"], "name": r["name"], "people_rows": counted, "overdue_or_expired": bad,
                    "compliance_pct": round(100 * ok / counted, 1) if counted else 100.0})  # fmt: skip
    return sorted(out, key=lambda x: x["compliance_pct"])


def person(scope: Scope, member_id) -> dict:
    """Everything about one person's required training (person view)."""
    member = scoped_members(scope).select_related("user").filter(pk=member_id).first()
    if member is None:
        from django.http import Http404

        raise Http404
    statuses = list(
        MemberStatus.objects.filter(org_id=scope.org_id, member=member, requirement__archived_at__isnull=True)
        .select_related("requirement__course")
        .order_by("requirement__name")
    )
    records = list(
        CompletionRecord.objects.filter(org_id=scope.org_id, member=member)
        .select_related("requirement", "recorded_by")
        .order_by("-completed_at")[:100]
    )
    exemptions = list(  # revoked ones too: they stay in the person's history
        Exemption.objects.filter(org_id=scope.org_id, member=member)
        .select_related("requirement", "granted_by")
        .order_by("-starts_at")[:100]
    )
    units = list(
        member.unit_links.filter(unit__archived_at__isnull=True)
        .select_related("unit")
        .order_by("-is_primary")
    )
    job_roles = list(
        member.job_role_links.filter(job_role__archived_at__isnull=True).select_related("job_role")
    )
    return {"member": member, "statuses": statuses, "records": records, "exemptions": exemptions,
            "units": units, "job_roles": job_roles}  # fmt: skip


def my_required(*, org_id, user_id):
    """The learner's 'Required training' list inside a company."""
    return (
        MemberStatus.objects.filter(
            org_id=org_id,
            member__user_id=user_id,
            member__removed_at__isnull=True,
            requirement__archived_at__isnull=True,
        )  # fmt: skip
        .select_related("requirement__course")
        .order_by("due_at")
    )


def export_rows(scope: Scope, *, unit=None):
    """Streamed CSV rows for the matrix export (one query, iterated in chunks)."""
    members = scoped_members(scope, unit=unit).values("id")
    return (
        MemberStatus.objects.filter(
            org_id=scope.org_id, member_id__in=members, requirement__archived_at__isnull=True
        )
        .order_by("member__user__full_name", "requirement__name")
        .values_list(
            "member__user__full_name",
            "member__user__email",
            "member__employee_ref",
            "requirement__name",
            "status",
            "due_at",
            "completed_at",
            "expires_at",
        )  # fmt: skip
        .iterator(chunk_size=2000)
    )
