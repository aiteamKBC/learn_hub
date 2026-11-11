# M15 — B2C Reporting (A05)

**Goal.** Give staff a single console page with the KPIs that matter for the token / package /
subscription economy.

## Scope
1. Extend `backend/apps/platform/console/reports.py` with aggregates:
   - Wallet balance total (sum of `TokenGrant.remaining_qty`, time-bucketed).
   - Tokens outstanding vs expired (source-split: pack / topup / bonus / admin).
   - Token revenue (sum of cash-backed token grants, GBP).
   - Package GMV (sum of `OrderItem.gbp_gross_minor` where source=cash_package).
   - Unlimited MRR (sum of active subscriptions at interval=monthly, annualised at
     interval=annual, in GBP).
   - B2C ARPU, conversion to paid.
2. Reuse keyset pagination and the console reports pattern (see existing `reports.py`).
3. CSV export reuses existing report-export plumbing.

## Acceptance
1. Dashboard tile values match a direct SQL spot-check within ±1 minor unit.
2. Export CSV header is stable across runs; opens in Excel without mojibake (UTF-8 BOM).

## BLOCKED
None — reporting is read-only aggregation.

## Dependencies
M7–M14.
