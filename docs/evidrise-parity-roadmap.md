# EvidRise → Learner Hub parity audit and delivery roadmap

**Audit date:** 22 November 2026  
**Source product:** `E:\new_project\EvidRise`  
**Target product:** `E:\new_project\learner_hu\learn_hub`

## 1. Executive answer

The accompanying route-by-route result is in
`docs/evidrise-route-parity.md` and covers all 56 registered EvidRise routes.

Learner Hub has a substantially stronger production foundation than EvidRise: real authentication, PostgreSQL, tenant isolation, APIs, payments, enrolments, course delivery, instructor tooling and a platform console. The recent M17–M20 work also added a working first slice of HCM, frameworks, PMS and governance to the backend and UI.

It is **not yet a complete EvidRise port**. EvidRise is a broad prototype whose state lives mainly in browser `localStorage`/IndexedDB; its Django backend is intentionally empty. Many apparently finished integrations, AI behaviours, payments and role switches are demo simulations. We should therefore port its useful product logic and workflows, not copy its storage, security model or UI verbatim.

The current production database confirms the distinction:

| Area | Current data |
|---|---:|
| Organisations | 8 |
| Organisation members | 83 |
| Organisation units | 28 |
| Job roles | 9 |
| Learner Hub courses | 24 total / 17 published |
| EvidRise catalogue | 160 course records |
| Exact EvidRise course title matches in Learner Hub | 0 |
| HCM profiles / qualifications / wellbeing / CPD | 0 / 0 / 0 / 0 |
| Competencies | 8 |
| Role frameworks | 0 |
| Maturity frameworks / campaigns | 1 / 0 |
| KPIs / KPI proposals | 0 / 0 |
| Review cycles / performance reviews | 0 / 0 |
| Strategies / policies / policy records | 0 / 0 / 0 |
| Technical questions | 0 |

All M17–M20 migrations are applied. The screens and APIs exist for the implemented slice, but most of those screens are empty because production data has not been configured or imported. Existing memberships also need an idempotent HCM profile backfill because they were created after the original migration backfill ran.

## Decisions confirmed with the product owner

- Do not bulk-import EvidRise's 160 demo courses. The training team will enter approved content into Learner Hub's existing course builder.
- Company HR and company admins can create private company courses; every submission waits in the Platform Admin approval queue before it becomes available.
- The Platform Admin controls all tenants from the central Workforce area and can jump straight into a selected company's People, Frameworks, Performance, Governance or Courses area.
- A person keeps one login and can hold multiple company responsibilities. Company admins or HR assign those responsibilities; Platform Admin can manage any company.
- HR and line managers see workforce summaries, not employees' individual wellbeing answers. Employees can see their own answers; Platform Admin retains full access.
- Recruitment, candidate assessment, onboarding, quarterly assessment campaigns, Company Academy/marketing and social-contribution features are deferred. Quarterly employee assessments are specifically not part of this delivery slice.

## Implemented continuation (2026-11-22)

The first executable slice is wired through the existing system: role assignments and company/unit scope are enforced on APIs; Executive, HR, Head of Department and Line Manager see role-aware company navigation; KPI proposals follow HoD → HR → Executive review; company course authoring is available in Studio to company admins and HR; submitted company courses enter the Platform Admin approval queue. Direct company-feature shortcuts are available from Platform Admin Workforce. Role permissions remain server-enforced, while the UI mirrors them. This does not complete the deferred domains or eliminate the need for account-by-account acceptance review.

## 2. What EvidRise actually contains

The source prototype is useful as a detailed functional specification. Its code-backed demo data includes:

- 160 catalogue course records.
- Eight departments and roughly 85 fictional people.
- 47 job-title/role-framework definitions.
- 26 seeded department KPIs.
- Six recruitment assessment types: RIASEC, work preferences, numerical, verbal, non-verbal and role competence.
- Five seeded quarterly assessment campaigns spanning Q1 2026 to Q1 2027.
- Capability and maturity templates, competence mapping, quarterly wellbeing, career, performance, policy and strategy demos.
- Course activity ideas including short teaching, song, podcast, cartoon, magazine, dialogue, narrated content, quiz and case study.
- Commercial academy, coupons, sales, contribution and tenant-request prototypes.

Those numbers describe browser demo records, not production-ready shared data. The fictional people and hard-coded scenarios must not be imported into a live tenant as real employees.

## 3. Correct identity and role model

### Three separate concepts

