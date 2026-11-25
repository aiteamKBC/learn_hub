"""HCM (Human Capital Management): per-member HR records that sit alongside the
compliance training data already on `org.OrgMember`.

Postgres schema: hcm. Every table is COMPANY-ONLY (`core.rls.company_only`) except
`WellbeingSurvey`, which carries personal responses and uses
`core.rls.manager_of_unit`: the owning member and their line of managers see the
raw rows; peers do not. Every link inside this schema is a composite FK
`(org_id, x_id) → (org_id, id)` so one company's profile can never point at
another company's people.

    MemberProfile     one row per OrgMember: track, level, aspiration, location,
                      start/termination dates, line_manager, stay/satisfaction
                      scalars, workplace adjustments, cached CPD rollup
    Qualification     company catalogue of qualifications (NVQ, SMSTS, SSSTS...)
    MemberQualification  one row per (member, qualification) awarded, with evidence
    MemberQuarter     one row per (member, year, quarter): hours worked, wellbeing
                      and KPI/competence rollups filled by later milestones
    WellbeingSurvey   point-in-time PsyCap + overall + stay/satisfaction response
    CpdEntry          per-member CPD log: onboarding / internal course / external
    MemberActivity    minutes-on-activity sessions (separate from the sub-lecture
                      video heartbeats in `learning.ProgressEvent`)

All times are UTC. Percentages are 0..100 integers. `level` is 1..4 (apprentice
through director), matching the EvidRise ladder convention. Quarters are 1..4.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField  # noqa: F401 - reserved for future fields
from django.db import models
from django.db.models import F, Q

from core.db import table
from core.models import TenantModel

SCHEMA = "hcm"
User = settings.AUTH_USER_MODEL


class MemberProfile(TenantModel):
    """HR extension of `org.OrgMember`. One row per member; created by backfill
    for every existing member and by signal when a new member is added."""

    member = models.OneToOneField("org.OrgMember", on_delete=models.CASCADE, related_name="profile")
    # EvidRise `track` — the department discipline label (free-text per company)
    track = models.CharField(max_length=80, blank=True)
    # Career ladder 1..4 (apprentice, practitioner, lead, director)
    level = models.PositiveSmallIntegerField(null=True, blank=True)
    # One-line career goal the member sets
    aspiration = models.CharField(max_length=300, blank=True)
    # Primary work site label
    location = models.CharField(max_length=160, blank=True)
    start_date = models.DateField(null=True, blank=True)
    termination_date = models.DateField(null=True, blank=True)
    line_manager = models.ForeignKey(
        "org.OrgMember",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_reports",
    )
    # Latest-value scalars (historical series lives on MemberQuarter / WellbeingSurvey)
    stay_intent = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    satisfaction = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    # Free-text workplace adjustments (accessibility, scheduling). See client-questions #29.
    adjustments = models.TextField(blank=True, max_length=2000)
    # Denormalised rollup of CpdEntry.hours; refreshed by hcm.refresh_cpd_cache
    cpd_hours_cached = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    cpd_cached_at = models.DateTimeField(null=True, blank=True)
    # Denormalised {competency_id: evidenced_level} map, refreshed nightly by
    # frameworks.recompute_evidenced (M18). Empty until the member has evidence.
    evidenced_cached = models.JSONField(default=dict, blank=True)
    evidenced_cached_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "member_profiles")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_profile_org_id"),
            models.UniqueConstraint(fields=["org", "member"], name="uq_profile_org_member"),
            models.CheckConstraint(
                condition=Q(level__isnull=True) | (Q(level__gte=1) & Q(level__lte=4)),
                name="ck_profile_level_1_4",
            ),
            models.CheckConstraint(
                condition=Q(line_manager__isnull=True) | ~Q(line_manager=F("member")),
                name="ck_profile_no_self_manager",
            ),
            models.CheckConstraint(
                condition=Q(stay_intent__isnull=True) | (Q(stay_intent__gte=0) & Q(stay_intent__lte=1)),
                name="ck_profile_stay_intent_0_1",
            ),
            models.CheckConstraint(
                condition=Q(satisfaction__isnull=True) | (Q(satisfaction__gte=0) & Q(satisfaction__lte=1)),
                name="ck_profile_satisfaction_0_1",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "line_manager"], name="ix_profile_org_manager"),
            models.Index(fields=["org", "level"], name="ix_profile_org_level"),
        ]

    def __str__(self) -> str:
        return f"Profile<{self.member_id}>"


class Qualification(TenantModel):
    """Per-company catalogue of qualifications (NVQ Level 3, SMSTS, SSSTS...). Members
    are awarded qualifications via `MemberQualification`."""

    name = models.CharField(max_length=160)
    code = models.CharField(max_length=32, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "qualifications")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_qual_org_id"),
            models.UniqueConstraint(
                fields=["org", "name"],
                condition=Q(archived_at__isnull=True),
                name="uq_qual_name",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "archived_at"], name="ix_qual_org_archived"),
        ]

    def __str__(self) -> str:
        return self.name


class MemberQualification(TenantModel):
    """A qualification awarded to a specific member, with optional evidence."""

    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="qualifications")
    qualification = models.ForeignKey(Qualification, on_delete=models.PROTECT, related_name="members")
    awarded_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    evidence_asset = models.ForeignKey(
        "catalog.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = table(SCHEMA, "member_qualifications")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_mq_org_id"),
            models.UniqueConstraint(fields=["org", "member", "qualification"], name="uq_mq_member_qual"),
            models.CheckConstraint(
                condition=Q(expires_on__isnull=True)
                | Q(awarded_on__isnull=True)
                | Q(expires_on__gte=F("awarded_on")),
                name="ck_mq_expiry_after_award",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "member"], name="ix_mq_org_member"),
            models.Index(fields=["org", "qualification"], name="ix_mq_org_qual"),
        ]


class MemberQuarter(TenantModel):
    """Per-member quarterly rollup. One row per (member, year, quarter). Created by
    `hcm.create_next_quarter` on quarter boundaries and recomputed nightly by
    `hcm.rollup_quarter`. `kpi_score` and `competence_score` stay NULL until later
    milestones (frameworks, PMS) fill them."""

    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="quarters")
    year = models.PositiveSmallIntegerField()
    quarter = models.PositiveSmallIntegerField()
    hours_worked = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    wellbeing_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    kpi_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    competence_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "member_quarters")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_quarter_org_id"),
            models.UniqueConstraint(
                fields=["org", "member", "year", "quarter"], name="uq_quarter_member_period"
            ),
            models.CheckConstraint(
                condition=Q(quarter__gte=1) & Q(quarter__lte=4),
                name="ck_quarter_1_4",
            ),
            models.CheckConstraint(
                condition=Q(wellbeing_score__isnull=True)
                | (Q(wellbeing_score__gte=0) & Q(wellbeing_score__lte=100)),
                name="ck_quarter_wellbeing_0_100",
            ),
            models.CheckConstraint(
                condition=Q(kpi_score__isnull=True) | (Q(kpi_score__gte=0) & Q(kpi_score__lte=100)),
                name="ck_quarter_kpi_0_100",
            ),
            models.CheckConstraint(
                condition=Q(competence_score__isnull=True)
                | (Q(competence_score__gte=0) & Q(competence_score__lte=100)),
                name="ck_quarter_comp_0_100",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "member", "-year", "-quarter"], name="ix_quarter_member_period"),
            models.Index(fields=["org", "year", "quarter"], name="ix_quarter_org_period"),
        ]


class WellbeingSurvey(TenantModel):
    """Point-in-time wellbeing survey response. PsyCap sub-scales follow the
    EvidRise 0..100 scale (see client-questions #23); a form that uses 1..5 Likert
    items converts at submit time. Raw rows are RLS-scoped by
    `manager_of_unit`: only the member and their managers see rows directly;
    peers and non-manager colleagues never do."""

    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="wellbeing_surveys")
    submitted_at = models.DateTimeField()
    hope = models.PositiveSmallIntegerField()
    efficacy = models.PositiveSmallIntegerField()
    resilience = models.PositiveSmallIntegerField()
    optimism = models.PositiveSmallIntegerField()
    overall = models.PositiveSmallIntegerField()
    stay_intent = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    satisfaction = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    note = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = table(SCHEMA, "wellbeing_surveys")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_wb_org_id"),
            models.CheckConstraint(
                condition=(
                    Q(hope__lte=100)
                    & Q(efficacy__lte=100)
                    & Q(resilience__lte=100)
                    & Q(optimism__lte=100)
                    & Q(overall__lte=100)
                ),
                name="ck_wb_percentages",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "member", "-submitted_at"], name="ix_wb_org_member_at"),
        ]


class CpdEntry(TenantModel):
    """Continuing Professional Development log. An entry can be auto-created from
    a `learning.Certificate` completion, authored by the member for external
    learning, or recorded by HR from an onboarding pathway. Dashboards count
    verified and unverified hours separately (see client-questions #26)."""

    class Kind(models.TextChoices):
        ONBOARDING = "onboarding", "Onboarding pathway"
        COURSE = "course", "Internal course"
        EXTERNAL = "external", "External learning"

    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="cpd_entries")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    title = models.CharField(max_length=200)
    provider = models.CharField(max_length=160, blank=True)
    completed_on = models.DateField()
    hours = models.DecimalField(max_digits=5, decimal_places=2)
    certificate = models.ForeignKey(
        "learning.Certificate", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    evidence_asset = models.ForeignKey(
        "catalog.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    verified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "cpd_entries")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_cpd_org_id"),
            models.CheckConstraint(condition=Q(hours__gt=0), name="ck_cpd_hours_positive"),
        ]
        indexes = [
            models.Index(fields=["org", "member", "-completed_on"], name="ix_cpd_org_member"),
            models.Index(
                fields=["org", "member"],
                name="ix_cpd_unverified",
                condition=Q(verified_at__isnull=True),
            ),
        ]


class TrainingPlan(TenantModel):
    """A member's development plan and its review period, separate from compliance."""

    member = models.OneToOneField("org.OrgMember", on_delete=models.CASCADE, related_name="training_plan")
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="owned_training_plans"
    )
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "training_plans")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_training_plan_org_id"),
            models.UniqueConstraint(fields=["org", "member"], name="uq_training_plan_member"),
            models.CheckConstraint(
                condition=Q(period_start__isnull=True)
                | Q(period_end__isnull=True)
                | Q(period_end__gte=F("period_start")),
                name="ck_training_plan_period",
            ),
        ]


