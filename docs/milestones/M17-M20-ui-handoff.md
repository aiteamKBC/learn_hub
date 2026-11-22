# M17–M20 UI integration and verification

Scope: finish the Learner Hub UI for the **implemented** HCM, Frameworks, PMS and
Governance APIs. EvidRise supplies functional requirements; Learner Hub supplies the
visual system and application architecture. This milestone does not imply full
EvidRise feature parity.

## Implemented journeys

| Domain | Business workspace | Employee workspace |
| --- | --- | --- |
| HCM | HR people directory, HR profile, qualification catalogue and awards | Own profile, wellbeing surveys, CPD entries/history, qualifications |
| Frameworks | Competency catalogue/create/clone/edit; role frameworks, draft requirements and approval history; maturity campaigns/create/results/close; course competency mappings | Evidenced competence; approved-role readiness, gaps and recommendations; criterion-level maturity survey |
| PMS | KPI list and measurements; proposal create/edit/history/submit/approve/request changes; review cycles; review summaries, rating, objectives, submit and analysis | Own reviews, summaries, objectives, acknowledgement and existing analysis |
| Governance | Strategy/objective authoring and approval; policy/SOP authoring, versions, allocation, adoption and observations; technical MCQ/rubric question bank | Allocated published policies, read/acknowledge/check, revision acknowledgement |

Shared integration: lazy routes, desktop navigation, employee mobile menu and explicit
company selection. HR administration and question-bank answers are admin-only.
Course mapping appears in the business **Course library** detail sheet for company
admins, and in studio course **Details** when an instructor is also a company admin.

## Repairs made during completion

- Correct wellbeing scales (PsyCap 0–100; retention/satisfaction 0–1), CPD precision
  and profile/role level limits.
- Correct role requirement kinds and submitted/changes-requested approval states.
- Real published maturity version IDs, dimensions, criteria and rating anchors.
- Real role version IDs for employee readiness and recommendations.
- Proposal editing, supported cadence/status values, zero-value preservation,
  dirty-form guards, stable person selections and query invalidation.
- Policy tuple sections and `q`/`question` compatibility, published-only employee
  content, answer redaction, allocation enforcement, unstarted employee identity,
  revision-specific acknowledgement/check reset and admin-only bank reads.
- Idempotent HR profile creation for members added after the original backfill.

These API repairs use existing tables. **No new migrations or deployments.**

## Verification record

- `logs/workforce-api-types.log`: generated types from Django's current schema.
- `logs/workforce-frontend-build.log`: typecheck and production build PASS.
- `logs/workforce-frontend-lint.log`: frontend lint PASS.
- `logs/workforce-python-lint.log`: domain Python lint PASS.
- `logs/workforce-backend.log`: broader domain suite interrupted to use focused
  regressions because the remote database is slow. **Not counted as a pass.**
- `logs/workforce-regressions.log`: **13/13 PASS** — new HR member self-service,
  cross-company denial, framework version/criterion metadata, policy allocation,
  answer/draft redaction, revision re-acknowledgement, question-bank permissions and
  the API contract checks. Runtime: 7m27s including test-runner setup.
- `logs/workforce-django-final.log`: Django system check PASS.
- `logs/workforce-migration-dry-run.log`: PASS, no model/migration changes detected.
- `logs/workforce-ui-smoke.log`: **96/96 PASS** — 24 routes in light/dark and
  desktop/375px phone, no page overflow or JavaScript/console/network errors.
  These use schema-shaped fixtures and establish rendering, not persistence.
- `logs/workforce-ui-focused.log`: focused browser form/navigation/permission and
  course-competency edit/save checks. Final report: `shots/workforce-ui-focused/report.json`.
- `logs/workforce-live.log`: **PASS**, real browser and actual Django APIs against
  the isolated `test_*` database. Profile creation/save, wellbeing submission,
  fractional CPD creation, policy published-content/read/acknowledge/check and all
  six employee mobile routes passed with no console errors or HTTP 5xx. Runtime
  3m56s. The independent browser worker uses system Python 3.12; the Django runner
  uses the existing backend venv (Python 3.14), avoiding binary-package mixing.
- Live screenshots: `shots/workforce-live/`; representative policy and phone CPD
  screens inspected. Final visual review caught a fractional-hours KPI rounding
  issue (0.25h displayed as 0); the KPI now preserves fractional hours and the phone
  CPD table moves the completion date under the activity to improve fit.
- Final focused browser checks: **8/8 PASS**, including visible and screen-reader
  fractional CPD hours (`0.25`), company selection, manager restrictions and course
  mappings. Four targeted CPD captures supersede the initial sweep's CPD captures.

## Local review session

The existing local server on port 8000 continued to return the older API contract.
A current backend was started on **8012**, and Vite on **5173** was restarted with
`LEARNHUB_API_PROXY_TARGET=http://127.0.0.1:8012`. The frontend's own
`/api/openapi.json` was checked and contains both the new policy-content and maturity
version endpoints. Open **http://localhost:5173** to review with the existing login.
No environment files were changed; the proxy override belongs to this dev process.
Vite still defaults to port 8000 when that environment variable is not set.

## Remaining backend surfaces / next parity review

The following appeared in older briefs or the source prototype but have no current
API for the UI to call. They must not be described as implemented:

- HCM quarterly/time-series and activity browsing APIs; HR wellbeing aggregates/raw
  views; qualification removal and CPD verification actions.
- Maturity/capability framework authoring/version publishing APIs and
  lecture/question-level competency-tagging APIs.
- A strategy endpoint to create the next draft after approval.
- Authoritative employee worker classification for policy allocation. Existing
  worker-type filters are preserved and fail closed; named-member overrides still
  work. Classification must not be inferred from a client's location names.

After this milestone's verification, compare EvidRise feature by feature for the
next scope: onboarding/career pathways, individual KPI depth, recruitment,
learning formats/plans, tenant provisioning and marketing/commercial extensions.
Existing LMS functionality must be checked before marking any source feature missing.
