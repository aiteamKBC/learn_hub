# M10 — Cash Course Package (P01–P07)

**Goal.** A one-off cash SKU that bundles N courses at a fixed price, with pro-rata instructor
revenue, reusing existing Stripe checkout.

## Scope
1. Models: `commerce.CashPackage`, `CashPackagePrice`, `CashPackageCourse` (with
   `snapshot_gbp_minor` set at include-time).
2. Checkout: `POST /api/v1/packages/{id}/checkout`, `/api/v1/packages` listing.
3. Fulfillment (webhook branch): creates `Order` + per-course `OrderItem` rows +
   `ContentEntitlement(source=package)` per course. Idempotent via Stripe inbox.
4. Revenue: `payouts.services.record_sale` recognises `CashPackage` items, allocates revenue
   pro-rata on `snapshot_gbp_minor`, applies each instructor's `platform_fee_bps`.
5. Resolver (`platform.access.resolve`) gains the `package` branch.
6. Frontend: package landing page + package card in catalogue.

## Acceptance
1. Buying a £80 package of two courses (list £40 and £60) writes two entitlements and
   earnings of £32-weighted and £48-weighted respectively (each × instructor's share).
2. Refund (staff-triggered) flips both entitlements to revoked and writes paired refund
   earnings. Pre-existing entitlements from other sources are untouched.
3. Changing the package's course set after launch does NOT re-snapshot earlier buyers.

## BLOCKED
- **P06 certificate interaction on refund** — until approved, certificates issued during
  package access are NOT auto-revoked on refund; staff can revoke manually.
- **P04 package price floor** — soft rule only; no enforcement until confirmed.

## Dependencies
M9 (resolver + entitlement model).
