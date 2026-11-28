import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

import type { RangeQuery } from './ui'

// Console > Reports (mockup 02). Read-only.

export type ReportFilters = RangeQuery & { category?: string; instructor?: string; scope?: string }

const fetchReport = (f: ReportFilters) => unwrap(api.GET('/api/v1/console/reports', { params: { query: f } }))
export type ConsoleReport = Awaited<ReturnType<typeof fetchReport>>

export function useConsoleReport(f: ReportFilters) {
  return useQuery({
    queryKey: ['console', 'reports', f],
    queryFn: () => fetchReport(f),
    enabled: f.range !== 'custom' || Boolean(f.start && f.end),
  })
}

export function useReportFilterChoices() {
  return useQuery({
    queryKey: ['console', 'reports', 'filters'],
    queryFn: () => unwrap(api.GET('/api/v1/console/reports/filters')),
    staleTime: 5 * 60_000,
  })
}

/** Path (with query) of the CSV export for the current filters and chosen sections. */
export function reportCsvPath(f: ReportFilters, types: string[], asOf?: string) {
  const q = new URLSearchParams({ range: f.range })
  if (f.start) q.set('start', f.start)
  if (f.end) q.set('end', f.end)
  if (f.category) q.set('category', f.category)
  if (f.instructor) q.set('instructor', f.instructor)
  if (f.scope) q.set('scope', f.scope)
  q.set('types', types.join(','))
  if (asOf) q.set('as_of', asOf)
  return `/api/v1/console/reports/export.csv?${q}`
}