1. **Account:** a `User`, authenticated by email. One human should normally have one account.
2. **Membership and permissions:** what that account may do in a particular company and, where relevant, a particular unit.
3. **Job title:** the employee's organisational position. This is HR data, not automatically a security permission.

An account may legitimately combine responsibilities. For example, one person can be both an instructor and an employer HR administrator, or an Executive and Head of Department. Changing responsibility should not require creating another login.

### How every requested persona should work

| Persona | What it is in Learner Hub | How it is granted | Intended landing area and visibility |
|---|---|---|---|
| Platform Admin | Platform staff account | `User.is_staff`; never a fake employee membership | `/console`; all tenants through audited platform access, Companies and Workforce |
| Employer | An `Organization`, not a user role | Created/provisioned by platform workflow; people receive memberships | Company workspace, billing, seats, people and configuration |
| Employer Owner/Admin | Company-level membership | Existing `OrgMember` owner/admin | Full company setup, billing, people and operational administration |
| Executive | Fine-grained company responsibility | New `executive` role assignment, scoped to organisation | Executive dashboard, organisation strategy, final KPI decisions and organisation-wide summaries |
| HR | Fine-grained sensitive responsibility | New `hr_admin` assignment, normally organisation-wide | People, recruitment, onboarding, HCM, policies, frameworks and sensitive workforce reporting |
| Head of Department | Unit-scoped leadership responsibility | New `department_head` assignment plus department `OrgUnit` | Department KPIs, reviews, people and approval stage for that department |
| Line Manager | Existing reporting/unit relationship plus capability | `UnitManager` and/or HCM `line_manager`, with new `line_manager` assignment | Own team only: reviews, plans, observations and wellbeing summaries with privacy thresholds |
| Head of Marketing | Company academy responsibility | New `academy_marketing` assignment | Employer academy catalogue, promotions, sales analytics and social-contribution campaigns; no platform console |
| Instructor | Teaching profile attached to the same account | Existing approved `InstructorProfile` | `/studio`; authored courses, students, grading, revenue and payouts |
| Learner | Baseline signed-in learner/company member | Existing user plus enrolment or learner membership | `/learn`; learning, certificates, own reviews, own HCM, policies and career plan |

### Required RBAC addition

The current coarse organisation roles—owner, admin, manager and learner—should remain for compatibility, but they are not expressive enough for EvidRise workflows. Add an organisation-scoped assignment model such as:

```text
OrgRoleAssignment
  user/member
  organization
  code: executive | hr_admin | department_head | line_manager | academy_marketing
  unit: optional organisation unit scope
  starts_at / ends_at
  assigned_by / audit metadata
```

Permissions must check these assignments on the backend. Hiding a navigation link is not security. Job titles remain in `JobRole`; a title such as “Head of Marketing” may suggest a default role during onboarding, but must not silently grant access merely because the text matches.

The EvidRise header “Role preview” selector should survive only as a development/demo impersonation tool for authorised platform staff, never as the production permission mechanism.

## 4. Persona roadmap

### Platform Admin journey

1. Sign in with a staff account.
2. Open Console Dashboard, Companies or Workforce.
3. Select any company without being inserted as a company employee.
4. Inspect organisation data through explicit, audited staff scope.
5. Configure platform commerce, approvals and tenant provisioning.

**Current status:** the Console, Companies and new Workforce entry exist. Platform staff can open a company's workforce through explicit staff access. A complete audit trail and persona impersonation banner remain to be added.

### Employer Owner/Admin journey

1. Create/configure the company, units and job roles.
2. Invite people and assign memberships, job titles and fine-grained roles.
3. Buy/assign courses, seats, packages and live training.
4. Configure HCM, frameworks, PMS and governance.
5. View company operational and compliance reports.

**Current status:** core company, unit, people, package, seat, live-training and compliance flows are strong. M17–M20 configuration screens exist, but need real seeded/configured data and the new RBAC layer.

### Executive journey

1. See an organisation-level role dashboard.
2. Review strategy and KPI alignment.
3. Approve final KPI proposals.
4. See aggregate maturity, capability, performance, risk and human-capital indicators.
5. Drill down only to permitted, privacy-safe detail.

**Current status:** strategy/KPI/review APIs and screens provide a partial foundation. The executive dashboard, real actor separation and human-capital index are missing.

### HR journey

1. Manage people, reporting lines, units, titles and responsibilities.
2. Run recruitment tests and candidate pipelines.
3. Run onboarding and quarterly assessment campaigns.
4. Configure competence, maturity, capability and role frameworks.
5. Manage policies, wellbeing, qualifications, CPD and performance cycles.

