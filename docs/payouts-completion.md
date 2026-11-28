# Payouts completion pass — 28 November 2026

Status: implementation and offline validation completed; runtime acceptance is pending.
Branch: `enhance_diaa`. No database/environment setup, migrations, Neon writes, Redis
operations, real transfers, emails or browser automation were performed.

## Changes

| Area | Implemented behavior |
| --- | --- |
| Overview | Unpaid total includes available, pending, request reservations and unsettled payouts. Positive-balance counts no longer claim everyone can be paid. Snapshot-based revenue figures remain historical. |
| Requests | One transaction-scoped advisory lock shared with scheduled bundling, approval, release and account edits. Positive amount/minimum/available checks; duplicate requests rejected. Only unbundled open requests deduct a reservation. Approval rechecks maturity, refunds and destination. |
| Balances | `available + reserved + pending + in_payout + paid = total` over signed earning records. Failed bundles still holding earnings remain visible and flagged rather than made spendable. Mismatched historical bundles and unconfirmed historical paid records require reconciliation. |
| Schedule | Existing registry defaults remain monthly, day 5, £25, 30 days. Both task entry points respect configured scheduling. Manual and scheduled bundles share approval/execution. Dates are calendar dates including today, not proof a job ran. |
| Methods | Validate destination formats, distinguish absent/unverified details, mask account identifiers, invalidate verification on changes, and prevent destination changes during reservations. Stripe verification/execution checks provider payout and transfer capability. |
| History | Held transfers are visible and can be reconciled by provider transfer ID without re-sending. Requests and corresponding payouts are not duplicated in the instructor detail history. Paid/uncertain transfers cannot be detached by fail/reject/dispute actions. |
| Settings | Atomic writes in the payout settings endpoint; minimum and hold rechecked before execution; refund-window floor retained. UI rejects fractional days and shows the effective hold. |
| Instructor integration | Reserved/unsettled funds appear in payout and earnings screens. Payout mutations invalidate affected console and studio query caches. Existing role checks and user filters remain. |

## Transfer safety

Approval commits a `held` reservation before an on-commit callback can contact Stripe.
A second committed claim records that execution may have started. Execution rejects
an enclosing transaction. A process crash, timeout, provider error, or confirmation
commit failure therefore leaves reserved funds rather than silently making them
available for another payout. The stable transfer key is `payout-{id}`. There is no
automatic replay of an attempted transfer after provider idempotency retention expires.

The provider transfer must match the payout ID in its description, amount, GBP currency,
destination and non-reversed state before payment is recorded. The signed webhook
dispatcher routes transfer events through the same retrieval/confirmation path.
Repeated confirmation cannot create another transfer. Execution also checks historical sale refunds so carry-over adjustments cannot bypass an asynchronously pending ledger reversal. A specific confirmed Stripe
`balance_insufficient` rejection releases its reservation; other failures remain held.
Authoritative reversal evidence is flagged for reconciliation without erasing the
historical payment or releasing earnings.

Provider references: [Stripe transfers](https://docs.stripe.com/api/transfers/create),
[account capabilities](https://docs.stripe.com/api/accounts/object),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests).

## Blockers and limits

- PayPal, Wise and bank have no authoritative provider-confirmation adapter. Their
  settlement actions are blocked; entering arbitrary text can no longer mark money paid.
  Approval/reservation and safe rejection remain available.
- F02/F03/C06 financial decisions remain unresolved. Token/subscription earning rows
  are preserved and held, consistent with the documented B2C finance payout block.
  K02 content-unlock gates and historical commission snapshots were not changed.
- Historical/demo data was not queried or repaired. Flags/checks expose inconsistencies
  when read; this is not evidence that existing data has been reconciled.
- A crash before dispatch can leave a queued hold; a crash around a provider request
  can leave an uncertain hold. Known transfer IDs can be reconciled through History.
  Absence of a known transfer is not proof of failure and cannot release funds. Durable
  automatic recovery/reconciliation, and accounting for confirmed reversals, need
  an approved operational workflow. No new settlement policy was invented.
- The repository has no canonical charge-dispute model integrated with earnings.
  Request disputes retain reservations, but provider charge-dispute ingestion and its
  settlement policy remain unresolved. Refund/order checks cannot substitute for that.
- Locks, RLS, real middleware commit boundaries, concurrent refunds/requests/scheduler
  execution, webhook delivery and provider sandbox behavior still need integration
  testing. The global payout lock serializes execution and is not load-tested.
- List limits remain the existing 200 balance / 500 account rows; no new pagination
  contract was introduced.

## Validation

- 18 offline service regressions passed. Offline service tests: `cd backend; venv/Scripts/python.exe -m apps.payouts.tests.run_offline`.
  The runner uses a dummy database/cache, loads no `.env`, and skips app-ready integrations.
- Targeted Ruff checks passed on payout services/APIs/tests and touched integration files.
- Frontend `tsc -b --pretty false` and focused Oxlint checks passed.
- Added five database regression tests in `test_payout_integrity_db.py`, and updated
  existing payout expectations for reservations and provider-confirmed settlement.
  These were **not run**: no authorized, exclusively available isolated PostgreSQL target
  was verified. The repository test runner can touch shared Neon test databases and
  truncate domain schemas, so it was not invoked.
- No full regression suite or end-to-end acceptance was claimed.
