import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Companies: status, seats, add-ons (entitlements), admins and subscriptions.

export const COMPANY_STATUSES: Record<string, string> = { trial: 'Trial', active: 'Active', suspended: 'Suspended', cancelled: 'Cancelled' }

export function useCompanyKpis() {
  return useQuery({ queryKey: ['console', 'companies', 'kpis'], queryFn: () => unwrap(api.GET('/api/v1/console/companies/kpis')) })
}

export function useCompanyFeatures() {
  return useQuery({ queryKey: ['console', 'companies', 'features'], queryFn: () => unwrap(api.GET('/api/v1/console/companies/features')), staleTime: 5 * 60_000 })
}

export function useCompanies(f: { q?: string; status?: string }) {
  return useQuery({
    queryKey: ['console', 'companies', 'list', f],
    queryFn: () => unwrap(api.GET('/api/v1/console/companies', { params: { query: { q: f.q || undefined, status: f.status || undefined } } })),
    placeholderData: keepPreviousData,
  })
}
export type ConsoleCompany = NonNullable<ReturnType<typeof useCompanies>['data']>[number]

export function useCompany(id?: string) {
  return useQuery({
    queryKey: ['console', 'companies', 'detail', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/companies/{org_id}', { params: { path: { org_id: id! } } })),
    enabled: !!id,
  })
}
export type ConsoleCompanyDetail = NonNullable<ReturnType<typeof useCompany>['data']>

function useDone() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['console', 'companies'] })
}

export function useCreateCompany() {
  const done = useDone()
  return useMutation({
    mutationFn: (body: { name: string; slug: string; owner_email: string; seat_limit: number | null; status: string }) => unwrap(api.POST('/api/v1/console/companies', { body })),
    onSuccess: done,
  })
}

export function useUpdateCompany(id: string) {
  const done = useDone()
  return useMutation({
    mutationFn: (body: { name?: string; status?: string; seat_limit?: number | null; clear_seat_limit?: boolean; reason?: string }) =>
      unwrap(api.PATCH('/api/v1/console/companies/{org_id}', { params: { path: { org_id: id } }, body: { clear_seat_limit: false, reason: '', ...body } })),
    onSuccess: done,
  })
}

export function useGrantFeature(id: string) {
  const done = useDone()
  return useMutation({
    mutationFn: (body: { feature: string; days: number | null; seats: number | null; note: string }) => unwrap(api.POST('/api/v1/console/companies/{org_id}/entitlements', { params: { path: { org_id: id } }, body })),
    onSuccess: done,
  })
}

export function useEndGrant(id: string) {
  const done = useDone()
  return useMutation({
    mutationFn: (v: { entitlement: string; reason: string }) =>
      unwrap(api.POST('/api/v1/console/companies/{org_id}/entitlements/{entitlement_id}/end', { params: { path: { org_id: id, entitlement_id: v.entitlement } }, body: { reason: v.reason } })),
    onSuccess: done,
  })
}

export function useAddAdmin(id: string) {
  const done = useDone()
  return useMutation({
    mutationFn: (body: { email: string; role: 'admin' | 'owner' }) => unwrap(api.POST('/api/v1/console/companies/{org_id}/admins', { params: { path: { org_id: id } }, body })),
    onSuccess: done,
  })
}

export function useRemoveAdmin(id: string) {
  const done = useDone()
  return useMutation({
    mutationFn: (v: { member: string; reason: string }) =>
      unwrap(api.POST('/api/v1/console/companies/{org_id}/admins/{member_id}/remove', { params: { path: { org_id: id, member_id: v.member } }, body: { reason: v.reason } })),
    onSuccess: done,
  })
}
