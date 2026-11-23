"""Department Maturity and Capability Frameworks.

A `MaturityFramework` is a survey template: platform library (owner_org NULL)
or per-org clone (owner_org set). Each framework has versioned specs with
dimensions and criteria. `MaturityCampaign` is a live survey wave for a
department; `MaturityResponse` stores per-member answers and reflections.

Score aggregation: per-criterion rating (1..5) × criterion weight → per-dimension
weighted mean → per-framework weighted overall. Computed on campaign close and
snapshotted as JSON on `MaturityVersion`.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel, TenantModel

from .competency import SCHEMA

User = settings.AUTH_USER_MODEL


class MaturityFramework(BaseModel):
    """Template for a maturity or capability survey. Platform rows (owner_org NULL)
    are readable by all orgs; org-local rows (owner_org set) only by that org."""

    class Kind(models.TextChoices):
        MATURITY = "maturity", "Maturity"
        CAPABILITY = "capability", "Capability"

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    code = models.CharField(max_length=32)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    dept = models.CharField(max_length=80)
    title = models.CharField(max_length=160)
    cloned_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="clones"
    )

    class Meta:
        db_table = table(SCHEMA, "maturity_frameworks")
        constraints = [
            models.UniqueConstraint(
                fields=["owner_org", "code"],
                name="uq_maturity_fw_org_code",
            ),
        ]
        indexes = [
            models.Index(fields=["owner_org", "kind"], name="ix_maturity_fw_org_kind"),
            models.Index(fields=["owner_org", "dept"], name="ix_maturity_fw_org_dept"),
        ]

    def __str__(self) -> str:
        return f"{self.code} — {self.title}"


class MaturityVersion(BaseModel):
    """Versioned spec of a MaturityFramework. Publishes snapshots on campaign close."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        SUPERSEDED = "superseded", "Superseded"

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    framework = models.ForeignKey(MaturityFramework, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    note = models.CharField(max_length=500, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    last_scores = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = table(SCHEMA, "maturity_versions")
        constraints = [
            models.UniqueConstraint(fields=["framework", "number"], name="uq_maturity_version_fw_number"),
        ]
        indexes = [
            models.Index(fields=["framework", "-number"], name="ix_maturity_version_fw_num"),
            models.Index(fields=["owner_org", "status"], name="ix_maturity_version_org_status"),
        ]


class MaturityDimension(BaseModel):
    """One dimension (pillar) of a maturity framework version."""

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    version = models.ForeignKey(MaturityVersion, on_delete=models.CASCADE, related_name="dimensions")
    name = models.CharField(max_length=160)
    owner_role = models.CharField(max_length=120, blank=True)
    target_level = models.PositiveSmallIntegerField(default=4)
    action_hint = models.CharField(max_length=300, blank=True)
    weight = models.PositiveSmallIntegerField(default=20)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "maturity_dimensions")
        constraints = [
            models.CheckConstraint(
                condition=Q(target_level__gte=1) & Q(target_level__lte=5),
                name="ck_maturity_dim_target_1_5",
            ),
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=100),
                name="ck_maturity_dim_weight_1_100",
            ),
        ]
        indexes = [
            models.Index(fields=["version", "sort_order"], name="ix_maturity_dim_version_sort"),
        ]


class MaturityCriterion(BaseModel):
    """One survey question / practice within a MaturityDimension."""

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    dimension = models.ForeignKey(MaturityDimension, on_delete=models.CASCADE, related_name="criteria")
    practice = models.CharField(max_length=160)
    question = models.CharField(max_length=500)
    evidence = models.CharField(max_length=500, blank=True)
    weight = models.PositiveSmallIntegerField(default=60)
    anchors = ArrayField(models.CharField(max_length=300), size=5, default=list, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "maturity_criteria")
        constraints = [
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=100),
                name="ck_maturity_crit_weight_1_100",
            ),
        ]
        indexes = [
            models.Index(fields=["dimension", "sort_order"], name="ix_maturity_crit_dim_sort"),
        ]


class MaturityCampaign(TenantModel):
    """A live survey wave: all members in a dept complete the same framework version
    within the given window. Closed campaigns are immutable."""

    framework_version = models.ForeignKey(MaturityVersion, on_delete=models.PROTECT, related_name="campaigns")
    dept = models.CharField(max_length=80)
    quarter_year = models.PositiveSmallIntegerField()
    quarter = models.PositiveSmallIntegerField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "maturity_campaigns")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_campaign_org_id"),
            models.CheckConstraint(
                condition=Q(quarter__gte=1) & Q(quarter__lte=4),
                name="ck_campaign_quarter_1_4",
            ),
            models.CheckConstraint(
                condition=Q(ends_at__gt=models.F("starts_at")),
                name="ck_campaign_end_after_start",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "dept", "-quarter_year", "-quarter"], name="ix_campaign_org_dept"),
            models.Index(
                fields=["org", "closed_at"],
                name="ix_campaign_open",
                condition=Q(closed_at__isnull=True),
            ),
        ]


class MaturityResponse(TenantModel):
    """One member's completed survey response for a campaign."""

    campaign = models.ForeignKey(MaturityCampaign, on_delete=models.CASCADE, related_name="responses")
    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="maturity_responses")
    answers = models.JSONField(default=dict)
    reflections = models.JSONField(default=dict)
    submitted_at = models.DateTimeField()

    class Meta:
        db_table = table(SCHEMA, "maturity_responses")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_matresp_org_id"),
            models.UniqueConstraint(fields=["campaign", "member"], name="uq_matresp_campaign_member"),
        ]
        indexes = [
            models.Index(fields=["org", "campaign"], name="ix_matresp_org_campaign"),
            models.Index(fields=["org", "member"], name="ix_matresp_org_member"),
        ]
