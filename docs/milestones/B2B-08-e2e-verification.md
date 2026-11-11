





















































































































































































































































































































































































































































































# B2B-08 — End-to-End Security, Finance & Regression Verification

**Goal.** Comprehensive verification of all B2B features: multi-company isolation, Stripe payment
integrity, Zoom privacy, B2C regression, and a published PASS/FAIL/BLOCKED audit report.

**Non-negotiable constraints.**
- All tests on isolated development environment only. No production database.
- No live Stripe charges, real Zoom secrets, or real notifications without explicit permission.
- Classify each area as PASS / PASS WITH BLOCKERS / FAIL with actual evidence.
- Clearly list skipped or unrun tests.
- Do not claim production readiness with unresolved critical policy gates.

## Scope

1. **Multi-company RLS isolation:** 2+ companies in same cohort — complete data separation for
   seats, allocations, attendance, progress, certificates.
2. **Stripe idempotency:** Duplicate checkout events, duplicate invoice events, concurrent
   payments, failed→retry sequences, partial refund flows.
3. **Seat accounting:** Correct counts after purchase, allocation, revocation, reassignment,
   refund, cancellation.
4. **Zoom security:** Spoofed webhooks, invalid signatures, missing emails, shared attendee
   accounts, reconnections, multiple-company isolation.
5. **Access control:** Role boundaries (owner/admin/manager/learner/tutor/staff), first-session
   schedule visibility, personal B2C isolation.
6. **B2C regression:** Existing token wallet, unlock, packages, subscriptions, payouts all pass.
7. **Historical compatibility:** Team subscription entitlements preserved, old corporate
   subscribers unaffected.
8. **Concurrency:** Concurrent reserve/checkout/allocate operations, replay protection.
9. **Audit trail:** All admin actions logged (seat changes, refunds, schedule changes, tutor
   assignments, attendance overrides).
10. **Frontend:** Build succeeds, API contract sync passes, no type errors.
11. **Report:** Published at `docs/features/b2b-packages-v1/e2e-report.md` with specific
    file paths, test commands, and exact findings.

## Out of scope
- Performance / load testing
- Production deployment
- User acceptance testing with real companies

## Acceptance

1. All B2B test files pass individually (known Neon pooler deadlock excluded from batch runs).
2. All B2C test files pass individually (regression verified).
3. RLS tests confirm corporate tables enforce company isolation.
4. Stripe webhook tests confirm idempotent fulfillment for all B2B event types.
5. Zoom webhook tests confirm signature verification and identity matching.
6. Seat accounting balances after all lifecycle operations.
7. Access control tests verify every role boundary.
8. Audit log contains entries for every admin action.
9. Frontend build completes without errors.
10. E2E report classifies every acceptance criterion with evidence.

## BLOCKED (documented in report, not blocking the test milestone)
All unresolved gates reported with impact assessment:
- **G01** — Live certificate criteria
- **G02** — Physical attendance evidence
- **G03** — Tutor cross-company data scope
- **G04** — Cancellation/refund rules
- **G05** — Course delisting with prepaid seats
- **G06** — Recorded access expiry vs inventory lifetime
- **G07** — Employer departure policy
- **G08** — Level compatibility without Skills Radar
- **G09** — Recorded certificate rule changes

## Dependencies
All prior milestones (B2B-01 through B2B-07) approved and implemented.
