"""Governance: company strategy, policy documents (with allocation + adoption) and
the technical question bank.

Postgres schema: governance. Most tables are company_only. `PolicyRecord` holds a
member's personal adoption trail (read / acknowledge / check / observations), so it
uses `core.rls.manager_of_unit` on `member` — the member and their line of managers
+ HR admins see rows, peers do not.

    Strategy / StrategyVersion / StrategyObjective
        A versioned company strategy (vision, mission, values, objectives). KPIs
        reference objectives by code (`pms.Kpi.objective_code`).

    PolicyDoc / PolicyVersion / PolicyAllocation / PolicyRecord
        Policies and SOPs, who they are allocated to, and each member's adoption.

    TechQuestion
        KSB-linked question bank: multiple-choice items and interview rubrics.

All times are UTC. Levels are 1..5. Admins author and edit everything here.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import TenantModel

SCHEMA = "governance"
User = settings.AUTH_USER_MODEL


# ================================================================ strategy
class Strategy(TenantModel):
    """A company strategy shell; the content lives on versions."""

    name = models.CharField(max_length=160)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "strategies")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_strategy_org_id"),
        ]
        indexes = [models.Index(fields=["org", "archived_at"], name="ix_gov_strategy_org")]

    def __str__(self) -> str:
        return self.name


class StrategyVersion(TenantModel):
    """One version of a strategy, with a draft → approved → superseded lifecycle."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        SUPERSEDED = "superseded", "Superseded"

    strategy = models.ForeignKey(Strategy, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    vision = models.TextField(blank=True)
    mission = models.TextField(blank=True)
    values = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    note = models.CharField(max_length=500, blank=True)
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "strategy_versions")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_sv_org_id"),
            models.UniqueConstraint(fields=["strategy", "number"], name="uq_gov_sv_strategy_number"),
        ]
        indexes = [models.Index(fields=["org", "status"], name="ix_gov_sv_org_status")]


class StrategyObjective(TenantModel):
    """A strategic objective (SO1…) on a strategy version."""

    class Priority(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    version = models.ForeignKey(StrategyVersion, on_delete=models.CASCADE, related_name="objectives")
    code = models.CharField(max_length=16)
    title = models.CharField(max_length=200)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.MEDIUM)
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="strategy_objectives"
    )
    period = models.CharField(max_length=40, blank=True)
    measure = models.CharField(max_length=400, blank=True)
    description = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "strategy_objectives")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_so_org_id"),
        ]
        indexes = [models.Index(fields=["version", "sort_order"], name="ix_gov_so_version_sort")]


# ================================================================ policies
class PolicyDoc(TenantModel):
    """A policy or SOP shell. Versions carry the body; one is current/approved."""

    class DocType(models.TextChoices):
        POLICY = "policy", "Policy"
        SOP = "sop", "SOP"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"

    code = models.CharField(max_length=32)
    title = models.CharField(max_length=200)
    doc_type = models.CharField(max_length=8, choices=DocType.choices, default=DocType.POLICY)
    category = models.CharField(max_length=80, blank=True)
    owner = models.ForeignKey(
        "org.OrgMember", on_delete=models.PROTECT, null=True, blank=True, related_name="owned_policies"
    )
    objective_code = models.CharField(max_length=16, blank=True)
    summary = models.TextField(blank=True)
    current_version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.DRAFT)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "policy_docs")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_poldoc_org_id"),
            models.UniqueConstraint(fields=["org", "code"], name="uq_gov_poldoc_org_code"),
        ]
        indexes = [
            models.Index(fields=["org", "doc_type", "category"], name="ix_gov_poldoc_org_type"),
            models.Index(fields=["org", "archived_at"], name="ix_gov_poldoc_org_arch"),
        ]

    def __str__(self) -> str:
        return f"{self.code} — {self.title}"


