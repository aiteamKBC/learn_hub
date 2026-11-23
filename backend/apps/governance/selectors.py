"""Optimised READ queries + payload shaping for Governance. All run under RLS."""

from __future__ import annotations

from uuid import UUID

from apps.org.models import OrgMember

from .models import (
    PolicyAllocation,
    PolicyDoc,
    PolicyRecord,
    PolicyVersion,
    Strategy,
    StrategyObjective,
    StrategyVersion,
    TechQuestion,
)

ADOPTION_LABELS = ["Not started", "Aware", "Understands", "Applies", "Embedded"]


# ---------------------------------------------------------------- strategy
def strategies(*, org_id: UUID, include_archived: bool = False):
    qs = Strategy.objects.filter(org_id=org_id)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    return qs.order_by("name")


def strategy(*, org_id: UUID, strategy_id: UUID) -> Strategy | None:
    return Strategy.objects.filter(org_id=org_id, id=strategy_id).first()


def strategy_payload(s: Strategy) -> dict:
    rows = StrategyVersion.objects.filter(org_id=s.org_id, strategy_id=s.id)
    approved = (
        rows.filter(status=StrategyVersion.Status.APPROVED)
        .order_by("-number")
        .values_list("number", flat=True)
        .first()
    )
    latest = rows.order_by("-number").values_list("number", flat=True).first()
    return {
        "id": s.id,
        "name": s.name,
        "archived": s.archived_at is not None,
        "approved_version_number": approved,
        "latest_version_number": latest,
    }


def strategy_version(*, org_id: UUID, version_id: UUID) -> StrategyVersion | None:
    return StrategyVersion.objects.filter(org_id=org_id, id=version_id).first()


def strategy_version_payload(v: StrategyVersion) -> dict:
    objectives = [
        {
            "id": o.id,
            "code": o.code,
            "title": o.title,
            "priority": o.priority,
            "owner_id": o.owner_id,
            "period": o.period,
            "measure": o.measure,
            "description": o.description,
            "sort_order": o.sort_order,
        }
        for o in StrategyObjective.objects.filter(org_id=v.org_id, version_id=v.id).order_by(
            "sort_order", "code"
        )
    ]
    return {
        "id": v.id,
        "strategy_id": v.strategy_id,
        "number": v.number,
        "status": v.status,
        "vision": v.vision,
        "mission": v.mission,
        "values": list(v.values or []),
        "note": v.note,
        "approved_at": v.approved_at,
        "objectives": objectives,
    }


# ---------------------------------------------------------------- policies
def policies(*, org_id: UUID, doc_type: str | None = None, include_archived: bool = False):
    qs = PolicyDoc.objects.filter(org_id=org_id)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    if doc_type:
        qs = qs.filter(doc_type=doc_type)
    return qs.order_by("code")


def policy(*, org_id: UUID, doc_id: UUID) -> PolicyDoc | None:
    return PolicyDoc.objects.filter(org_id=org_id, id=doc_id).first()


def policy_payload(d: PolicyDoc) -> dict:
    return {
        "id": d.id,
        "code": d.code,
        "title": d.title,
        "doc_type": d.doc_type,
        "category": d.category,
        "owner_id": d.owner_id,
        "objective_code": d.objective_code,
        "summary": d.summary,
        "current_version": d.current_version,
        "status": d.status,
        "archived": d.archived_at is not None,
    }


def policy_version(*, org_id: UUID, version_id: UUID) -> PolicyVersion | None:
    return PolicyVersion.objects.filter(org_id=org_id, id=version_id).first()


def policy_versions(*, org_id: UUID, doc_id: UUID):
    return PolicyVersion.objects.filter(org_id=org_id, doc_id=doc_id).order_by("-number")


def policy_version_payload(v: PolicyVersion) -> dict:
    return {
        "id": v.id,
        "doc_id": v.doc_id,
        "number": v.number,
        "status": v.status,
        "effective_date": v.effective_date,
        "review_date": v.review_date,
        "summary": v.summary,
        "sections": list(v.sections or []),
        "understanding_check": dict(v.understanding_check or {}),
        "approved_at": v.approved_at,
        "published_at": v.published_at,
    }


def allocation(*, org_id: UUID, doc_id: UUID) -> PolicyAllocation | None:
    return PolicyAllocation.objects.filter(org_id=org_id, doc_id=doc_id).first()


def allocation_payload(a: PolicyAllocation) -> dict:
    return {
        "doc_id": a.doc_id,
        "scope": a.scope,
        "depts": list(a.depts or []),
        "titles": list(a.titles or []),
        "sites": list(a.sites or []),
        "worker_types": list(a.worker_types or []),
        "persons": list(a.persons or []),
        "require_reack": a.require_reack,
        "published_version": a.published_version,
        "published_at": a.published_at,
    }


