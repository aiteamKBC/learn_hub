"""Idempotent local KPI showcase for the fictional Instalment Demo Company."""

import os
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.org.models import Organization, OrgMember
from apps.pms import services
from apps.pms.models import Kpi, KpiMeasurement, KpiProposal
from core.tenancy import tenant_context

SLUG = "instalment-demo-company"
MARK = "[WORKFORCE DEMO]"
OBJECTIVE = ("DEMO-SO1", "Improve safe service delivery")

# key, title, department, owner account, baseline, target, Q1..Q4 actuals,
# weight, direction, optional learning course
DEPARTMENTS = (
    (
        "safety",
        "On-time safety inspections",
        "Operations",
        "workforce.hod",
        76,
        92,
        (80, 82, 85, 88),
        25,
        True,
        "health-and-safety-at-work",
    ),
    (
        "first_time",
        "First-time job completion",
        "Operations",
        "workforce.manager",
        70,
        95,
        (77, 81, 87, 93),
        25,
        True,
        "project-management-essentials",
    ),
    (
        "incidents",
        "Safety incidents per 100 jobs",
        "Operations",
        "workforce.hod",
        8,
        2,
        (7, 6, 5, 4),
        25,
        False,
        "fire-safety-awareness",
    ),
    (
        "handover",
        "Customer handover satisfaction",
        "Operations",
        "workforce.manager",
        65,
        90,
        (71, 77, 82, 86),
        25,
        True,
        "",
    ),
    (
        "training",
        "Mandatory training completion",
        "People & Culture",
        "workforce.hr",
        65,
        95,
        (72, 80, 87, 92),
        30,
        True,
        "health-and-safety-at-work",
    ),
    (
        "onboarding",
        "30-day onboarding completion",
        "People & Culture",
        "workforce.hr",
        60,
        90,
        (66, 72, 79, 84),
        25,
        True,
        "gdpr-essentials",
    ),
    (
        "cpd",
        "Average CPD hours completed",
        "People & Culture",
        "workforce.hr",
        8,
        24,
        (10, 12, 15, 18),
        25,
        True,
        "project-management-essentials",
    ),
    (
        "retention",
        "Employee retention rate",
        "People & Culture",
        "workforce.hr",
        75,
        90,
        (78, 82, 85, 88),
        20,
        True,
        "",
    ),
)

# key, title, parent key, assignee, baseline, target, Q1..Q4 actuals, weight
INDIVIDUALS = (
    (
        "liam_safety",
        "Complete assigned safety inspections on time",
        "safety",
        "workforce.learner",
        70,
        95,
        (75, 80, 86, 91),
        40,
    ),
    (
        "liam_quality",
        "Close jobs right first time",
        "first_time",
        "workforce.learner",
        68,
        92,
        (73, 79, 84, 89),
        35,
    ),
    (
        "liam_handover",
        "Collect positive customer handovers",
        "handover",
        "workforce.learner",
        65,
        90,
        (70, 75, 80, 84),
        25,
    ),
    (
        "maya_safety",
        "Coach team on timely safety checks",
        "safety",
        "workforce.manager",
        72,
        95,
        (76, 82, 87, 92),
        40,
    ),
    (
        "maya_quality",
        "Improve team first-time completion",
        "first_time",
        "workforce.manager",
        70,
        95,
        (76, 82, 88, 93),
        35,
    ),
    (
        "maya_handover",
        "Review customer handover feedback",
        "handover",
        "workforce.manager",
        65,
        90,
        (69, 74, 80, 85),
        25,
    ),
    (
        "samira_training",
        "Close mandatory training gaps",
        "training",
        "workforce.hr",
        65,
        95,
        (72, 79, 86, 92),
        50,
    ),
    (
        "samira_onboarding",
        "Complete new starter onboarding",
        "onboarding",
        "workforce.hr",
        60,
        90,
        (67, 74, 80, 85),
        50,
    ),
)


