import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Audit log: every staff and admin action, filterable and exportable.

export type AuditFilters = { actor?: string; org_id?: string; action?: string; start?: string; end?: string; q?: string }

const tidy = (f: AuditFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v).trim()])) as AuditFilters

const fetchAudit = (f: AuditFilters, cursor?: string) => unwrap(api.GET('/api/v1/console/audit', { params: { query: { ...tidy(f), cursor, limit: 50 } } }))
export type AuditRow = Awaited<ReturnType<typeof fetchAudit>>['items'][number]

export function useAudit(f: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'audit', 'list', tidy(f)],
    queryFn: ({ pageParam }) => fetchAudit(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useAuditActions() {
  return useQuery({ queryKey: ['console', 'audit', 'actions'], queryFn: () => unwrap(api.GET('/api/v1/console/audit/actions')), staleTime: 60_000 })
}

export function auditCsvPath(f: AuditFilters) {
  const q = new URLSearchParams(tidy(f) as Record<string, string>)
  return `/api/v1/console/audit/export.csv${q.size ? `?${q}` : ''}`
}
