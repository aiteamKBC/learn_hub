# B2C course payments completion

The console page now reads canonical settings and saves promotion stacking through
`PUT /api/v1/console/settings`, retaining staff authorisation, validation and audit.
Saving invalidates settings and basket queries. Existing server pricing applies
this setting to eligible individual-course baskets; package prices and personal
subscription offers retain their existing rules.

Card and wallet availability remains controlled by the existing Stripe integration.
There is no second payment-method toggle or new setting/table. A typed, read-only
configuration endpoint reports presence of server/browser configuration and the
existing K02 deployment flag, without returning credentials or calling Stripe.
The UI distinguishes configured from verified connectivity and conditional wallet
eligibility, and separates token/subscription entitlements from payment methods.
No VAT calculation or invoice policy switch has been introduced.

B2C checkout validates the existing active/Stripe-supported currency flags for
packages, token packs and personal subscriptions as well as individual courses.
Package conversion now uses the stored ISO exponent, not Stripe's exponent.
Unrepresentable B2C amounts fail closed instead of silently truncating. These
checks use the existing gateway conversion and preserve purchase snapshots and
fulfilment paths. Existing entitlements and K02 unlock restrictions are unchanged.
Company subscription currency validation and invoicing behaviour are unchanged.

## Validation and limits

- Focused database-free SimpleTestCase regressions run with dummy DB backend,
  dotenv loading disabled and local-memory cache. No database tests or external
  service calls are required by this suite.
- Targeted Ruff, TypeScript and diff checks are recorded in the final report.
- API types generated from an offline Django schema; unrelated generated report
  changes are left for the Reports session.
- No environment launched, migrations/seeds executed, real payments made, emails
  sent or shared Redis used. No browser/runtime acceptance claimed.
- Concurrent Commissions/Payouts/Reports work, including package accounting,
  is not part of this commit. Only our package currency-conversion hunk is staged.

## Outstanding policies and acceptance

Stripe Tax/VAT policy remains unresolved (client question 4). This page cannot
activate tax collection. Stripe account configuration, wallet/device eligibility,
provider price agreement for subscriptions, webhook delivery and end-to-end refund
reconciliation require provider-backed acceptance. Existing provider price IDs
are reused; this work does not remotely verify their amounts or change them.

Manual localhost acceptance on the already-running environment:

1. As staff, open `/console/course-payments`. Confirm loading/error/retry states,
   provider-managed status, K02 state, tax display and the revised process diagram.
2. Change promotion stacking, save and reload. Check Settings → Payment shows the
   same value; discard must make no request. Verify a learner cannot PUT settings.
3. With eligible course promotions/coupons, compare basket and server checkout
   totals with stacking off/on. Confirm an open basket refreshes after saving.
4. Check course, package, token-pack and personal-subscription checkout in an
   active supported currency. With an inactive/unsupported currency, direct API
   checkout must reject it, including GBP fallback where applicable. Inspect
   package ISO/Stripe conversion (for example ISK) in an isolated test fixture.
5. In Stripe test mode only, verify eligible wallets appear on supported devices
   and absent wallets are not promised. Test hosted checkout when embedded browser
   configuration is missing. Do not perform real payments.
6. Returning/cancelling from Stripe must not grant paid access. Verify signed paid
   events, replay idempotency and refunds in an isolated test setup. Recheck
   historical token access and personal subscription eligibility/expiry; new token
   unlocks remain refused when K02 is disabled. Check company invoice/transfer
   flows remain unchanged.

## Scoped currency follow-up

Requested B2C checkout currencies are now validated before GBP price fallback.
Supported currencies with no configured product price still fall back to GBP.
The explicit subscription request is checked before the display-currency resolver
can substitute another currency; direct package/subscription service calls and
resolved token-pack currencies are checked before looking up fallback prices.

For new B2C UGX amounts, [Stripe's special-case rule](https://docs.stripe.com/currencies#special-cases)
requires two-decimal API units ending in 00: 5 UGX is sent as 500. Fractional
shillings are rejected. New UGX orders record their conversion convention and
stored exponent in the existing audit store. Payment verification and partial
refunds use that convention; historical orders without the marker and B2B retain
the previous conversion path. No historical rows are rewritten, and already-paid
webhook replays still return without re-verification. K02/F02 rules are untouched.

Validation: database-free regression tests, targeted Ruff and diff checks only.
The runner disables dotenv loading, uses a dummy database and local-memory cache.
No database, provider, browser or environment setup operations were performed.
