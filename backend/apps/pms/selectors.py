"""Optimised READ queries for PMS. All run under RLS."""

from __future__ import annotations

from uuid import UUID

from django.db.models import Count

from .models import (
    Kpi,
    KpiProposal,
    KpiProposalHistory,
    PerformanceReview,
    ReviewCycle,
    ReviewObjective,
)


# ---------------------------------------------------------------- KPIs
def active_kpis(*, org_id: UUID, dept: str | None = None, scope: str = "department"):
    qs = Kpi.objects.filter(org_id=org_id, status=Kpi.Status.ACTIVE)
    qs = qs.filter(scope=scope)
    if dept:
        qs = qs.filter(dept=dept)
    return qs.order_by("dept", "name")


def kpi(*, org_id: UUID, kpi_id: UUID) -> Kpi | None:
    return Kpi.objects.filter(org_id=org_id, id=kpi_id).first()


def proposals(*, org_id: UUID, stage: str | None = None, dept: str | None = None):
    qs = KpiProposal.objects.filter(org_id=org_id)
    if stage:
        qs = qs.filter(stage=stage)
    if dept:
        qs = qs.filter(dept=dept)
    return qs.order_by("-id")


def proposal(*, org_id: UUID, proposal_id: UUID) -> KpiProposal | None:
    return KpiProposal.objects.filter(org_id=org_id, id=proposal_id).first()


def proposal_payload(p: KpiProposal) -> dict:
    return {
        "id": p.id,
        "scope": p.scope,
        "parent_kpi_id": p.parent_kpi_id,
        "name": p.name,
        "objective_code": p.objective_code,
        "objective_title": p.objective_title,
        "dept": p.dept,
        "owner_id": p.owner_id,
        "definition": p.definition,
        "unit": p.unit,
        "baseline": p.baseline,
        "target": p.target,
        "actual": p.actual,
        "higher_better": p.higher_better,
        "source": p.source,
        "cadence": p.cadence,
        "period": p.period,
        "review_date": p.review_date,
        "weight": p.weight,
        "stage": p.stage,
        "version": p.version,
        "ai_draft": p.ai_draft,
        "active_kpi_id": p.active_kpi_id,
    }


def proposal_history(*, org_id: UUID, proposal_id: UUID):
    return KpiProposalHistory.objects.filter(org_id=org_id, proposal_id=proposal_id).order_by("-at")


def measurements(*, org_id: UUID, kpi_id: UUID):
    from .models import KpiMeasurement

    return KpiMeasurement.objects.filter(org_id=org_id, kpi_id=kpi_id).order_by(
        "-period_year", "-period_index"
    )


# ---------------------------------------------------------------- cycles
def cycles(*, org_id: UUID):
    return (
        ReviewCycle.objects.filter(org_id=org_id).annotate(n=Count("reviews")).order_by("-year", "-quarter")
    )


def cycle(*, org_id: UUID, cycle_id: UUID) -> ReviewCycle | None:
    return ReviewCycle.objects.filter(org_id=org_id, id=cycle_id).first()


def cycle_payload(c: ReviewCycle) -> dict:
    n = getattr(c, "n", None)
    if n is None:
        n = PerformanceReview.objects.filter(org_id=c.org_id, cycle_id=c.id).count()
    return {
        "id": c.id,
        "name": c.name,
        "year": c.year,
        "quarter": c.quarter,
        "opens_at": c.opens_at,
        "closes_at": c.closes_at,
        "status": c.status,
        "closed_at": c.closed_at,
        "review_count": n,
    }


# ---------------------------------------------------------------- reviews
def reviews_for_member(*, org_id: UUID, member_id: UUID):
    return PerformanceReview.objects.filter(org_id=org_id, member_id=member_id).order_by("-id")


def reviews_in_cycle(*, org_id: UUID, cycle_id: UUID):
    return PerformanceReview.objects.filter(org_id=org_id, cycle_id=cycle_id).order_by("-id")


def review(*, org_id: UUID, review_id: UUID) -> PerformanceReview | None:
    return PerformanceReview.objects.filter(org_id=org_id, id=review_id).first()


def review_payload(r: PerformanceReview) -> dict:
    objectives = [
        {
            "id": o.id,
            "title": o.title,
            "measure": o.measure,
            "priority": o.priority,
            "progress_pct": o.progress_pct,
            "status": o.status,
            "sort_order": o.sort_order,
        }
        for o in ReviewObjective.objects.filter(org_id=r.org_id, review_id=r.id).order_by("sort_order", "id")
    ]
    return {
        "id": r.id,
        "cycle_id": r.cycle_id,
        "member_id": r.member_id,
        "reviewer_id": r.reviewer_id,
        "status": r.status,
        "self_summary": r.self_summary,
        "manager_summary": r.manager_summary,
        "strengths": r.strengths,
        "development_areas": r.development_areas,
        "overall_rating": r.overall_rating,
        "competence_score": r.competence_score,
        "kpi_score": r.kpi_score,
        "wellbeing_score": r.wellbeing_score,
        "submitted_at": r.submitted_at,
        "acknowledged_at": r.acknowledged_at,
        "objectives": objectives,
    }


def analysis_payload(a) -> dict:
    return {
        "id": a.id,
        "review_id": a.review_id,
        "status": a.status,
        "model_id": a.model_id,
        "summary": a.summary,
        "strengths": list(a.strengths or []),
        "development": list(a.development or []),
        "suggested_actions": list(a.suggested_actions or []),
        "error": a.error,
        "generated_at": a.generated_at,
    }
