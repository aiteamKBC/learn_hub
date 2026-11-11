# M16 — Grandfathering + Gradual Migration (X05)

**Goal.** Make the v2 B2C stack safe to enable in production without regressing any existing
B2C user (direct course buyer, pre-v2 personal subscriber) or any B2B org.

## Scope
1. Feature flags (platform `feature_flags`):
   - `b2c.wallet`, `b2c.unlock`, `b2c.packages`, `b2c.unlimited`, `b2c.console`,
     `b2c.sub_certificates`, `b2c.backfill_entitlements`,
     `payouts.subscription_pool_v2`.
   Every new learner-facing route is a 404 for a user whose flag is off.
2. One-time additive backfill:
   `platform.management.commands.backfill_direct_entitlements` — for every existing
   `learning.Enrollment` with a paid `OrderItem`, write a mirror
   `ContentEntitlement(source=direct_purchase, is_revocable=false)`. Idempotent (NO-OP if the
   entitlement already exists); re-runnable; audits what it wrote.
3. Existing active subscribers:
   - No re-pricing automatically. Their `Plan` continues to drive price until next renewal.
   - S10-sensitive logic stays BLOCKED until policy approved.
4. Regression suite:
   - `backend/apps/platform/tests/test_b2b_regression.py` — load seeded org + seats + compliance,
     run full v2 migrations, assert zero diffs in B2B tables and that no org user has access to
     any B2C wallet surface.
   - `backend/apps/learning/tests/test_grandfather_access.py` — pre-v2 enrollments still unlock
     their lectures after migrations and after resolver is enabled.
5. Rollout runbook: step-by-step flag flip order, with rollback (every step is reversible by
   turning the flag off; no destructive migration ever runs).

## Acceptance
1. Running every v2 migration on a seeded production-shaped dataset produces zero changes to
   any `org`, `compliance`, team-plan, or existing-B2C row.
2. Backfill command on a fresh database is a no-op; on a seeded database writes exactly
   `COUNT(paid_order_items_with_course)` entitlements and is idempotent on a second run.
3. With all B2C flags off, the `/wallet/me` route returns 404 and the resolver still returns the
   same decisions it would have pre-v2.

## BLOCKED (would prevent GA cutover)
- **S10** — existing-subscriber price change policy.
- **F02, F03, C06** — before enabling `payouts.subscription_pool_v2`.
- **S03 / C03** — before enabling `b2c.sub_certificates`.

## Dependencies
All prior B2C v2 milestones.
