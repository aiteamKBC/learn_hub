# Reports and analytics completion record — 2026-11-28

Status: implemented confirmed corrections; **not fully accepted**. No live database or browser evidence was obtained. Work remains blocked on historical source data/policy and authorised runtime verification.

## Five tabs

- Overview: canonical paid order totals, paid subscription invoices and confirmed course instalments; separate gross order list value, discounts, successful refunds and known net collected; current course/billing-subscription snapshots explicitly distinguished from period metrics. Zero-baseline percentage remains unavailable rather than fabricated.
- Sales: one receipt per order; order-linked invoices excluded; order items used only for frozen course allocations, not counted as additional receipts. Confirmed instalments appear separately. Currency exponents used in UI/CSV. Unknown invoice/instalment FX is excluded from GBP and disclosed, retained in native-currency totals. Token consumption never counted as cash.
- Students: non-staff, non-anonymised account population matches Students admin; suspended accounts retained. Scoped cohorts require enrolment by each respective period endpoint. Distinct active learners use recorded watch events, quiz starts, submissions and completions. Enrolment sources/counts remain separate from distinct learners.
- Courses: rankings explicitly by period enrolments; completions measured by completion date independently of enrolment date; deleted/unpublished course history retained; only published reviews aggregated. Only existing order-item allocations attributed; no new package allocation rules.
- Subscriptions: only paid invoice amounts, never current prices; legacy personal plans included by org-null scope. Current billing status distinguishes expiry, cancelled, trialling and past due. Billing counts do not claim K02 content eligibility. Plan totals and chart use the same receipt aggregation. Course filters explicitly disable subscription reporting.

## Filters, exports and performance

Personal, company and combined scopes apply to transactions, subscriptions and enrolments. Category includes direct children, matching Sales. Published course inventory is explicitly cross-scope. Report types apply on Generate and both exports use applied selections. CSV pins the displayed end timestamp for rolling windows, includes complete sales/course rows, per-currency totals and status counts; sanitises formula prefixes including whitespace. Export errors surface with retry by repeating export. Chart date labels have space independent of daily hit-target width.

Orders/items are read in batches of 500. Both periods aggregate daily/product/plan/currency totals once. Interactive results retain ten recent receipts; previous-period detail retains none. Export materialises full filtered results inside the request/RLS transaction before streaming. Large-export memory and query budgets still need runtime measurement.

## Financial reconciliation findings and blockers

- Reports uses Order.gbp_total_minor and OrderItem.gbp_gross_minor, the same frozen consideration consumed by Sales, Commissions and payout reconciliation. Successful Refund records establish refund cash; full refunds reuse item GBP, partial recorded amounts use the existing GBP conversion helper and checkout FX. Partial refund earnings reconciliation remains a separate policy/runtime check; no earnings are recomputed.
- New cash packages represented by paid orders and frozen item allocations are naturally included exactly once. Historical entitlement-only packages have no authoritative cash receipt/allocation; no totals or allocations are invented.
- Token grants store rounded unit cost, and pack grants historically stored payment-currency amounts in a field named GBP. They do not supply reliable payment amount/currency/FX. Token cash purchases therefore remain excluded and visibly flagged. Recovering immutable receipts requires a separate approved financial-data task.
- Subscription invoices have no payment timestamp or frozen historical FX. Reports uses issue-date timing, actual paid amounts and only known GBP values. Native totals preserve foreign receipts. Sales & Subscriptions still use latest-rate conversion in their existing metrics; their GBP totals can differ. Choosing/backfilling historical invoice FX or changing those modules requires a coordinated follow-up, not invented conversion rules.
- Invoices point to the subscription's current plan, not a historical plan snapshot. Plan changes cannot be reconstructed reliably; this limitation is shown in reporting notes.
- Personal/company scope here uses existing org ownership. Separate corporate seat/stage settlement ledgers and legacy company reporting remain untouched; this report is not a certified consolidation of every corporate billing ledger.
- Current subscription status is not historical entitlement evidence. K02/F02 were untouched. No live invoice, receipt, earning or payout reconciliation was executed, so cross-module financial acceptance is pending.

## Validation

- Database-free runner: 10 tests pass (network socket connections and dotenv loading disabled; dummy database backend).
- Coverage: exact period boundaries, zero baselines, CSV injection, mixed currency exponents/native totals, anchored export cutoff, scope validation, partial refund conversion, no duplicate order invoice projection, complete aggregate totals despite bounded recent details.
- Three focused database regressions added to test_console_reports.py for completion/review eligibility, >10 row export/deleted history, and invalid filters. Not executed: no verified, authorised, exclusively available isolated test DB was established. Existing two report integration tests also remain unexecuted.
- OpenAPI generated offline; only generated Reports schemas/operations copied into the shared type file to preserve concurrent work.
- Targeted Ruff, frontend TypeScript and git diff checks run; see logs/reports-*.log. Repository reviewer inspected the changes; findings addressed, including native-currency export totals.
- No browser acceptance, full suite, migration/schema/seed, Neon write, external FX call, payment, email or Redis operation was performed. No runtime or full acceptance claim.
