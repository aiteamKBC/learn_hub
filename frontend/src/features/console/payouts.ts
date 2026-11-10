import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// Console > Payouts (mockup 33, bottom). Keys start with ['console', 'payouts', …].

export type PayoutSettingsIn = components['schemas']['ConsolePayoutSettingsIn']

const fetchOverview = () => unwrap(api.GET('/api/v1/console/payouts/overview'))
export type PayoutOverview = Awaited<ReturnType<typeof fetchOverview>>
const fetchRequests = (status: string, q: string, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/payout-requests', { params: { query: { status: status || undefined, q: q || undefined, cursor, limit: 25 } } }))
export type PayoutRequestRow = Awaited<ReturnType<typeof fetchRequests>>['items'][number]
const fetchHistory = (status: string, q: string, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/payouts/history', { params: { query: { status: status || undefined, q: q || undefined, cursor, limit: 25 } } }))
export type PayoutHistoryRow = Awaited<ReturnType<typeof fetchHistory>>['items'][number]
const fetchBalances = (q: string) => unwrap(api.GET('/api/v1/console/payouts/balances', { params: { query: { q: q || undefined } } }))
export type BalanceRow = Awaited<ReturnType<typeof fetchBalances>>[number]
const fetchAccounts = (unverified: boolean) => unwrap(api.GET('/api/v1/console/payout-accounts', { params: { query: { unverified } } }))
export type PayoutAccountRow = Awaited<ReturnType<typeof fetchAccounts>>[number]

export const METHOD_NAME: Record<string, string> = { stripe: 'Stripe Connect', paypal: 'PayPal', wise: 'Wise', bank: 'Bank transfer' }
export const REQUEST_STATUS: Record<string, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid', rejected: 'Rejected', disputed: 'Disputed', failed: 'Failed' }

const pages = { initialPageParam: undefined as string | undefined, getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined, placeholderData: keepPreviousData }

export function usePayoutOverview() {
  return useQuery({ queryKey: ['console', 'payouts', 'overview'], queryFn: fetchOverview })
}

export function usePayoutRequests(status: string, q: string) {
  return useInfiniteQuery({ queryKey: ['console', 'payouts', 'requests', status, q], queryFn: ({ pageParam }) => fetchRequests(status, q, pageParam), ...pages })
}

export function usePayoutRequest(id: string) {
  return useQuery({
    queryKey: ['console', 'payouts', 'request', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/payout-requests/{request_id}', { params: { path: { request_id: id } } })),
    enabled: !!id,
  })
}

export function usePayoutHistory(status: string, q: string) {
  return useInfiniteQuery({ queryKey: ['console', 'payouts', 'history', status, q], queryFn: ({ pageParam }) => fetchHistory(status, q, pageParam), ...pages })
}

export function usePayoutBalances(q: string) {
  return useQuery({ queryKey: ['console', 'payouts', 'balances', q], queryFn: () => fetchBalances(q), placeholderData: keepPreviousData })
}

export function usePayoutAccounts(unverified: boolean) {
  return useQuery({ queryKey: ['console', 'payouts', 'accounts', unverified], queryFn: () => fetchAccounts(unverified) })
}

/** Money moved: every payouts list, the summary, people detail and the nav badge. */
function useChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'payouts'] })
    void qc.invalidateQueries({ queryKey: ['console', 'people', 'instructors'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
    void qc.invalidateQueries({ queryKey: ['console', 'dashboard'] })
  }
}

type Action = 'approve' | 'mark-paid' | 'reject' | 'dispute' | 'fail'

export function usePayoutRequestAction() {
  const done = useChanged()
  return useMutation({
    mutationFn: (v: { id: string; action: Action; reason?: string; provider_ref?: string }) => {
      const path = { params: { path: { request_id: v.id } } }
      switch (v.action) {
        case 'approve':
          return unwrap(api.POST('/api/v1/console/payout-requests/{request_id}/approve', path))
        case 'mark-paid':
          return unwrap(api.POST('/api/v1/console/payout-requests/{request_id}/mark-paid', { ...path, body: { provider_ref: v.provider_ref ?? '' } }))
        case 'reject':
          return unwrap(api.POST('/api/v1/console/payout-requests/{request_id}/reject', { ...path, body: { reason: v.reason ?? '' } }))
        case 'dispute':
          return unwrap(api.POST('/api/v1/console/payout-requests/{request_id}/dispute', { ...path, body: { reason: v.reason ?? '' } }))
        case 'fail':
          return unwrap(api.POST('/api/v1/console/payout-requests/{request_id}/fail', { ...path, body: { reason: v.reason ?? '' } }))
      }
    },
    onSuccess: done,
  })
}

/** A scheduled payout (the monthly or weekly run): pay it (Stripe sends it; others need the reference). */
export function useApprovePayout() {
  const done = useChanged()
  return useMutation({
    mutationFn: (v: { id: string; provider_ref?: string }) =>
      unwrap(api.POST('/api/v1/console/payouts/{payout_id}/approve', { params: { path: { payout_id: v.id } }, body: { provider_ref: v.provider_ref ?? '' } })),
    onSuccess: done,
  })
}

/** A scheduled payout failed: its earnings go back to the balance for the next one. */
export function useFailPayout() {
  const done = useChanged()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/payouts/{payout_id}/fail', { params: { path: { payout_id: v.id } }, body: { reason: v.reason } })),
    onSuccess: done,
  })
}

export function useVerifyAccount() {
  const done = useChanged()
  return useMutation({ mutationFn: (userId: string) => unwrap(api.POST('/api/v1/console/payout-accounts/{user_id}/verify', { params: { path: { user_id: userId } } })), onSuccess: done })
}

export function useSavePayoutSettings() {
  const done = useChanged()
  return useMutation({ mutationFn: (body: PayoutSettingsIn) => unwrap(api.PUT('/api/v1/console/payouts/settings', { body })), onSuccess: done })
}

export function useRunPayouts() {
  const done = useChanged()
  return useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/console/payouts/run')), onSuccess: done })
}
