"""Competency catalogue (hybrid platform/org) and content tagging.

Platform rows have owner_org=NULL and are readable by all orgs via `scoped_content`
RLS. Org-local rows (owner_org set) are readable/writable only by that org. An org
can clone a platform row to get an editable local copy while keeping a reference to
the source via `cloned_from`.

KSBs attach to Course, Lecture, QuizQuestion (via join tables below). Assignment
rubric criterion KSBs live in the rubric JSON on the Assignment model (see services).
"""

from decimal import Decimal

from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel

SCHEMA = "frameworks"


class Competency(BaseModel):
    """Knowledge, Skill, Behaviour or Professional-identity item.

    Platform library row: owner_org=NULL, readable by all.
    Org-local row: owner_org=<org>, only that org can read/write.
    """

    class Kind(models.TextChoices):
        KNOWLEDGE = "K", "Knowledge"
        SKILL = "S", "Skill"
        BEHAVIOUR = "B", "Behaviour"
        PROFESSIONAL = "P", "Professional identity"

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    code = models.CharField(max_length=16)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=1, choices=Kind.choices)
    sort_order = models.PositiveIntegerField(default=0)
    cloned_from = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="clones",
    )
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "competencies")
        constraints = [
            models.UniqueConstraint(
                fields=["owner_org", "code"],
                name="uq_competency_org_code",
            ),
        ]
        indexes = [
            models.Index(fields=["owner_org", "kind"], name="ix_competency_org_kind"),
            models.Index(fields=["owner_org", "sort_order"], name="ix_competency_org_sort"),
        ]

    def __str__(self) -> str:
        return f"{self.code} — {self.name}"


class CourseCompetency(BaseModel):
    """Tags a course with the competency it develops and its target proficiency."""

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="competencies")
    competency = models.ForeignKey(Competency, on_delete=models.PROTECT, related_name="course_tags")
    target_level = models.PositiveSmallIntegerField(default=3)
    weight = models.PositiveSmallIntegerField(default=5)

    class Meta:
        db_table = table(SCHEMA, "course_competencies")
        constraints = [
            models.UniqueConstraint(fields=["course", "competency"], name="uq_cc_course_competency"),
            models.CheckConstraint(
                condition=Q(target_level__gte=1) & Q(target_level__lte=5),
                name="ck_cc_target_level_1_5",
            ),
            models.CheckConstraint(
                condition=Q(weight__gte=1) & Q(weight__lte=10),
                name="ck_cc_weight_1_10",
            ),
        ]
        indexes = [
            models.Index(fields=["competency", "course"], name="ix_cc_competency_course"),
            models.Index(fields=["owner_org", "course"], name="ix_cc_owner_course"),
        ]


class LectureCompetency(BaseModel):
    """Tags a lecture with a competency it contributes evidence for."""

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    lecture = models.ForeignKey("catalog.Lecture", on_delete=models.CASCADE, related_name="competencies")
    competency = models.ForeignKey(Competency, on_delete=models.PROTECT, related_name="lecture_tags")

    class Meta:
        db_table = table(SCHEMA, "lecture_competencies")
        constraints = [
            models.UniqueConstraint(fields=["lecture", "competency"], name="uq_lc_lecture_competency"),
        ]
        indexes = [
            models.Index(fields=["owner_org", "lecture"], name="ix_lc_owner_lecture"),
        ]


class QuizQuestionCompetency(BaseModel):
    """Tags a quiz question with a competency and the fraction of its marks that
    count as evidence for that competency."""

    owner_org = models.ForeignKey(
        "org.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        db_index=False,
    )
    question = models.ForeignKey(
        "catalog.QuizQuestion", on_delete=models.CASCADE, related_name="competencies"
    )
    competency = models.ForeignKey(Competency, on_delete=models.PROTECT, related_name="question_tags")
    weight = models.DecimalField(max_digits=4, decimal_places=3, default=Decimal("1.000"))

    class Meta:
        db_table = table(SCHEMA, "quiz_question_competencies")
        constraints = [
            models.UniqueConstraint(fields=["question", "competency"], name="uq_qqc_question_competency"),
            models.CheckConstraint(
                condition=Q(weight__gte=0) & Q(weight__lte=1),
                name="ck_qqc_weight_0_1",
            ),
        ]
        indexes = [
            models.Index(fields=["owner_org", "question"], name="ix_qqc_owner_question"),
        ]
