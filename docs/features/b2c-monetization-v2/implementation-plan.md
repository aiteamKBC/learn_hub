# B2C Monetization v2 — Implementation Plan

## Milestone sequencing

```
M1 Wallet + Token Pack + Top-up
   └── M2 Content Pricing (lecture + material)
         └── M3 Token Unlock + Entitlement
               └── M6 Cross-Access Resolver + Preview + Certificates
                     ├── M4 Cash Course Package     (parallelisable from end of M3)
                     └── M5 Unlimited Subscription  (parallelisable from end of M3)
                           └── M7 Admin Pricing Console
                                 └── M8 Instructor Finance
                                       └── M9 Reporting
                                             └── M10 Grandfathering + Gradual Migration
```

Rationale: wallet infrastructure is foundational; pricing + entitlements must land before unlocks
are user-visible; resolver consolidates the three purchase modes; admin/finance/reporting come
once data flows exist.

## Per-milestone file impact (exact paths)

### M1 — Wallet + Token Pack + Top-up (T01, T02, T03, C04)
- `backend/apps/commerce/models.py` — add `TokenPack`, `TokenPackPrice`, `TokenRate`,
  `TokenGrant`, `TokenLedgerEntry`, `TokenSpend` (last two used in M3).
- `backend/apps/commerce/migrations/0005_tokens.py` (new).
- `backend/apps/commerce/services.py` — add `start_token_pack_checkout`,
  `start_topup_checkout`.
- `backend/apps/commerce/tokens.py` (new) — `spend_atomic`, `grant_from_pack`, `grant_from_topup`,
  `expire_grants_tick`.
- `backend/apps/commerce/webhooks.py` — add fulfillment branches for `metadata.kind in (token_pack, token_topup)`.
- `backend/apps/commerce/schemas.py` + `token_schemas.py` (new) — Wallet/Token DTOs.
- `backend/apps/commerce/api.py` — new routes `/wallet/me`, `/wallet/me/ledger`, `/tokens/packs`,
  `/tokens/packs/{id}/checkout`, `/tokens/topup/checkout`, `/tokens/rate`.
- `backend/apps/commerce/tests/test_tokens_grant.py`, `test_tokens_spend.py`,
  `test_tokens_webhook.py`, `test_tokens_rls.py` (new).
- `backend/core/rls.py` — add `enable_user_rls_sql` helper.
- `backend/core/tests/test_api_contract.py` — add `/wallet/`, `/tokens/` to `TYPED_PREFIXES`.
- `frontend/src/features/wallet/` (new) — balance card, ledger table, top-up sheet.
- `frontend/src/pages/learner/WalletPage.tsx` (new).

### M2 — Content pricing (T05, T06, T07, T14, C05)
- `backend/apps/catalog/models.py` — `Lecture.token_price` (nullable int),
  `Material.token_price` (nullable int). Note: Materials currently live as `OwnedContent` /
  download lecture type — audit on build start and extend accordingly; may need a dedicated
  `LectureMaterial` row if not present.
- `backend/apps/catalog/migrations/0007_token_prices.py` (new).
- `backend/apps/catalog/pricing.py` (new module) — distribution function per C05 default.
- `backend/apps/catalog/studio.py` + `studio_schemas.py` — expose token price fields in course
  editor. `/studio/lectures/{id}` PATCH accepts `token_price`.
- `backend/apps/catalog/tests/test_token_pricing.py`.
- `frontend/src/features/studio/pricing/` — token price input per lecture/material.

### M3 — Token unlock + Entitlement (T05, T06, T10, X01 stub, X03)
- `backend/apps/platform/entitlements.py` (new) — `ContentEntitlement` model + services.
- `backend/apps/platform/migrations/0004_entitlements.py` (new).
- `backend/apps/platform/access.py` (new — resolver, M3 ships a minimal version covering
  enrollment + token entitlement; package & subscription branches land in M4/M5/M6).
- `backend/apps/learning/services.py::_check_unlocked` — delegate to resolver.
- `backend/apps/learning/api.py` — new `POST /learning/unlock`, `GET /learning/access/{course_id}`.
- `backend/apps/commerce/tokens.py::spend_atomic` — writes entitlement on success.
- `backend/apps/catalog/media.py`, `backend/apps/learning/uploads.py` — gate signed URL issuance
  on resolver.
