"""Organizations: business customers (Staff Skills side of the platform).

Postgres schema: org
RLS (core.rls):
    organizations       organizations()  members, current company, staff
    org_members         membership()     own memberships always visible (needed
                                         before a company is selected)
    everything else     company_only()

Composite foreign keys (org_id, x_id) -> (org_id, id) are added in migration 0002
so the database itself refuses links between two companies' rows.
"""

from django.conf import settings
from django.contrib.postgres.indexes import GistIndex
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from core.db import table
from core.fields import LTreeField
from core.models import BaseModel, TenantModel

SCHEMA = "org"
hex_color = RegexValidator(r"^#[0-9a-fA-F]{6}$", "Use a hex colour like #6D28D9.")


class Organization(BaseModel):
    class Status(models.TextChoices):
        TRIAL = "trial", "Trial"
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        CANCELLED = "cancelled", "Cancelled"

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.TRIAL)
    billing_currency = models.CharField(max_length=3, default="GBP")
    email_domain = models.CharField(max_length=253, blank=True)  # for future company SSO
    # How long training records are kept after someone leaves, then anonymised (decision 8)
    retention_months = models.PositiveSmallIntegerField(default=72)
    seat_limit = models.PositiveIntegerField(null=True, blank=True)
    stripe_customer_id = models.CharField(max_length=64, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = table(SCHEMA, "organizations")
        indexes = [models.Index(fields=["status"], name="ix_org_status")]

    def __str__(self) -> str:
        return self.name


class OrgMember(TenantModel):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Admin"
        MANAGER = "manager", "Manager"
        LEARNER = "learner", "Learner"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.LEARNER)
    job_title = models.CharField(max_length=120, blank=True)
    employee_ref = models.CharField(max_length=64, blank=True)  # the company's own staff number
    joined_at = models.DateTimeField()
    removed_at = models.DateTimeField(null=True, blank=True)  # never deleted: audits need history

    class Meta:
        db_table = table(SCHEMA, "org_members")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_members_org_id"),
            models.UniqueConstraint(
                fields=["org", "user"], condition=Q(removed_at__isnull=True), name="uq_members_active"
            ),
        ]
        indexes = [
            models.Index(
                fields=["org", "role"], name="ix_members_org_role", condition=Q(removed_at__isnull=True)
            ),
            models.Index(fields=["user"], name="ix_members_user", condition=Q(removed_at__isnull=True)),
        ]


class OrgUnit(TenantModel):
    """One node of the company tree: region, site, department or team (decision 3)."""

    class Kind(models.TextChoices):
        COMPANY = "company", "Company"
        REGION = "region", "Region"
        SITE = "site", "Site"
        DEPARTMENT = "department", "Department"
        TEAM = "team", "Team"

    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    name = models.CharField(max_length=160)
    code = models.CharField(max_length=32, blank=True)  # e.g. a site code from the company's HR system
    path = LTreeField()  # maintained by services.create_unit / move_unit only
    depth = models.PositiveSmallIntegerField()
    sort_order = models.PositiveIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)  # never deleted once it has history

    class Meta:
        db_table = table(SCHEMA, "org_units")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_units_org_id"),
            models.UniqueConstraint(
                fields=["org"], condition=Q(parent__isnull=True), name="uq_units_one_root"
            ),
        ]
        indexes = [
            GistIndex(fields=["path"], name="gx_units_path"),
            models.Index(fields=["org", "parent", "sort_order"], name="ix_units_org_parent"),
        ]

    def __str__(self) -> str:
        return self.name


class MemberUnit(TenantModel):
    """Which units a member belongs to; exactly one primary (headcount and reporting)."""

    member = models.ForeignKey(OrgMember, on_delete=models.CASCADE, related_name="unit_links")
    unit = models.ForeignKey(OrgUnit, on_delete=models.PROTECT, related_name="member_links")
    is_primary = models.BooleanField(default=False)

    class Meta:
        db_table = table(SCHEMA, "member_units")
        constraints = [
            models.UniqueConstraint(fields=["member", "unit"], name="uq_member_unit"),
            models.UniqueConstraint(
                fields=["member"], condition=Q(is_primary=True), name="uq_member_primary_unit"
            ),
        ]
        indexes = [models.Index(fields=["org", "unit"], name="ix_member_units_org_unit")]


