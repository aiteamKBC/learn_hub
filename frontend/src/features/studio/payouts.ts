import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// The instructor's payouts (/studio/payouts, mockup 31): balance, requests, methods.
// Keys start with ['payouts', …].

const fetchMe = () => unwrap(api.GET('/api/v1/payouts/me'))
export type MyPayouts = Awaited<ReturnType<typeof fetchMe>>
const fetchRequests = () => unwrap(api.GET('/api/v1/payouts/requests'))
export type MyPayoutRequest = Awaited<ReturnType<typeof fetchRequests>>[number]
export type PayoutMethodIn = components['schemas']['PayoutsMethodIn']
export type PayoutMethod = PayoutMethodIn['method']

export function useMyPayouts() {
  return useQuery({ queryKey: ['payouts', 'me'], queryFn: fetchMe })
}

export function useMyPayoutRequests() {
  return useQuery({ queryKey: ['payouts', 'requests'], queryFn: fetchRequests })
}

function useChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['payouts'] })
    void qc.invalidateQueries({ queryKey: ['studio', 'revenue'] })
    void qc.invalidateQueries({ queryKey: ['studio', 'payout-account'] })
    void qc.invalidateQueries({ queryKey: ['studio', 'payouts'] })
  }
}

export function useRequestPayout() {
  const done = useChanged()
  return useMutation({ mutationFn: (body: components['schemas']['PayoutsRequestIn']) => unwrap(api.POST('/api/v1/payouts/requests', { body })), onSuccess: done })
}

export function useSavePayoutMethod() {
  const qc = useQueryClient()
  const done = useChanged()
  return useMutation({
    mutationFn: (body: PayoutMethodIn) => unwrap(api.PUT('/api/v1/payouts/methods', { body })),
    onSuccess: (data) => (qc.setQueryData(['payouts', 'me'], data), done()),
  })
}

export function useSetDefaultPayoutMethod() {
  const qc = useQueryClient()
  const done = useChanged()
  return useMutation({
    mutationFn: (method: PayoutMethod) => unwrap(api.PUT('/api/v1/payouts/methods/default', { body: { method } })),
    onSuccess: (data) => (qc.setQueryData(['payouts', 'me'], data), done()),
  })
}

export function useRemovePayoutMethod() {
  const qc = useQueryClient()
  const done = useChanged()
  return useMutation({
    mutationFn: (method: PayoutMethod) => unwrap(api.DELETE('/api/v1/payouts/methods/{method}', { params: { path: { method } } })),
    onSuccess: (data) => (qc.setQueryData(['payouts', 'me'], data), done()),
  })
}
