# B2C Monetization v2 — Architecture

## 1. Modules and layering

**No new top-level Django app.** Add two cohesive sub-domains inside existing apps to respect the
upward-only dependency rule declared in `docs/STRUCTURE.md`:

- `backend/apps/commerce/` gains: `tokens.py` (service), `token_schemas.py`, token-related models
  appended to `commerce/models.py`, `console/tokens.py` admin views (under
  `backend/apps/platform/console/tokens.py`).
- `backend/apps/platform/` gains: `access.py` (the cross-access resolver — single entrypoint),
  `entitlements.py` (models + services for `ContentEntitlement`), and extends `console/`.
- `backend/apps/payouts/` gains: `services_tokens.py` (token-spend earning writer), extends
  `Earning.Kind` and `RevenueShare.Channel`.
- `backend/apps/learning/` — `services.py::_check_unlocked` delegates to
  `apps.platform.access.resolve()` instead of inlining the enrollment check.

Dependency direction stays compatible:
`identity ← org ← catalog ← learning ← compliance` ; `commerce, payouts, engagement, platform`
sit above. `platform.access` is the one place that aggregates signals from `commerce`
(subscription, order), `learning` (enrollment) and the new entitlement store. Learning imports
`platform.access` — allowed because `platform` is already above `learning`.

## 2. New / changed models

All additive. Every tenant-scoped table gets FORCE RLS via `core.rls.enable_rls_sql`.
Every model inherits from `BaseModel` or `MixedTenantModel` per existing convention.

### 2.1 commerce (schema `commerce`)
- `TokenPack` — SKU; name, slug, quantity, bonus_qty, is_active, availability window.
- `TokenPackPrice` — per-currency prices (mirrors `PlanPrice`).
- `TokenRate` — current GBP-per-token conversion rate; history kept (one row per change, latest
  wins via `is_active` + `effective_from`).
- `TokenGrant` — user, source enum, qty, remaining_qty, unit_cost_gbp Decimal(12,4), granted_at,
  expires_at (nullable), reason, origin (pack_id | topup_id | admin_id | campaign_id |
  refund_id), stripe_session_id (nullable, unique when set).
- `TokenLedgerEntry` — append-only; kind in (spend, expiry, admin_clawback, refund_reversal),
  grant, qty, unit_cost_at_event, spend_id (FK to `TokenSpend`), created_at.
- `TokenSpend` — one row per unlock operation; user, scope (lecture|material|course), target_id,
  tokens_total, weighted_unit_cost_gbp, instructor_id (denormalized for payouts), course_id,
  content_entitlement_id.
- `CashPackage` — name, slug, is_active, starts_at, ends_at.
- `CashPackagePrice` — per-currency.
- `CashPackageCourse` — package, course, snapshot_gbp_minor (list price at include-time, used
  for pro-rata revenue; recomputed on package publish).
- `BonusCampaign` — name, applies_to (pack|topup|both), rule_type (percent|fixed_per_band),
  value, starts_at, ends_at, is_active, funding_source (platform|instructor|pooled — BLOCKED F02).
- `Plan` — extend `Plan.kind` with `unlimited_b2c` (choice, additive).

### 2.2 platform (schema `platform`)
- `ContentEntitlement` — owner_user, scope (course|lecture|material), target_id, source
  (direct_purchase|package|token_spend|subscription|admin_grant), source_ref (polymorphic id),
  granted_at, expires_at (nullable), revoked_at (nullable), revoke_reason, is_revocable.
- `SubscriptionAccessEvent` — user, course, lecture, seconds_consumed, subscription_id,
  session_date (date, for monthly rollup), source_event_id (progress event). FORCE RLS.
- `AccessAuditLog` — resolver decisions sampled and/or deny-reason logged for support.

### 2.3 learning
- `Lecture.excluded_from_subscription` — boolean, default false (additive).
- `Course.certificate_requires_purchase` — boolean, default false (additive). Used only when C03
  resolves to "subscription completions do not certify by default" (BLOCKED).
- No change to `Enrollment`, `Certificate`.

### 2.4 payouts
- `Earning.Kind` gains `token_spend` (additive choice).
- `RevenueShare.Channel` gains `token_spend` (additive, default instructor_bps mirrors
  marketplace until A/F decisions arrive).
