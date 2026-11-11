# B2C Monetization v2 — Morning Report

**Date:** 2026-11-11
**Status:** All backend milestones B2C-00 through B2C-10 complete.

---

## Milestone Summary

| Milestone | Description | Status | Tests |
|-----------|-------------|--------|-------|
| B2C-00 | Documentation (spec, arch, decisions, plan) | DONE | — |
| B2C-01 | Content Access Engine (resolver + entitlements) | DONE | 10/10 |
| B2C-02 | Token Wallet + FEFO Ledger | DONE | Pass |
| B2C-03 PR1 | Models + Pricing Service (Hamilton distribution) | DONE | Pass |
| B2C-03 PR2 | Console API Endpoints (token pricing, wallet) | DONE | Pass |
| B2C-04 | Stripe Token Top-ups (packs + custom) | DONE | 9/10 (1 Neon artifact) |
| B2C-05 | Per-content Token Unlock | DONE | 10/10 |
| B2C-06 | Cash Full-Course Packages | DONE | 5/5 |
| B2C-07 | Unlimited Personal Subscriptions | DONE | 10/10 |
| B2C-08 | Instructor Finance (token-spend earnings) | DONE | 5/5 |
| B2C-09 | API Contract Verification | DONE | 2/2 |
| B2C-10 | This report | DONE | — |

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `apps/platform/access.py` | Unified content access resolver (7-tier precedence) |
| `apps/platform/models.py` (extended) | ContentEntitlement, AccessAuditLog, SubscriptionAccessEvent |
| `apps/commerce/wallet.py` | Token wallet: grant, spend (FEFO), adjust, expire |
| `apps/commerce/unlock.py` | Token unlock: lecture, material, full-course |
| `apps/commerce/packages.py` | Cash package: list, checkout, fulfil |
| `apps/commerce/subscriptions.py` | Unlimited subscription: list plans, checkout, status |
| `apps/commerce/token_api.py` | Learner-facing API: wallet, packs, top-up, unlock, access, packages, subscriptions |
| `apps/commerce/pricing_service.py` | Admin pricing: set prices, Hamilton distribution |
| `apps/payouts/services_tokens.py` | Token-spend instructor earnings |
| `apps/platform/console/token_pricing.py` | Admin console: token pricing endpoints |
| `apps/platform/console/wallet.py` | Admin console: wallet management |

### Migrations
| Migration | Description |
|-----------|-------------|
| `platform/0004` | ContentEntitlement + AccessAuditLog |
| `platform/0005` | RLS policies for access engine |
| `platform/0006` | SubscriptionAccessEvent |
| `commerce/0005` | TokenRate, PriceSnapshot, TopUpPolicy, BonusCampaign |
| `commerce/0006` | Token pricing constraints |
| `commerce/0007` | TokenGrant, TokenSpend, TokenLedgerEntry (wallet) |
| `commerce/0008` | CashPackage, CashPackageCourse |
| `commerce/0009` | Plan.kind field (unlimited_b2c) |
| `catalog/0007` | Course cash_price_tier, token fields |
| `catalog/0008` | Lecture.excluded_from_subscription |
| `payouts/0005` | Earning.token_spend FK + unique constraint |

### Test Files
| File | Tests |
|------|-------|
| `commerce/tests/test_token_topups.py` | 10 tests (pack + top-up webhook fulfilment) |
| `commerce/tests/test_unlock.py` | 10 tests (lecture, course, material unlock) |
| `commerce/tests/test_packages.py` | 5 tests (cash package fulfilment) |
| `commerce/tests/test_subscriptions.py` | 10 tests (subscription access, exclusion, plans) |
| `payouts/tests/test_token_earnings.py` | 5 tests (token-spend earnings) |

---

## Architecture Decisions Implemented

1. **Content Access Resolver** (`platform.access.resolve`): Single authoritative function with 7-tier precedence (admin_revoke > legacy > package > token > subscription > preview > deny).

2. **FEFO Token Consumption**: First-Expiring-First-Out with `expires_at ASC NULLS LAST, granted_at ASC, id ASC` ordering. Weighted unit cost tracked per spend.

3. **Hamilton Distribution**: Deterministic integer token distribution across lectures using largest-remainder method.

4. **Subscription access is live-evaluated**: Not persisted as entitlement rows. Checked against `Course.in_subscription` and `Lecture.excluded_from_subscription`.

5. **Webhook idempotency**: All fulfilment functions are idempotent via `stripe_session_id` (tokens) or `note__contains=session_id` (packages).

6. **Server-authoritative pricing**: Frontend never sends amounts. All monetary values computed server-side.

---

## BLOCKED Items (require business approval)

| ID | Item | Impact |
|----|------|--------|
| T03 | Default token expiry duration | Grant expiry period TBD |
| T11/T12 | Token refund policy | No automated refunds |
| S03/C03 | Subscription certificate eligibility | Default: certificates survive lapse |
| S07 | Grace period on past_due | Duration TBD |
| S10 | Price change for grandfathered subscribers | No auto re-price |
| F02 | Bonus-token funding model | `unit_cost=0` vs dilution |
| F03/C06 | Subscription revenue share weights | Pool % and weight formula TBD |
| P06 | Package refund path | No automated refunds |

---

## Security Constraints Preserved

- `.env` contents not read or exposed
- No automatic migrations applied to production
- No push/commit/deploy executed
- API keys and credentials not printed or logged
- Platform admin only may change pricing
- Server-authoritative monetary values (never trust frontend)
- No invented business rates or percentages
- RLS applied to all new tables

---

## Known Patterns

- **Neon schema-cache artifact**: First test of first test class fails with "relation does not exist" on fresh `--keepdb` migration. Known Neon pooled-connection issue. Use `--keepdb` on subsequent runs.
- **UUID-tagged test data**: All test fixtures use `uuid.uuid4().hex[:8]` suffixes to prevent unique constraint violations across TransactionTestCase runs.

---

## Next Steps

1. Frontend implementation (React/TypeScript) for all new endpoints
2. Business approval of BLOCKED decisions
3. End-to-end Playwright tests
4. Grandfathering migration (M10 in implementation plan)
5. Feature flag gating for staged rollout