def policy_allocated_to(doc: PolicyDoc, member: OrgMember, rule: PolicyAllocation | None = None) -> bool:
    """Mirror the source audience rule: named members override the scope filters.

    Unit codes, names and ids are accepted for imported department/site references.
    Worker classification has no authoritative field yet, so it never broadens access.
    """
    if doc.org_id != member.org_id or doc.archived_at or doc.status != PolicyDoc.Status.APPROVED:
        return False
    rule = rule or allocation(org_id=doc.org_id, doc_id=doc.id)
    if rule is None:
        return False
    if str(member.id) in {str(pid) for pid in rule.persons}:
        return True
    departments, sites = set(), set()
    for link in member.unit_links.select_related("unit").all():
        unit = link.unit
        while unit:
            aliases = {str(unit.id), unit.code, unit.name}
            if unit.kind == "department":
                departments.update(aliases)
            if unit.kind == "site":
                sites.update(aliases)
            unit = unit.parent
    if rule.scope == "depts" and not departments.intersection(rule.depts):
        return False
    titles = {member.job_title, *member.job_role_links.values_list("job_role__name", flat=True)}
    if rule.titles and not titles.intersection(rule.titles):
        return False
    from apps.hcm.models import MemberProfile

    location = (
        MemberProfile.objects.filter(org_id=member.org_id, member=member)
        .values_list("location", flat=True)
        .first()
    )
    if location:
        sites.add(location)
    if rule.sites and not sites.intersection(rule.sites):
        return False
    if rule.worker_types:
        return False
    return True


# ---- adoption --------------------------------------------------------------
def adoption_stage(record: PolicyRecord | None, *, current_version: int, require_reack: bool) -> int:
    if record is None or record.ack_at is None:
        return 0
    if require_reack and record.version < current_version:
        return 0
    stage = 1  # Aware (acknowledged current version)
    if record.check_at and (record.check_score or 0) >= 100:
        stage = 2  # Understands
    else:
        return stage
    obs = record.observations or []
    if len(obs) >= 1:
        stage = 3  # Applies
    else:
        return stage
    months = {o["at"][:7] for o in obs if isinstance(o, dict) and o.get("at")}
    if len(months) >= 2:
        stage = 4  # Embedded
    return stage


def record_payload(
    doc: PolicyDoc, record: PolicyRecord | None, *, require_reack: bool, member_id: UUID | None = None
) -> dict:
    stage = adoption_stage(record, current_version=doc.current_version, require_reack=require_reack)
    return {
        "doc_id": doc.id,
        "member_id": record.member_id if record else member_id,
        "version": record.version if record else 0,
        "read_at": record.read_at if record else None,
        "ack_at": record.ack_at if record else None,
        "check_at": record.check_at if record else None,
        "check_score": record.check_score if record else None,
        "adoption_stage": stage,
        "adoption_label": ADOPTION_LABELS[stage],
        "policy_code": doc.code,
        "policy_title": doc.title,
        "current_version": doc.current_version,
        "require_reack": require_reack,
        "needs_reack": bool(record and require_reack and record.version < doc.current_version),
    }


def records_for_doc(*, org_id: UUID, doc_id: UUID):
    return PolicyRecord.objects.filter(org_id=org_id, doc_id=doc_id).order_by("member_id")


def record_for(*, org_id: UUID, doc_id: UUID, member_id: UUID) -> PolicyRecord | None:
    return PolicyRecord.objects.filter(org_id=org_id, doc_id=doc_id, member_id=member_id).first()


# ---------------------------------------------------------------- question bank
def questions(*, org_id: UUID, dept: str | None = None, include_archived: bool = False):
    qs = TechQuestion.objects.filter(org_id=org_id)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    if dept:
        qs = qs.filter(dept=dept)
    return qs.order_by("dept", "level")


def question(*, org_id: UUID, question_id: UUID) -> TechQuestion | None:
    return TechQuestion.objects.filter(org_id=org_id, id=question_id).first()


def question_payload(q: TechQuestion) -> dict:
    return {
        "id": q.id,
        "competency_id": q.competency_id,
        "dept": q.dept,
        "q_type": q.q_type,
        "prompt": q.prompt,
        "options": list(q.options or []),
        "answer_index": q.answer_index,
        "expected": q.expected,
        "rationale": q.rationale,
        "mark": q.mark,
        "level": q.level,
        "course_ref": q.course_ref,
        "archived": q.archived_at is not None,
    }
