# EvidRise route-by-route parity manifest

This manifest covers every route registered by EvidRise's generated route tree on
22 November 2026. It is a functional comparison, not a request to preserve the
source URL or copy its visual design.

Legend: **Replaced** = Learner Hub already has the stronger production journey.
**Partial** = a real target foundation exists but the source workflow is not fully
covered. **Build** = no adequate target workflow. **Reject/rebuild** = the demo must
not be copied; implement a real integration only if retained in scope.

| EvidRise route | Target / decision | Status | Gap or note |
|---|---|---|---|
| `/` | Role-aware dashboard set | Partial | Current dashboards are product/workspace based; build Executive, HR, HoD and manager views. |
| `/about` | Public information page | Build/decide | Not material to workforce parity; confirm marketing scope. |
| `/account` | `/account` | Replaced | Real authenticated account settings exist. |
| `/activity-log` | Learner timeline + `/console/audit` | Partial | Platform audit exists; learner/HCM timeline and CSV export need completion. |
| `/assessments` | Quarterly workforce campaigns | Build | Unified campaign scheduling, instruments, reminders and results are missing. |
| `/b2b` | `/console/companies` + corporate workspace | Partial | Tenant operations exist; public employer request/provisioning queue is not equivalent. |
| `/basket` | `/cart` | Replaced | Real cart and checkout flow exists. |
| `/capability` | `/business/frameworks/maturity` | Partial | Campaign runtime exists; capability authoring, templates and dashboards are incomplete. |
| `/careers` | `/learn/competence` + role readiness | Partial | Readiness exists; career map, aspiration and progression workflow are missing. |
| `/commercial` | Company academy workspace | Build | Organisation-owned academy controls and Marketing role are not modelled. |
| `/competence` | `/business/frameworks/competencies` + `/learn/competence` | Partial | Catalogue/self evidence exist; people, title, department and talent-pool views are missing. |
| `/compliance` | `/business/matrix`, requirements and reports | Replaced | Learner Hub's operational compliance journey is stronger. |
| `/contributions` | Social-contribution workspace | Build | Campaign, evidence and outcome model are absent. |
| `/coupons` | Studio course coupons + `/console/promotions` | Partial | Instructor/platform promotion exists; organisation-academy ownership is missing. |
| `/gateways` | Real gateway administration | Reject/rebuild | Source connection states are demo data. Retain only verified provider setup/health. |
| `/individual-kpis` | PMS objectives/KPIs | Partial | Foundations exist; dedicated individual KPI lifecycle is missing. |
| `/integrations` | Real connector administration | Reject/rebuild | Do not copy fake BreatheHR/AI connection toggles. |
| `/kbc-admin` | `/console/companies` + `/console/workforce` | Partial | Platform tenant/workforce access exists; tenant provisioning and staff impersonation audit need completion. |
| `/kpi-approvals` | `/business/pms/proposals` | Partial | Proposal stages exist; actual Executive/HR/HoD actor separation is missing. |
| `/kpis` | `/business/pms/kpis` | Partial | KPI CRUD/measurements exist; data, dashboards and scoped responsibility need completion. |
| `/leaderboard` | Learner leaderboard | Build | Must be tenant-configurable and privacy-aware. |
| `/maturity` | `/business/frameworks/maturity` | Partial | Runtime exists; full authoring/publish/template library is incomplete. |
| `/my-learning` | `/learn`, `/learn/required`, `/learn/achievements` | Replaced | Real enrolments/progress and assigned learning exist. |
| `/onboarding` | Organisation onboarding plans | Build | Configurable plans, tasks, ownership and progress are absent. |
| `/organisation` | `/business/people`, `/business/units`, company settings | Replaced/extend | Strong hierarchy exists; add fine-grained role assignment and reporting-line UX. |
| `/performance` | `/business/pms/*` role dashboards | Partial | Reviews/KPIs exist; consolidated persona dashboards and calibration are missing. |
| `/plans` | Required learning + individual plan | Partial | Assignments exist; manager-owned plan, recommendations, extensions and external learning are missing. |
| `/policies` | `/business/governance/policies` + `/learn/policies` | Partial | Version/allocation/adoption exist; document storage and richer authoring remain. |
| `/practice` | Competence/KSB practice | Build | Structured challenges and evaluator workflow are absent. |
| `/reports` | `/business/reports`, `/console/reports` + role dashboards | Partial | Operational reports exist; HCI/workforce/role-specific exports are missing. |
| `/roles` | `/business/frameworks/roles` | Partial | Version/workflow/readiness exist; full authoring/publish and career progression need completion. |
| `/sales` | `/studio/revenue`, `/console/sales` | Replaced/extend | Real instructor/platform sales exist; company academy sales ownership is missing. |
| `/settings` | `/account`, `/business/settings`, `/console/settings` | Replaced | Correctly separated by scope in Learner Hub. |
| `/store` | `/courses` | Replaced | Public catalogue is production-backed. EvidRise's 160 records still need approved import. |
| `/strategy` | `/business/governance/strategies` | Partial | Versions/objectives/approval exist; role approval rules and alignment dashboard remain. |
| `/strategy-config` | Strategy authoring/configuration | Partial | Existing strategy detail covers part; next-draft/config UX remains. |
| `/studio` | `/studio/courses` | Replaced/extend | Existing Studio is stronger; extend activity types and framework tagging. |
| `/wellbeing` | `/learn/wellbeing` + future HR aggregate | Partial | Self survey exists; periods, HR aggregates, privacy thresholds and campaign integration remain. |
| `/candidate-report/:candidateId` | Recruitment candidate report | Build | Recruitment domain is absent. |
| `/certificates` | `/learn/certificates` | Replaced | Production certificate wallet exists. |
| `/certificates/:certId` | Certificate detail | Replaced | Existing detail/verification flow replaces source. |
| `/courses` | `/courses` | Replaced | Real catalogue exists; source metadata/content not imported. |
| `/courses/:courseId` | `/courses/:slug` | Replaced | Real public course detail exists. |
| `/learn/:courseId` | `/learn/:slug/*` | Replaced/extend | Real player exists; optional richer activity-format support remains. |
| `/people` | `/business/people`, `/business/hcm/people` | Replaced/extend | Real members and HR profile foundation exist; roles/reporting lines need UX. |
| `/people/:personId` | `/business/people/:memberId`, HCM profile | Replaced/extend | Real member detail exists; finish sensitive HCM actions and scoped roles. |
| `/portal` | Candidate portal start | Build | Candidate authentication/assignment entry is absent. |
| `/portal/:assignmentId` | Candidate test runner | Build | Timed assessment engine and anti-tamper rules are absent. |
| `/reviews` | `/business/pms/cycles`, `/learn/reviews` | Partial | Review foundation exists; manager/HR role flows and populated cycles remain. |
| `/reviews/:reviewId` | `/business/pms/reviews/:reviewId` | Partial | Review form exists; role-specific workflow/calibration needs completion. |
| `/store/:courseId` | `/courses/:slug` | Replaced | Existing course detail and checkout replace source. |
| `/studio/new` | `/studio/courses/new` | Replaced/extend | Existing builder is production-backed; add optional EvidRise activity templates. |
| `/talent` | Recruitment/talent pipeline | Build | Vacancies, candidates, stages, tests and decisions are absent. |
| `/talent/:candidateId` | Candidate workspace | Build | Candidate detail, assignments, CV/interview notes and audit are absent. |
| `/tenants/:tenantId` | `/console/companies` drawer + `/console/workforce` | Partial | Company detail/access exists; complete provisioning, role setup and audit. |
| `/verify/:certId` | `/verify/:code` | Replaced | Public verification exists. |

## Counted result

- **56 EvidRise routes audited.**
- **19 routes are functionally replaced** by stronger Learner Hub journeys; several
  remain extensible for the employer-academy or richer-content use case.
- **23 routes are partial** and require a defined backend/UI completion slice.
- **12 routes require new workflows**, concentrated in recruitment, onboarding,
  quarterly assessments, careers/practice, employer academy and contribution.
- **2 integration surfaces must be rejected as demos and rebuilt only as real,
  auditable connectors.**

Counts classify each row by its primary status; rows labelled “replaced/extend” are
counted as replaced and rows labelled “build/decide” as build.
