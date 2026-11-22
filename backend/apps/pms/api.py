"""PMS endpoints: KPIs (with approval workflow), performance reviews and AI analysis.

Mounted at /api/v1/pms/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
KPI definition/approval and review-cycle management require a company admin (D3);
a member may read and acknowledge their own review.
"""

from __future__ import annotations

from uuid import UUID

from ninja import Router

from apps.org.models import OrgMember
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import require_org

from . import analysis, scoring, selectors, services
from . import permissions as perms
from .models import Kpi, KpiProposal, PerformanceReview, ReviewCycle
from .schemas import (
    PmsAnalysisOut,
    PmsCycleIn,
    PmsCycleOut,
    PmsHistoryOut,
    PmsKpiOut,
    PmsMeasurementIn,
    PmsMeasurementOut,
    PmsObjectiveIn,
    PmsOk,
    PmsProposalIn,
    PmsProposalOut,
    PmsProposalPatch,
    PmsReviewCreateIn,
    PmsReviewOut,
    PmsReviewPatch,
    PmsTransitionIn,
)

router = Router(tags=["pms"], auth=session_auth)


# ---------------------------------------------------------------- helpers
def _member(request, member_id: UUID) -> OrgMember:
    org_id = require_org(request)
    m = OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()
    if m is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    return m


def _kpi(request, kpi_id: UUID) -> Kpi:
    k = selectors.kpi(org_id=require_org(request), kpi_id=kpi_id)
    if k is None:
        raise ServiceError("not_found", "KPI not found.", status=404)
    return k


def _proposal(request, proposal_id: UUID) -> KpiProposal:
    p = selectors.proposal(org_id=require_org(request), proposal_id=proposal_id)
    if p is None or not perms.can_view_proposal(request, p):
        raise ServiceError("not_found", "Proposal not found.", status=404)
    return p


def _cycle(request, cycle_id: UUID) -> ReviewCycle:
    c = selectors.cycle(org_id=require_org(request), cycle_id=cycle_id)
    if c is None:
        raise ServiceError("not_found", "Review cycle not found.", status=404)
    return c


def _review(request, review_id: UUID) -> PerformanceReview:
    r = selectors.review(org_id=require_org(request), review_id=review_id)
    if r is None:
        raise ServiceError("not_found", "Review not found.", status=404)
    return r


def _meas_payload(m) -> dict:
    return {
        "id": m.id,
        "kpi_id": m.kpi_id,
        "period_year": m.period_year,
        "period_index": m.period_index,
        "value": m.value,
        "recorded_at": m.recorded_at,
        "note": m.note,
    }


# ================================================================ KPIs
@router.get("/kpis", response=list[PmsKpiOut])
def list_kpis(request, dept: str | None = None):
    org_id = require_org(request)
    return [scoring.kpi_payload(k, org_id=org_id) for k in selectors.active_kpis(org_id=org_id, dept=dept)]


@router.post("/kpis/{kpi_id}/measurements", response=PmsMeasurementOut)
def record_measurement(request, kpi_id: UUID, data: PmsMeasurementIn):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    m = services.record_measurement(
        org_id=org_id,
        kpi=_kpi(request, kpi_id),
        period_year=data.period_year,
        period_index=data.period_index,
        value=data.value,
        by_user_id=request.user.id,
        note=data.note,
    )
    return _meas_payload(m)


@router.get("/kpis/{kpi_id}/measurements", response=list[PmsMeasurementOut])
def list_measurements(request, kpi_id: UUID):
    org_id = require_org(request)
    _kpi(request, kpi_id)
    return [_meas_payload(m) for m in selectors.measurements(org_id=org_id, kpi_id=kpi_id)]


# ---------------------------------------------------------------- proposals
@router.get("/kpis/proposals", response=list[PmsProposalOut])
def list_proposals(request, stage: str | None = None, dept: str | None = None):
    org_id = require_org(request)
    rows = selectors.proposals(org_id=org_id, stage=stage, dept=dept)
    return [selectors.proposal_payload(p) for p in rows if perms.can_view_proposal(request, p)]


