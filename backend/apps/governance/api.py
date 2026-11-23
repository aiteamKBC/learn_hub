"""Governance endpoints: company strategy, policy documents (with allocation and
member adoption) and the technical question bank.

Mounted at /api/v1/governance/ via DOMAIN_APPS. Authoring requires a company admin;
members read policies allocated to them and record their own read/acknowledge/check.
"""

from __future__ import annotations

from uuid import UUID

from ninja import Router

from apps.org.models import OrgMember
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import require_org

from . import permissions as perms
from . import selectors, services
from .models import PolicyDoc, PolicyVersion, Strategy, StrategyVersion, TechQuestion
from .schemas import (
    GovAllocationIn,
    GovAllocationOut,
    GovCheckIn,
    GovObjectiveIn,
    GovObservationIn,
    GovOk,
    GovPolicyContentOut,
    GovPolicyIn,
    GovPolicyOut,
    GovPolicyVersionOut,
    GovPolicyVersionPatch,
    GovQuestionIn,
    GovQuestionOut,
    GovQuestionPatch,
    GovRecordOut,
    GovStrategyIn,
    GovStrategyOut,
    GovStrategyVersionOut,
    GovVersionPatch,
)

router = Router(tags=["governance"], auth=session_auth)


# ---------------------------------------------------------------- helpers
def _active_member(request) -> OrgMember:
    org_id = require_org(request)
    m = OrgMember.objects.filter(
        org_id=org_id, id=perms.active_member_id(request), removed_at__isnull=True
    ).first()
    if m is None:
        raise ServiceError("not_a_member", "You are not a member of this company.", status=403)
    return m


def _strategy(request, sid: UUID) -> Strategy:
    s = selectors.strategy(org_id=require_org(request), strategy_id=sid)
    if s is None:
        raise ServiceError("not_found", "Strategy not found.", status=404)
    return s


def _sversion(request, vid: UUID) -> StrategyVersion:
    v = selectors.strategy_version(org_id=require_org(request), version_id=vid)
    if v is None:
        raise ServiceError("not_found", "Strategy version not found.", status=404)
    return v


def _policy(request, pid: UUID) -> PolicyDoc:
    d = selectors.policy(org_id=require_org(request), doc_id=pid)
    if d is None:
        raise ServiceError("not_found", "Policy not found.", status=404)
    if not perms.is_governance_admin(request) and not selectors.policy_allocated_to(
        d, _active_member(request)
    ):
        raise ServiceError("not_allocated", "This policy is not allocated to you.", status=403)
    return d


def _pversion(request, vid: UUID) -> PolicyVersion:
    v = selectors.policy_version(org_id=require_org(request), version_id=vid)
    if v is None:
        raise ServiceError("not_found", "Policy version not found.", status=404)
    if not perms.is_governance_admin(request):
        doc = _policy(request, v.doc_id)
        if v.status != "approved" or v.number != doc.current_version:
            raise ServiceError("not_found", "Published policy version not found.", status=404)
    return v


def _policy_version_payload(request, version):
    payload = selectors.policy_version_payload(version)
    if not perms.is_governance_admin(request):
        check = payload["understanding_check"]
        payload["understanding_check"] = {
            "q": check.get("q", check.get("question", "")),
            "options": check.get("options", []),
        }
    return payload


def _question(request, qid: UUID) -> TechQuestion:
    q = selectors.question(org_id=require_org(request), question_id=qid)
    if q is None:
        raise ServiceError("not_found", "Question not found.", status=404)
    return q


# ================================================================ strategy
@router.get("/strategies", response=list[GovStrategyOut])
def list_strategies(request, include_archived: bool = False):
    org_id = require_org(request)
    return [
        selectors.strategy_payload(s)
        for s in selectors.strategies(org_id=org_id, include_archived=include_archived)
    ]


