# B2B-04 — Live Payment / Time-Bound Seat Reservations

**Goal.** After admin confirms a live cohort and schedule, enable companies to pay for reserved
live seats via Stripe Checkout or Invoice. Unpaid holds expire and release capacity.

**Non-negotiable constraints.**
- Payment is AFTER admin confirms cohort and schedule (L04).
- Only company Owner/Admin may pay (P10).
- Atomic capacity checks — never oversell a cohort.
- Admin-configured reservation TTL; expired unpaid holds release seats.
- Live access ends at cohort completion — NOT modeled as a subscription.
- Stripe only (Checkout + Invoicing). No offline payment fulfillment.
- Idempotent: one paid event fulfills once only.
- No automatic partial-refund calculation (G04); admin reviews individually.

## Scope

1. **Model:** `LiveReservation` (TenantModel) — held/paid/expired/cancelled lifecycle.
2. **Service:** `backend/apps/corporate/live_checkout.py` — checkout, capacity lock, fulfillment.
3. **Tasks:** `backend/apps/corporate/tasks.py` — Celery periodic cleanup of expired holds.
4. **Webhooks:** `kind="corporate_live"` dispatch in `commerce/webhooks.py`.
5. **Company API:** live checkout for confirmed cohort seats.
6. **Console API:** manage reservations, extend deadlines.

## Out of scope
- Cohort formation / scheduling (B2B-03)
- Zoom attendance (B2B-05)
- Refund calculation (GATE G04)

## Acceptance

1. Company pays for N live seats → CohortCompany.status=paid, seats_confirmed=N.
2. Two companies race for last seats → one succeeds, other gets capacity error.
3. Expired hold → seats released, CohortCompany.status=expired.
4. Duplicate `invoice.paid` / `checkout.session.completed` → idempotent.
5. Admin-reviewed refund → manual Stripe refund, reservation cancelled, audit logged.
6. Cohort cancellation → all reservations cancelled, refund path initiated.
7. Payment after deadline → reservation expired, payment rejected.
8. Live access tied to cohort end date, not a renewable subscription.
9. Concurrent reserve/pay operations → atomic capacity via SELECT FOR UPDATE.

## BLOCKED
- **G04** — Partial attendance / postponed cohort refund calculation: admin case-by-case only.

## Dependencies
B2B-03 approved (cohort and session models exist).