- No schema change needed on `PayoutRequest`, `Payout`, `CommissionRule`.

### 2.5 identity
- No change. Existing `instructor_profiles.platform_fee_bps` and `payout_account` reused.

## 3. Authorization matrix

| Surface | Learner | Instructor (self) | Staff |
|---|---|---|---|
| Read own wallet balance / grants / ledger | ✅ | ✅ (own) | ✅ (any user) |
| Buy token pack / top-up | ✅ | ✅ | n/a |
| Admin wallet adjust | ❌ | ❌ | ✅ |
| Create token pack / set rate / bonus campaign | ❌ | ❌ | ✅ |
| Set lecture/material token price | ❌ | ✅ on own course drafts | ✅ |
| Resolve access (internal) | n/a — called by services | | |
| Create CashPackage / price | ❌ | ❌ | ✅ |
| Create/update unlimited plan | ❌ | ❌ | ✅ |
| Read subscription access events | ❌ | ✅ (own courses, aggregated) | ✅ (raw) |
| Read `Earning(kind=token_spend)` | ❌ | ✅ (own) | ✅ |

RLS policies:
- `TokenGrant`, `TokenLedgerEntry`, `TokenSpend`: user-scoped, enforced by `app.user_id` in
  addition to existing tenancy — these are user-owned, not org-owned, so a new policy template
  (`core.rls.enable_user_rls_sql`) uses `user_id = current_setting('app.user_id')::uuid` for
  non-staff roles. Staff bypass via existing staff role check.
- `ContentEntitlement`: same user-scoped policy; staff sees all.
- `SubscriptionAccessEvent`: user-scoped read for learner; instructor sees rows where
  `course.primary_instructor_id = current_user_id`; staff sees all.
- `TokenPack`, `CashPackage`, `BonusCampaign`, `TokenRate`: public-read when `is_active`, staff
  write only.

## 4. Data flows

### 4.1 Token pack purchase
1. Frontend → `POST /api/v1/commerce/token-packs/{id}/checkout` (currency, qty=1).
2. `commerce.services.start_token_pack_checkout` creates pending `Order(kind=token_pack)` and
   Stripe Checkout Session; stores `stripe_session_id`.
3. Stripe webhook `checkout.session.completed` arrives → `commerce.webhooks` dedupes via
   `StripeEvent` inbox (existing). On first successful processing:
   - set Order.paid; write `TokenGrant(source=pack_purchase, unit_cost=pack_gbp / (qty+bonus_qty),
     expires_at=now+default_duration)`.
   - emit notification.
4. Retry-safe: second webhook finds Order already paid AND a grant with the same
   `origin=pack_id, stripe_session_id` → no-op.

### 4.2 Token unlock
1. Frontend → `POST /api/v1/learning/unlock` `{scope, target_id}`.
2. `platform.access.resolve` first — if already granted, return 409 `already_unlocked`.
3. Compute token cost from `catalog.pricing` (lecture/material/course distribution per C05).
4. `commerce.tokens.spend_atomic(user, cost, spend_context)`:
   - `with transaction.atomic()` + `SELECT … FOR UPDATE` on wallet grants in FEFO order.
   - Insufficient balance → `ServiceError("insufficient_tokens", status=402)`.
   - Write `TokenSpend` + N `TokenLedgerEntry` rows + decrement `remaining_qty`.
   - Write `ContentEntitlement(source=token_spend, ...)`.
   - Enqueue `payouts.services_tokens.record_token_spend_earning(spend_id)` (deferred Celery task
     so failures in payouts don't roll back the unlock — the spend is the user-visible
     transaction).

### 4.3 Subscription renewal
- Stripe `invoice.paid` → existing handler; writes `SubscriptionEvent(renewed)`. No entitlement
  rows required — the resolver reads subscription status live.

### 4.4 Refund
- Order refund via existing `commerce.services.refund_order_item`. Extended to:
  - If item is a `CashPackage`: iterate `CashPackageCourse`, revoke matching entitlements
    (set `revoked_at`), write earning refund rows pro-rata.
  - If item is a `TokenPack`: reverse the grant — `remaining_qty` set to 0 and a
    `TokenLedgerEntry(kind=refund_reversal, qty=original_qty - consumed_qty)` written. If the
    user has already spent some tokens from the pack, policy decision whether to claw back from
    future grants (BLOCKED P06 variant).
  - Certificate interaction BLOCKED (P06).