class UnitManager(TenantModel):
    """A manager covers their unit and everything below it."""

    unit = models.ForeignKey(OrgUnit, on_delete=models.CASCADE, related_name="manager_links")
    member = models.ForeignKey(OrgMember, on_delete=models.CASCADE, related_name="managed_units")

    class Meta:
        db_table = table(SCHEMA, "unit_managers")
        constraints = [models.UniqueConstraint(fields=["unit", "member"], name="uq_unit_manager")]
        indexes = [models.Index(fields=["org", "member"], name="ix_unit_managers_member")]


class JobRole(TenantModel):
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=32, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "job_roles")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_job_roles_org_id"),
            models.UniqueConstraint("org", Lower("name"), name="uq_job_roles_name"),
        ]

    def __str__(self) -> str:
        return self.name


class MemberJobRole(TenantModel):
    member = models.ForeignKey(OrgMember, on_delete=models.CASCADE, related_name="job_role_links")
    job_role = models.ForeignKey(JobRole, on_delete=models.PROTECT, related_name="member_links")

    class Meta:
        db_table = table(SCHEMA, "member_job_roles")
        constraints = [models.UniqueConstraint(fields=["member", "job_role"], name="uq_member_job_role")]
        indexes = [models.Index(fields=["org", "job_role"], name="ix_member_job_roles_role")]


class OrgRoleAssignment(TenantModel):
    """A company responsibility, distinct from both membership access and job title."""

    class Code(models.TextChoices):
        EXECUTIVE = "executive", "Executive"
        HR_ADMIN = "hr_admin", "HR"
        DEPARTMENT_HEAD = "department_head", "Head of Department"
        LINE_MANAGER = "line_manager", "Line Manager"
        ACADEMY_MARKETING = "academy_marketing", "Academy Marketing"

    member = models.ForeignKey(OrgMember, on_delete=models.CASCADE, related_name="responsibility_assignments")
    code = models.CharField(max_length=32, choices=Code.choices)
    unit = models.ForeignKey(
        OrgUnit, on_delete=models.PROTECT, null=True, blank=True, related_name="responsibility_assignments"
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="assigned_org_responsibilities"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "role_assignments")
        indexes = [
            models.Index(fields=["org", "member", "revoked_at"], name="ix_org_roles_member_active"),
            models.Index(fields=["org", "code", "unit"], name="ix_org_roles_scope"),
        ]


class Invite(TenantModel):
    """Email invite to join a company. Only a SHA-256 hash of the token is stored,
    so a database leak cannot be used to accept invites."""

    email = models.EmailField(max_length=320)
    role = models.CharField(max_length=16, choices=OrgMember.Role.choices, default=OrgMember.Role.LEARNER)
    unit = models.ForeignKey(OrgUnit, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    job_role = models.ForeignKey(JobRole, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    token_hash = models.CharField(max_length=64, unique=True)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "invites")
        constraints = [
            models.UniqueConstraint(
                "org",
                Lower("email"),
                condition=Q(accepted_at__isnull=True, revoked_at__isnull=True),
                name="uq_invites_pending",
            ),
        ]
        indexes = [models.Index(fields=["org", "-created_at"], name="ix_invites_org_recent")]


class OrgBranding(TenantModel):
    """Company colours and logo, applied as CSS variables inside its workspace."""

    logo_url = models.URLField(blank=True)
    primary_color = models.CharField(max_length=7, blank=True, validators=[hex_color])
    accent_color = models.CharField(max_length=7, blank=True, validators=[hex_color])

    class Meta:
        db_table = table(SCHEMA, "branding")
        constraints = [models.UniqueConstraint(fields=["org"], name="uq_branding_org")]