@router.post("/strategies", response=GovStrategyOut)
def create_strategy(request, data: GovStrategyIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    s, _ = services.create_strategy(org_id=org_id, name=data.name)
    return selectors.strategy_payload(s)


@router.get("/strategies/{sid}/versions", response=list[GovStrategyVersionOut])
def strategy_versions(request, sid: UUID):
    org_id = require_org(request)
    _strategy(request, sid)
    rows = StrategyVersion.objects.filter(org_id=org_id, strategy_id=sid).order_by("-number")
    return [selectors.strategy_version_payload(v) for v in rows]


@router.get("/strategy-versions/{vid}", response=GovStrategyVersionOut)
def get_strategy_version(request, vid: UUID):
    return selectors.strategy_version_payload(_sversion(request, vid))


@router.patch("/strategy-versions/{vid}", response=GovStrategyVersionOut)
def update_strategy_version(request, vid: UUID, data: GovVersionPatch):
    require_org(request)
    perms.require_governance_admin(request)
    v = services.update_strategy_version(version=_sversion(request, vid), patch=data.dict(exclude_unset=True))
    return selectors.strategy_version_payload(v)


@router.post("/strategy-versions/{vid}/objectives", response=GovStrategyVersionOut)
def add_objective(request, vid: UUID, data: GovObjectiveIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    v = _sversion(request, vid)
    services.add_objective(org_id=org_id, version=v, data=data.dict())
    return selectors.strategy_version_payload(v)


@router.post("/strategy-versions/{vid}/approve", response=GovStrategyVersionOut)
def approve_strategy_version(request, vid: UUID):
    require_org(request)
    perms.require_governance_admin(request)
    v = services.approve_strategy_version(version=_sversion(request, vid), by_user_id=request.user.id)
    return selectors.strategy_version_payload(v)


# ================================================================ policies
@router.get("/policies", response=list[GovPolicyOut])
def list_policies(request, doc_type: str | None = None, include_archived: bool = False):
    org_id = require_org(request)
    admin = perms.is_governance_admin(request)
    member = None if admin else _active_member(request)
    return [
        selectors.policy_payload(d)
        for d in selectors.policies(org_id=org_id, doc_type=doc_type, include_archived=include_archived)
        if admin or selectors.policy_allocated_to(d, member)
    ]


@router.post("/policies", response=GovPolicyOut)
def create_policy(request, data: GovPolicyIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    doc, _ = services.create_policy(org_id=org_id, data=data.dict())
    return selectors.policy_payload(doc)


@router.get("/policies/{pid}", response=GovPolicyOut)
def get_policy(request, pid: UUID):
    return selectors.policy_payload(_policy(request, pid))


@router.get("/policies/{pid}/versions", response=list[GovPolicyVersionOut])
def policy_versions(request, pid: UUID):
    org_id = require_org(request)
    doc = _policy(request, pid)
    rows = selectors.policy_versions(org_id=org_id, doc_id=pid)
    if not perms.is_governance_admin(request):
        rows = rows.filter(status="approved", number=doc.current_version)
    return [_policy_version_payload(request, v) for v in rows]


@router.post("/policies/{pid}/versions", response=GovPolicyVersionOut)
def start_policy_version(request, pid: UUID):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    v = services.start_new_policy_version(org_id=org_id, doc=_policy(request, pid))
    return selectors.policy_version_payload(v)


@router.get("/policy-versions/{vid}", response=GovPolicyVersionOut)
def get_policy_version(request, vid: UUID):
    return _policy_version_payload(request, _pversion(request, vid))


@router.patch("/policy-versions/{vid}", response=GovPolicyVersionOut)
def update_policy_version(request, vid: UUID, data: GovPolicyVersionPatch):
    require_org(request)
    perms.require_governance_admin(request)
    v = services.update_policy_version(version=_pversion(request, vid), patch=data.dict(exclude_unset=True))
    return selectors.policy_version_payload(v)


@router.post("/policy-versions/{vid}/approve", response=GovPolicyVersionOut)
def approve_policy_version(request, vid: UUID):
    require_org(request)
    perms.require_governance_admin(request)
    v = services.approve_policy_version(version=_pversion(request, vid), by_user_id=request.user.id)
    return selectors.policy_version_payload(v)


@router.get("/policies/{pid}/allocation", response=GovAllocationOut)
def get_allocation(request, pid: UUID):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    doc = _policy(request, pid)
    a = selectors.allocation(org_id=org_id, doc_id=doc.id)
    if a is None:
        raise ServiceError("not_found", "No allocation rule.", status=404)
    return selectors.allocation_payload(a)


@router.put("/policies/{pid}/allocation", response=GovAllocationOut)
def set_allocation(request, pid: UUID, data: GovAllocationIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    a = services.update_allocation(org_id=org_id, doc=_policy(request, pid), data=data.dict())
    return selectors.allocation_payload(a)


@router.get("/policies/{pid}/records", response=list[GovRecordOut])
def policy_records(request, pid: UUID):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    doc = _policy(request, pid)
    alloc = selectors.allocation(org_id=org_id, doc_id=doc.id)
    require_reack = alloc.require_reack if alloc else True
    return [
        selectors.record_payload(doc, r, require_reack=require_reack)
        for r in selectors.records_for_doc(org_id=org_id, doc_id=doc.id)
    ]


# ---- member adoption -------------------------------------------------------
@router.get("/me/policies", response=list[GovRecordOut])
def my_policies(request):
    org_id = require_org(request)
    member = _active_member(request)
    out = []
    for doc in selectors.policies(org_id=org_id):
        if doc.status != PolicyDoc.Status.APPROVED:
            continue
        alloc = selectors.allocation(org_id=org_id, doc_id=doc.id)
        if not selectors.policy_allocated_to(doc, member, alloc):
            continue
        rec = selectors.record_for(org_id=org_id, doc_id=doc.id, member_id=member.id)
        out.append(
            selectors.record_payload(
                doc, rec, require_reack=alloc.require_reack if alloc else True, member_id=member.id
            )
        )
    return out


@router.get("/me/policies/{pid}", response=GovPolicyContentOut)
def my_policy_content(request, pid: UUID):
    member = _active_member(request)
    doc = _policy(request, pid)
    if not selectors.policy_allocated_to(doc, member):
        raise ServiceError("not_allocated", "This policy is not allocated to you.", status=403)
    version = (
        selectors.policy_versions(org_id=doc.org_id, doc_id=doc.id)
        .filter(status="approved", number=doc.current_version)
        .first()
    )
    if version is None:
        raise ServiceError("not_found", "Published policy version not found.", status=404)
    payload = selectors.policy_version_payload(version)
    check = payload["understanding_check"]
    payload["understanding_check"] = {
        "q": check.get("q", check.get("question", "")),
        "options": check.get("options", []),
    }
    alloc = selectors.allocation(org_id=doc.org_id, doc_id=doc.id)
    return {
        "doc_id": doc.id,
        "code": doc.code,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "current_version": doc.current_version,
        "require_reack": alloc.require_reack if alloc else True,
        "version": payload,
    }


@router.post("/policies/{pid}/read", response=GovOk)
def read_policy(request, pid: UUID):
    org_id = require_org(request)
    services.mark_read(org_id=org_id, doc=_policy(request, pid), member=_active_member(request))
    return {"ok": True}


@router.post("/policies/{pid}/acknowledge", response=GovOk)
def acknowledge_policy(request, pid: UUID):
    org_id = require_org(request)
    services.acknowledge(org_id=org_id, doc=_policy(request, pid), member=_active_member(request))
    return {"ok": True}


@router.post("/policies/{pid}/check", response=GovRecordOut)
def submit_check(request, pid: UUID, data: GovCheckIn):
    org_id = require_org(request)
    doc = _policy(request, pid)
    member = _active_member(request)
    rec = services.submit_check(org_id=org_id, doc=doc, member=member, answer_index=data.answer_index)
    alloc = selectors.allocation(org_id=org_id, doc_id=doc.id)
    return selectors.record_payload(doc, rec, require_reack=alloc.require_reack if alloc else True)


@router.post("/policies/{pid}/observations", response=GovOk)
def add_observation(request, pid: UUID, data: GovObservationIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    doc = _policy(request, pid)
    member = OrgMember.objects.filter(org_id=org_id, id=data.member_id, removed_at__isnull=True).first()
    if member is None:
        raise ServiceError("member_not_found", "Member not found.", status=404)
    services.add_observation(
        org_id=org_id, doc=doc, member=member, by_label=request.user.full_name, note=data.note
    )
    return {"ok": True}


# ================================================================ question bank
@router.get("/questions", response=list[GovQuestionOut])
def list_questions(request, dept: str | None = None, include_archived: bool = False):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    return [
        selectors.question_payload(q)
        for q in selectors.questions(org_id=org_id, dept=dept, include_archived=include_archived)
    ]


@router.post("/questions", response=GovQuestionOut)
def create_question(request, data: GovQuestionIn):
    org_id = require_org(request)
    perms.require_governance_admin(request)
    q = services.create_question(org_id=org_id, data=data.dict())
    return selectors.question_payload(q)


@router.get("/questions/{qid}", response=GovQuestionOut)
def get_question(request, qid: UUID):
    perms.require_governance_admin(request)
    return selectors.question_payload(_question(request, qid))


@router.patch("/questions/{qid}", response=GovQuestionOut)
def update_question(request, qid: UUID, data: GovQuestionPatch):
    require_org(request)
    perms.require_governance_admin(request)
    q = services.update_question(question=_question(request, qid), patch=data.dict(exclude_unset=True))
    return selectors.question_payload(q)


@router.post("/questions/{qid}/archive", response=GovQuestionOut)
def archive_question(request, qid: UUID):
    require_org(request)
    perms.require_governance_admin(request)
    q = services.archive_question(question=_question(request, qid))
    return selectors.question_payload(q)


# ---------------------------------------------------------------- misc
@router.get("/health", response=GovOk)
def health(request):
    require_org(request)
    return {"ok": True}