**Current status:** people plus HCM/framework/governance foundations exist. Recruitment, candidate portal, onboarding, unified quarterly campaigns and aggregate HR wellbeing reporting are missing.

### Head of Department journey

1. See department KPIs, capability gaps and learning compliance.
2. Propose/approve KPIs at the departmental stage.
3. Manage reviews and plans for the department hierarchy.
4. See department-only workforce and maturity data.

**Current status:** unit hierarchy, KPI workflow and review foundations exist. Department-scoped role enforcement and a HoD dashboard are missing.

### Line Manager journey

1. See direct/indirect reports in the allowed unit subtree.
2. Perform reviews and maintain objectives/training plans.
3. Record observations and make development recommendations.
4. See only aggregated wellbeing signals where privacy thresholds allow.

**Current status:** unit managers and reporting relationships exist, and review APIs exist. The manager dashboard, full plan lifecycle and permission wiring are incomplete.

### Head of Marketing journey

1. Curate the employer's external academy catalogue.
2. Manage company academy coupons and campaigns.
3. View company-owned sales and conversion analytics.
4. Manage social-contribution learning campaigns.

**Current status:** Learner Hub has strong platform/instructor commerce. It does not yet model a company-owned academy marketing workspace, so this must be built as an organisation capability rather than giving Marketing access to platform administration.

### Instructor journey

1. Use Studio to author and publish courses.
2. Manage learners, assignments, quizzes, grading and Q&A.
3. View course sales, earnings and payouts.

**Current status:** largely complete in the current product. EvidRise's studio ideas should extend the existing builder, not replace it.

### Learner journey

1. Discover or receive assigned learning.
2. Complete courses, assessments and activities.
3. View certificates, achievements, required learning and wallet/subscription.
4. Complete own wellbeing, CPD, qualifications, competence and review tasks.
5. Follow an individual career/training plan.

**Current status:** learning, commerce, certificates and the first self-service M17–M20 pages exist. Career maps, full training-plan lifecycle, quarterly assessment inbox, external learning and some HCM actions are incomplete.

## 5. Feature parity matrix

Legend: **Keep** = Learner Hub already provides the stronger production implementation. **Extend** = useful foundation exists but EvidRise capability is incomplete. **Build** = no adequate target workflow exists. **Reject demo** = do not copy the prototype behaviour.

