"""Write-side operations for PMS.

Each service wraps one logical change in `transaction.atomic`. Business rules — the
KPI approval route, review lifecycle and score snapshotting — live here; schemas
validate shape only. All writes run under the request's RLS context.
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.org.models import OrgMember
from core.errors import ServiceError

from . import scoring
from .models import (
    Kpi,
    KpiMeasurement,
    KpiProposal,
    KpiProposalHistory,
    PerformanceReview,
    ReviewCycle,
    ReviewObjective,
)

_PROP_EDITABLE = {KpiProposal.Stage.DRAFT, KpiProposal.Stage.CHANGES_REQUESTED}
_PROP_REVIEW = {
    KpiProposal.Stage.HOD_REVIEW,
    KpiProposal.Stage.HR_ALIGNMENT,
    KpiProposal.Stage.EXEC_APPROVAL,
}
# The next stage when an advance (approval) is applied.
_ADVANCE = {
    KpiProposal.Stage.HOD_REVIEW: KpiProposal.Stage.HR_ALIGNMENT,
    KpiProposal.Stage.HR_ALIGNMENT: KpiProposal.Stage.EXEC_APPROVAL,
    KpiProposal.Stage.EXEC_APPROVAL: KpiProposal.Stage.ACTIVE,
}

_PROP_FIELDS = (
    "name",
    "scope",
    "objective_code",
    "objective_title",
    "dept",
    "definition",
    "unit",
    "baseline",
    "target",
    "higher_better",
    "source",
    "cadence",
    "period",
    "review_date",
    "weight",
)


# ================================================================ KPI proposals
def _member_in_org(org_id: UUID, member_id: UUID | None) -> OrgMember | None:
    if member_id is None:
        return None
    m = OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()
    if m is None:
        raise ServiceError("member_not_found", "Owner is not a member of this company.", status=404)
    return m


def _parent_in_org(org_id: UUID, parent_id: UUID | None, scope: str, dept: str, owner) -> Kpi | None:
    if scope == Kpi.Scope.DEPARTMENT:
        if parent_id:
            raise ServiceError("bad_parent", "Only an individual KPI can have a parent KPI.", status=400)
        return None
    if owner is None or parent_id is None:
        raise ServiceError(
            "missing_link", "An individual KPI needs a person and a department KPI.", status=400
        )
    parent = Kpi.objects.filter(
        org_id=org_id, id=parent_id, scope=Kpi.Scope.DEPARTMENT, status=Kpi.Status.ACTIVE
    ).first()
    if parent is None or parent.dept != dept:
        raise ServiceError("bad_parent", "Choose an active KPI in the same department.", status=400)
    return parent


def _log_proposal(proposal: KpiProposal, *, by_user_id, action: str, comment: str = "") -> None:
    KpiProposalHistory.objects.create(
        org_id=proposal.org_id,
        proposal=proposal,
        at=timezone.now(),
        by_id=by_user_id,
        action=action,
        stage=proposal.stage,
        version=proposal.version,
        comment=(comment or "").strip(),
    )


@transaction.atomic
def create_proposal(*, org_id: UUID, by_user_id: UUID, data: dict) -> KpiProposal:
    owner = _member_in_org(org_id, data.get("owner_id"))
    parent = _parent_in_org(
        org_id,
        data.get("parent_kpi_id"),
        data.get("scope", Kpi.Scope.DEPARTMENT),
        data.get("dept", ""),
        owner,
    )
    proposal = KpiProposal.objects.create(
        org_id=org_id,
        author_id=by_user_id,
        owner=owner,
        parent_kpi=parent,
        stage=KpiProposal.Stage.DRAFT,
        version=1,
        ai_draft=data.get("ai_draft", False),
        **{f: data[f] for f in _PROP_FIELDS if f in data and data[f] is not None},
    )
    _log_proposal(proposal, by_user_id=by_user_id, action="draft_created")
    return proposal


@transaction.atomic
def create_kpi_direct(*, org_id: UUID, by_user_id: UUID, data: dict) -> Kpi:
    """Create an active KPI in one step, skipping the HoD/HR/Exec approval chain.
    A proposal is still recorded (already active) so audit history and the KPI's
    source/course linkage stay consistent with the approval route."""
    owner = _member_in_org(org_id, data.get("owner_id"))
    parent = _parent_in_org(
        org_id,
        data.get("parent_kpi_id"),
        data.get("scope", Kpi.Scope.DEPARTMENT),
        data.get("dept", ""),
        owner,
    )
    proposal = KpiProposal.objects.create(
        org_id=org_id,
        author_id=by_user_id,
        owner=owner,
        parent_kpi=parent,
        stage=KpiProposal.Stage.ACTIVE,
        version=1,
        ai_draft=data.get("ai_draft", False),
        **{f: data[f] for f in _PROP_FIELDS if f in data and data[f] is not None},
    )
    kpi = _activate(proposal)
    proposal.active_kpi = kpi
    proposal.save(update_fields=["active_kpi", "updated_at"])
    _log_proposal(proposal, by_user_id=by_user_id, action="created_direct", comment="Added directly")
    return kpi


@transaction.atomic
def update_proposal(*, org_id: UUID, proposal: KpiProposal, patch: dict) -> KpiProposal:
    if proposal.stage not in _PROP_EDITABLE:
        raise ServiceError("not_editable", f"A {proposal.stage} proposal cannot be edited.", status=409)
    if "owner_id" in patch:
        proposal.owner = _member_in_org(org_id, patch["owner_id"])
    proposal.parent_kpi = _parent_in_org(
        org_id,
        patch.get("parent_kpi_id", proposal.parent_kpi_id),
        patch.get("scope", proposal.scope),
        patch.get("dept", proposal.dept),
        proposal.owner,
    )
    for f in _PROP_FIELDS:
        if f in patch and patch[f] is not None:
            setattr(proposal, f, patch[f])
    proposal.save()
    return proposal


@transaction.atomic
def submit_proposal(*, proposal: KpiProposal, by_user_id: UUID, comment: str = "") -> KpiProposal:
    if proposal.stage not in _PROP_EDITABLE:
        raise ServiceError("not_submittable", "Only a draft proposal can be submitted.", status=409)
    proposal.stage = KpiProposal.Stage.HOD_REVIEW
    proposal.save(update_fields=["stage", "updated_at"])
    _log_proposal(proposal, by_user_id=by_user_id, action="submitted", comment=comment)
    return proposal


@transaction.atomic
def advance_proposal(*, proposal: KpiProposal, by_user_id: UUID, comment: str = "") -> KpiProposal:
    """Approve the current review stage and move to the next; final stage creates the
    active KPI."""
    if proposal.stage not in _PROP_REVIEW:
        raise ServiceError("not_advanceable", "This proposal is not awaiting approval.", status=409)
    nxt = _ADVANCE[proposal.stage]
    proposal.stage = nxt
    if nxt == KpiProposal.Stage.ACTIVE:
        kpi = _activate(proposal)
        proposal.active_kpi = kpi
        proposal.save(update_fields=["stage", "active_kpi", "updated_at"])
        _log_proposal(proposal, by_user_id=by_user_id, action="activated", comment=comment)
    else:
        proposal.save(update_fields=["stage", "updated_at"])
        _log_proposal(proposal, by_user_id=by_user_id, action="approved", comment=comment)
    return proposal


def _activate(proposal: KpiProposal) -> Kpi:
    return Kpi.objects.create(
        org_id=proposal.org_id,
        scope=proposal.scope,
        parent_kpi=proposal.parent_kpi,
        objective_code=proposal.objective_code,
        objective_title=proposal.objective_title,
        dept=proposal.dept,
        name=proposal.name,
        owner=proposal.owner,
        definition=proposal.definition,
        unit=proposal.unit,
        baseline=proposal.baseline,
        target=proposal.target,
        higher_better=proposal.higher_better,
        cadence=proposal.cadence,
        weight=proposal.weight,
        period=proposal.period,
        review_date=proposal.review_date,
        status=Kpi.Status.ACTIVE,
        source_proposal_id=proposal.id,
    )


@transaction.atomic
def request_changes_proposal(*, proposal: KpiProposal, by_user_id: UUID, comment: str = "") -> KpiProposal:
    if proposal.stage not in _PROP_REVIEW:
        raise ServiceError("not_reviewable", "Only a proposal under review can be returned.", status=409)
    proposal.stage = KpiProposal.Stage.CHANGES_REQUESTED
    proposal.version += 1
    proposal.save(update_fields=["stage", "version", "updated_at"])
    _log_proposal(proposal, by_user_id=by_user_id, action="changes_requested", comment=comment)
    return proposal


# ================================================================ measurements
@transaction.atomic
def record_measurement(
    *, org_id: UUID, kpi: Kpi, period_year: int, period_index: int, value, by_user_id, note: str = ""
) -> KpiMeasurement:
    row, _ = KpiMeasurement.objects.update_or_create(
        org_id=org_id,
        kpi=kpi,
        period_year=period_year,
        period_index=period_index,
        defaults={
            "value": value,
            "recorded_at": timezone.now(),
            "recorded_by_id": by_user_id,
            "note": (note or "").strip(),
        },
    )
    return row


# ================================================================ review cycles
@transaction.atomic
def create_cycle(*, org_id: UUID, by_user_id: UUID, data: dict) -> ReviewCycle:
    if data["closes_at"] <= data["opens_at"]:
        raise ServiceError("bad_window", "Cycle close must be after its open.", status=400)
    return ReviewCycle.objects.create(
        org_id=org_id,
        name=data["name"].strip(),
        year=data["year"],
        quarter=data["quarter"],
        opens_at=data["opens_at"],
        closes_at=data["closes_at"],
        status=ReviewCycle.Status.DRAFT,
        created_by_id=by_user_id,
    )


@transaction.atomic
def set_cycle_status(*, cycle: ReviewCycle, status: str) -> ReviewCycle:
    if status == ReviewCycle.Status.OPEN:
        if cycle.status == ReviewCycle.Status.CLOSED:
            raise ServiceError("closed", "A closed cycle cannot be reopened.", status=409)
        cycle.status = ReviewCycle.Status.OPEN
        cycle.closed_at = None
        cycle.save(update_fields=["status", "closed_at", "updated_at"])
    elif status == ReviewCycle.Status.CLOSED:
        cycle.status = ReviewCycle.Status.CLOSED
        cycle.closed_at = timezone.now()
        cycle.save(update_fields=["status", "closed_at", "updated_at"])
    else:
        raise ServiceError("bad_status", "Unknown cycle status.", status=400)
    return cycle


# ================================================================ reviews
@transaction.atomic
def create_review(
    *, org_id: UUID, cycle: ReviewCycle, member: OrgMember, reviewer: OrgMember | None
) -> PerformanceReview:
    if PerformanceReview.objects.filter(org_id=org_id, cycle=cycle, member=member).exists():
        raise ServiceError("exists", "This member already has a review in this cycle.", status=409)
    return PerformanceReview.objects.create(
        org_id=org_id,
        cycle=cycle,
        member=member,
        reviewer=reviewer,
        status=PerformanceReview.Status.DRAFT,
    )


_REVIEW_FIELDS = ("self_summary", "manager_summary", "strengths", "development_areas", "overall_rating")


@transaction.atomic
def update_review(*, review: PerformanceReview, patch: dict) -> PerformanceReview:
    if review.status == PerformanceReview.Status.ACKNOWLEDGED:
        raise ServiceError("locked", "An acknowledged review cannot be edited.", status=409)
    for f in _REVIEW_FIELDS:
        if f in patch and patch[f] is not None:
            setattr(review, f, patch[f])
    review.save()
    return review


@transaction.atomic
def add_objective(*, org_id: UUID, review: PerformanceReview, data: dict) -> ReviewObjective:
    if review.status == PerformanceReview.Status.ACKNOWLEDGED:
        raise ServiceError("locked", "An acknowledged review cannot be edited.", status=409)
    from django.db.models import Max

    next_sort = (
        ReviewObjective.objects.filter(org_id=org_id, review=review).aggregate(m=Max("sort_order"))["m"] or 0
    ) + 1
    return ReviewObjective.objects.create(
        org_id=org_id,
        review=review,
        member_id=review.member_id,
        title=data["title"].strip(),
        measure=(data.get("measure") or "").strip(),
        priority=data.get("priority", "medium"),
        progress_pct=data.get("progress_pct", 0),
        status=data.get("status", "open"),
        sort_order=next_sort,
    )


@transaction.atomic
def submit_review(*, org_id: UUID, review: PerformanceReview, by_user_id: UUID) -> PerformanceReview:
    """Submit a review, snapshotting the competence / KPI / wellbeing scores (P4)."""
    if review.status != PerformanceReview.Status.DRAFT:
        raise ServiceError("not_submittable", "Only a draft review can be submitted.", status=409)
    snap = scoring.review_snapshot(org_id=org_id, member=review.member)
    review.competence_score = snap["competence_score"]
    review.kpi_score = snap["kpi_score"]
    review.wellbeing_score = snap["wellbeing_score"]
    review.status = PerformanceReview.Status.SUBMITTED
    review.submitted_at = timezone.now()
    review.save(
        update_fields=[
            "competence_score",
            "kpi_score",
            "wellbeing_score",
            "status",
            "submitted_at",
            "updated_at",
        ]
    )
    return review


@transaction.atomic
def acknowledge_review(*, review: PerformanceReview) -> PerformanceReview:
    if review.status != PerformanceReview.Status.SUBMITTED:
        raise ServiceError("not_acknowledgeable", "Only a submitted review can be acknowledged.", status=409)
    review.status = PerformanceReview.Status.ACKNOWLEDGED
    review.acknowledged_at = timezone.now()
    review.save(update_fields=["status", "acknowledged_at", "updated_at"])
    return review
