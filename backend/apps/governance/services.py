"""Write-side operations for Governance.

Strategy and policy versions share a draft → approved lifecycle (approving supersedes
the prior approved version, atomically). Policies also carry an allocation rule and
per-member adoption records. The question bank is simple CRUD. All writes are
`transaction.atomic` and run under the request's RLS context.
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.org.models import OrgMember
from core.errors import ServiceError

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


def _member(org_id: UUID, member_id: UUID | None) -> OrgMember | None:
    if member_id is None:
        return None
    m = OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()
    if m is None:
        raise ServiceError("member_not_found", "Not a member of this company.", status=404)
    return m


# ================================================================ strategy
@transaction.atomic
def create_strategy(*, org_id: UUID, name: str) -> tuple[Strategy, StrategyVersion]:
    strategy = Strategy.objects.create(org_id=org_id, name=name.strip())
    version = StrategyVersion.objects.create(
        org_id=org_id, strategy=strategy, number=1, status=StrategyVersion.Status.DRAFT
    )
    return strategy, version


@transaction.atomic
def update_strategy_version(*, version: StrategyVersion, patch: dict) -> StrategyVersion:
    if version.status != StrategyVersion.Status.DRAFT:
        raise ServiceError("not_editable", "Only a draft version can be edited.", status=409)
    for f in ("vision", "mission", "values", "note"):
        if f in patch and patch[f] is not None:
            setattr(version, f, patch[f])
    version.save()
    return version


@transaction.atomic
def add_objective(*, org_id: UUID, version: StrategyVersion, data: dict) -> StrategyObjective:
    if version.status != StrategyVersion.Status.DRAFT:
        raise ServiceError("not_editable", "Objectives can only be added to a draft.", status=409)
    owner = _member(org_id, data.get("owner_id"))
    next_sort = (
        StrategyObjective.objects.filter(org_id=org_id, version=version).aggregate(m=Max("sort_order"))["m"]
        or 0
    ) + 1
    return StrategyObjective.objects.create(
        org_id=org_id,
        version=version,
        code=data["code"].strip(),
        title=data["title"].strip(),
        priority=data.get("priority", "medium"),
        owner=owner,
        period=(data.get("period") or "").strip(),
        measure=(data.get("measure") or "").strip(),
        description=(data.get("description") or "").strip(),
        sort_order=next_sort,
    )


@transaction.atomic
def approve_strategy_version(*, version: StrategyVersion, by_user_id: UUID) -> StrategyVersion:
    if version.status != StrategyVersion.Status.DRAFT:
        raise ServiceError("not_approvable", "Only a draft version can be approved.", status=409)
    StrategyVersion.objects.filter(
        org_id=version.org_id, strategy_id=version.strategy_id, status=StrategyVersion.Status.APPROVED
    ).update(status=StrategyVersion.Status.SUPERSEDED)
    version.status = StrategyVersion.Status.APPROVED
    version.approved_by_id = by_user_id
    version.approved_at = timezone.now()
    version.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    return version


# ================================================================ policies
@transaction.atomic
def create_policy(*, org_id: UUID, data: dict) -> tuple[PolicyDoc, PolicyVersion]:
    if PolicyDoc.objects.filter(org_id=org_id, code=data["code"].strip()).exists():
        raise ServiceError("duplicate_code", "A policy with this code already exists.", status=409)
    owner = _member(org_id, data.get("owner_id"))
    doc = PolicyDoc.objects.create(
        org_id=org_id,
        code=data["code"].strip(),
        title=data["title"].strip(),
        doc_type=data.get("doc_type", "policy"),
        category=(data.get("category") or "").strip(),
        owner=owner,
        objective_code=(data.get("objective_code") or "").strip(),
        summary=(data.get("summary") or "").strip(),
        current_version=1,
        status=PolicyDoc.Status.DRAFT,
    )
    version = PolicyVersion.objects.create(
        org_id=org_id, doc=doc, number=1, status=PolicyVersion.Status.DRAFT
    )
    PolicyAllocation.objects.create(org_id=org_id, doc=doc, scope=PolicyAllocation.Scope.ORG)
    return doc, version


@transaction.atomic
def update_policy_version(*, version: PolicyVersion, patch: dict) -> PolicyVersion:
    if version.status != PolicyVersion.Status.DRAFT:
        raise ServiceError("not_editable", "Only a draft version can be edited.", status=409)
    for f in ("effective_date", "review_date", "summary", "sections", "understanding_check"):
        if f in patch and patch[f] is not None:
            setattr(version, f, patch[f])
    version.save()
    return version


@transaction.atomic
def approve_policy_version(*, version: PolicyVersion, by_user_id: UUID) -> PolicyVersion:
    if version.status != PolicyVersion.Status.DRAFT:
        raise ServiceError("not_approvable", "Only a draft version can be approved.", status=409)
    doc = version.doc
    PolicyVersion.objects.filter(
        org_id=version.org_id, doc_id=doc.id, status=PolicyVersion.Status.APPROVED
    ).update(status=PolicyVersion.Status.SUPERSEDED)
    now = timezone.now()
    version.status = PolicyVersion.Status.APPROVED
    version.approved_by_id = by_user_id
    version.approved_at = now
    version.published_at = now
    version.save(update_fields=["status", "approved_by", "approved_at", "published_at", "updated_at"])
    doc.status = PolicyDoc.Status.APPROVED
    doc.current_version = version.number
    doc.save(update_fields=["status", "current_version", "updated_at"])
    return version


@transaction.atomic
def start_new_policy_version(*, org_id: UUID, doc: PolicyDoc) -> PolicyVersion:
    rows = PolicyVersion.objects.filter(org_id=org_id, doc=doc)
    latest = rows.order_by("-number").first()
    if latest and latest.status == PolicyVersion.Status.DRAFT:
        return latest
    base = rows.filter(status=PolicyVersion.Status.APPROVED).order_by("-number").first()
    next_number = (rows.aggregate(m=Max("number"))["m"] or 0) + 1
    new = PolicyVersion.objects.create(
        org_id=org_id, doc=doc, number=next_number, status=PolicyVersion.Status.DRAFT
    )
    if base:
        new.summary = base.summary
        new.sections = base.sections
        new.understanding_check = base.understanding_check
        new.effective_date = base.effective_date
        new.review_date = base.review_date
        new.save()
    return new


@transaction.atomic
def update_allocation(*, org_id: UUID, doc: PolicyDoc, data: dict) -> PolicyAllocation:
    alloc, _ = PolicyAllocation.objects.get_or_create(org_id=org_id, doc=doc)
    alloc.scope = data.get("scope", alloc.scope)
    for f in ("depts", "titles", "sites", "worker_types", "persons"):
        if f in data and data[f] is not None:
            setattr(alloc, f, data[f])
    if "require_reack" in data and data["require_reack"] is not None:
        alloc.require_reack = data["require_reack"]
    alloc.published_version = doc.current_version
    alloc.published_at = timezone.now()
    alloc.save()
    return alloc


# ---- member adoption -------------------------------------------------------
def _record(org_id: UUID, doc: PolicyDoc, member: OrgMember) -> PolicyRecord:
    from .selectors import policy_allocated_to

    if not policy_allocated_to(doc, member):
        raise ServiceError("not_allocated", "This policy is not allocated to you.", status=403)
    rec, _ = PolicyRecord.objects.get_or_create(
        org_id=org_id, doc=doc, member=member, defaults={"version": doc.current_version}
    )
    rule = PolicyAllocation.objects.filter(org_id=org_id, doc=doc).first()
    if rec.version < doc.current_version and rule and rule.require_reack:
        rec.version = doc.current_version
        rec.read_at = rec.ack_at = rec.check_at = rec.check_score = None
        rec.observations = []
        rec.save(
            update_fields=[
                "version",
                "read_at",
                "ack_at",
                "check_at",
                "check_score",
                "observations",
                "updated_at",
            ]
        )
    return rec


@transaction.atomic
def mark_read(*, org_id: UUID, doc: PolicyDoc, member: OrgMember) -> PolicyRecord:
    rec = _record(org_id, doc, member)
    rec.version = doc.current_version
    rec.read_at = timezone.now()
    rec.save(update_fields=["version", "read_at", "updated_at"])
    return rec


@transaction.atomic
def acknowledge(*, org_id: UUID, doc: PolicyDoc, member: OrgMember) -> PolicyRecord:
    rec = _record(org_id, doc, member)
    rec.version = doc.current_version
    if rec.read_at is None:
        rec.read_at = timezone.now()
    rec.ack_at = timezone.now()
    rec.save(update_fields=["version", "read_at", "ack_at", "updated_at"])
    return rec


@transaction.atomic
def submit_check(*, org_id: UUID, doc: PolicyDoc, member: OrgMember, answer_index: int) -> PolicyRecord:
    version = PolicyVersion.objects.filter(org_id=org_id, doc=doc, number=doc.current_version).first()
    correct = None
    if version and isinstance(version.understanding_check, dict):
        correct = version.understanding_check.get("answer")
    rec = _record(org_id, doc, member)
    rec.check_at = timezone.now()
    rec.check_score = 100 if (correct is not None and answer_index == correct) else 0
    rec.save(update_fields=["check_at", "check_score", "updated_at"])
    return rec


@transaction.atomic
def add_observation(
    *, org_id: UUID, doc: PolicyDoc, member: OrgMember, by_label: str, note: str
) -> PolicyRecord:
    rec = _record(org_id, doc, member)
    obs = list(rec.observations or [])
    obs.append(
        {"at": timezone.now().date().isoformat(), "by": (by_label or "")[:120], "note": note.strip()[:500]}
    )
    rec.observations = obs
    rec.save(update_fields=["observations", "updated_at"])
    return rec


# ================================================================ question bank
_Q_FIELDS = (
    "dept",
    "q_type",
    "prompt",
    "options",
    "answer_index",
    "expected",
    "rationale",
    "mark",
    "level",
    "course_ref",
)


@transaction.atomic
def create_question(*, org_id: UUID, data: dict) -> TechQuestion:
    fields = {f: data[f] for f in _Q_FIELDS if f in data and data[f] is not None}
    return TechQuestion.objects.create(org_id=org_id, competency_id=data.get("competency_id"), **fields)


@transaction.atomic
def update_question(*, question: TechQuestion, patch: dict) -> TechQuestion:
    for f in _Q_FIELDS:
        if f in patch and patch[f] is not None:
            setattr(question, f, patch[f])
    question.save()
    return question


@transaction.atomic
def archive_question(*, question: TechQuestion) -> TechQuestion:
    question.archived_at = timezone.now()
    question.save(update_fields=["archived_at", "updated_at"])
    return question