### 4.5 Payouts of token-spend earnings
- `payouts.services_tokens.record_token_spend_earning(spend_id)` reads the `TokenSpend` +
  ledger entries, computes `gross_gbp_minor = sum(entry.qty × entry.unit_cost_at_event)`,
  applies instructor's `share_bps`, writes `Earning(kind=token_spend, channel=token_spend,
  available_at = earned_at + hold_window)`. Reuses existing monthly payout bundling.

## 5. API design (additive, all under `/api/v1/`)

Every endpoint declares a typed Ninja response schema. New prefixes `/wallet/`, `/tokens/`,
`/packages/`, `/console/tokens/`, `/console/packages/`, `/console/wallet/` added to
`TYPED_PREFIXES`.

| Method | Path | Auth | Body | 200 Schema |
|---|---|---|---|---|
| GET | `/wallet/me` | learner | — | `WalletOut{balance, soon_expiring, grants[]}` |
| GET | `/wallet/me/ledger` | learner | cursor | `WalletLedgerPage` |
| GET | `/tokens/packs` | public | — | `TokenPackListOut` |
| POST | `/tokens/packs/{id}/checkout` | learner | `{currency}` | `CheckoutRedirectOut` |
| POST | `/tokens/topup/checkout` | learner | `{currency, amount_minor}` | `CheckoutRedirectOut` |
| GET | `/tokens/rate` | public | — | `TokenRateOut` |
| POST | `/learning/unlock` | learner | `{scope, target_id}` | `UnlockResultOut{entitlement_id, new_balance}` |
| GET | `/learning/access/{course_id}` | learner | — | `AccessSummaryOut` (per-lecture resolver results, for the course outline) |
| GET | `/packages` | public | — | `CashPackageListOut` |
| POST | `/packages/{id}/checkout` | learner | `{currency}` | `CheckoutRedirectOut` |
| GET | `/subscriptions/plans` | public | — | `SubscriptionPlanListOut` (filtered to `unlimited_b2c`) |
| POST | `/subscriptions/checkout` | learner | `{plan_id, interval, currency}` | `CheckoutRedirectOut` |
| GET | `/console/tokens/packs` / POST / PATCH / DELETE | staff | — | `ConsoleTokenPackOut` |
| GET | `/console/tokens/rate` / PUT | staff | — | `ConsoleTokenRateOut` |
| GET | `/console/tokens/campaigns` / POST / PATCH | staff | — | `ConsoleBonusCampaignOut` |
| POST | `/console/wallet/{user_id}/adjust` | staff | `{delta, reason}` | `ConsoleWalletAdjustOut` |
| GET | `/console/packages` / POST / PATCH | staff | — | `ConsolePackageOut` |
| GET | `/console/subscriptions/plans` / POST / PATCH | staff | — | `ConsoleSubPlanOut` |
| GET | `/studio/earnings?kind=token_spend` | instructor | — | `StudioEarningPage` (reuse existing) |

Schema class names are all `Console…`, `Wallet…`, `Token…`, `Package…`, `Subscription…`,
`Unlock…`, `Access…` — unique as required by `core/tests/test_api_contract.py`.

Errors use `core.errors.ServiceError`:
- `insufficient_tokens` (402)
- `already_unlocked` (409)
- `pricing_missing` (409) — lecture has no token price and course has no distribution
- `wallet_locked` (423) — simultaneous spend contention after retry
- `subscription_required_not_active`, `package_refunded`, `entitlement_revoked`.

## 6. RLS policies for new tables

Reuse `core.rls.enable_rls_sql` pattern with two templates:

- **Tenant tables** (`SubscriptionAccessEvent`): `org_id IS NULL OR org_id = app.org_id`.
- **User-owned (new helper)** `core.rls.enable_user_rls_sql`:
  - policy `user_rls_select`: `user_id = current_setting('app.user_id')::uuid OR current_setting('app.is_staff', true) = 'true'`.
  - policy `user_rls_modify`: same.
- Grants to `lms_app` role only. `lms_owner` never used at runtime.

## 7. Stripe webhook handling

- Use existing `commerce.webhooks` dispatcher with `StripeEvent` inbox (dedupe key =
  `event.id`). Already idempotent and replay-safe.
- New event handling branches (no new event types — all go through existing
  `checkout.session.completed`, `invoice.paid`, `customer.subscription.*`):
  - Session metadata.kind in (`token_pack`, `token_topup`, `cash_package`, `unlimited_sub`) drives
    which fulfillment function runs.
  - Each fulfillment is wrapped in `with transaction.atomic()` and uses `select_for_update` on
    the Order row. Writing grants / entitlements happens inside the same transaction as the Order
    status flip. On replay the dedupe column(s) make the second attempt a no-op.

## 8. Migration strategy

- Entirely additive migrations, one per app:
  - `commerce 0005_tokens_packages` — new tables, additive columns, no backfill.
  - `platform 0004_entitlements` — `ContentEntitlement`, `SubscriptionAccessEvent`,
    `AccessAuditLog`.
  - `learning 0006_subscription_flags` — adds `Lecture.excluded_from_subscription`,
    `Course.certificate_requires_purchase`.
  - `payouts 0005_token_channel` — `Earning.Kind` + `RevenueShare.Channel` choice addition and
    one `RevenueShare` row insert for `token_spend` (data migration, insert-only, requires an
    initial platform-safe rate — **BLOCKED pending F02/C06**; migration stops with a clear error
    if run before the rate is approved).
- Backfill:
  - No existing user data is reinterpreted. Existing enrollments keep working through the
    resolver's "direct enrollment" branch.
  - One optional backfill job (`platform.management.commands.backfill_direct_entitlements`)
    reads `learning.Enrollment` and writes mirror `ContentEntitlement(source=direct_purchase)`
    rows for consistency. Idempotent, additive, runs behind a feature flag.
- Grandfathering:
  - Existing `Subscription` rows continue under their current plan+price until renewal. Writing
    `plan_version_id` is not required; current plans implicitly carry their current price until
    admin publishes a `PlanVersion` with a cutover rule (BLOCKED S10).

## 9. Caching

- `TokenRate` cached in Redis (key `tokens:rate:active`, TTL 60 s, invalidated on staff PUT).
- `platform.access.resolve` MUST NOT be cached across requests (correctness over cost); within
  one request, memoize per `(user_id, course_id)` to avoid re-querying for each lecture in a
  course outline fetch.
- Course outline endpoint computes resolver for all lectures in one SQL batch: a single
  `ContentEntitlement` query filtered by target_id IN (…lecture_ids…, course_id,
  …material_ids…).

## 10. Precision and rounding (summary)

| Quantity | Type | Rounding |
|---|---|---|
| Money at rest | `PositiveIntegerField` (minor units) | — |
| Money in service | `Decimal(12,2)` | `ROUND_HALF_UP` on final write |
| Tokens | `int` | spend = exact integer; no rounding |
| Token conversion rate (GBP/token) | `Decimal(12,4)` | stored exactly; application uses `ROUND_HALF_UP` on cash amounts and `floor` on token outputs |
| Per-grant `unit_cost_gbp` | `Decimal(12,4)` | computed `ROUND_HALF_UP` once at grant creation |
| FX rate | existing `Decimal(20,10)` | unchanged |
| Instructor share | `bps` integer | `amount = floor(gross_minor × share_bps / 10000)` |
| FEFO order | `expires_at ASC NULLS LAST, granted_at ASC, id ASC` (deterministic tiebreak) | |

## 11. Observability

- Every spend writes a structured log event `tokens.spend` with `{user, tokens, grants[], unit_cost_weighted, entitlement_id}`.
- Resolver denies write to `AccessAuditLog` at WARNING sampling rate = 1.0 in staging, 0.1 in
  production (feature flag).
- Prom-style counters via existing `platform/metrics.py`: `token_grants_total`,
  `token_spends_total`, `wallet_balance_gauge` (periodic), `subscription_access_events_total`,
  `entitlement_denies_total{reason}`.
