"""Pydantic In/Out schemas for the HCM API."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from ninja import Field, Schema


# ---------------------------------------------------------------- profile
class ProfileOut(Schema):
    member_id: UUID
    full_name: str
    email: str
    role: str
    track: str
    level: int | None
    aspiration: str
    location: str
    start_date: date | None
    termination_date: date | None
    line_manager_id: UUID | None
    line_manager_name: str | None
    stay_intent: Decimal | None
    satisfaction: Decimal | None
    adjustments: str
    cpd_hours_cached: Decimal


class MyProfilePatch(Schema):
    """Fields a member may change on their own profile."""

    aspiration: str | None = Field(None, max_length=300)
    adjustments: str | None = Field(None, max_length=2000)


class HrProfilePatch(Schema):
    """Fields an HR admin may change on a member's profile."""

    track: str | None = Field(None, max_length=80)
    level: int | None = Field(None, ge=1, le=4)
    aspiration: str | None = Field(None, max_length=300)
    location: str | None = Field(None, max_length=160)
    start_date: date | None = None
    termination_date: date | None = None
    line_manager_id: UUID | None = None
    adjustments: str | None = Field(None, max_length=2000)


# ---------------------------------------------------------------- qualifications
class QualificationIn(Schema):
    name: str = Field(..., min_length=2, max_length=160)
    code: str = Field("", max_length=32)


class QualificationOut(Schema):
    id: UUID
    name: str
    code: str
    archived: bool


class MemberQualificationIn(Schema):
    qualification_id: UUID
    awarded_on: date | None = None
    expires_on: date | None = None
    # id of a certificate file already uploaded via the evidence-upload endpoint
    certificate_asset_id: UUID | None = None


class MemberQualificationOut(Schema):
    id: UUID
    qualification_id: UUID
    qualification_name: str
    code: str
    awarded_on: date | None
    expires_on: date | None
    has_certificate: bool = False
    certificate_filename: str = ""


class CertificateUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., gt=0)


class CertificateTicketOut(Schema):
    asset_id: UUID
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int
    max_bytes: int


class CertificateUrlOut(Schema):
    url: str
    filename: str


# ---------------------------------------------------------------- CPD
class CpdIn(Schema):
    title: str = Field(..., min_length=2, max_length=200)
    provider: str = Field("", max_length=160)
    completed_on: date
    hours: Decimal = Field(..., gt=0, le=999)


class CpdOut(Schema):
    id: UUID
    kind: str
    title: str
    provider: str
    completed_on: date
    hours: Decimal
    verified: bool
    verified_at: datetime | None


# ---------------------------------------------------------------- member development plans
class TrainingPlanPatch(Schema):
    owner_id: UUID | None = None
    period_start: date | None = None
    period_end: date | None = None


class TrainingPlanItemIn(Schema):
    kind: str = Field(..., pattern="^(course|external)$")
    course_id: UUID | None = None
    title: str = Field("", max_length=200)
    provider: str = Field("", max_length=160)
    external_url: str = Field("", max_length=200)
    purpose: str = Field("self_directed", pattern="^(corrective|preventive|self_directed)$")
    source: str = Field("manager", pattern="^(manager|career_path|competency_gap|external)$")
    source_detail: str = Field("", max_length=300)
    owner_id: UUID | None = None
    due_at: date | None = None
    estimated_hours: Decimal | None = Field(None, gt=0, le=999)


class TrainingPlanCompleteIn(Schema):
    hours: Decimal = Field(..., gt=0, le=999)


class TrainingPlanItemOut(Schema):
    id: UUID
    kind: str
    course_id: UUID | None
    course_slug: str | None
    title: str
    provider: str
    external_url: str
    purpose: str
    source: str
    source_detail: str
    owner_id: UUID | None
    owner_name: str | None
    assigned_by_name: str
    assigned_at: datetime
    due_at: date | None
    estimated_hours: Decimal | None
    completed_hours: Decimal | None
    status: str
    completed_on: date | None


class TrainingPlanOut(Schema):
    member_id: UUID
    owner_id: UUID | None
    owner_name: str | None
    period_start: date | None
    period_end: date | None
    items: list[TrainingPlanItemOut]


# ---------------------------------------------------------------- wellbeing
class WellbeingIn(Schema):
    hope: int = Field(..., ge=0, le=100)
    efficacy: int = Field(..., ge=0, le=100)
    resilience: int = Field(..., ge=0, le=100)
    optimism: int = Field(..., ge=0, le=100)
    overall: int = Field(..., ge=0, le=100)
    stay_intent: Decimal | None = Field(None, ge=0, le=1)
    satisfaction: Decimal | None = Field(None, ge=0, le=1)
    note: str = Field("", max_length=500)


class WellbeingOut(Schema):
    id: UUID
    submitted_at: datetime
    hope: int
    efficacy: int
    resilience: int
    optimism: int
    overall: int
    stay_intent: Decimal | None
    satisfaction: Decimal | None
    note: str


class HcmOk(Schema):
    ok: bool = True
