"""PMS (Performance Management): KPIs, performance reviews and AI analysis.

Postgres schema: pms. Three groups of tables:

  KPIs            `Kpi` (active definition), `KpiProposal` (approval workflow),
                  `KpiProposalHistory` (audit), `KpiMeasurement` (actuals series).
                  All company_only — a KPI is not personal data.

  Reviews         `ReviewCycle` (org-wide quarterly window), `PerformanceReview`
                  (one per cycle×member), `ReviewObjective` (SMART objectives).

  AI analysis     `ReviewAnalysis` — the Claude-generated summary for one review.

`PerformanceReview`, `ReviewObjective` and `ReviewAnalysis` carry a personal
assessment, so they use `core.rls.manager_of_unit` on a `member` column (the member
and their line of managers + HR admins see rows; peers do not). Every link between
company tables is a composite FK `(org_id, x_id) → (org_id, id)`.

All times are UTC. Percentages are 0..100. Quarters are 1..4. Ratings are 1..5.
"""

from django.conf import settings
from django.db import models
from django.db.models import F, Q

from core.db import table
from core.models import TenantModel

SCHEMA = "pms"
User = settings.AUTH_USER_MODEL


# ================================================================ KPIs
class Kpi(TenantModel):
    """An active KPI definition. Created when a `KpiProposal` reaches `active`."""

    class Cadence(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        RETIRED = "retired", "Retired"

    objective_code = models.CharField(max_length=16, blank=True)
    objective_title = models.CharField(max_length=200, blank=True)
    dept = models.CharField(max_length=80, blank=True)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="owned_kpis"
    )
    definition = models.TextField(blank=True)
    unit = models.CharField(max_length=24, blank=True)
    baseline = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    higher_better = models.BooleanField(default=True)
    cadence = models.CharField(max_length=12, choices=Cadence.choices, default=Cadence.MONTHLY)
    weight = models.PositiveSmallIntegerField(default=10)
    period = models.CharField(max_length=32, blank=True)
    review_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    source_proposal_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "kpis")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_kpi_org_id"),
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=100), name="ck_pms_kpi_weight_1_100"
            ),
        ]
        indexes = [
            models.Index(fields=["org", "status", "dept"], name="ix_pms_kpi_org_status"),
            models.Index(fields=["org", "owner"], name="ix_pms_kpi_org_owner"),
        ]

    def __str__(self) -> str:
        return self.name


class KpiProposal(TenantModel):
    """A proposed KPI moving through the HoD → HR → Exec approval route."""

    class Stage(models.TextChoices):
        DRAFT = "draft", "Draft"
        HOD_REVIEW = "hod_review", "HoD review"
        HR_ALIGNMENT = "hr_alignment", "HR alignment"
        EXEC_APPROVAL = "exec_approval", "Executive approval"
        ACTIVE = "active", "Active"
        CHANGES_REQUESTED = "changes_requested", "Changes requested"

    class Cadence(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"

    objective_code = models.CharField(max_length=16, blank=True)
    objective_title = models.CharField(max_length=200, blank=True)
    dept = models.CharField(max_length=80, blank=True)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="owned_kpi_proposals"
    )
    definition = models.TextField(blank=True)
    unit = models.CharField(max_length=24, blank=True)
    baseline = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    actual = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    higher_better = models.BooleanField(default=True)
    source = models.CharField(max_length=200, blank=True)
    cadence = models.CharField(max_length=12, choices=Cadence.choices, default=Cadence.MONTHLY)
    period = models.CharField(max_length=32, blank=True)
    review_date = models.DateField(null=True, blank=True)
    weight = models.PositiveSmallIntegerField(default=10)
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.DRAFT)
    version = models.PositiveIntegerField(default=1)
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    ai_draft = models.BooleanField(default=False)
    active_kpi = models.ForeignKey(
        Kpi, on_delete=models.PROTECT, null=True, blank=True, related_name="source_proposals"
    )

    class Meta:
        db_table = table(SCHEMA, "kpi_proposals")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_kpiprop_org_id"),
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=100), name="ck_pms_kpiprop_weight_1_100"
            ),
        ]
        indexes = [
            models.Index(fields=["org", "stage", "dept"], name="ix_pms_kpiprop_org_stage"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.stage})"


class KpiProposalHistory(TenantModel):
    """Audit entry for every transition on a KpiProposal."""

    proposal = models.ForeignKey(KpiProposal, on_delete=models.CASCADE, related_name="history")
    at = models.DateTimeField()
    by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    action = models.CharField(max_length=40)
    stage = models.CharField(max_length=20, blank=True)
    version = models.PositiveIntegerField(default=1)
    comment = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = table(SCHEMA, "kpi_proposal_history")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_kpihist_org_id"),
        ]
        indexes = [
            models.Index(fields=["proposal", "-at"], name="ix_pms_kpihist_proposal_at"),
        ]