class TrainingPlanItem(TenantModel):
    """An optional or external development item; required compliance stays in compliance.MemberStatus."""

    class Kind(models.TextChoices):
        COURSE = "course", "Course"
        EXTERNAL = "external", "External learning"

    class Purpose(models.TextChoices):
        CORRECTIVE = "corrective", "Corrective"
        PREVENTIVE = "preventive", "Preventive"
        SELF_DIRECTED = "self_directed", "Self-directed"

    class Source(models.TextChoices):
        MANAGER = "manager", "Manager assigned"
        CAREER_PATH = "career_path", "Career pathway"
        COMPETENCY_GAP = "competency_gap", "Competency gap"
        EXTERNAL = "external", "External learning"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    plan = models.ForeignKey(TrainingPlan, on_delete=models.CASCADE, related_name="items")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    course = models.ForeignKey(
        "catalog.Course", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    title = models.CharField(max_length=200)
    provider = models.CharField(max_length=160, blank=True)
    external_url = models.URLField(blank=True)
    purpose = models.CharField(max_length=16, choices=Purpose.choices, default=Purpose.SELF_DIRECTED)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANAGER)
    source_detail = models.CharField(max_length=300, blank=True)
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="owned_training_items"
    )
    assigned_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="assigned_training_plan_items"
    )
    assigned_at = models.DateTimeField()
    due_at = models.DateField(null=True, blank=True)
    estimated_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    completed_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    completed_on = models.DateField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "training_plan_items")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_training_item_org_id"),
            models.UniqueConstraint(
                fields=["plan", "course"], condition=Q(course__isnull=False), name="uq_training_item_course"
            ),
            models.CheckConstraint(
                condition=(Q(kind="course", course__isnull=False) | Q(kind="external", course__isnull=True)),
                name="ck_training_item_kind_course",
            ),
            models.CheckConstraint(
                condition=Q(estimated_hours__isnull=True) | Q(estimated_hours__gt=0),
                name="ck_training_item_hours",
            ),
            models.CheckConstraint(
                condition=Q(completed_hours__isnull=True) | Q(completed_hours__gt=0),
                name="ck_training_item_completed_hours",
            ),
        ]
        indexes = [models.Index(fields=["org", "plan", "status", "due_at"], name="ix_training_item_plan")]