- Tests: `backend/apps/platform/tests/test_resolver.py`,
  `backend/apps/learning/tests/test_unlock_api.py`, concurrency test for spend_atomic.

### M4 — Cash course package (P01–P07, P06 BLOCKED)
- `backend/apps/commerce/models.py` — `CashPackage`, `CashPackagePrice`, `CashPackageCourse`.
- `backend/apps/commerce/migrations/0006_cash_packages.py`.
- `backend/apps/commerce/services.py::start_package_checkout` + fulfillment in `webhooks.py`.
- `backend/apps/payouts/services.py::record_sale` — recognise package items and compute pro-rata
  per snapshot.
- `backend/apps/platform/access.py` — add `package` branch.
- `backend/apps/commerce/api.py` — `/packages`, `/packages/{id}/checkout`.
- Frontend: package landing page under `src/pages/shop/PackagePage.tsx`; package card in catalogue.
- BLOCKED: refund path depends on P06, T11, T12.

### M5 — Unlimited subscription (S01–S12; S03/S07/S10 BLOCKED)
- `backend/apps/commerce/models.py` — `Plan.kind` adds `unlimited_b2c`; no new tables required
  (reuse `Subscription`, `SubscriptionEvent`, `Invoice`).
- `backend/apps/commerce/migrations/0007_unlimited_plan.py` (choice-only migration + inserts).
- `backend/apps/platform/models.py` — `SubscriptionAccessEvent`.
- `backend/apps/platform/migrations/0005_sub_access_events.py`.
- `backend/apps/platform/access.py` — subscription branch (status + course.in_subscription +
  lecture.excluded_from_subscription).
- `backend/apps/learning/models.py` — `Lecture.excluded_from_subscription`,
  `Course.certificate_requires_purchase` (gated on C03).
- `backend/apps/learning/progress.py` — on heartbeat for a subscription-sourced access,
  enqueue a `SubscriptionAccessEvent` writer (deferred).
- `backend/apps/commerce/webhooks.py` — handle unlimited sub lifecycle; grace-period service.
- Frontend: subscription landing + manage; billing portal link reuses existing.
- BLOCKED items block GA cutover of M5 but not internal scaffolding.

### M6 — Cross-access resolver complete + Preview + Certificate eligibility (X01–X05, C01–C03)
- Finish `platform.access.resolve` (all branches, memoization, one-query outline bulk mode).
- `backend/apps/learning/certificates.py` — honour `Course.certificate_requires_purchase` and
  the resolved access source.
- Course outline endpoint returns per-lecture reason codes for UI badges.
- End-to-end integration tests across all three purchase modes.

### M7 — Admin pricing console (A01–A06)
- `backend/apps/platform/console/tokens.py` (new), `packages.py`, `subscription_plans.py`,
  `wallet_adjust.py`, `bonus_campaigns.py`.
- `backend/apps/platform/console/__init__.py` — register new routers.
- `backend/apps/platform/console/reports.py` — extend KPI aggregates.
- Frontend: `src/pages/console/Tokens*.tsx`, `Packages*.tsx`, `Subscriptions*.tsx`,
  `WalletAdjust*.tsx`, `Campaigns*.tsx`.
- Audit hooks on every mutating endpoint.

### M8 — Instructor finance (F01, F04, F05; F02/F03/C06 BLOCKED)
- `backend/apps/payouts/services_tokens.py` (new) — `record_token_spend_earning(spend_id)`.
- `backend/apps/payouts/migrations/0005_token_channel.py` — choice addition + insert of a
  `RevenueShare(token_spend)` row (requires platform-approved bps — SHIP TIME GATED on F-series).
- `backend/apps/payouts/services.py::record_sale` — unchanged for M8; subscription pool
  distribution writer scaffolded but disabled behind feature flag `payouts.subscription_pool_v2`.
- Studio UI: filter earnings by kind in `src/features/studio/earnings/`.

### M9 — Reporting (A05)
- `backend/apps/platform/console/reports.py` — new aggregates (wallet balance total,
  tokens-outstanding, tokens-spent-by-period, package GMV, unlimited MRR, ARPU B2C).
