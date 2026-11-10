import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// The admin console (/api/v1/console/). Every query key starts with 'console', then the
// area ('console', 'courses', …). Each area keeps its hooks in its own file next to this
// one (features/console/<area>.ts); this file holds what the layout needs.

const fetchSearch = (q: string) => unwrap(api.GET('/api/v1/console/search', { params: { query: { q } } }))
export type ConsoleSearchResult = Awaited<ReturnType<typeof fetchSearch>>
export type ConsoleSearchGroup = ConsoleSearchResult['groups'][number]

/** Sidebar badges (approvals waiting, open tickets…), refreshed once a minute. */
export function useNavCounts() {
  return useQuery({
    queryKey: ['console', 'nav-counts'],
    queryFn: () => unwrap(api.GET('/api/v1/console/nav-counts')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/** Header search: grouped results for 2+ characters. */
export function useConsoleSearch(q: string) {
  const term = q.trim()
  return useQuery({
    queryKey: ['console', 'search', term],
    queryFn: () => fetchSearch(term),
    enabled: term.length >= 2,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  })
}
