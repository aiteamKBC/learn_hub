import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

import type { RangeQuery } from './ui'

// Console > Dashboard (mockup 26).

const fetchOverview = (r: RangeQuery) => unwrap(api.GET('/api/v1/console/overview', { params: { query: r } }))
export type ConsoleOverview = Awaited<ReturnType<typeof fetchOverview>>

const fetchHealth = () => unwrap(api.GET('/api/v1/console/health'))
export type ConsoleHealth = Awaited<ReturnType<typeof fetchHealth>>

export function useConsoleOverview(r: RangeQuery) {
  return useQuery({
    queryKey: ['console', 'dashboard', 'overview', r],
    queryFn: () => fetchOverview(r),
    enabled: r.range !== 'custom' || Boolean(r.start && r.end),
    placeholderData: (prev) => prev,
  })
}

export function useConsoleActivity(limit = 8) {
  return useQuery({
    queryKey: ['console', 'dashboard', 'activity', limit],
    queryFn: () => unwrap(api.GET('/api/v1/console/activity', { params: { query: { limit } } })),
    refetchInterval: 60_000,
  })
}

/** Health tiles: the server caches outside checks for 60 s, so polling once a minute is cheap. */
export function useConsoleHealth() {
  return useQuery({ queryKey: ['console', 'dashboard', 'health'], queryFn: fetchHealth, refetchInterval: 60_000 })
}
