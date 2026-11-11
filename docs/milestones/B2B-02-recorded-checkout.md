# B2B-02 — Recorded Package Checkout + Stripe Invoicing

**Goal.** Enable corporate customers to purchase recorded course seat packages via Stripe Checkout
and receive custom quotes via Stripe Invoicing. Only verified payment triggers seat credit.

**Non-negotiable constraints.**
- Extend EXISTING Stripe gateway — do NOT build a second payment adapter.
- Stripe Checkout AND Stripe Invoicing supported (P11).
- Only company Owner/Admin may purchase (P10).
- Invoice created/sent is NOT payment — only `invoice.paid` webhook triggers fulfillment.
- Idempotent: one paid event fulfills once only, even with retries/out-of-order callbacks.
- Price and currency snapshot at checkout time; no retroactive price changes.
- Keep old team subscription entitlements intact (no new B2B subscriptions).

## Scope

1. **Gateway extension:** `create_invoice()`, `send_invoice()`, `finalize_invoice()`,
   `void_invoice()` in `backend/apps/commerce/gateway.py`.
2. **Checkout service:** `backend/apps/corporate/checkout.py` — Stripe Checkout flow for N seats.
3. **Quote service:** `backend/apps/corporate/quotes.py` — admin creates quote → Stripe Invoice.
4. **Model:** `CorporateQuote` (TenantModel) — draft/sent/accepted/expired/voided lifecycle.
5. **Webhooks:** `kind="corporate_recorded"` in checkout.session.completed; `invoice.paid` for
   B2B invoice fulfillment.
6. **Company API:** package listing, checkout, purchase history, quote acceptance.
7. **Console API:** quote CRUD, send, void.

## Out of scope
- Live training payment (B2B-04)
- Seat allocation (already in B2B-01)
- Frontend (B2B-06)

## Acceptance

1. CompanyA admin checks out 5 recorded seats → SeatPurchase(pending) created → Stripe webhook
   → status=paid, 5 available allocations.
2. Duplicate `checkout.session.completed` event → no double seat credit.
3. Failed Stripe payment → SeatPurchase stays pending, no allocations.
4. Admin creates quote for CompanyB → sends via Stripe Invoice → CompanyB pays → seats credited.
5. Stale quote (past valid_until) → acceptance rejected.
6. Only owner/admin buyer role → manager gets 403.
7. Currency matches offering price at time of checkout.
8. Two concurrent buyers for same offering → each gets own SeatPurchase.
9. B2C cart/order/subscription checkout unaffected (regression test).
10. Stripe Invoice hosted link delivered to company contact.

## BLOCKED
None — payment mechanics are approved.

## Dependencies
B2B-01 approved (seat ledger models exist).
