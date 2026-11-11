# M7 — B2C Wallet + Token Pack + Custom Top-up (T01, T02, T03, C04 FEFO)

**Goal.** Give every B2C learner a token wallet, two ways to add tokens (pre-priced packs and
custom top-up), and a safe, atomic spending primitive used by later milestones.

**Non-negotiable constraints (from the planner brief).**
- B2C only. Do NOT create wallets for `org` tenants.
- Preserve RLS and tenant isolation. User-scoped tables get a new user-RLS helper.
- Decimal(12,2) money; Decimal(12,4) token rate; integer tokens; ROUND_HALF_UP; floor for tokens.
- Idempotent Stripe fulfillment; atomic spend with `SELECT … FOR UPDATE`.

**Mockups.** None yet; follow `docs/design/README.md` guidance for new screens.

## Scope
1. Models (additive): `TokenPack`, `TokenPackPrice`, `TokenRate`, `TokenGrant`,
   `TokenLedgerEntry`, `TokenSpend` (last two consumed by M9).
2. Services (`backend/apps/commerce/tokens.py`): `grant_from_pack`, `grant_from_topup`,
   `spend_atomic`, `expire_grants_tick` (Celery daily).
3. API (typed, add prefixes to `TYPED_PREFIXES`):
   - `GET /api/v1/wallet/me`, `GET /api/v1/wallet/me/ledger`
   - `GET /api/v1/tokens/packs`, `POST /api/v1/tokens/packs/{id}/checkout`
   - `POST /api/v1/tokens/topup/checkout`
   - `GET /api/v1/tokens/rate`
4. Webhook: branches for `metadata.kind in {token_pack, token_topup}` in
   `backend/apps/commerce/webhooks.py`; dedupe via existing `StripeEvent` inbox AND unique
   `stripe_session_id` on `TokenGrant`.
5. RLS: new `core.rls.enable_user_rls_sql` helper; `core/tests/test_rls.py` extended.
6. Frontend: Wallet page (balance, soon-to-expire, ledger), buy-pack sheet, custom top-up sheet.

## Acceptance
1. Buying pack `starter-100` via Stripe test card credits exactly 100 tokens (plus bonus if
   defined) once, even when the webhook is replayed.
2. Custom top-up £5.03 at rate 0.1000 credits exactly 50 tokens; the receipt shows an "unused
   £0.03" line.
3. FEFO: two grants with different expiries consume oldest first in a spend test.
4. `_user_rls_` test confirms learner A cannot query learner B's grants or ledger.
5. Daily expiry job marks expired grant remainder into a `TokenLedgerEntry(kind=expiry)` and
   sends a notification 7 days ahead.

## BLOCKED (would prevent GA)
- **T03 default grant expiry duration** — must be set in platform settings before the pack SKU
  seed can be published. Scaffolding can ship; staff-only visibility until approved.
- **T02a top-up overflow policy** — UI shows "unused" until decided.

## Dependencies
None. This is the foundation milestone.