- `backend/apps/analytics/*` rollups (if we need daily snapshots).

### M10 — Grandfathering + Gradual migration (X05)
- Feature flags (`platform.feature_flags`) gate learner-facing exposure of tokens, packages, and
  unlimited plan.
- `platform.management.commands.backfill_direct_entitlements` — additive backfill.
- Post-migration verification suite.
- Data migration guard: the migration fails loudly if any pre-existing paid order would be
  reinterpreted; proof lives in `backend/apps/platform/tests/test_b2b_regression.py`.

## Testing strategy

**Unit (per service)**
- `spend_atomic`: FEFO ordering, exact integer deduction, insufficient-balance error,
  weighted unit-cost calculation across grants.
- Grant expiry job: boundary conditions (expires_at == now, timezone, DST not applicable in UTC).
- Package pro-rata: three-course rounding (remainder goes to the highest-priced course per
  ROUND_HALF_UP on final course to keep sum invariant).
- Resolver: for each of the six branches, positive and negative paths.

**Integration**
- Stripe webhook replay harness: inject the same event twice; assert exactly-once side effects.
- End-to-end purchase → unlock flow for each mode.
- Access gating at Bunny token mint and Azure SAS mint.

**RLS**
- Extend `core/tests/test_rls.py` to cover all new tables.
- New tests in `backend/apps/platform/tests/test_user_rls.py` — verify `TokenGrant`,
  `ContentEntitlement`, `TokenLedgerEntry` isolation across two learner users.

**Concurrency**
- `backend/apps/commerce/tests/test_spend_concurrency.py`: launch two `spend_atomic` threads on
  the same wallet; assert serialized, no over-spend, `wallet_locked` not surfaced after retry.

**B2B regression**
- `backend/apps/platform/tests/test_b2b_regression.py`: load a seeded org with seats + team plan
  + compliance, run the full catalog of B2C migrations, assert zero diffs in org / compliance /
  team-plan tables and that no org user can see any B2C wallet surface.

**Frontend**
- Component tests for wallet card, unlock sheet.
- Playwright E2E `tools/harness/e2e_b2c_monetization.js`: pack purchase → unlock → certificate.

## Rollout

- **Dark launch:** all new routes behind `feature_flags.b2c_monetization_v2` (platform app
  already has flag infra). Enabled for staff-tagged accounts first.
- **Per-milestone flags:** `b2c.wallet`, `b2c.unlock`, `b2c.packages`, `b2c.unlimited`,
  `b2c.console`. A frontend route is a 404 unless its flag is on for the viewer.
- **Grandfathering migration:** M10 ships the one-time additive backfill behind
  `b2c.backfill_entitlements`; run on staging before production.
- **Cutover:** when all flags land green and all BLOCKED decisions are APPROVED in the register.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decision tables arrive with different granularity than inferred | High | Medium | Register explicitly flags TEXT-PENDING rows; spec cites IDs not literal numbers so updates are cheap. |
| Token spend race condition over-spends a wallet | Low | High | `SELECT FOR UPDATE` on grants + wallet row; concurrency test. |
| Stripe webhook replay double-grants | Low | High | Existing `StripeEvent` inbox; unique `stripe_session_id` on `TokenGrant`. |
| B2B tenancy leakage via new user-scoped RLS helper | Medium | High | New `test_user_rls.py`; no table is both org- and user-scoped; code review gate. |
| Subscription revenue share launched on wrong formula | Medium | High | Shipped behind `payouts.subscription_pool_v2` flag; no earnings written until F03 approved. |
| Refund of partially consumed token pack creates negative balance | Medium | Medium | Policy BLOCKED (T11/T12); until approved, refund of token packs is admin-only. |
| Certificate issued then subscription refunded | Medium | High (legal) | Policy BLOCKED (P06/S03/C03); until approved, no automated revocation. |
| Course-level distribution surprises instructors | Low | Medium | Explicit per-lecture override always wins; preview endpoint shows the distribution. |
| Price change for grandfathered subscribers | Medium | High (legal) | S10 BLOCKED; no automated re-price until approved. |
| Migration order mis-sequencing on Neon | Low | Medium | Only additive; `sqlmigrate` reviewed; migrations run via owner; check-makemigrations gate in CI. |
