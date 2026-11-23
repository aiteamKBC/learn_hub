# M20 — Governance: Strategy · Policies · Question bank

**Status:** Backend done (frontend pending)
**Branch:** `enhance_diaa`
**Depends on:** M18 (Frameworks — Competency for question-bank KSB link), M19 (PMS — KPIs reference strategy objectives by code)

---

## Goal

Port the remaining EvidRise features into learner_hu as a new `governance` schema:
company **strategy** (versioned objectives), **policy documents** (with allocation and
per-member adoption tracking) and a **technical question bank**. Everything is authored
and edited by company admins. Backend only; frontend awaits the provisional UI build.
All content generic and name-free.

---

## Scope — new app `apps/governance` (schema `governance`)

**Strategy** — `Strategy`, `StrategyVersion` (draft→approved→superseded),
`StrategyObjective` (SO1…, priority/owner/period/measure). KPIs reference objectives by code.

**Policies** — `PolicyDoc` (policy/SOP), `PolicyVersion` (sections + understanding check,
draft→approved→superseded), `PolicyAllocation` (who must read: org / depts / titles /
sites / worker types / persons, re-ack flag), `PolicyRecord` (per-member read / ack /
check / observations → adoption stage Aware→Understands→Applies→Embedded).

**Question bank** — `TechQuestion` (MCQ or interview rubric, KSB/competency link, level,
mark, rationale).

### Migrations

| File | Contents |
|------|----------|
| `governance/0001_initial` | CREATE SCHEMA + 8 tables + grants |
| `governance/0002_security` | company_only ×7, manager_of_unit on policy_records, 8 composite FKs |

### Design decisions

| # | Decision |
|---|----------|
| G1 | All tables `company_only` except `PolicyRecord` (personal adoption) → `manager_of_unit` on `member`. |
| G2 | Strategy & policy versions use a simple draft→approved lifecycle; approving supersedes the prior approved version atomically. |
| G3 | Adoption stage derived from the record (ack + check + observations across ≥2 months), mirroring EvidRise. |
| G4 | Admins author/edit everything; members read allocated policies and record their own read/ack/check. |

---

## Acceptance criteria

- [x] `manage.py check` 0 issues · `ruff` clean · `makemigrations --check` clean
- [x] `core.tests.test_rls` — `governance` schema, all 8 tables FORCE RLS
- [x] `apps.governance.tests` — strategy versioning+approval, policy authoring/approval, member adoption, question bank CRUD
- [x] Migrations applied to Neon dev

## BLOCKED / Next

- Frontend for M17–M20 (provisional learner_hu UI, admin + learner areas).
