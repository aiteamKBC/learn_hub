# M14 — Instructor Finance: token-spend earnings, cash commission, subscription weighted share scaffolding (F01, F04, F05)

**Goal.** Instructors earn from token unlocks on their content and from cash sales, with
scaffolding (not GA) for subscription-pool revenue share.

## Scope
1. `backend/apps/payouts/services_tokens.py` (new) — `record_token_spend_earning(spend_id)`:
   reads `TokenSpend` + its ledger entries; computes
   `gross_gbp_minor = Σ(entry.qty × entry.unit_cost_at_event)` (Decimal 12,4 → rounded to minor
   with ROUND_HALF_UP); applies instructor `share_bps` via `floor(gross × bps / 10000)`;
   writes `Earning(kind=token_spend, channel=token_spend, available_at=earned_at + hold)`.
2. Additive migrations:
   - `payouts.0005_token_channel` — `Earning.Kind` gains `token_spend`; `RevenueShare.Channel`
     gains `token_spend`. Data migration inserts one `RevenueShare(token_spend, instructor_bps)`
     row — **the bps value is BLOCKED (F02)**; migration refuses to run if the environment
     variable `B2C_TOKEN_CHANNEL_BPS` is unset, forcing conscious ops sign-off.
3. `payouts.services.record_sale` — unchanged for cash commission (F04).
4. Per-instructor fee (F05) — reuse `identity.instructor_profiles.platform_fee_bps`.
5. Subscription weighted share scaffolding — nightly Celery job
   `payouts.tasks.compute_subscription_pool_month(month)` reads
   `SubscriptionAccessEvent` aggregates and **writes NOTHING** until flag
   `payouts.subscription_pool_v2` is on AND F03/C06 rates are set. Until then it produces a
   report only, consumable in the console.
6. Studio UI: earnings page filter by kind; new badge "Token earning".

## Acceptance
1. A 50-token spend with weighted unit_cost £0.08 on instructor I's lecture creates an
   `Earning(kind=token_spend, gross_gbp_minor=400, share_bps=<from RevenueShare>,
   amount_gbp_minor=floor(400 × bps / 10000))`.
2. Refunding the unlocking spend (admin-only path) writes a paired negative earning.
3. Nightly subscription job writes no earnings while flag is off; it emits a report row per
   instructor per course per month with minutes watched and unique learners.

## BLOCKED (prevent GA of subscription earnings)
- **F02** bonus-token funding — how to set `unit_cost` for bonus grants.
- **F03 / C06** subscription revenue share formula and pool %.

## Dependencies
M9 (token spend data) and M11 (subscription access events).