@router.post("/kpis/proposals", response=PmsProposalOut)
def create_proposal(request, data: PmsProposalIn):
    org_id = require_org(request)
    perms.require_proposal_author(request, data.dept)
    p = services.create_proposal(org_id=org_id, by_user_id=request.user.id, data=data.dict())
    return selectors.proposal_payload(p)


@router.get("/kpis/proposals/{proposal_id}", response=PmsProposalOut)
def get_proposal(request, proposal_id: UUID):
    return selectors.proposal_payload(_proposal(request, proposal_id))


@router.patch("/kpis/proposals/{proposal_id}", response=PmsProposalOut)
def update_proposal(request, proposal_id: UUID, data: PmsProposalPatch):
    org_id = require_org(request)
    current = _proposal(request, proposal_id)
    patch = data.dict(exclude_unset=True)
    perms.require_proposal_author(request, patch.get("dept", current.dept))
    p = services.update_proposal(
        org_id=org_id, proposal=current, patch=patch
    )
    return selectors.proposal_payload(p)


@router.get("/kpis/proposals/{proposal_id}/history", response=list[PmsHistoryOut])
def proposal_history(request, proposal_id: UUID):
    org_id = require_org(request)
    _proposal(request, proposal_id)
    return [
        {"at": h.at, "action": h.action, "stage": h.stage, "version": h.version, "comment": h.comment}
        for h in selectors.proposal_history(org_id=org_id, proposal_id=proposal_id)
    ]


@router.post("/kpis/proposals/{proposal_id}/submit", response=PmsProposalOut)
def submit_proposal(request, proposal_id: UUID, data: PmsTransitionIn):
    require_org(request)
    proposal = _proposal(request, proposal_id)
    perms.require_proposal_author(request, proposal.dept)
    p = services.submit_proposal(
        proposal=proposal, by_user_id=request.user.id, comment=data.comment
    )
    return selectors.proposal_payload(p)


@router.post("/kpis/proposals/{proposal_id}/approve", response=PmsProposalOut)
def approve_proposal(request, proposal_id: UUID, data: PmsTransitionIn):
    require_org(request)
    proposal = _proposal(request, proposal_id)
    perms.require_proposal_reviewer(request, proposal)
    p = services.advance_proposal(
        proposal=proposal, by_user_id=request.user.id, comment=data.comment
    )
    return selectors.proposal_payload(p)


@router.post("/kpis/proposals/{proposal_id}/request-changes", response=PmsProposalOut)
def request_changes_proposal(request, proposal_id: UUID, data: PmsTransitionIn):
    require_org(request)
    proposal = _proposal(request, proposal_id)
    perms.require_proposal_reviewer(request, proposal)
    p = services.request_changes_proposal(
        proposal=proposal, by_user_id=request.user.id, comment=data.comment
    )
    return selectors.proposal_payload(p)


# ================================================================ review cycles
@router.get("/review-cycles", response=list[PmsCycleOut])
def list_cycles(request):
    org_id = require_org(request)
    return [selectors.cycle_payload(c) for c in selectors.cycles(org_id=org_id)]


@router.post("/review-cycles", response=PmsCycleOut)
def create_cycle(request, data: PmsCycleIn):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    c = services.create_cycle(org_id=org_id, by_user_id=request.user.id, data=data.dict())
    return selectors.cycle_payload(c)


@router.post("/review-cycles/{cycle_id}/open", response=PmsCycleOut)
def open_cycle(request, cycle_id: UUID):
    require_org(request)
    perms.require_pms_admin(request)
    c = services.set_cycle_status(cycle=_cycle(request, cycle_id), status=ReviewCycle.Status.OPEN)
    return selectors.cycle_payload(c)