class PolicyVersion(TenantModel):
    """One version of a policy/SOP: body sections and an understanding check."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        SUPERSEDED = "superseded", "Superseded"

    doc = models.ForeignKey(PolicyDoc, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    effective_date = models.DateField(null=True, blank=True)
    review_date = models.DateField(null=True, blank=True)
    summary = models.TextField(blank=True)
    # sections: [["Heading", ["line", "line"]], ...]
    sections = models.JSONField(default=list, blank=True)
    # understanding_check: {"q": "...", "options": ["..."], "answer": 1}
    understanding_check = models.JSONField(default=dict, blank=True)
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "policy_versions")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_pv_org_id"),
            models.UniqueConstraint(fields=["doc", "number"], name="uq_gov_pv_doc_number"),
        ]
        indexes = [models.Index(fields=["doc", "-number"], name="ix_gov_pv_doc_number")]


class PolicyAllocation(TenantModel):
    """Who must read a policy: a single rule per document."""

    class Scope(models.TextChoices):
        ORG = "org", "Whole organisation"
        DEPTS = "depts", "Selected departments"

    doc = models.OneToOneField(PolicyDoc, on_delete=models.CASCADE, related_name="allocation")
    scope = models.CharField(max_length=8, choices=Scope.choices, default=Scope.ORG)
    depts = ArrayField(models.CharField(max_length=80), default=list, blank=True)
    titles = ArrayField(models.CharField(max_length=120), default=list, blank=True)
    sites = ArrayField(models.CharField(max_length=120), default=list, blank=True)
    worker_types = ArrayField(models.CharField(max_length=40), default=list, blank=True)
    persons = ArrayField(models.UUIDField(), default=list, blank=True)
    require_reack = models.BooleanField(default=True)
    published_version = models.PositiveIntegerField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "policy_allocations")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_alloc_org_id"),
        ]


class PolicyRecord(TenantModel):
    """One member's adoption trail for a policy. RLS: manager_of_unit on `member`."""

    doc = models.ForeignKey(PolicyDoc, on_delete=models.CASCADE, related_name="records")
    member = models.ForeignKey("org.OrgMember", on_delete=models.CASCADE, related_name="policy_records")
    version = models.PositiveIntegerField(default=1)
    read_at = models.DateTimeField(null=True, blank=True)
    ack_at = models.DateTimeField(null=True, blank=True)
    check_at = models.DateTimeField(null=True, blank=True)
    check_score = models.PositiveSmallIntegerField(null=True, blank=True)
    # observations: [{"at": "YYYY-MM-DD", "by": "...", "note": "..."}]
    observations = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = table(SCHEMA, "policy_records")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_polrec_org_id"),
            models.UniqueConstraint(fields=["doc", "member"], name="uq_gov_polrec_doc_member"),
            models.CheckConstraint(
                condition=Q(check_score__isnull=True) | (Q(check_score__gte=0) & Q(check_score__lte=100)),
                name="ck_gov_polrec_score_0_100",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "doc"], name="ix_gov_polrec_org_doc"),
            models.Index(fields=["org", "member"], name="ix_gov_polrec_org_member"),
        ]


# ================================================================ question bank
class TechQuestion(TenantModel):
    """A technical question: a multiple-choice item or an interview rubric, linked to
    a competency (KSB)."""

    class QType(models.TextChoices):
        MCQ = "mcq", "Multiple choice"
        RUBRIC = "rubric", "Interview rubric"

    competency = models.ForeignKey(
        "frameworks.Competency", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    dept = models.CharField(max_length=80, blank=True)
    q_type = models.CharField(max_length=8, choices=QType.choices, default=QType.MCQ)
    prompt = models.TextField()
    # options: ["...", "..."] (MCQ only)
    options = models.JSONField(default=list, blank=True)
    answer_index = models.PositiveSmallIntegerField(null=True, blank=True)
    expected = models.TextField(blank=True)  # rubric: what a good answer shows
    rationale = models.CharField(max_length=500, blank=True)
    mark = models.PositiveSmallIntegerField(default=1)
    level = models.PositiveSmallIntegerField(default=2)
    course_ref = models.CharField(max_length=40, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "tech_questions")
        constraints = [
            models.UniqueConstraint(fields=["org", "id"], name="uq_gov_tq_org_id"),
            models.CheckConstraint(condition=Q(level__gte=1) & Q(level__lte=5), name="ck_gov_tq_level_1_5"),
        ]
        indexes = [
            models.Index(fields=["org", "dept", "q_type"], name="ix_gov_tq_org_dept"),
            models.Index(fields=["org", "competency"], name="ix_gov_tq_org_comp"),
        ]
