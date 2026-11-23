# M17 — HCM Foundation (Person records)

**Goal.** Give every org member a durable HR profile so later milestones (frameworks,
performance management, wellbeing dashboards) have a `Person` object to attach to. Backend
only — the matching screens land in a later milestone once mockups exist.

## Scope

1. **New Django app `apps/hcm`** (schema `hcm`). All tables company-only (`core.rls.company_only`)
   with composite FKs `(org_id, x_id) → (org_id, id)` so one company's HR data can never
   reference another's members, units or qualifications.
2. **Models** (6):
   - `MemberProfile` (one-to-one `org.OrgMember`): `track`, `level 1..4`, `aspiration`,
     `location`, `start_date`, `termination_date`, `line_manager FK OrgMember`,
     `stay_intent`, `satisfaction`, `adjustments`, `cpd_hours_cached` + `cpd_cached_at`.
     Check constraints: `level` in `1..4`, `line_manager != member`.
   - `Qualification` + `MemberQualification`: normalises the free-text qualifications
     list; `awarded_on`, `expires_on`, `evidence_asset FK catalog.MediaAsset`.
   - `MemberQuarter` (time-series, one row per (member, year, quarter)): `hours_worked`,
     `wellbeing_score`, `kpi_score`, `competence_score` (last two filled by later milestones).
   - `WellbeingSurvey`: PsyCap sub-scales (`hope`, `efficacy`, `resilience`, `optimism`),
     `overall`, `stay_intent`, `satisfaction`, `note`. All percentages `0..100`.
   - `CpdEntry`: CPD log; `kind` (`onboarding` / `course` / `external`), `hours`,
     `completed_on`, nullable FK `learning.Certificate`, `verified_by` + `verified_at`.
   - `MemberActivity`: minutes-on-activity per course/lecture (separate from
     `learning.ProgressEvent` which stays for sub-lecture video heartbeats).
3. **New RLS helper `manager_of_unit`** in `core/rls.py`: lets a `UnitManager` see rows for
   members whose primary unit is a descendant of the manager's unit via LTree `path <@`.
   Applied to `WellbeingSurvey` raw rows (privacy); other new tables keep plain
   `company_only`. Managers get aggregated wellbeing via a service, not raw rows.
4. **Tenancy extensions** in `core/tenancy.py`: set `app.member_id` and `app.org_role` per
   request alongside the existing `app.user_id` / `app.org_id`. Needed for `manager_of_unit`.
   `tenant_context` context manager updated with matching kwargs for Celery.
5. **Ninja API** at `/api/v1/hcm/`:
   - `GET`/`PATCH /me/profile` — self reads full card; PATCH whitelist: `aspiration`,
     `location`, `adjustments` only.
   - `GET /me/quarters` — own time-series (paged, keyset).
   - `GET`/`POST /me/wellbeing` — own survey history + submit new.
   - `GET`/`POST /me/cpd` — own CPD log + add external entry.
   - `GET /me/activity` — own activity, date-range filter, keyset paged.
   - `GET /people`, `GET`/`PATCH /people/{member_id}` — manager/admin directory.
   - `GET /people/{member_id}/wellbeing/aggregate` — manager-safe aggregate (no raw rows).
   - `GET /people/{member_id}/wellbeing` — admin only (raw rows, 403 for managers).
   - `POST /people/{member_id}/qualifications`, `DELETE .../{mq_id}`.
   - All endpoints return typed schemas; schema class names unique project-wide.
   - Prefix `/api/v1/hcm/` added to `TYPED_PREFIXES` in `core/tests/test_api_contract.py`.
6. **Celery tasks** (schedules added to the beat config, consistent with
   `compliance.nightly` fan-out pattern):
   - `hcm.rollup_quarter` nightly 02:00 UTC — recompute current-quarter `MemberQuarter`
     row per active member (hours, wellbeing mean).
   - `hcm.refresh_cpd_cache` nightly 02:15 UTC — sum CpdEntry hours →
     `MemberProfile.cpd_hours_cached`.
   - `hcm.create_next_quarter` at each quarter boundary 00:05 — pre-create
     `MemberQuarter` rows so dashboards don't 404.
   - `hcm.wellbeing_reminder` weekly Mon 09:00 local — nudge members with no survey this
     quarter. Reuses `apps.engagement.notify.notify(...)`; wording lives in an insert-only
     data migration under `engagement`.
7. **Services + selectors** split per project convention. `services.py` for writes
   (submit survey, add CPD, backfill profile). `selectors.py` for reads (aggregate
   wellbeing, member directory, keyset-paged activity).
8. **Tests** under `apps/hcm/tests/`:
   - `test_models.py` — constraints (level 1-4, quarter 1-4, percentages ≤100,
     no-self-manager), unique_togethers.
   - `test_rls.py` — `company_only` on every table; `manager_of_unit` positive +
     negative + self-read; cross-org blocked (auto-covered by `core/tests/test_rls.py`
     but we add direct policy round-trips).
   - `test_api_self.py` — /me/* round-trip, PATCH field whitelist enforced.
   - `test_api_people.py` — gate matrix (self / peer / manager / admin) × 4 targets.
   - `test_tasks.py` — rollup_quarter idempotent; CPD cache refresh.

## Acceptance

1. `python manage.py migrate --database owner` from a clean dev applies three new HCM
   migrations with zero failures (the user runs this, not the builder).
2. Every existing `org.OrgMember` has a `MemberProfile` row after the backfill migration
   (idempotent `get_or_create` per member).
3. `GET /api/v1/hcm/me/profile` for a logged-in member returns the profile with
   `adjustments` empty, `qualifications: []`, `cpd_hours_cached: 0`, `latest_quarter: null`.
4. A line manager fetching `GET /api/v1/hcm/people/{member_id}/wellbeing/aggregate`
   gets the dept mean + distribution; the raw-rows endpoint returns `403`.
5. An admin fetching `/people/{member_id}/wellbeing` gets raw rows.
6. A manager of unit A can never read a profile whose primary unit is outside A's LTree
   subtree (asserted at the RLS layer, not the service layer).
7. `python manage.py test apps.hcm` passes in isolation.
8. `core/tests/test_rls.py` still passes (all new `org_id` tables registered with RLS).
9. `core/tests/test_api_contract.py` still passes with the new prefix.
10. Full suite `python manage.py test core apps --keepdb --noinput` still green.
11. `ruff check .` + `ruff format --check .` clean.

## BLOCKED

- Frontend screens for `/business/people/*`, `/business/wellbeing`, `/account/profile`
  extension — awaits `docs/design/mockups/` entries for HCM. Backend API is designed so
  the planner can brief the frontend milestone later without schema changes.
- `kpi_score` and `competence_score` columns on `MemberQuarter` stay NULL — fed by
  later milestones (frameworks, performance management).

## Dependencies

- `identity` (User), `org` (Organization, OrgMember, OrgUnit, UnitManager, JobRole),
  `catalog` (MediaAsset — evidence), `learning` (Certificate — CPD provenance),
  `engagement` (notify — reminders), `platform` (settings — cache TTLs).
- No destructive changes to any existing table. Pure-additive to the `org` + `core`
  modules (tenancy keys + RLS helper only).

## Unblocks

- M18 — Frameworks (KSB catalogue, Role framework, Dept maturity). Fills
  `MemberQuarter.competence_score`.
- M19 — PMS (Strategy, KPIs, Reviews with AI analysis). Fills
  `MemberQuarter.kpi_score`.