class Command(BaseCommand):
    help = "Seed linked department and individual KPIs for the local Instalment Demo Company."

    def handle(self, *args, **options):
        if not settings.DEBUG or os.getenv("DJANGO_SETTINGS_MODULE") == "config.settings.prod":
            raise CommandError("This fictional KPI seed is restricted to development.")
        with transaction.atomic(), tenant_context(staff=True):
            org = Organization.objects.get(slug=SLUG)
            members = {
                m.user.email.split("@")[0]: m
                for m in OrgMember.objects.filter(org=org, removed_at__isnull=True).select_related("user")
            }
            required = {row[3] for row in DEPARTMENTS} | {row[3] for row in INDIVIDUALS}
            required |= {"workforce.hod", "workforce.hr", "workforce.executive"}
            if required - members.keys():
                raise CommandError(f"Seed workforce accounts first: {sorted(required - members.keys())}")
            owner = members["instalment.owner"]
            with tenant_context(
                org_id=org.id, user_id=owner.user_id, member_id=owner.id, org_role=owner.role
            ):
                parents = {}
                courses = {row[0]: row[-1] for row in DEPARTMENTS}
                for key, title, dept, who, baseline, target, actuals, weight, higher, course in DEPARTMENTS:
                    parents[key] = self._upsert(
                        org,
                        members,
                        title=title,
                        dept=dept,
                        who=who,
                        baseline=baseline,
                        target=target,
                        actuals=actuals,
                        weight=weight,
                        higher=higher,
                        course=course,
                        scope=Kpi.Scope.DEPARTMENT,
                    )
                for _key, title, parent_key, who, baseline, target, actuals, weight in INDIVIDUALS:
                    parent = parents[parent_key]
                    self._upsert(
                        org,
                        members,
                        title=title,
                        dept=parent.dept,
                        who=who,
                        baseline=baseline,
                        target=target,
                        actuals=actuals,
                        weight=weight,
                        higher=True,
                        course=courses[parent_key],
                        scope=Kpi.Scope.INDIVIDUAL,
                        parent=parent,
                    )
        self.stdout.write(
            self.style.SUCCESS(
                f"Ready: {len(DEPARTMENTS)} department and {len(INDIVIDUALS)} individual KPIs in {org.name}."
            )
        )

    def _upsert(
        self,
        org,
        members,
        *,
        title,
        dept,
        who,
        baseline,
        target,
        actuals,
        weight,
        higher,
        course,
        scope,
        parent=None,
    ):
        name = f"{MARK} {title}"
        proposal = KpiProposal.objects.filter(org=org, name=name).first()
        assignee = members[who]
        source = f"/courses/{course}" if course else "Demo operational records"
        if proposal is None:
            proposal = services.create_proposal(
                org_id=org.id,
                by_user_id=members["workforce.hod"].user_id,
                data={
                    "name": name,
                    "scope": scope,
                    "parent_kpi_id": parent.id if parent else None,
                    "dept": dept,
                    "owner_id": assignee.id,
                    "objective_code": OBJECTIVE[0],
                    "objective_title": OBJECTIVE[1],
                    "definition": f"Fictional demo measure for {dept.lower()}; quarterly actuals are illustrative.",
                    "unit": "%"
                    if "hours" not in title and "incidents" not in title
                    else ("hours" if "hours" in title else "per 100 jobs"),
                    "baseline": Decimal(baseline),
                    "target": Decimal(target),
                    "higher_better": higher,
                    "cadence": "quarterly",
                    "weight": weight,
                    "period": "2026",
                    "source": source,
                },
            )
        elif proposal.source != source:
            proposal.source = source
            proposal.save(update_fields=["source", "updated_at"])
        # Bring the older single-KPI demo onto the same board without deleting its history.
        if proposal.stage == KpiProposal.Stage.ACTIVE and proposal.active_kpi_id:
            kpi = proposal.active_kpi
            if kpi.objective_code != OBJECTIVE[0]:
                proposal.objective_code, proposal.objective_title = OBJECTIVE
                proposal.source = source
                proposal.save(update_fields=["objective_code", "objective_title", "source", "updated_at"])
                kpi.objective_code, kpi.objective_title = OBJECTIVE
                kpi.save(update_fields=["objective_code", "objective_title", "updated_at"])
        else:
            if proposal.stage == KpiProposal.Stage.DRAFT:
                proposal = services.submit_proposal(
                    proposal=proposal, by_user_id=members["workforce.hod"].user_id, comment=MARK
                )
            for stage, reviewer in (
                (KpiProposal.Stage.HOD_REVIEW, "workforce.hod"),
                (KpiProposal.Stage.HR_ALIGNMENT, "workforce.hr"),
                (KpiProposal.Stage.EXEC_APPROVAL, "workforce.executive"),
            ):
                if proposal.stage == stage:
                    proposal = services.advance_proposal(
                        proposal=proposal, by_user_id=members[reviewer].user_id, comment=MARK
                    )
            if proposal.stage != KpiProposal.Stage.ACTIVE or not proposal.active_kpi_id:
                raise CommandError(f"Cannot activate {name} from {proposal.stage}.")
            kpi = proposal.active_kpi
        if kpi.cadence == Kpi.Cadence.QUARTERLY:
            periods = ((2026, index, value) for index, value in enumerate(actuals, 1))
        else:
            periods = ((2026, month, value) for month, value in zip((8, 9, 10, 11), actuals, strict=True))
        for year, index, value in periods:
            KpiMeasurement.objects.get_or_create(
                org=org,
                kpi=kpi,
                period_year=year,
                period_index=index,
                defaults={
                    "value": Decimal(value),
                    "recorded_at": timezone.now(),
                    "recorded_by": members["workforce.hod"].user,
                    "note": MARK,
                },
            )
        return kpi