| EvidRise domain / route family | Decision | Current reality and required work |
|---|---|---|
| Authentication and tenancy | Keep | Real accounts, org membership and tenant isolation exist. Add fine-grained role assignments and audited staff impersonation/scope. |
| Marketplace, cart, checkout, orders | Keep | Learner Hub implementation is production-oriented; do not duplicate EvidRise store state. |
| Course player and progress | Keep | Core delivery exists. Extend activity taxonomy and competency tags where valuable. |
| Instructor Studio | Keep/Extend | Builder, learners, quizzes, assignments, grading and finance exist. Add lecture/question competency tags and richer activity formats. |
| Certificates and verification | Keep | Existing wallet/detail/verification flows replace the prototype. |
| Company, people, units and job roles | Keep/Extend | Strong base exists. Add fine-grained assignments, reporting-line administration and current-member profile backfill. |
| Role dashboards | Build | EvidRise has Executive, HR, HoD and manager demo dashboards. Build real dashboards over Learner Hub APIs with server-enforced scope. |
| Activity log | Extend | Platform audit/progress data exists. Add learner activity timeline/export and expose relevant HCM history APIs. |
| B2B employer requests | Extend | Company/corporate operations exist. Add a customer-request/provisioning queue only if the public employer-request journey is retained. |
| Recruitment and talent pipeline | Build | Vacancies, candidate assignments, timed tests, candidate portal and candidate reports are absent. |
| Onboarding | Build | Convert EvidRise's demo subjects/pathway into configurable organisation onboarding plans and tasks. |
| Quarterly assessments | Build/Extend | Wellbeing storage exists; unified campaign scheduling, reminders, instruments, scoring and HR aggregates are missing. |
| Wellbeing | Extend | Self-service basis exists. Add HR aggregate dashboards, privacy thresholds, periods/activity and required verify/delete operations. |
| Competence | Extend | Eight competencies and readiness/recommendation foundations exist. Add person/title/department views, talent pools and deeper manager analysis. |
| Role frameworks and careers | Extend | Version/workflow/readiness foundation exists. Add framework authoring/publish UI, career map, progression workflow and aspirations. |
| Capability and maturity | Extend | Runtime/campaign foundations exist but authoring/publishing, a full seeded library and dashboards are incomplete. |
| Department and individual KPIs | Extend | KPI and proposal workflows exist. Add true role-stage authorisation, dedicated individual KPI lifecycle and dashboards. |
| Performance reviews | Extend | Cycles, reviews, objectives and analysis exist. Add role dashboards, calibration/manager workflows and scoped permissions. |
| Strategy | Extend | Version/objective/approval foundation exists. Add the next-draft workflow, alignment dashboards and actor-specific approval rules. |
| Policies | Extend | Versions, allocation, read, acknowledge and checks exist. Add final document storage/version UX, authoring decisions and authoritative worker classification. |
| Technical question bank | Extend | Backend/UI foundation exists; enrich tagging, imports, governance and assessment integration. |
| Individual learning plans | Build/Extend | Assignments and required learning exist. Add plan ownership, recommendations, deadlines/extensions, external learning and manager/HR approvals. |
| Leaderboard | Build | No equivalent learner leaderboard currently exists. Must be tenant-configurable and privacy-aware. |
| Practice/KSB challenges | Build | No equivalent structured practice workflow exists. Reuse competence and assessment services. |
| Employer academy marketing | Build | Platform/instructor commerce exists, but organisation-owned academy catalogue, marketing analytics and permissions do not. |
| Coupons and sales | Keep/Extend | Platform commerce exists. Add organisation ownership only for the employer academy use case. |
| Social contribution | Build | Contribution dashboard/campaign flow is absent. Define measurable outcomes before implementation. |
| Reports / Human Capital Index | Extend/Build | Business and platform reports exist. Add workforce exports, role dashboards and a transparent HCI definition; do not copy unvalidated demo claims. |
| Integrations | Reject demo / rebuild real | Do not port fake “connected” BreatheHR, gateway or AI toggles. Implement only real connectors with encrypted credentials, webhooks, health and audit. |
| AI behaviours | Reject demo / design separately | Prototype text generation is not a production AI service. Add only bounded, reviewed AI use cases with provenance and human approval. |

## 6. What is already done in the recent merge

### HCM — selected first slice

- Learner self profile, wellbeing, CPD and qualifications.
- HR member profile inspection and qualification awarding.
- Qualification catalogue and supporting APIs.
- UI routes integrated into the existing Learner Hub design.

Remaining examples: wellbeing periods/activity and HR aggregate/raw views, CPD verification, qualification deletion and automatic profile backfill for existing memberships.

### Frameworks — selected first slice

- Competence CRUD/clone and course-level competence tagging.
- Role framework version workflow, readiness and recommendations.
- Maturity campaign response/close/scoring runtime.

Remaining examples: framework authoring/publishing, lecture/question tags, career map/progression and manager/talent-pool analysis.

### PMS — selected first slice

- KPIs, measurements and proposal workflow.
- Review cycles, performance reviews, objectives and analysis.

Remaining examples: distinct Executive/HR/HoD/manager permissions, dashboards, individual KPI lifecycle, calibration and populated tenant data.

### Governance — selected first slice

- Strategy versions/objectives/approval.
- Policy versions, allocation, records, learner read/acknowledge/check.
- Technical questions.

Remaining examples: next strategy draft, final document/object-storage approach, worker classification and richer policy authoring/import.

### Platform administration

- Platform Console retains platform operations.
- Companies drawer now exposes an “Open workforce” path.
- Workforce is visible to staff without creating fake company membership.
- The navigation and screens retain Learner Hub's design system rather than copying EvidRise visuals.

## 7. What must not be merged

- Browser `localStorage`/IndexedDB as the source of truth.
- The role-preview selector as authentication or authorisation.
- Fictional EvidRise people, emails or demo company as production employees.
- Fake payment, BreatheHR, AI or integration connection states.
- Duplicate marketplace, commerce, course player or Studio implementations.
- Hard-coded 2026 campaign dates as live schedules.
- Claims that psychometric tests, scoring, AI outputs or compliance rules are validated without the required domain/legal review.
- Job-title text as the sole security check.
- EvidRise's visual shell where Learner Hub already has a consistent production design system.

## 8. Delivery plan

The fastest safe order is foundation first, then visible role journeys. Working on all pages before fixing roles and data would create screens that look finished but are not secure or populated.

