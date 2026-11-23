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


class MemberQualificationOut(Schema):
    id: UUID
    qualification_id: UUID
    qualification_name: str
    code: str
    awarded_on: date | None
    expires_on: date | None


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