@router.post("/review-cycles/{cycle_id}/close", response=PmsCycleOut)
def close_cycle(request, cycle_id: UUID):
    require_org(request)
    perms.require_pms_admin(request)
    c = services.set_cycle_status(cycle=_cycle(request, cycle_id), status=ReviewCycle.Status.CLOSED)
    return selectors.cycle_payload(c)


@router.get("/review-cycles/{cycle_id}/reviews", response=list[PmsReviewOut])
def list_cycle_reviews(request, cycle_id: UUID):
    org_id = require_org(request)
    _cycle(request, cycle_id)
    return [selectors.review_payload(r) for r in selectors.reviews_in_cycle(org_id=org_id, cycle_id=cycle_id)]


# ================================================================ reviews
@router.get("/me/reviews", response=list[PmsReviewOut])
def my_reviews(request):
    org_id = require_org(request)
    member_id = perms.active_member_id(request)
    return [
        selectors.review_payload(r) for r in selectors.reviews_for_member(org_id=org_id, member_id=member_id)
    ]


@router.post("/reviews", response=PmsReviewOut)
def create_review(request, data: PmsReviewCreateIn):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    cycle = _cycle(request, data.cycle_id)
    member = _member(request, data.member_id)
    reviewer = _member(request, data.reviewer_id) if data.reviewer_id else None
    r = services.create_review(org_id=org_id, cycle=cycle, member=member, reviewer=reviewer)
    return selectors.review_payload(r)


@router.get("/reviews/{review_id}", response=PmsReviewOut)
def get_review(request, review_id: UUID):
    return selectors.review_payload(_review(request, review_id))


@router.patch("/reviews/{review_id}", response=PmsReviewOut)
def update_review(request, review_id: UUID, data: PmsReviewPatch):
    require_org(request)
    perms.require_pms_admin(request)
    r = services.update_review(review=_review(request, review_id), patch=data.dict(exclude_unset=True))
    return selectors.review_payload(r)


@router.post("/reviews/{review_id}/objectives", response=PmsReviewOut)
def add_objective(request, review_id: UUID, data: PmsObjectiveIn):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    r = _review(request, review_id)
    services.add_objective(org_id=org_id, review=r, data=data.dict())
    return selectors.review_payload(r)


@router.post("/reviews/{review_id}/submit", response=PmsReviewOut)
def submit_review(request, review_id: UUID):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    r = services.submit_review(org_id=org_id, review=_review(request, review_id), by_user_id=request.user.id)
    return selectors.review_payload(r)


@router.post("/reviews/{review_id}/acknowledge", response=PmsReviewOut)
def acknowledge_review(request, review_id: UUID):
    require_org(request)
    r = _review(request, review_id)
    # Only the reviewed member may acknowledge their own review.
    if perms.active_member_id(request) != r.member_id:
        raise ServiceError("not_your_review", "Only the reviewed member can acknowledge.", status=403)
    services.acknowledge_review(review=r)
    return selectors.review_payload(r)


# ================================================================ analysis
@router.post("/reviews/{review_id}/analysis", response=PmsAnalysisOut)
def generate_analysis(request, review_id: UUID):
    org_id = require_org(request)
    perms.require_pms_admin(request)
    r = _review(request, review_id)
    a = analysis.generate(org_id=org_id, review=r, by_user_id=request.user.id)
    return selectors.analysis_payload(a)


@router.get("/reviews/{review_id}/analysis", response=PmsAnalysisOut)
def get_analysis(request, review_id: UUID):
    r = _review(request, review_id)
    a = getattr(r, "analysis", None)
    if a is None:
        raise ServiceError("not_found", "No analysis yet for this review.", status=404)
    return selectors.analysis_payload(a)


# ---------------------------------------------------------------- misc
@router.get("/health", response=PmsOk)
def health(request):
    require_org(request)
    return {"ok": True}
