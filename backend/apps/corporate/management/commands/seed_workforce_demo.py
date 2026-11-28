"""Add repeatable fictional workforce data for local UI and service demos.

This command only adds records to the dedicated `learnhub-workforce-demo` company.
It refuses to run when Django DEBUG is disabled and never truncates existing data.
New login accounts use the supplied password (default: Demo1234!).
"""

import os
from datetime import timedelta
from decimal import Decimal

from allauth.account.models import EmailAddress
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.frameworks import services as framework_services
from apps.frameworks.models import RoleFramework
from apps.frameworks.models.competency import Competency
from apps.governance import services as governance_services
from apps.governance.models import PolicyAllocation, PolicyDoc, Strategy, TechQuestion
from apps.hcm import services as hcm_services
from apps.hcm.models import CpdEntry, MemberProfile, MemberQualification, Qualification, WellbeingSurvey
from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import JobRole, OrgMember, OrgRoleAssignment, OrgUnit
from apps.pms import services as pms_services
from apps.pms.models import KpiMeasurement, KpiProposal, PerformanceReview, ReviewCycle, ReviewObjective
from core.tenancy import tenant_context

SLUG = "learnhub-workforce-demo"
DOMAIN = "learnhub.example"
MARK = "[WORKFORCE DEMO]"

PEOPLE = (
    ("workforce.owner", "Alex Morgan", "owner", None),
    ("workforce.executive", "Jordan Ellis", "learner", "executive"),
    ("workforce.hr", "Samira Hassan", "learner", "hr_admin"),
    ("workforce.hod", "Omar Farouk", "learner", "department_head"),
    ("workforce.manager", "Maya Bennett", "learner", "line_manager"),
    ("workforce.learner", "Liam Parker", "learner", None),
)


