"""Pydantic In/Out schemas for the Frameworks API.

Schema class names are unique across the project (enforced by test_api_contract);
Frameworks schemas are prefixed `Fw*` to stay distinct from HCM/compliance.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema


# ---------------------------------------------------------------- competencies
class FwCompetencyOut(Schema):
    id: UUID
    owner_org_id: UUID | None
    code: str
    name: str
    description: str
    kind: str
    sort_order: int
    is_platform: bool
    cloned_from_id: UUID | None
    archived: bool


class FwCompetencyIn(Schema):
    code: str = Field(..., min_length=1, max_length=16)
    name: str = Field(..., min_length=2, max_length=200)
    description: str = Field("", max_length=4000)
    kind: str = Field(..., pattern="^[KSBP]$")
    sort_order: int = Field(0, ge=0, le=10000)


class FwCompetencyPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = Field(None, max_length=4000)
    sort_order: int | None = Field(None, ge=0, le=10000)


# ---------------------------------------------------------------- content tagging
class FwCourseTagIn(Schema):
    competency_id: UUID
    target_level: int = Field(3, ge=1, le=5)
    weight: int = Field(5, ge=1, le=10)


class FwCourseTagOut(Schema):
    id: UUID
    competency_id: UUID
    competency_code: str
    competency_name: str
    target_level: int
    weight: int


# ---------------------------------------------------------------- role frameworks
class FwRoleIn(Schema):
    job_role_id: UUID
    unit_id: UUID | None = None
    title: str = Field(..., min_length=2, max_length=160)
    level: int = Field(..., ge=1, le=4)
    step: int = Field(1, ge=1, le=20)
    track: str = Field("", max_length=80)


class FwRoleOut(Schema):
    id: UUID
    job_role_id: UUID
    unit_id: UUID | None
    title: str
    level: int
    step: int
    track: str
    archived: bool
    approved_version_number: int | None
    latest_version_number: int | None
    approved_version_id: UUID | None
    latest_version_id: UUID | None


class FwVersionPatch(Schema):
    job_description: str | None = Field(None, max_length=20000)
    person_spec: str | None = Field(None, max_length=20000)
    required_hours: int | None = Field(None, ge=0, le=2000)
    recommended_hours: int | None = Field(None, ge=0, le=2000)
    cpd_period: str | None = Field(None, max_length=32)
    required_qualification_ids: list[UUID] | None = None
    recommended_qualification_ids: list[UUID] | None = None


class FwRequirementIn(Schema):
    kind: str = Field(..., pattern="^(knowledge|skill|behaviour|professional)$")
    text: str = Field(..., min_length=2, max_length=500)
    competency_id: UUID | None = None
    level: int = Field(..., ge=1, le=5)
    priority: str = Field(..., pattern="^(essential|important|desirable)$")
    weight: int = Field(5, ge=1, le=10)
    source: str = Field("", max_length=160)


class FwRequirementOut(Schema):
    id: UUID
    kind: str
    text: str
    competency_id: UUID | None
    competency_code: str | None
    level: int
    priority: str
    weight: int
    sort_order: int


class FwVersionOut(Schema):
    id: UUID
    framework_id: UUID
    number: int
    status: str
    job_description: str
    person_spec: str
    required_hours: int
    recommended_hours: int | None
    cpd_period: str
    required_qualification_ids: list[UUID]
    recommended_qualification_ids: list[UUID]
    submitted_at: datetime | None
    approved_at: datetime | None
    requirements: list[FwRequirementOut]


class FwTransitionIn(Schema):
    comment: str = Field("", max_length=500)


class FwHistoryOut(Schema):
    version_number: int
    at: datetime
    action: str
    comment: str


# ---------------------------------------------------------------- scoring / readiness
class FwCompetenceItem(Schema):
    competency_id: UUID
    code: str
    name: str
    kind: str
    evidenced_level: int


class FwCompetenceOut(Schema):
    member_id: UUID
    items: list[FwCompetenceItem]
    computed_at: datetime | None


class FwGapOut(Schema):
    competency_id: UUID
    code: str
    name: str
    required_level: int
    evidenced_level: int
    priority: str


class FwReadinessOut(Schema):
    member_id: UUID
    version_id: UUID
    competence_score: float
    qualifications_met: bool
    missing_qualification_ids: list[UUID]
    ready: bool
    gaps: list[FwGapOut]


class FwRecommendationOut(Schema):
    competency_id: UUID
    competency_code: str
    required_level: int
    course_id: UUID
    course_title: str
    target_level: int


# ---------------------------------------------------------------- maturity
class FwMaturityFrameworkOut(Schema):
    id: UUID
    owner_org_id: UUID | None
    code: str
    kind: str
    dept: str
    title: str
    is_platform: bool
    published_version_id: UUID | None


class FwMaturityCriterionOut(Schema):
    id: UUID
    practice: str
    question: str
    evidence: str
    weight: int
    anchors: list[str]


class FwMaturityDimensionOut(Schema):
    id: UUID
    name: str
    target_level: int
    weight: int
    action_hint: str
    criteria: list[FwMaturityCriterionOut]


class FwMaturityVersionOut(Schema):
    id: UUID
    framework_id: UUID
    number: int
    status: str
    title: str
    dimensions: list[FwMaturityDimensionOut]


class FwCampaignIn(Schema):
    framework_version_id: UUID
    dept: str = Field(..., min_length=1, max_length=80)
    quarter_year: int = Field(..., ge=2000, le=2100)
    quarter: int = Field(..., ge=1, le=4)
    starts_at: datetime
    ends_at: datetime


class FwCampaignOut(Schema):
    id: UUID
    framework_version_id: UUID
    dept: str
    quarter_year: int
    quarter: int
    starts_at: datetime
    ends_at: datetime
    closed_at: datetime | None
    response_count: int


class FwResponseIn(Schema):
    answers: dict = Field(default_factory=dict)
    reflections: dict = Field(default_factory=dict)


class FwResponseOut(Schema):
    id: UUID
    campaign_id: UUID
    member_id: UUID
    submitted_at: datetime


class FwCampaignScoresOut(Schema):
    campaign_id: UUID
    closed_at: datetime | None
    response_count: int
    scores: dict


class FwOk(Schema):
    ok: bool = True