class MemberActivity(TenantModel):
    """Minutes-on-activity session: 'this member spent 24m on this lecture at 10:00
    today'. Separate from `learning.ProgressEvent` (sub-lecture video heartbeats)
    because the lifecycle is different: heartbeats are high-volume and purged;
    activity rows are kept for CPD and dashboards and are the unit shown in
    `/activity-log` style surfaces."""

    class Category(models.TextChoices):
        READING = "reading", "Reading"
        MEDIA = "media", "Media"
        REFLECTION = "reflection", "Reflection"
        QUIZ = "quiz", "Quiz"

    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="activities")
    course = models.ForeignKey(
        "catalog.Course", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    lecture = models.ForeignKey(
        "catalog.Lecture", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    category = models.CharField(max_length=16, choices=Category.choices)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    seconds = models.PositiveIntegerField()
    mode = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = table(SCHEMA, "member_activities")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_act_org_id"),
            models.CheckConstraint(condition=Q(ended_at__gte=F("started_at")), name="ck_act_time_order"),
            models.CheckConstraint(condition=Q(seconds__gt=0), name="ck_act_seconds_positive"),
        ]
        indexes = [
            models.Index(fields=["org", "member", "-started_at"], name="ix_act_member_time"),
            models.Index(fields=["org", "course", "-started_at"], name="ix_act_course_time"),
        ]
