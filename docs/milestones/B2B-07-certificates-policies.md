# B2B-07 — Certificates / Cancellations / Company Departure Policies

**Goal.** Handle corporate certificate issuance, cohort cancellation/postponement workflows,
manual refund processing, and configurable company departure policies.

**Non-negotiable constraints.**
- Preserve existing recorded certificate behavior and history — no changes to existing logic.
- Do NOT invent live certificate attendance thresholds (GATE G01).
- No automated partial-refund calculation (GATE G04) — admin reviews individually.
- Employer departure policy configurable per company (GATE G07).
- Never overwrite historical completions or training evidence.
- Keep company training rights separate from personal B2C.
- Stripe refunds are manual admin operations with full audit trail.
- All policy decisions audited; all admin overrides recorded.

## Scope

1. **Recorded certificates:** Reuse existing `learning.issue_certificate()`. No changes needed.
   Certificate auto-issues on course completion for corporate enrollments as it does for personal.
2. **Live certificates:** Framework implemented (model/service), but issuance BLOCKED until
   G01 resolved. `ConfigurationBlocked` raised on attempt.
3. **Cancellation workflows:** `CancellationRequest` model for cohort cancel, recorded refund,
   postponement. Admin reviews and processes manually.
4. **Refund processing:** Admin sets refund amount → Stripe refund via existing `gateway.refund()`.
5. **Departure policy:** `DeparturePolicy` per company — options: revoke_all, preserve_completed,
   admin_decides. Applied when employee is removed from org.

## Out of scope
- Automated refund formulas
- Skills-based certificate criteria
- Tutor compensation

## Acceptance

1. Recorded corporate enrollment completion → certificate auto-issued (existing flow, regression).
2. Live certificate issuance → raises `ConfigurationBlocked` (G01 not resolved).
3. Cohort cancellation request → admin reviews → approves → reservations cancelled, refund path.
4. Postponed cohort → sessions rescheduled, affected companies notified.
5. Admin sets refund amount and processes → Stripe refund created, audit logged.
6. No automatic partial-refund ever calculated by system.
7. Departure policy=revoke_all → all active enrollments revoked, certificates preserved.
8. Departure policy=preserve_completed → completed enrollments/certs kept, active revoked.
9. Historical training evidence never deleted or overwritten.
10. Company-paid training never accidentally transfers to personal ownership.

## BLOCKED (must be resolved by owner before this milestone ships)
- **G01** — Live certificate criteria (attendance threshold? tutor approval? graded assessment?).
- **G04** — Cancellation/refund calculation rules and fee structures.
- **G07** — Employer departure policy: allowable options, authorization, date/transition rules.

## Dependencies
B2B-04 approved (live payment and reservation models exist).
Policy gates G01, G04, G07 resolved by owner (or features marked BLOCKED in delivery).