### Phase 0 — truth, roles and data readiness (3–5 working days)

- Add `OrgRoleAssignment` and server-side permission helpers.
- Add role assignment UI to company People/Workforce.
- Backfill HCM profiles idempotently for current organisation members.
- Add audited staff tenant access/impersonation banner and tests.
- Produce a machine-readable parity manifest mapping every EvidRise route to target route/API/status.

**Exit:** the same email can safely hold multiple scoped responsibilities and each persona sees only allowed backend data.

### Phase 1 — catalogue and framework import (4–7 working days for metadata)

- Build repeatable import/preview/rollback commands for the 160 course records.
- Deduplicate by stable external key, not title alone.
- Import selected framework, department, role and KPI templates as optional tenant templates.
- Keep fictional employee records out of production.
- Add seed/configuration status to platform/company screens.

**Important:** metadata, thumbnails, outcomes and structure can fit this phase. Producing and reviewing real assets for all nine activity formats across 160 courses is content production, not a code import; that is a separate multi-week editorial workstream.

### Phase 2 — HCM complete journey (10–15 working days)

- Recruitment, vacancies, candidate portal, timed assessments and reports.
- Onboarding plans, tasks and progress.
- Quarterly assessment campaigns and HR aggregate wellbeing.
- Career map, aspiration, progression and training-plan lifecycle.
- Competence views by person, role, department and talent pool.

### Phase 3 — PMS and governance role journeys (8–12 working days)

- Executive, HR, HoD and Line Manager dashboards.
- Role-enforced KPI stages and individual KPI lifecycle.
- Review/calibration workflows and scoped team views.
- Strategy alignment, policy document workflow and reporting.
- Human-capital metrics with documented formulas and privacy rules.

### Phase 4 — employer academy and contribution (7–10 working days)

- Organisation-owned external academy catalogue.
- Head of Marketing permissions, coupons, sales and analytics.
- Social-contribution campaigns and measurable outcome dashboard.
- Employer workspace request/provisioning flow if product scope confirms it.

### Phase 5 — hardening and acceptance (5–7 working days)

- Cross-role, cross-tenant and negative permission tests.
- Responsive/accessibility passes and empty/loading/error states.
- Data migration dry runs, rollback and audit verification.
- Full E2E journeys for every persona.
- Product-owner comparison against EvidRise route-by-route manifest.

### Realistic total

- **Production feature parity excluding mass content production:** approximately 5–8 focused working weeks.
- **Metadata-first usable milestone:** approximately 2 weeks for role foundation, current-data repair, catalogue/template import and the first role-aware dashboards.
- **Full 160-course multimedia/content parity:** depends on asset ownership and editorial review; it must be estimated as a content programme after auditing the actual source assets.

These estimates assume one integrated codebase, available product decisions and no external vendor approval delays. Parallel work can shorten calendar time, but not the required review and migration gates.

## 9. Immediate implementation sprint

Current delivery status:

1. Role assignments and People controls: implemented; targeted permission acceptance still needs to be run.
2. Role-aware dashboards, API scopes and KPI approval stages: implemented for the current HCM/frameworks/PMS/governance slice.
3. Company course authoring and Platform Admin approval: implemented and build-checked.
4. HCM backfill/configuration health and real tenant seed data: outstanding; do this before presenting empty dashboards as populated.
5. Recruitment, candidate portal, onboarding, quarterly campaigns, academy marketing and social contribution: deferred by the product owner.
6. 160-course import: explicitly declined for this project phase; content authors will add selected material through Course Builder.

## 10. Definition of “EvidRise is merged”

The merge is complete only when:

- Every EvidRise route is marked replaced, implemented, intentionally rejected or explicitly out of scope in the parity manifest.
- Every visible action calls a real API and persists to PostgreSQL/object storage as appropriate.
- Every persona has a tested login journey and backend-enforced permission scope.
- Platform staff can inspect tenants without becoming employees.
- No tenant can read or mutate another tenant's data.
- The approved 160-course/template import is repeatable, idempotent and reversible.
- Empty, error, loading, responsive and accessibility states pass review.
- Demo simulations are absent from production and all real integrations expose verifiable health/audit state.
- The product owner signs off each persona journey against agreed acceptance data.

Until those conditions are met, the accurate statement is: **Learner Hub contains a production-grade core and an implemented first slice of EvidRise's HCM/PMS/governance ideas; full functional and content parity remains a planned programme.**
