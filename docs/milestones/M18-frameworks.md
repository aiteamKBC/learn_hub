# M18 — Frameworks: KSB Catalogue · Role Ladders · Department Maturity

**Status:** In progress  
**Branch:** `enhance_diaa`  
**Depends on:** M17 (HCM Foundation — MemberProfile, MemberQuarter, hcm schema)

---

## Goal

Port EvidRise's competency framework, role ladder and department maturity features
into learner_hu as a new `frameworks` Postgres schema. Backend only; frontend awaits
mockups.

---

## Scope

### New app: `apps/frameworks` (schema `frameworks`)

**Competency catalogue (hybrid platform/org)**
- `Competency` — platform library (owner_org NULL) + per-org clones/overrides. Kind: K/S/B/P.
- `CourseCompetency`, `LectureCompetency`, `QuizQuestionCompetency` — KSB tagging on content.

**Role Framework (approval workflow)**
- `RoleFramework` — shell per (job_role, unit, track, level).
- `RoleFrameworkVersion` — versioned spec (5 states: draft → submitted → approved/changes_requested → superseded).
- `RoleRequirement` — per-KSB requirement on a version (kind, priority, level, weight).
- `RoleFrameworkHistory` — audit log per version transition.

**Department Maturity**
- `MaturityFramework` — platform template + per-org clone (kind: maturity/capability).
- `MaturityVersion` — versioned framework (draft/published/superseded).
- `MaturityDimension`, `MaturityCriterion` — survey structure with anchors.
- `MaturityCampaign` — survey wave per dept per quarter.
- `MaturityResponse` — per-member answers + reflections JSON.

**HCM extension**
- `hcm.0004` — adds `evidenced_cached` JSON + `evidenced_cached_at` to `MemberProfile`.

### Migrations

| File | Contents |
|------|----------|
| `frameworks/0001_initial` | CREATE SCHEMA frameworks + all 13 tables + RLS grants |
| `frameworks/0002_security` | RLS policies + composite FKs |
| `frameworks/0003_seed` | 8 default Competencies (C1–C8) + 2 MaturityFramework templates |
| `hcm/0004_evidenced_cache` | Adds `evidenced_cached` + `evidenced_cached_at` to MemberProfile |

### Design decisions baked in

| # | Decision |
|---|----------|
| D1 | Hybrid catalogue: platform rows (owner_org NULL) readable by all; org clones readable/writable by own org. `OwnedContent` base, `scoped_content` RLS (same pattern as `catalog.Course`). |
| D2 | `required_qualifications` on `RoleFrameworkVersion` → ManyToManyField to `hcm.Qualification` (reuses Phase 0 reference table, enables `readiness()` matching). |
| D3 | HR approver = members with role `admin` or `owner`. No new role enum value for now. |
| D4 | `MaturityCampaign` and `MemberQuarter` are independent (campaign = time window; quarter = per-member rollup). |
| D5 | Per-campaign scored results snapshotted on campaign close (not recomputed on read). |

---

## Acceptance criteria

- [ ] `python manage.py check` — 0 issues
- [ ] `ruff check / format --check` — clean
- [ ] `makemigrations --check` — no additional migrations needed
- [ ] `core.tests.test_rls` — schema `frameworks` appears, all tables have FORCE RLS
- [ ] `apps.frameworks.tests` — competency hybrid, role workflow, scoring smoke, maturity campaign round-trip
- [ ] `docs/build-status.md` updated; migrations listed for user to apply

---

## BLOCKED

- Frontend screens (`/business/roles`, `/business/competencies`, `/business/maturity`, `/learn/competence`, `/learn/recommendations`) — awaiting mockups.

---

## Dependencies

- M17 (HCM Foundation) — `MemberProfile`, `MemberQuarter`, `hcm.Qualification`
- `apps.org.JobRole` — already exists
- `core.rls.scoped_content` — already exists
- `apps.catalog.OwnedContent` base — already exists

## Unblocks

- M19 PMS (Phase 2) — `readiness()` score feeds performance review context.
- Recommender — `evidenced_cached` on `MemberProfile` enables fast gap → course mapping.
