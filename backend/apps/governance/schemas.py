"""Pydantic In/Out schemas for the Governance API (prefixed `Gov*`)."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from ninja import Field, Schema


# ---------------------------------------------------------------- strategy
class GovStrategyIn(Schema):
    name: str = Field(..., min_length=2, max_length=160)


class GovVersionPatch(Schema):
    vision: str | None = Field(None, max_length=4000)
    mission: str | None = Field(None, max_length=4000)
    values: list[str] | None = None
    note: str | None = Field(None, max_length=500)


class GovObjectiveIn(Schema):
    code: str = Field(..., min_length=1, max_length=16)
    title: str = Field(..., min_length=2, max_length=200)
    priority: str = Field("medium", pattern="^(high|medium|low)$")
    owner_id: UUID | None = None
    period: str = Field("", max_length=40)
    measure: str = Field("", max_length=400)
    description: str = Field("", max_length=4000)


class GovObjectiveOut(Schema):
    id: UUID
    code: str
    title: str
    priority: str
    owner_id: UUID | None
    period: str
    measure: str
    description: str
    sort_order: int


class GovStrategyVersionOut(Schema):
    id: UUID
    strategy_id: UUID
    number: int
    status: str
    vision: str
    mission: str
    values: list[str]
    note: str
    approved_at: datetime | None
    objectives: list[GovObjectiveOut]


class GovStrategyOut(Schema):
    id: UUID
    name: str
    archived: bool
    approved_version_number: int | None
    latest_version_number: int | None


class GovTransitionIn(Schema):
    comment: str = Field("", max_length=500)


# ---------------------------------------------------------------- policies
class GovPolicyIn(Schema):
    code: str = Field(..., min_length=1, max_length=32)
    title: str = Field(..., min_length=2, max_length=200)
    doc_type: str = Field("policy", pattern="^(policy|sop)$")
    category: str = Field("", max_length=80)
    owner_id: UUID | None = None
    objective_code: str = Field("", max_length=16)
    summary: str = Field("", max_length=4000)


class GovPolicyVersionPatch(Schema):
    effective_date: date | None = None
    review_date: date | None = None
    summary: str | None = Field(None, max_length=4000)
    sections: list | None = None
    understanding_check: dict | None = None


class GovPolicyVersionOut(Schema):
    id: UUID
    doc_id: UUID
    number: int
    status: str
    effective_date: date | None
    review_date: date | None
    summary: str
    sections: list
    understanding_check: dict
    approved_at: datetime | None
    published_at: datetime | None


class GovPolicyOut(Schema):
    id: UUID
    code: str
    title: str
    doc_type: str
    category: str
    owner_id: UUID | None
    objective_code: str
    summary: str
    current_version: int
    status: str
    archived: bool


class GovPolicyContentOut(Schema):
    doc_id: UUID
    code: str
    title: str
    doc_type: str
    current_version: int
    require_reack: bool
    version: GovPolicyVersionOut


class GovAllocationIn(Schema):
    scope: str = Field("org", pattern="^(org|depts)$")
    depts: list[str] = Field(default_factory=list)
    titles: list[str] = Field(default_factory=list)
    sites: list[str] = Field(default_factory=list)
    worker_types: list[str] = Field(default_factory=list)
    persons: list[UUID] = Field(default_factory=list)
    require_reack: bool = True


class GovAllocationOut(Schema):
    doc_id: UUID
    scope: str
    depts: list[str]
    titles: list[str]
    sites: list[str]
    worker_types: list[str]
    persons: list[UUID]
    require_reack: bool
    published_version: int | None
    published_at: datetime | None


class GovCheckIn(Schema):
    answer_index: int = Field(..., ge=0, le=20)


class GovObservationIn(Schema):
    member_id: UUID
    note: str = Field(..., min_length=2, max_length=500)


class GovRecordOut(Schema):
    doc_id: UUID
    member_id: UUID
    version: int
    read_at: datetime | None
    ack_at: datetime | None
    check_at: datetime | None
    check_score: int | None
    adoption_stage: int
    adoption_label: str
    policy_code: str
    policy_title: str
    current_version: int
    require_reack: bool
    needs_reack: bool


# ---------------------------------------------------------------- question bank
class GovQuestionIn(Schema):
    competency_id: UUID | None = None
    dept: str = Field("", max_length=80)
    q_type: str = Field("mcq", pattern="^(mcq|rubric)$")
    prompt: str = Field(..., min_length=2, max_length=4000)
    options: list[str] = Field(default_factory=list)
    answer_index: int | None = Field(None, ge=0, le=20)
    expected: str = Field("", max_length=4000)
    rationale: str = Field("", max_length=500)
    mark: int = Field(1, ge=1, le=20)
    level: int = Field(2, ge=1, le=5)
    course_ref: str = Field("", max_length=40)


class GovQuestionPatch(Schema):
    dept: str | None = Field(None, max_length=80)
    prompt: str | None = Field(None, min_length=2, max_length=4000)
    options: list[str] | None = None
    answer_index: int | None = Field(None, ge=0, le=20)
    expected: str | None = Field(None, max_length=4000)
    rationale: str | None = Field(None, max_length=500)
    mark: int | None = Field(None, ge=1, le=20)
    level: int | None = Field(None, ge=1, le=5)
    course_ref: str | None = Field(None, max_length=40)


class GovQuestionOut(Schema):
    id: UUID
    competency_id: UUID | None
    dept: str
    q_type: str
    prompt: str
    options: list[str]
    answer_index: int | None
    expected: str
    rationale: str
    mark: int
    level: int
    course_ref: str
    archived: bool


class GovOk(Schema):
    ok: bool = True
