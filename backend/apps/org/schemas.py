"""Pydantic In/Out schemas for the business (company) API: people, structure, invites."""

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema


class OrgOut(Schema):
    id: UUID
    name: str
    slug: str
    status: str
    seat_limit: int | None
    seats_used: int
    retention_months: int
    my_role: str
    logo_url: str = ""
    primary_color: str = ""
    accent_color: str = ""


class BrandingIn(Schema):
    logo_url: str = Field("", max_length=500)
    primary_color: str = Field("", pattern=r"^(#[0-9a-fA-F]{6})?$")
    accent_color: str = Field("", pattern=r"^(#[0-9a-fA-F]{6})?$")


class LogoUploadIn(Schema):
    filename: str = Field(..., max_length=200)
    size_bytes: int


class LogoUploadOut(Schema):
    key: str
    upload_url: str
    method: str
    headers: dict[str, str]


class LogoConfirmIn(Schema):
    key: str = Field(..., max_length=60)


class LogoOut(Schema):
    url: str


class UnitOut(Schema):
    id: UUID
    parent_id: UUID | None
    kind: str
    name: str
    code: str
    depth: int
    people: int
    managers: list[str]
    manager_ids: list[UUID]  # member ids, same order as managers


class UnitIn(Schema):
    parent_id: UUID
    kind: str
    name: str = Field(..., min_length=1, max_length=160)
    code: str = Field("", max_length=32)


class UnitPatch(Schema):
    name: str | None = Field(None, min_length=1, max_length=160)
    code: str | None = Field(None, max_length=32)
    parent_id: UUID | None = None  # move


class ManagersIn(Schema):
    member_ids: list[UUID] = Field(default_factory=list, max_length=50)


class JobRoleOut(Schema):
    id: UUID
    name: str
    code: str
    people: int


class JobRoleIn(Schema):
    name: str = Field(..., min_length=1, max_length=120)
    code: str = Field("", max_length=32)


class PersonRow(Schema):
    member_id: UUID
    user_id: UUID
    name: str
    email: str
    role: str
    job_title: str
    employee_ref: str
    joined_at: datetime
    units: list[str]
    job_roles: list[str]
    overdue: int
    expiring: int
    compliant: int
    total: int


class PersonPage(Schema):
    items: list[PersonRow]
    next_cursor: str | None


class MemberPatch(Schema):
    role: str | None = None
    job_title: str | None = Field(None, max_length=120)
    employee_ref: str | None = Field(None, max_length=64)
    unit_ids: list[UUID] | None = Field(None, max_length=20)  # replaces; first = primary
    job_role_ids: list[UUID] | None = Field(None, max_length=20)


class InviteIn(Schema):
    email: str = Field(..., max_length=320)
    role: str = "learner"
    unit_id: UUID | None = None
    job_role_id: UUID | None = None


class InviteOut(Schema):
    id: UUID
    email: str
    role: str
    expires_at: datetime
    created_at: datetime
    # lifecycle, worked out on the server from the record: pending | expired | accepted | revoked
    status: str = "pending"
    unit_name: str | None = None
    job_role_name: str | None = None
    accepted_at: datetime | None = None
    revoked_at: datetime | None = None

    @staticmethod
    def resolve_status(obj) -> str:
        from django.utils import timezone

        if getattr(obj, "accepted_at", None):
            return "accepted"
        if getattr(obj, "revoked_at", None):
            return "revoked"
        return "expired" if obj.expires_at <= timezone.now() else "pending"

    @staticmethod
    def resolve_unit_name(obj) -> str | None:
        return obj.unit.name if getattr(obj, "unit_id", None) and obj.unit else None

    @staticmethod
    def resolve_job_role_name(obj) -> str | None:
        return obj.job_role.name if getattr(obj, "job_role_id", None) and obj.job_role else None


class MemberIdsIn(Schema):
    member_ids: list[UUID] = Field(..., min_length=1, max_length=1000)


class MoveIn(MemberIdsIn):
    unit_id: UUID


class MoveOut(Schema):
    moved: int
    unchanged: int


class BulkRemindOut(Schema):
    sent: int  # reminders queued (one per training that is due)
    skipped: int  # already reminded today, or nothing due
    failed: int
    people_without_due_training: int


class PersonRowsOut(Schema):
    items: list[PersonRow]


class OrgResponsibilityOut(Schema):
    code: str
    unit_id: UUID | None
    unit_name: str | None


class OrgResponsibilityIn(Schema):
    code: str
    unit_id: UUID | None = None


class OrgResponsibilitiesIn(Schema):
    assignments: list[OrgResponsibilityIn] = Field(default_factory=list, max_length=20)


class OrgResponsibilitiesOut(Schema):
    assignments: list[OrgResponsibilityOut]


class OrgRoleCapabilitiesOut(Schema):
    can_manage_responsibilities: bool
    responsibilities: list[OrgResponsibilityOut]


class AssignIn(Schema):
    course_id: UUID
    member_ids: list[UUID] = Field(default_factory=list, max_length=5000)
    unit_ids: list[UUID] = Field(default_factory=list, max_length=100)
    dry_run: bool = False  # count who would receive it, without assigning


class LibraryCourse(Schema):
    id: UUID
    slug: str
    title: str
    subtitle: str
    thumbnail_url: str
    ownership: str
    cpd_hours: float | None
    lecture_count: int
    total_duration_sec: int
    assigned: int
    completed: int


class AssignSeatsOut(Schema):
    """Recorded courses sold per seat: the company's free seats for this assignment."""

    offering_id: UUID
    price_minor: int
    currency: str
    free: int
    needed: int
    short: int


class AssignOut(Schema):
    enrolled: int
    already_had_it: int
    seats: AssignSeatsOut | None = None  # None: free from the library (no seats used)


class AssignmentRow(Schema):
    enrollment_id: UUID
    name: str
    email: str
    status: str
    progress_pct: float
    enrolled_at: datetime
    completed_at: datetime | None
    last_accessed_at: datetime | None


class InvitationOut(Schema):
    org_name: str
    role: str


class InviteAcceptOut(Schema):
    org_id: UUID


class AuditOut(Schema):
    id: int
    created_at: datetime
    actor_id: UUID | None
    actor_name: str | None
    action: str
    target_type: str
    target_id: str
    data: dict


class AuditPage(Schema):
    items: list[AuditOut]
    next_cursor: str | None
