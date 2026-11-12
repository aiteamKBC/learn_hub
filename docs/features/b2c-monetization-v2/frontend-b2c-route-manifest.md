# B2C Frontend — Route / Nav Manifest (for the integrator)

Developer A (B2C) · branch `feat/frontend-b2c-v2` · prepared 2026-11-11

This lists the new learner-facing routes to wire into the reserved shared files
(`src/app/router.tsx`, nav/layout). Feature code is self-contained; route + nav integration is
the integrator's step, done after the feature PR (per the handoff).

## Shared baseline prepared by the integrator (done)
- **OpenAPI types regenerated** from the audited backend into `frontend/src/api/schema.d.ts`
  (`backend/venv python tools/dump_openapi.py` → `npx openapi-typescript ../logs/openapi.json`).
  The previous committed `schema.d.ts` predated the entire B2C token backend; it now contains all
  15 learner token endpoints plus the console pricing/wallet surface.

## New routes

All routes are **personal / learner** and require an authenticated user (`RequireAuth`). None take a
company role; all money/wallet calls send `X-Org-Id: ''` from the feature layer regardless of the
selected workspace.

| Requested path | Component export | Lazy import | Route `handle.art` | Auth |
|---|---|---|---|---|
| `/wallet` | `WalletPage` | `@/pages/b2c/WalletPage` | `coins` | RequireAuth |
| `/wallet/buy` | `TokenBuyPage` | `@/pages/b2c/TokenBuyPage` | `coins` | RequireAuth |
| `/wallet/result` | `TokenResultPage` | `@/pages/b2c/TokenResultPage` | `coins` | RequireAuth |
| `/subscription` | `SubscriptionPage` | `@/pages/b2c/SubscriptionPage` | `aurora` | RequireAuth |
| `/packages` | `PackagesPage` | `@/pages/b2c/PackagesPage` | `ribbons` | RequireAuth |

### Admin console routes (staff only — mount inside `pages/console/ConsoleShell.tsx`)

| Requested path | Component export | Lazy import | Required role |
|---|---|---|---|
| `/console/token-pricing` | `TokenPricingPage` | `@/pages/console/b2c/TokenPricingPage` | staff (platform admin) |
| `/console/wallets` | `AdminWalletPage` | `@/pages/console/b2c/AdminWalletPage` | staff (platform admin) |

Add nav entries in the console shell (e.g. under a "Monetization" group): "Token pricing" → `/console/token-pricing`, "Wallets" → `/console/wallets`. These call `/console/pricing/token/*` and `/console/wallet/*`, which require `StaffSessionAuth` + `staff(request)`.

Suggested registration (mirrors the existing `named()` + `page()` pattern):

```tsx
const WalletPage = named(() => import('@/pages/b2c/WalletPage'), 'WalletPage')
const TokenBuyPage = named(() => import('@/pages/b2c/TokenBuyPage'), 'TokenBuyPage')
const TokenResultPage = named(() => import('@/pages/b2c/TokenResultPage'), 'TokenResultPage')
const SubscriptionPage = named(() => import('@/pages/b2c/SubscriptionPage'), 'SubscriptionPage')
const PackagesPage = named(() => import('@/pages/b2c/PackagesPage'), 'PackagesPage')

// inside the authed learner branch of the tree:
{ path: '/wallet', element: page(<WalletPage />), handle: { art: 'coins' } },
{ path: '/wallet/buy', element: page(<TokenBuyPage />), handle: { art: 'coins' } },
{ path: '/wallet/result', element: page(<TokenResultPage />), handle: { art: 'coins' } },
{ path: '/subscription', element: page(<SubscriptionPage />), handle: { art: 'aurora' } },
{ path: '/packages', element: page(<PackagesPage />), handle: { art: 'ribbons' } },
```

`/wallet`, `/wallet/buy`, `/subscription`, `/packages` sit under `RequireAuth` like `/cart`.
`/wallet/result` is the Stripe return page for token packs and custom top-ups (needs auth).

## Navigation entries (learner account/profile menu)
- **Wallet** → `/wallet` (icon: `Wallet` / `Coins`)
- **Unlimited plan** → `/subscription` (icon: `Crown`)
- **Course bundles** → `/packages` (icon: `Package`)

These are personal entries; show them in the learner space, not the business/console shells.

## Cross-links already in the feature code (no action needed)
- Wallet → `/wallet/buy`; Buy → `/wallet` and `/wallet/result`; UnlockButton (insufficient) → `/wallet/buy`.
- Subscription "Manage/cancel" → existing `/api/v1/commerce/billing-portal` (Stripe portal).
- Package success → `/learn` (My Learning reflects real server-granted enrolments).

## Not yet wired into existing shared pages (follow-up, same branch)
- `CoursePage.tsx`: entitlement-vs-purchase actions, locked-metadata display, full-course + per-lecture
  token unlock via `UnlockButton` (`@/features/b2c/UnlockButton`).
- Player (`pages/learn/**`): access-resolver gating, independently paid resources, wallet-insufficient flow.
- `PlansPage.tsx`: remove the NEW Team Subscription purchase (deliverable 10).
- Admin console (`pages/console/b2c/**`): deferred — learner-first per owner decision (2026-11-11).

## Stripe webhook events required for fulfilment to reflect in the UI
The learner flows rely on these already-handled events (see `backend/apps/commerce/webhooks.py`):
`checkout.session.completed` / `checkout.session.async_payment_succeeded` with metadata
`kind ∈ {token_pack, token_topup, cash_package}` and the subscription events. Local dev must run
`stripe listen` (see build-status.md) or token top-ups won't credit the wallet — there is **no**
server reconcile-by-session for token purchases (unlike orders), so the result page polls the
balance and degrades gracefully on timeout.
