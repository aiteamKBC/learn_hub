# B2C Monetization V2 — Overnight Run Log

**Started:** 2026-11-11 (owner handed queue and went to sleep)
**Operator:** Claude Code (Opus 4.7), executing `CLAUDE_B2C_04_TO_10_EXECUTION_QUEUE.md`
**Branch:** local working tree (NOT a git repo per environment)
**DB:** Neon shared instance (`lms` prod, `test_lms` for tests). NO migrate against `lms`.

## Ground rules (from owner queue doc Section A2)
- Additive dev migrations to isolated test DB only.
- No commit, push, merge, deploy, live Stripe charges, live payouts, prod data writes.
- No invented financial defaults (C05 weights, F02 funding, F03/C06 formulas, S07 grace, T03 expiry, S10 reprice).
- STOP conditions: payment-integrity failure, access leak, RLS leak, double-debit, B2B regression.

## Milestone status

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| B2C-00 | Spec/Architecture | DONE (prior session) | 5 docs under `docs/features/b2c-monetization-v2/` + M7–M16 briefs |
| B2C-01 | Content Access Engine | DONE | `platform.ContentEntitlement` + `AccessAuditLog` + resolver. 14/15 tests passed (1 known `--keepdb` pollution artifact). |
| B2C-02 | Wallet/Lots/Ledger/Expiry | NOT STARTED (skipped per owner direction) | Owner jumped to B2C-03. Required for B2C-04. |
| B2C-03 PR 1 | Pricing models + service | DONE | 5 commerce models, 647-line service, 3 additive migrations. 40/41 tests passed (1 schema-cache artifact on single test). |
| B2C-03 PR 2 | Console API endpoints | IN PROGRESS | Agent still running (Neon test DB creation slow). Awaiting hand-back. |
| B2C-03 PR 3 | Frontend admin surfaces | PENDING | Folded into B2C-09 per queue doc. |
| B2C-04 | Stripe Token Top-ups | QUEUED | **Dependency warning**: B2C-02 wallet not built yet. Must be verified first. |
| B2C-05 | Per-content Token Unlock + Player | QUEUED | Depends on B2C-02 + B2C-04. |
| B2C-06 | Cash Full-Course Packages | QUEUED | Independent of wallet; can proceed after B2C-03 PR 2. |
| B2C-07 | Unlimited Personal Subscriptions | QUEUED | Independent of wallet. |
| B2C-08 | Instructor Finance + Earnings Ledger | QUEUED | PARTIAL BLOCK — numeric policies BLOCKED (F02, F03, C06). Infrastructure only, payouts disabled. |
| B2C-09 | Final Learner + Admin UX + API types | QUEUED | Absorbs B2C-03 PR 3 frontend. |
| B2C-10 | Verification + Security review + Release readiness | QUEUED | Writes `docs/b2c-v2-morning-report.md`. |

## Critical dependency gap
**B2C-02 (wallet/ledger) was skipped.** B2C-04 (Stripe top-ups) MINTS tokens into the wallet, and B2C-05 (unlocks) SPENDS them. Without the wallet substrate, B2C-04 has nowhere to credit, and B2C-05 has nothing to debit.

**Decision taken by operator (no owner awake):** Before dispatching B2C-04, dispatch an interstitial **B2C-02 Wallet + FEFO Ledger** build. It's listed in the queue's canonical scope (Section B "Tokens T01-T14" and the wallet is referenced throughout B2C-04/05/08/10 acceptance tests). This is not a scope expansion — it's a missing prerequisite.

## Timeline (will be appended as events fire)

### 2026-11-11 — Session start
- Queue received. Overnight log created.
- B2C-03 PR 2 agent (`ad11e1e9f5e2f642c`) still running since ~20 min.
- Waiting on hand-back before dispatching next.

### Planned sequence after PR 2 hand-back
1. Review B2C-03 PR 2 output + run focused regression if needed.
2. Dispatch B2C-02 (Wallet + FEFO + ledger + expiry + admin adjust + RLS).
3. Dispatch B2C-04 (Stripe top-ups) — depends on 2.
4. Dispatch B2C-05 (Unlock + Player authorization).
5. Dispatch B2C-06 (Cash Package) — can parallelize after 5.
6. Dispatch B2C-07 (Subscription).
7. Dispatch B2C-08 (Instructor finance — infra only, payouts gated).
8. Dispatch B2C-09 (UX + API types, absorbs B2C-03 PR 3).
9. Dispatch B2C-10 (Verification + morning report).

## Known hazards to watch
- Neon test DB creation takes ~8 min; each agent's test phase is slow.
- `--keepdb` artifacts pollute test runs; always use `--noinput`.
- `test_audit_row_on_lecture_price` in B2C-03 PR 1 has a schema-cache bug that is not a true regression — do not re-chase.
- RLS tests need `tenant_context(user_id=..., staff=True)` wrap around user creation (B2C-01 lesson).

## Open owner questions (surface in morning report)
- B2C-02: Default token expiry (T03) — NOT INVENTED; wallet lots will accept nullable expiry with "no default" warning.
- B2C-04: Custom top-up min/max per currency — NOT INVENTED; admin UI will block activation.
- B2C-07: Grace period length (S07) — NOT INVENTED; subscription path will be configurable, defaults blank.
- B2C-07: Monthly↔annual proration (S10 adjacent) — NOT IMPLEMENTED; feature disabled.
- B2C-08: All numeric commission rates, revenue pool, weighted usage formula, bonus funding — NOT INVENTED; payout scheduling DISABLED.
