"""Pydantic In/Out schemas for the compliance API."""

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema


class TargetIn(Schema):
    unit_id: UUID | None = None
    job_role_id: UUID | None = None
    include_subunits: bool = True


class RequirementIn(Schema):
    course_id: UUID
    name: str = Field(..., min_length=2, max_length=160)
    description: str = Field("", max_length=2000)
    renewal_months: int | None = Field(None, ge=1, le=120)
    due_days: int = Field(30, ge=0, le=365)
    expiring_soon_days: int = Field(30, ge=1, le=180)
    reminder_days: list[int] = Field(default_factory=lambda: [14, 3], max_length=8)
    overdue_every_days: int = Field(7, ge=0, le=90)
    targets: list[TargetIn] = Field(..., min_length=1, max_length=50)


class RequirementPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=160)
    description: str | None = Field(None, max_length=2000)
    renewal_months: int | None = Field(None, ge=1, le=120)
    due_days: int | None = Field(None, ge=0, le=365)
    expiring_soon_days: int | None = Field(None, ge=1, le=180)
    reminder_days: list[int] | None = Field(None, max_length=8)
    overdue_every_days: int | None = Field(None, ge=0, le=90)
    targets: list[TargetIn] | None = Field(None, min_length=1, max_length=50)


class TargetOut(Schema):
    unit_id: UUID | None
    unit_name: str | None
    job_role_id: UUID | None
    job_role_name: str | None
    include_subunits: bool


class RequirementOut(Schema):
    id: UUID
    name: str
    description: str
    course_id: UUID
    course_title: str
    renewal_months: int | None
    due_days: int
    expiring_soon_days: int
    reminder_days: list[int]
    overdue_every_days: int
    targets: list[TargetOut]
    total: int = 0
    compliance_pct: float = 100.0
    overdue: int = 0


class Cell(Schema):
    id: UUID
    status: str
    due_at: datetime | None
    expires_at: datetime | None


class MatrixRow(Schema):
    member_id: UUID
    name: str
    email: str
    job_title: str
    employee_ref: str
    cells: dict[str, Cell]  # requirement_id -> cell


class MatrixRequirement(Schema):
    id: UUID
    name: str


class MatrixOut(Schema):
    requirements: list[MatrixRequirement]
    rows: list[MatrixRow]
    next_cursor: str | None


class ExtendIn(Schema):
    due_at: datetime


class ExemptIn(Schema):
    reason: str = Field(..., min_length=3, max_length=300)
    ends_at: datetime | None = None


class ManualIn(Schema):
    completed_at: datetime
    note: str = Field(..., min_length=3, max_length=500)
    evidence_asset_id: UUID | None = None


class VoidIn(Schema):
    reason: str = Field(..., min_length=3, max_length=300)


class ExtendOut(Schema):
    status: str
    due_at: datetime | None


class ExemptionCreatedOut(Schema):
    exemption_id: UUID


class RecordCreatedOut(Schema):
    record_id: UUID


class ReminderOut(Schema):
    reminder_id: UUID


# ---------------------------------------------------------------- one person
class NamedRef(Schema):
    id: UUID
    name: str


class PersonStatusOut(Schema):
    status_id: UUID
    requirement_id: UUID
    name: str
    course_title: str
    status: str
    due_at: datetime | None
    completed_at: datetime | None
    expires_at: datetime | None
    due_override_at: datetime | None


class PersonRecordOut(Schema):
    id: UUID
    requirement_id: UUID
    requirement: str
    source: str
    completed_at: datetime
    expires_at: datetime | None
    note: str
    voided: bool
    void_reason: str
    recorded_by: str | None


class PersonExemptionOut(Schema):
    id: UUID
    requirement_id: UUID
    requirement: str
    reason: str
    starts_at: datetime
    ends_at: datetime | None
    revoked_at: datetime | None
    granted_by: str


class PersonCourseOut(Schema):
    course_title: str
    status: str
    progress_pct: float
    enrolled_at: datetime
    completed_at: datetime | None


class PersonCertificateOut(Schema):
    id: UUID
    course_title: str
    issued_at: datetime
    code: str


class CompliancePersonOut(Schema):
    member_id: UUID
    name: str
    email: str
    role: str
    job_title: str
    employee_ref: str
    joined_at: datetime
    units: list[NamedRef]
    job_roles: list[NamedRef]
    requirements: list[PersonStatusOut]
    records: list[PersonRecordOut]
    exemptions: list[PersonExemptionOut]
    courses: list[PersonCourseOut]
    certificates: list[PersonCertificateOut]


class MyRequirement(Schema):
    status_id: UUID
    requirement: str
    course_id: UUID
    course_slug: str
    course_title: str
    status: str
    due_at: datetime | None
    expires_at: datetime | None
    completed_at: datetime | None


# ---------------------------------------------------------------- dashboard
class LearningActivityOut(Schema):
    people: int
    active_30: int
    completed_30: int
    in_progress: int


class UnitComplianceOut(Schema):
    unit_id: UUID
    name: str
    people_rows: int
    overdue_or_expired: int
    compliance_pct: float


class AttentionOut(Schema):
    id: UUID
    status: str
    due_at: datetime | None
    member_id: UUID
    member__user__full_name: str
    requirement__name: str


class DashboardOut(Schema):
    compliance_pct: float
    headcount: int
    total: int
    exempt: int
    ok: int
    overdue: int
    expired: int
    people_overdue: int  # people with at least one overdue or expired requirement
    expiring_30: int
    due_30: int
    learning: LearningActivityOut
    units: list[UnitComplianceOut]
    attention: list[AttentionOut]


class RequirementSummaryOut(Schema):
    requirement_id: UUID
    requirement__name: str
    requirement__renewal_months: int | None
    total: int
    not_started: int
    in_progress: int
    compliant: int
    expiring_soon: int
    expired: int
    overdue: int
    exempt: int
    compliance_pct: float
