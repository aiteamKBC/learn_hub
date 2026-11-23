"""Role Framework: versioned role specification with KSB requirements and HR approval.

A `RoleFramework` shell anchors one (job_role, unit, track, level) tuple. HR drafts
a `RoleFrameworkVersion`, which lists `RoleRequirement` rows (each linked to a
`Competency`). The version flows through an approval state machine:

    draft → submitted → approved   (prior approved → superseded atomically)
                      ↘ changes_requested → draft (new version)

All transitions are logged to `RoleFrameworkHistory`. Only one version per framework
may be in `approved` state at any time.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import TenantModel

from .competency import SCHEMA, Competency

User = settings.AUTH_USER_MODEL


class RoleFramework(TenantModel):
    """Shell record for one role × level combination. Versions attach to this."""

    job_role = models.ForeignKey("org.JobRole", on_delete=models.PROTECT, related_name="frameworks")
    unit = models.ForeignKey(
        "org.OrgUnit", on_delete=models.PROTECT, null=True, blank=True, related_name="role_frameworks"
    )
    title = models.CharField(max_length=160)
    level = models.PositiveSmallIntegerField()
    step = models.PositiveSmallIntegerField(default=1)
    track = models.CharField(max_length=80, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "role_frameworks")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_rolefw_org_id"),
            models.CheckConstraint(
                condition=Q(level__gte=1) & Q(level__lte=4),
                name="ck_rolefw_level_1_4",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "job_role", "level"], name="ix_rolefw_org_role_level"),
            models.Index(fields=["org", "archived_at"], name="ix_rolefw_org_archived"),
        ]

    def __str__(self) -> str:
        return f"{self.title} L{self.level}"


class RoleFrameworkVersion(TenantModel):
    """One version of a role framework spec.  Number is monotonically increasing per
    framework; only one version may be `approved` at a time."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        CHANGES_REQUESTED = "changes_requested", "Changes requested"
        APPROVED = "approved", "Approved"
        SUPERSEDED = "superseded", "Superseded"

    framework = models.ForeignKey(RoleFramework, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.DRAFT)
    job_description = models.TextField(blank=True)
    person_spec = models.TextField(blank=True)
    required_hours = models.PositiveSmallIntegerField(default=35)
    recommended_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    cpd_period = models.CharField(max_length=32, blank=True)
    # Qualification IDs (hcm.Qualification) this role needs / recommends. Stored as an
    # array on the version row rather than an M2M, so the data stays on a company_only
    # table with no untracked join table to secure. readiness() resolves the ids.
    required_qualification_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    recommended_qualification_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    based_on = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    submitted_by = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="submitted_role_versions"
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="approved_role_versions"
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "role_framework_versions")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_rfv_org_id"),
            models.UniqueConstraint(fields=["framework", "number"], name="uq_rfv_framework_number"),
        ]
        indexes = [
            models.Index(fields=["framework", "-number"], name="ix_rfv_framework_number"),
            models.Index(fields=["org", "status"], name="ix_rfv_org_status"),
        ]


class RoleRequirement(TenantModel):
    """One KSB requirement on a RoleFrameworkVersion."""

    class ReqKind(models.TextChoices):
        KNOWLEDGE = "knowledge", "Knowledge"
        SKILL = "skill", "Skill"
        BEHAVIOUR = "behaviour", "Behaviour"
        PROFESSIONAL = "professional", "Professional identity"

    class Priority(models.TextChoices):
        ESSENTIAL = "essential", "Essential"
        IMPORTANT = "important", "Important"
        DESIRABLE = "desirable", "Desirable"

    version = models.ForeignKey(RoleFrameworkVersion, on_delete=models.CASCADE, related_name="requirements")
    kind = models.CharField(max_length=16, choices=ReqKind.choices)
    text = models.CharField(max_length=500)
    competency = models.ForeignKey(
        Competency, on_delete=models.SET_NULL, null=True, blank=True, related_name="role_requirements"
    )
    level = models.PositiveSmallIntegerField()
    priority = models.CharField(max_length=16, choices=Priority.choices)
    weight = models.PositiveSmallIntegerField(default=5)
    source = models.CharField(max_length=160, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "role_requirements")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_rolerq_org_id"),
            models.CheckConstraint(
                condition=Q(level__gte=1) & Q(level__lte=5),
                name="ck_req_level_1_5",
            ),
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=10),
                name="ck_req_weight_1_10",
            ),
        ]
        indexes = [
            models.Index(fields=["version", "sort_order"], name="ix_req_version_sort"),
        ]


class RoleFrameworkHistory(TenantModel):
    """Audit log entry for every state transition on a RoleFramework."""

    framework = models.ForeignKey(RoleFramework, on_delete=models.CASCADE, related_name="history")
    version_number = models.PositiveIntegerField()
    at = models.DateTimeField()
    by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    action = models.CharField(max_length=32)
    comment = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = table(SCHEMA, "role_framework_history")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_rfh_org_id"),
        ]
        indexes = [
            models.Index(fields=["framework", "-at"], name="ix_rfh_framework_at"),
        ]
