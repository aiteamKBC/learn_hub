# M8 — B2C Content Pricing (lecture + material level) (T05–T09, T14, C05)

**Goal.** Let instructors (and staff) set token prices at lecture or material level, with a
safe course-level default distribution rule (C05).

## Scope
1. Additive catalog columns:
   - `catalog.lectures.token_price` (nullable `PositiveIntegerField`).
   - `catalog.materials.token_price` (nullable `PositiveIntegerField`) — if material rows do
     not exist today, start by extending the lecture rows typed as `download`/material and
     add per-material rows in a follow-up (audit on milestone start).
   - `catalog.courses.aggregate_token_price` (nullable `PositiveIntegerField`) — optional
     course-level number distributed per C05.
2. `backend/apps/catalog/pricing.py` (new): `distribute(course)` returns `{lecture_id: tokens,
   material_id: tokens}`.
   - Default rule: duration-weighted for video; equal weight for other lecture types and
     materials; explicit per-row overrides always win.
3. Studio editor: new "Token price" field in lesson settings card, with a hint when a course
   aggregate drives it.
4. Learner catalog / course page: show token price next to cash price where either is set.
5. Tests: `backend/apps/catalog/tests/test_token_pricing.py` — distribution invariants, sum
   equals course aggregate when all defaults apply, override wins.

## Acceptance
1. A course with aggregate token price 100 and three video lectures of lengths 10, 20, 30 min
   gets tokens 17, 33, 50 (sum = 100; ROUND_HALF_UP; residue added to the highest-weight row
   to keep the invariant).
2. Setting an explicit token price on one lecture leaves the others untouched.
3. Studio API accepts `token_price=null` to clear.

## BLOCKED
- T07 (course-level aggregate) — confirm whether it is required or only per-row.
- C05 default weighting — confirm duration-weight is the right default.

## Dependencies
M7 (model primitives). Not required for unlocking yet; that comes in M9.

---

## PR 1 done (B2C-03 PR 1 / 3) — 2026-11-10

Scope: models + migrations + pricing service + tests (no API routes, no frontend).

### Files
- `backend/apps/commerce/models.py` — appended token-pricing models:
  `TokenPack`, `TokenRate`, `TopUpPolicy`, `BonusCampaign`, `PriceSnapshot`.
  Multi-currency via GBP-base `TokenRate.tokens_per_gbp_minor` + existing `FxRate`
  (same pattern as `PriceTier.gbp_minor` + `PriceTierAmount`).
- `backend/apps/catalog/models.py` — additive columns:
  `Course.cash_price_tier`, `Course.full_course_token_price`, `Course.token_pricing_mode`,
  `Lecture.token_price`, `Lecture.is_free_preview`, `LectureResource.token_price`,
  `LectureResource.is_free_preview`.
- `backend/apps/commerce/pricing_service.py` — new file; service façade:
  `set_course_price`, `set_lecture_token_price`, `set_material_token_price`,
  `set_preview_flag`, `distribute_course_token_price`, `upsert_token_pack`,
  `upsert_token_rate`, `upsert_topup_policy`, `upsert_bonus_campaign`,
  `migrate_token_pricing_on_republish`.
  Reuses existing `apps.platform.services.audit()` (writes to the partitioned
  append-only `platform.audit_logs` table). No parallel `PricingAuditLog`.
- Migrations:
  `commerce/migrations/0005_tokenrate_pricesnapshot_topuppolicy_bonuscampaign_and_more.py`
  (generated), `commerce/migrations/0006_token_pricing_constraints.py`
  (hand-authored partial unique indexes), `catalog/migrations/0007_course_cash_price_tier_and_more.py`.
  All additive — safe for prod; no existing rows modified.
- Tests: `backend/apps/commerce/tests/test_token_pricing.py`,
  `backend/apps/catalog/tests/test_token_pricing_columns.py`.

### PR 2 / PR 3 remaining
- PR 2: Ninja routes for staff console (`/console/pricing/tokens/...`,
  `/console/pricing/packs/...`, `/console/pricing/rate`, `/console/pricing/topup`,
  `/console/pricing/campaigns`). Add `Console…` prefixes to `TYPED_PREFIXES`.
  Thin `api.py`; call `pricing_service` directly; pass `request=` to retain audit IP.
- PR 3: Admin frontend screens.

### Still BLOCKED
- **C05** default auto-weights for `distribute_course_token_price` (no defaults invented).
- **T03** default grant expiry duration (wallet concern; noted here for the PR 2 agent).
- **F02** bonus-campaign activation funding model — `is_active=True` is refused.
- TopUp default per-currency bounds.