class Command(BaseCommand):
    help = "Add a fictional workforce company, role accounts, HCM, KPI and governance demo data."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=os.getenv("DEMO_PASSWORD", "Demo1234!"))
        parser.add_argument(
            "--company",
            default=None,
            help="Seed into an existing company by slug (e.g. instalment-demo-company) instead of the dedicated workforce demo company. Its current owner is kept and acts as the owner.",
        )

    def handle(self, *args, password, company, **options):
        if not settings.DEBUG or os.getenv("DJANGO_SETTINGS_MODULE") == "config.settings.prod":
            raise CommandError("Workforce demo seeding is restricted to a DEBUG development environment.")
        if not password:
            raise CommandError("Provide --password or set DEMO_PASSWORD for the demo logins.")

        staff = User.objects.filter(is_staff=True, is_active=True).order_by("created_at").first()
        if staff is None:
            raise CommandError("Create a Platform Admin account before seeding workforce demo data.")

        with transaction.atomic(using="default"):
            target = self._existing_company(company) if company else None
            users = self._users(password, existing_owner=self._company_owner(target) if target else None)
            org = target or self._company(users["workforce.owner"])
            owner_user = users["workforce.owner"]
            with tenant_context(org_id=org.id, user_id=owner_user.id):
                units, roles = self._structure(org)
                members = self._members(org, users, units)
                owner_member = members["workforce.owner"]
                with tenant_context(
                    org_id=org.id,
                    user_id=owner_user.id,
                    member_id=owner_member.id,
                    org_role=owner_member.role,
                ):
                    self._responsibilities(org, members, units, owner_user)
                    self._hcm(org, members, users)
                    competency = self._frameworks(
                        org, roles["Facilities Supervisor"], units["Operations"], staff
                    )
                    self._performance(org, members, competency, users)
                    self._governance(org, members, users, competency)

        self.stdout.write(self.style.SUCCESS(f"Workforce demo is ready: {org.name} ({org.slug})."))
        self.stdout.write("Company: workforce.owner@learnhub.example")
        self.stdout.write("Executive: workforce.executive@learnhub.example")
        self.stdout.write("HR: workforce.hr@learnhub.example")
        self.stdout.write("Head of department: workforce.hod@learnhub.example")
        self.stdout.write("Line manager: workforce.manager@learnhub.example")
        self.stdout.write("Learner: workforce.learner@learnhub.example")
        self.stdout.write(f"Password for newly created accounts: {password}")

    def _users(self, password, existing_owner=None):
        users = {}
        for local, name, _membership_role, _responsibility in PEOPLE:
            # Seeding into an existing company keeps that company's real owner as the
            # owner identity; only the other role accounts are created.
            if local == "workforce.owner" and existing_owner is not None:
                users[local] = existing_owner
                continue
            email = f"{local}@{DOMAIN}"
            user, created = User.objects.get_or_create(email=email, defaults={"full_name": name})
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
            # These are fictional local demo accounts with a reserved example
            # domain. No confirmation email can reach them, while allauth
            # requires a verified address before password sign-in.
            EmailAddress.objects.update_or_create(
                user=user,
                email=email,
                defaults={"verified": True, "primary": True},
            )
            users[local] = user
        return users

    def _existing_company(self, slug):
        from apps.org.models import Organization

        with tenant_context(staff=True):
            org = Organization.objects.filter(slug=slug).first()
        if org is None:
            raise CommandError(
                f"No company with slug '{slug}' exists. Create it before seeding workforce data into it."
            )
        return org

    def _company_owner(self, org):
        with tenant_context(org_id=org.id, staff=True):
            member = (
                OrgMember.objects.filter(org=org, role=OrgMember.Role.OWNER, removed_at__isnull=True)
                .select_related("user")
                .order_by("joined_at")
                .first()
            )
        if member is None:
            raise CommandError(f"{org.name} has no active owner to act as. Seed or set its owner first.")
        return member.user

    def _company(self, owner):
        from apps.org.models import Organization

        with tenant_context(user_id=owner.id, staff=True):
            org = Organization.objects.filter(slug=SLUG).first()
        return org or org_services.create_organization(name="LearnHub Workforce Demo", slug=SLUG, owner=owner)

    def _structure(self, org):
        root = OrgUnit.objects.get(org=org, parent__isnull=True)
        departments = {}
        for name in ("Operations", "People & Culture"):
            departments[name] = OrgUnit.objects.filter(org=org, parent=root, name=name).first()
            if departments[name] is None:
                departments[name] = org_services.create_unit(
                    parent=root, kind=OrgUnit.Kind.DEPARTMENT, name=name
                )
        roles = {}
        for name in ("Facilities Supervisor", "People Partner", "Operations Executive"):
            roles[name], _ = JobRole.objects.get_or_create(org=org, name=name)
        return departments, roles

    def _members(self, org, users, units):
        members = {}
        for local, _name, membership_role, _responsibility in PEOPLE:
            user = users[local]
            with tenant_context(org_id=org.id, user_id=user.id):
                member, _ = OrgMember.objects.get_or_create(
                    org=org,
                    user=user,
                    defaults={
                        "role": membership_role,
                        "job_title": user.full_name,
                        "joined_at": timezone.now(),
                    },
                )
                if local != "workforce.owner":
                    unit = units["People & Culture"] if local == "workforce.hr" else units["Operations"]
                    org_services.add_member_to_unit(member=member, unit=unit, primary=True)
                members[local] = member
        return members

    def _responsibilities(self, org, members, units, assigned_by):
        wanted = (
            ("workforce.executive", OrgRoleAssignment.Code.EXECUTIVE, None),
            ("workforce.hr", OrgRoleAssignment.Code.HR_ADMIN, None),
            ("workforce.hod", OrgRoleAssignment.Code.DEPARTMENT_HEAD, units["Operations"]),
            ("workforce.manager", OrgRoleAssignment.Code.LINE_MANAGER, units["Operations"]),
        )
        for local, code, unit in wanted:
            OrgRoleAssignment.objects.get_or_create(
                org=org,
                member=members[local],
                code=code,
                unit=unit,
                revoked_at__isnull=True,
                defaults={"assigned_by": assigned_by},
            )

    def _hcm(self, org, members, users):
        today = timezone.localdate()
        manager = members["workforce.manager"]
        names = {
            "workforce.executive": ("Leadership", 4, "Improve service reliability"),
            "workforce.hr": ("People & Culture", 3, "Develop workforce analytics"),
            "workforce.hod": ("Operations", 3, "Lead safe delivery"),
            "workforce.manager": ("Operations", 2, "Build coaching skills"),
            "workforce.learner": ("Operations", 1, "Become a site supervisor"),
        }
        for local, member in members.items():
            if local == "workforce.owner":
                continue
            track, level, aspiration = names[local]
            profile, _ = MemberProfile.objects.get_or_create(
                org=org,
                member=member,
                defaults={
                    "track": track,
                    "level": level,
                    "aspiration": aspiration,
                    "location": "Demo North Site",
                    "start_date": today - timedelta(days=365),
                    "line_manager": manager if local == "workforce.learner" else None,
                },
            )
            CpdEntry.objects.get_or_create(
                org=org,
                member=member,
                title=f"{MARK} Site induction",
                completed_on=today - timedelta(days=14),
                defaults={
                    "kind": CpdEntry.Kind.COURSE,
                    "provider": "LearnHub Demo",
                    "hours": Decimal("2.00"),
                },
            )
            if not WellbeingSurvey.objects.filter(org=org, member=member, note=MARK).exists():
                with tenant_context(
                    org_id=org.id, user_id=member.user_id, member_id=member.id, org_role=member.role
                ):
                    hcm_services.submit_wellbeing(
                        org_id=org.id,
                        member=member,
                        data={
                            "hope": 72,
                            "efficacy": 78,
                            "resilience": 68,
                            "optimism": 74,
                            "overall": 73,
                            "stay_intent": Decimal("0.750"),
                            "satisfaction": Decimal("0.800"),
                            "note": MARK,
                        },
                    )
        qualification, _ = Qualification.objects.get_or_create(
            org=org, name=f"{MARK} Health and Safety Level 2", defaults={"code": "DEMO-HS2"}
        )
        learner = members["workforce.learner"]
        MemberQualification.objects.get_or_create(
            org=org,
            member=learner,
            qualification=qualification,
            defaults={"awarded_on": today - timedelta(days=60), "expires_on": today + timedelta(days=305)},
        )

    def _frameworks(self, org, job_role, unit, staff):
        competency, _ = Competency.objects.get_or_create(
            owner_org=org,
            code="DEMO-SAFE-01",
            defaults={
                "name": f"{MARK} Safe site operations",
                "kind": Competency.Kind.SKILL,
                "description": "Demonstrates safe, consistent site operations.",
                "sort_order": 1,
            },
        )
        framework = RoleFramework.objects.filter(org=org, job_role=job_role, level=2, unit=unit).first()
        if framework is None:
            framework, version = framework_services.create_role_framework(
                org_id=org.id,
                job_role_id=job_role.id,
                title="Facilities Supervisor",
                level=2,
                unit_id=unit.id,
                track="Operations",
            )
            framework_services.add_requirement(
                org_id=org.id,
                version=version,
                data={
                    "kind": "skill",
                    "text": "Apply safe operating procedures",
                    "competency_id": competency.id,
                    "level": 3,
                    "priority": "essential",
                    "weight": 7,
                    "source": "Demo framework",
                },
            )
            framework_services.submit_version(version=version, by_user_id=staff.id, comment=MARK)
            framework_services.approve_version(version=version, by_user_id=staff.id, comment=MARK)
        return competency

    def _performance(self, org, members, competency, users):
        _ = competency
        org_id = org.id
        proposals = list(KpiProposal.objects.filter(org=org, name__startswith=MARK).order_by("name"))
        if not proposals:
            active = pms_services.create_proposal(
                org_id=org_id,
                by_user_id=users["workforce.hod"].id,
                data={
                    "name": f"{MARK} On-time safety inspections",
                    "dept": "Operations",
                    "definition": "Share of planned inspections completed on time.",
                    "unit": "%",
                    "baseline": 76,
                    "target": 92,
                    "weight": 25,
                    "cadence": "monthly",
                    "owner_id": members["workforce.hod"].id,
                },
            )
            active = pms_services.submit_proposal(
                proposal=active, by_user_id=users["workforce.hod"].id, comment=MARK
            )
            for reviewer in ("workforce.hod", "workforce.hr", "workforce.executive"):
                active = pms_services.advance_proposal(
                    proposal=active, by_user_id=users[reviewer].id, comment=MARK
                )
            proposals.append(active)
            pending = pms_services.create_proposal(
                org_id=org_id,
                by_user_id=users["workforce.hod"].id,
                data={
                    "name": f"{MARK} Team action close-out",
                    "dept": "Operations",
                    "unit": "%",
                    "baseline": 60,
                    "target": 85,
                    "weight": 15,
                    "cadence": "quarterly",
                    "owner_id": members["workforce.hod"].id,
                },
            )
            proposals.append(
                pms_services.submit_proposal(
                    proposal=pending, by_user_id=users["workforce.hod"].id, comment=MARK
                )
            )
        for proposal in proposals:
            if proposal.active_kpi_id:
                KpiMeasurement.objects.get_or_create(
                    org=org,
                    kpi_id=proposal.active_kpi_id,
                    period_year=timezone.localdate().year,
                    period_index=timezone.localdate().month,
                    defaults={
                        "value": 88,
                        "recorded_at": timezone.now(),
                        "recorded_by": users["workforce.executive"],
                        "note": MARK,
                    },
                )
        now = timezone.now()
        cycle, _ = ReviewCycle.objects.get_or_create(
            org=org,
            name=f"{MARK} Quarterly check-in",
            defaults={
                "year": now.year,
                "quarter": (now.month - 1) // 3 + 1,
                "opens_at": now - timedelta(days=7),
                "closes_at": now + timedelta(days=30),
                "status": ReviewCycle.Status.OPEN,
            },
        )
        review, created = PerformanceReview.objects.get_or_create(
            org=org,
            cycle=cycle,
            member=members["workforce.learner"],
            defaults={
                "reviewer": members["workforce.manager"],
                "self_summary": f"{MARK} completed induction and improved handover quality.",
                "manager_summary": f"{MARK} steady progress; ready for more responsibility.",
                "overall_rating": 4,
            },
        )
        if created:
            ReviewObjective.objects.create(
                org=org,
                review=review,
                member=review.member,
                title=f"{MARK} Complete supervisor shadowing",
                measure="Complete two supervised shifts",
                priority=ReviewObjective.Priority.HIGH,
                progress_pct=50,
            )

    def _governance(self, org, members, users, competency=None):
        strategy_name = f"{MARK} Safer service delivery"
        strategy = Strategy.objects.filter(org=org, name=strategy_name).first()
        if strategy is None:
            strategy, version = governance_services.create_strategy(org_id=org.id, name=strategy_name)
            governance_services.update_strategy_version(
                version=version,
                patch={
                    "vision": "Reliable, safe service for every customer.",
                    "mission": "Build confident teams through clear standards and learning.",
                    "values": ["Safety", "Care", "Accountability"],
                    "note": MARK,
                },
            )
            governance_services.add_objective(
                org_id=org.id,
                version=version,
                data={
                    "code": "DEMO-SO1",
                    "title": "Improve safe service delivery",
                    "priority": "high",
                    "owner_id": members["workforce.executive"].id,
                    "period": "2026-2027",
                    "measure": "On-time safety checks above 92%",
                },
            )
            governance_services.approve_strategy_version(
                version=version, by_user_id=users["workforce.executive"].id
            )
        code = "DEMO-HS-01"
        doc = PolicyDoc.objects.filter(org=org, code=code).first()
        if doc is None:
            doc, policy_version = governance_services.create_policy(
                org_id=org.id,
                data={
                    "code": code,
                    "title": f"{MARK} Site safety basics",
                    "doc_type": "policy",
                    "category": "Health & Safety",
                    "owner_id": members["workforce.hr"].id,
                    "objective_code": "DEMO-SO1",
                    "summary": "Core demo policy for safe site work.",
                },
            )
            governance_services.update_policy_version(
                version=policy_version,
                patch={
                    "summary": "Stop, assess and report hazards before work continues.",
                    "sections": [
                        ["Purpose", ["Keep colleagues and visitors safe."]],
                        ["What to do", ["Stop unsafe work.", "Report hazards to your manager."]],
                    ],
                    "understanding_check": {
                        "q": "What should you do when you find a hazard?",
                        "options": ["Ignore it", "Stop work and report it"],
                        "answer": 1,
                    },
                },
            )
            governance_services.approve_policy_version(
                version=policy_version, by_user_id=users["workforce.hr"].id
            )
            allocation = PolicyAllocation.objects.get(org=org, doc=doc)
            allocation.published_version = 1
            allocation.published_at = timezone.now()
            allocation.save(update_fields=["published_version", "published_at", "updated_at"])

        # Question bank: a few technical questions for the demo, linked to the competency.
        competency_id = competency.id if competency is not None else None
        questions = [
            {
                "dept": "Operations",
                "q_type": "mcq",
                "prompt": f"{MARK} What is the first thing you do when you spot a hazard on site?",
                "options": [
                    "Carry on and finish the task",
                    "Stop the work and report the hazard",
                    "Wait for the next shift to deal with it",
                ],
                "answer_index": 1,
                "rationale": "Unsafe work must stop and the hazard be reported before work resumes.",
                "mark": 1,
                "level": 1,
                "course_ref": "DEMO-HS-01",
            },
            {
                "dept": "Operations",
                "q_type": "mcq",
                "prompt": f"{MARK} How often should a planned safety inspection be recorded?",
                "options": [
                    "Only when something goes wrong",
                    "Once a year",
                    "On the planned schedule, every time",
                ],
                "answer_index": 2,
                "rationale": "The KPI tracks on-time completion of every planned inspection.",
                "mark": 2,
                "level": 2,
                "course_ref": "DEMO-HS-01",
            },
            {
                "dept": "Operations",
                "q_type": "rubric",
                "prompt": f"{MARK} Describe how you would hand over an unfinished task safely at the end of a shift.",
                "expected": "Clear written handover, hazards flagged, next steps and responsible person named.",
                "rationale": "Look for: records the state of work, flags any hazard, names who takes it on next.",
                "mark": 5,
                "level": 3,
                "course_ref": "DEMO-HS-01",
            },
        ]
        existing = set(
            TechQuestion.objects.filter(org=org, prompt__startswith=MARK).values_list("prompt", flat=True)
        )
        for q in questions:
            if q["prompt"] in existing:
                continue
            governance_services.create_question(org_id=org.id, data={**q, "competency_id": competency_id})
