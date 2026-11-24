"""Pydantic In/Out schemas for the PMS API.

Class names are prefixed `Pms*` to stay unique across the project (enforced by
test_api_contract).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from ninja import Field, Schema


# ---------------------------------------------------------------- KPIs
class PmsKpiPoint(Schema):
    period_year: int
    period_index: int
    value: Decimal


class PmsKpiOut(Schema):
    id: UUID
    scope: str
    parent_kpi_id: UUID | None
    source: str
    source_title: str
    objective_code: str
    objective_title: str
    dept: str
    name: str
    owner_id: UUID | None
    owner_name: str
    definition: str
    unit: str
    baseline: Decimal | None
    target: Decimal | None
    higher_better: bool
    cadence: str
    weight: int
    period: str
    review_date: date | None
    status: str
    latest_value: Decimal | None
    attainment: float | None
    series: list[PmsKpiPoint]


class PmsProposalIn(Schema):
    name: str = Field(..., min_length=2, max_length=200)
    scope: str = Field("department", pattern="^(department|individual)$")
    parent_kpi_id: UUID | None = None
    objective_code: str = Field("", max_length=16)
    objective_title: str = Field("", max_length=200)
    dept: str = Field("", max_length=80)
    owner_id: UUID | None = None
    definition: str = Field("", max_length=4000)
    unit: str = Field("", max_length=24)
    baseline: Decimal | None = None
    target: Decimal | None = None
    higher_better: bool = True
    source: str = Field("", max_length=200)
    cadence: str = Field("monthly", pattern="^(weekly|monthly|quarterly)$")
    period: str = Field("", max_length=32)
    review_date: date | None = None
    weight: int = Field(10, ge=1, le=100)


class PmsProposalPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=200)
    scope: str | None = Field(None, pattern="^(department|individual)$")
    parent_kpi_id: UUID | None = None
    objective_code: str | None = Field(None, max_length=16)
    objective_title: str | None = Field(None, max_length=200)
    dept: str | None = Field(None, max_length=80)
    owner_id: UUID | None = None
    definition: str | None = Field(None, max_length=4000)
    unit: str | None = Field(None, max_length=24)
    baseline: Decimal | None = None
    target: Decimal | None = None
    higher_better: bool | None = None
    source: str | None = Field(None, max_length=200)
    cadence: str | None = Field(None, pattern="^(weekly|monthly|quarterly)$")
    period: str | None = Field(None, max_length=32)
    review_date: date | None = None
    weight: int | None = Field(None, ge=1, le=100)


class PmsProposalOut(Schema):
    id: UUID
    scope: str
    parent_kpi_id: UUID | None
    name: str
    objective_code: str
    objective_title: str
    dept: str
    owner_id: UUID | None
    definition: str
    unit: str
    baseline: Decimal | None
    target: Decimal | None
    actual: Decimal | None
    higher_better: bool
    source: str
    cadence: str
    period: str
    review_date: date | None
    weight: int
    stage: str
    version: int
    ai_draft: bool
    active_kpi_id: UUID | None


class PmsTransitionIn(Schema):
    comment: str = Field("", max_length=500)


class PmsHistoryOut(Schema):
    at: datetime
    action: str
    stage: str
    version: int
    comment: str


class PmsMeasurementIn(Schema):
    period_year: int = Field(..., ge=2000, le=2100)
    period_index: int = Field(..., ge=1, le=53)
    value: Decimal
    note: str = Field("", max_length=300)


class PmsMeasurementOut(Schema):
    id: UUID
    kpi_id: UUID
    period_year: int
    period_index: int
    value: Decimal
    recorded_at: datetime
    note: str


# ---------------------------------------------------------------- review cycles
class PmsCycleIn(Schema):
    name: str = Field(..., min_length=2, max_length=120)
    year: int = Field(..., ge=2000, le=2100)
    quarter: int = Field(..., ge=1, le=4)
    opens_at: datetime
    closes_at: datetime


class PmsCycleOut(Schema):
    id: UUID
    name: str
    year: int
    quarter: int
    opens_at: datetime
    closes_at: datetime
    status: str
    closed_at: datetime | None
    review_count: int


# ---------------------------------------------------------------- reviews
class PmsReviewCreateIn(Schema):
    cycle_id: UUID
    member_id: UUID
    reviewer_id: UUID | None = None


class PmsReviewPatch(Schema):
    self_summary: str | None = Field(None, max_length=8000)
    manager_summary: str | None = Field(None, max_length=8000)
    strengths: str | None = Field(None, max_length=4000)
    development_areas: str | None = Field(None, max_length=4000)
    overall_rating: int | None = Field(None, ge=1, le=5)


class PmsObjectiveIn(Schema):
    title: str = Field(..., min_length=2, max_length=200)
    measure: str = Field("", max_length=300)
    priority: str = Field("medium", pattern="^(high|medium|low)$")
    progress_pct: int = Field(0, ge=0, le=100)
    status: str = Field("open", pattern="^(open|met|missed|carried)$")


class PmsObjectiveOut(Schema):
    id: UUID
    title: str
    measure: str
    priority: str
    progress_pct: int
    status: str
    sort_order: int


class PmsReviewOut(Schema):
    id: UUID
    cycle_id: UUID
    member_id: UUID
    reviewer_id: UUID | None
    status: str
    self_summary: str
    manager_summary: str
    strengths: str
    development_areas: str
    overall_rating: int | None
    competence_score: Decimal | None
    kpi_score: Decimal | None
    wellbeing_score: Decimal | None
    submitted_at: datetime | None
    acknowledged_at: datetime | None
    objectives: list[PmsObjectiveOut]


# ---------------------------------------------------------------- analysis
class PmsAnalysisOut(Schema):
    id: UUID
    review_id: UUID
    status: str
    model_id: str
    summary: str
    strengths: list[str]
    development: list[str]
    suggested_actions: list[str]
    error: str
    generated_at: datetime | None


class PmsOk(Schema):
    ok: bool = True
