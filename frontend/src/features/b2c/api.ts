/** B2C monetization (personal): token wallet, token packs + custom top-up, per-content
 * unlock, access resolution, unlimited personal subscription, and cash course packages.
 *
 * Invariants enforced here (see LEARNHUB_FRONTEND_A_B2C_HANDOFF.md):
 *  - Personal money/wallet requests always send `X-Org-Id: ''` so a corporate workspace
 *    never pays or reads a personal wallet.
 *  - The browser never computes a chargeable amount. Every checkout is server-authoritative
 *    and returns a Stripe hosted-checkout URL.
 *  - Access is decided by the server resolver, never by catalog price fields.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { useMe } from '@/features/identity/auth'
import { useCurrency } from '@/lib/currency'

/** Personal space: money and wallet live on the person, not the selected company. */
const PERSONAL = { 'X-Org-Id': '' }

/** Absolute URLs Stripe redirects back to (Stripe requires absolute URLs). */
export function returnUrl(path: string): string {
  return `${window.location.origin}${path}`
}

export type UnlockScope = 'course' | 'lecture' | 'material'

// ------------------------------------------------------------------ wallet
export function useWalletBalance(opts: { enabled?: boolean; poll?: boolean; baseline?: number } = {}) {
  const { enabled = true, poll = false, baseline } = opts
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['b2c-wallet-balance'],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/wallet/balance', { headers: PERSONAL })),
    enabled: enabled && !!me,
    staleTime: poll ? 0 : 30_000,
    // After a Stripe top-up we poll until the webhook credits the wallet (balance rises above
    // the pre-checkout baseline). We never assume success from the return URL alone.
    refetchInterval: (q) => {
      if (!poll) return false
      const cur = q.state.data?.balance
      if (baseline != null && cur != null && cur > baseline) return false
      return q.state.dataUpdateCount < 40 ? 1500 : false
    },
  })
}

export function useWalletGrants(limit = 50) {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['b2c-wallet-grants', limit],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/wallet/grants', { params: { query: { limit } }, headers: PERSONAL })),
    enabled: !!me,
  })
}

export function useWalletLedger(limit = 50) {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['b2c-wallet-ledger', limit],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/wallet/ledger', { params: { query: { limit } }, headers: PERSONAL })),
    enabled: !!me,
  })
}

/** Invalidate everything a confirmed spend or purchase changes. */
export function useWalletRefresh() {
  const qc = useQueryClient()
  return () =>
    qc.invalidateQueries({
      predicate: (q) =>
        ['b2c-wallet-balance', 'b2c-wallet-grants', 'b2c-wallet-ledger', 'b2c-access', 'b2c-my-subscription', 'course', 'my-courses', 'enrollment'].includes(
          String(q.queryKey[0]),
        ),
    })
}

// ------------------------------------------------------------------ packs + rate + top-up limits
export function useTokenPacks() {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['b2c-token-packs', code],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/packs', { params: { query: { currency: code } } })),
  })
}

/** The token exchange rate. `null` means an admin has not set one — a truthful not-configured state. */
export function useTokenRate() {
  return useQuery({
    queryKey: ['b2c-token-rate'],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/rate')),
    staleTime: 5 * 60_000,
  })
}

/** Custom top-up bounds for a currency. `null` means no policy configured for it. */
export function useTopUpLimits() {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['b2c-topup-limits', code],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/topup-limits', { params: { query: { currency: code } } })),
  })
}

export function usePackCheckout() {
  return useMutation({
    mutationFn: (v: { packId: string; successPath: string; cancelPath: string; customerEmail?: string }) =>
      unwrap(
        api.POST('/api/v1/commerce/tokens/packs/{pack_id}/checkout', {
          params: { path: { pack_id: v.packId } },
          body: { success_url: returnUrl(v.successPath), cancel_url: returnUrl(v.cancelPath), customer_email: v.customerEmail },
          headers: PERSONAL,
        }),
      ),
  })
}

export function useTopUpCheckout() {
  return useMutation({
    mutationFn: (v: { amountMinor: number; currency: string; successPath: string; cancelPath: string; customerEmail?: string }) =>
      unwrap(
        api.POST('/api/v1/commerce/tokens/topup/checkout', {
          body: { amount_minor: v.amountMinor, currency: v.currency, success_url: returnUrl(v.successPath), cancel_url: returnUrl(v.cancelPath), customer_email: v.customerEmail },
          headers: PERSONAL,
        }),
      ),
  })
}

// ------------------------------------------------------------------ access resolver (single source of truth for gating)
export function useAccess(scope: UnlockScope, targetId: string | null | undefined, enabled = true) {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['b2c-access', scope, targetId],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/access/{scope}/{target_id}', { params: { path: { scope, target_id: targetId! } }, headers: PERSONAL })),
    enabled: enabled && !!me && !!targetId,
    staleTime: 15_000,
  })
}

// ------------------------------------------------------------------ unlock (confirm-to-spend; server guards double spend)
export function useUnlock() {
  const refresh = useWalletRefresh()
  return useMutation({
    mutationFn: (v: { scope: UnlockScope; targetId: string }) =>
      unwrap(api.POST('/api/v1/commerce/tokens/unlock', { body: { scope: v.scope, target_id: v.targetId }, headers: PERSONAL })),
    // Only refresh after confirmed server success — never unlock from optimistic client state.
    onSuccess: () => refresh(),
  })
}

// ------------------------------------------------------------------ cash packages
export function useCashPackages() {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['b2c-cash-packages', code],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/packages', { params: { query: { currency: code } } })),
  })
}

export function usePackageCheckout() {
  return useMutation({
    mutationFn: (v: { packageId: string; successPath: string; cancelPath: string; customerEmail?: string }) =>
      unwrap(
        api.POST('/api/v1/commerce/tokens/packages/{package_id}/checkout', {
          params: { path: { package_id: v.packageId } },
          body: { success_url: returnUrl(v.successPath), cancel_url: returnUrl(v.cancelPath), customer_email: v.customerEmail },
          headers: PERSONAL,
        }),
      ),
  })
}

// ------------------------------------------------------------------ unlimited personal subscription
export function useSubscriptionPlans() {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['b2c-sub-plans', code],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/subscriptions/plans', { params: { query: { currency: code } } })),
  })
}

/** The person's active unlimited subscription, or `null` if none. */
export function useMySubscription(poll = false) {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['b2c-my-subscription'],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/tokens/subscriptions/me', { headers: PERSONAL })),
    enabled: !!me,
    refetchInterval: (q) => (poll && !['active', 'trialing'].includes(q.state.data?.status ?? '') && q.state.dataUpdateCount < 40 ? 1500 : false),
  })
}

export function useSubscriptionCheckout() {
  return useMutation({
    mutationFn: (v: { planId: string; successPath: string; cancelPath: string; customerEmail?: string }) =>
      unwrap(
        api.POST('/api/v1/commerce/tokens/subscriptions/checkout', {
          body: { plan_id: v.planId, success_url: returnUrl(v.successPath), cancel_url: returnUrl(v.cancelPath), customer_email: v.customerEmail },
          headers: PERSONAL,
        }),
      ),
  })
}
