"""Scoring helpers: KPI attainment and the review score snapshot.

Pure compute, plus `review_snapshot` which reads across HCM (wellbeing) and
Frameworks (competence evidence) to assemble the numbers stored on a review at
submit time (decision P4). Nothing here mutates framework or HCM data.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .models import Kpi, KpiMeasurement


def kpi_attainment(*, value, baseline, target, higher_better: bool) -> float | None:
    """Attainment 0..100 of a measured value against its target.

    With a baseline, progress is measured from baseline → target. Without one, it is
    value/target (higher_better) or target/value (lower is better). Returns None when
    there is nothing to compare against."""
    if value is None or target is None:
        return None
    value = float(value)
    target = float(target)
    if baseline is not None:
        baseline = float(baseline)
        span = target - baseline
        if span == 0:
            return 100.0 if value == target else 0.0
        frac = (value - baseline) / span
        return round(max(0.0, min(frac, 1.0)) * 100.0, 1)
    if higher_better:
        if target == 0:
            return 100.0 if value >= 0 else 0.0
        return round(max(0.0, min(value / target, 1.0)) * 100.0, 1)
    # lower is better
    if value <= 0:
        return 100.0
    return round(max(0.0, min(target / value, 1.0)) * 100.0, 1)


def latest_measurement(*, org_id: UUID, kpi_id: UUID) -> KpiMeasurement | None:
    return (
        KpiMeasurement.objects.filter(org_id=org_id, kpi_id=kpi_id)
        .order_by("-period_year", "-period_index")
        .first()
    )


def kpi_payload(
    kpi: Kpi,
    *,
    org_id: UUID,
    recent: list[KpiMeasurement] | None = None,
    source: str | None = None,
    source_title: str = "",
) -> dict:
    if recent is None:
        recent = list(
            KpiMeasurement.objects.filter(org_id=org_id, kpi_id=kpi.id).order_by(
                "-period_year", "-period_index"
            )[:6]
        )
    m = recent[0] if recent else None
    value = m.value if m else None
    if source is None:
        from .models import KpiProposal

        source = (
            KpiProposal.objects.filter(org_id=org_id, id=kpi.source_proposal_id)
            .values_list("source", flat=True)
            .first()
            if kpi.source_proposal_id
            else ""
        )
    return {
        "id": kpi.id,
        "scope": kpi.scope,
        "parent_kpi_id": kpi.parent_kpi_id,
        "source": source or "",
        "source_title": source_title,
        "objective_code": kpi.objective_code,
        "objective_title": kpi.objective_title,
        "dept": kpi.dept,
        "name": kpi.name,
        "owner_id": kpi.owner_id,
        "owner_name": kpi.owner.user.full_name or kpi.owner.user.email if kpi.owner_id else "Unassigned",
        "definition": kpi.definition,
        "unit": kpi.unit,
        "baseline": kpi.baseline,
        "target": kpi.target,
        "higher_better": kpi.higher_better,
        "cadence": kpi.cadence,
        "weight": kpi.weight,
        "period": kpi.period,
        "review_date": kpi.review_date,
        "status": kpi.status,
        "latest_value": value,
        "series": [
            {"period_year": row.period_year, "period_index": row.period_index, "value": row.value}
            for row in reversed(recent)
        ],
        "attainment": kpi_attainment(
            value=value, baseline=kpi.baseline, target=kpi.target, higher_better=kpi.higher_better
        ),
    }


def member_kpi_score(*, org_id: UUID, member_id: UUID) -> float | None:
    """Weighted mean attainment across the active KPIs this member owns that have a
    measurement. Returns None if the member owns no measured KPI."""
    kpis = Kpi.objects.filter(org_id=org_id, owner_id=member_id, status=Kpi.Status.ACTIVE)
    total_w = 0
    acc = 0.0
    for kpi in kpis:
        m = latest_measurement(org_id=org_id, kpi_id=kpi.id)
        if m is None:
            continue
        att = kpi_attainment(
            value=m.value, baseline=kpi.baseline, target=kpi.target, higher_better=kpi.higher_better
        )
        if att is None:
            continue
        acc += att * kpi.weight
        total_w += kpi.weight
    if total_w == 0:
        return None
    return round(acc / total_w, 2)


def member_competence_score(*, org_id: UUID, user_id: UUID) -> float | None:
    """A competence proxy 0..100: mean evidenced level (1..5) across the member's
    evidenced competencies, scaled to 100. Reuses Frameworks evidence."""
    from apps.frameworks.scoring import evidenced_levels

    levels = evidenced_levels(org_id=org_id, user_id=user_id)
    if not levels:
        return None
    mean_level = sum(levels.values()) / len(levels)
    return round(mean_level / 5.0 * 100.0, 2)


def member_wellbeing_score(*, org_id: UUID, member_id: UUID) -> float | None:
    """Latest overall wellbeing (0..100) for the member, if any."""
    from apps.hcm.models import WellbeingSurvey

    row = (
        WellbeingSurvey.objects.filter(org_id=org_id, member_id=member_id)
        .order_by("-submitted_at")
        .values_list("overall", flat=True)
        .first()
    )
    return float(row) if row is not None else None


def review_snapshot(*, org_id: UUID, member) -> dict:
    """Assemble the competence / KPI / wellbeing numbers for a member's review."""
    competence = member_competence_score(org_id=org_id, user_id=member.user_id)
    kpi = member_kpi_score(org_id=org_id, member_id=member.id)
    wellbeing = member_wellbeing_score(org_id=org_id, member_id=member.id)
    return {
        "competence_score": None if competence is None else Decimal(str(competence)),
        "kpi_score": None if kpi is None else Decimal(str(kpi)),
        "wellbeing_score": None if wellbeing is None else Decimal(str(wellbeing)),
    }