class KpiMeasurement(TenantModel):
    """One actual value for a KPI in a period (kpi, year, index)."""

    kpi = models.ForeignKey(Kpi, on_delete=models.CASCADE, related_name="measurements")
    period_year = models.PositiveSmallIntegerField()
    period_index = models.PositiveSmallIntegerField()  # quarter 1..4 / month 1..12 / week 1..53
    value = models.DecimalField(max_digits=12, decimal_places=2)
    recorded_at = models.DateTimeField()
    recorded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "kpi_measurements")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_meas_org_id"),
            models.UniqueConstraint(
                fields=["kpi", "period_year", "period_index"], name="uq_pms_meas_kpi_period"
            ),
        ]
        indexes = [
            models.Index(fields=["kpi", "-period_year", "-period_index"], name="ix_pms_meas_kpi_period"),
        ]


# ================================================================ reviews
class ReviewCycle(TenantModel):
    """An org-wide performance review window for one quarter."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    name = models.CharField(max_length=120)
    year = models.PositiveSmallIntegerField()
    quarter = models.PositiveSmallIntegerField()
    opens_at = models.DateTimeField()
    closes_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "review_cycles")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_cycle_org_id"),
            models.UniqueConstraint(fields=["org", "year", "quarter", "name"], name="uq_pms_cycle_period"),
            models.CheckConstraint(
                condition=Q(quarter__gte=1) & Q(quarter__lte=4), name="ck_pms_cycle_quarter_1_4"
            ),
            models.CheckConstraint(condition=Q(closes_at__gt=F("opens_at")), name="ck_pms_cycle_window"),
        ]
        indexes = [
            models.Index(fields=["org", "-year", "-quarter"], name="ix_pms_cycle_org_period"),
            models.Index(fields=["org", "status"], name="ix_pms_cycle_org_status"),
        ]

    def __str__(self) -> str:
        return self.name


class PerformanceReview(TenantModel):
    """One member's review for a cycle. RLS: manager_of_unit on `member`."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"

    cycle = models.ForeignKey(ReviewCycle, on_delete=models.CASCADE, related_name="reviews")
    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="performance_reviews")
    reviewer = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="reviews_given"
    )
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.DRAFT)
    self_summary = models.TextField(blank=True)
    manager_summary = models.TextField(blank=True)
    strengths = models.TextField(blank=True)
    development_areas = models.TextField(blank=True)
    overall_rating = models.PositiveSmallIntegerField(null=True, blank=True)
    # Snapshotted at submit time (decision P4)
    competence_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    kpi_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    wellbeing_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "performance_reviews")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_review_org_id"),
            models.UniqueConstraint(fields=["org", "cycle", "member"], name="uq_pms_review_cycle_member"),
            models.CheckConstraint(
                condition=Q(overall_rating__isnull=True)
                | (Q(overall_rating__gte=1) & Q(overall_rating__lte=5)),
                name="ck_pms_review_rating_1_5",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "member", "-id"], name="ix_pms_review_org_member"),
            models.Index(fields=["org", "cycle", "status"], name="ix_pms_review_cycle_status"),
        ]


class ReviewObjective(TenantModel):
    """A SMART objective on a review. `member` denormalised for manager_of_unit RLS."""

    class Priority(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        MET = "met", "Met"
        MISSED = "missed", "Missed"
        CARRIED = "carried", "Carried forward"

    review = models.ForeignKey(PerformanceReview, on_delete=models.CASCADE, related_name="objectives")
    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="review_objectives")
    title = models.CharField(max_length=200)
    measure = models.CharField(max_length=300, blank=True)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.MEDIUM)
    progress_pct = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "review_objectives")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_revobj_org_id"),
            models.CheckConstraint(condition=Q(progress_pct__lte=100), name="ck_pms_revobj_progress_0_100"),
        ]
        indexes = [
            models.Index(fields=["review", "sort_order"], name="ix_pms_revobj_review_sort"),
            models.Index(fields=["org", "member"], name="ix_pms_revobj_org_member"),
        ]


class ReviewAnalysis(TenantModel):
    """Claude-generated analysis of one review. `member` denormalised for RLS."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        OK = "ok", "Completed"
        FAILED = "failed", "Failed"

    review = models.OneToOneField(PerformanceReview, on_delete=models.CASCADE, related_name="analysis")
    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="review_analyses")
    model_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    summary = models.TextField(blank=True)
    strengths = models.JSONField(default=list, blank=True)
    development = models.JSONField(default=list, blank=True)
    suggested_actions = models.JSONField(default=list, blank=True)
    input_context = models.JSONField(default=dict, blank=True)
    error = models.CharField(max_length=500, blank=True)
    generated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    generated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "review_analyses")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_pms_analysis_org_id"),
        ]
        indexes = [
            models.Index(fields=["org", "member"], name="ix_pms_analysis_org_member"),
        ]
