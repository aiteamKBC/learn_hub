import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Reviews: moderation of reviews, questions and answers, and reported content.

export type ModKind = 'review' | 'question' | 'answer'

const fetchItems = (f: { kind: ModKind; status?: string; q?: string; reported?: boolean; max_rating?: number }, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/moderation/items', { params: { query: { kind: f.kind, status: f.status || undefined, q: f.q || undefined, reported: f.reported, max_rating: f.max_rating || undefined, cursor, limit: 25 } } }))
export type ModItem = Awaited<ReturnType<typeof fetchItems>>['items'][number]
const fetchReports = (status: string, cursor?: string) => unwrap(api.GET('/api/v1/console/moderation/reports', { params: { query: { status, cursor, limit: 25 } } }))
export type ModReport = Awaited<ReturnType<typeof fetchReports>>['items'][number]

export function useModSummary() {
  return useQuery({ queryKey: ['console', 'moderation', 'summary'], queryFn: () => unwrap(api.GET('/api/v1/console/moderation/summary')) })
}

export function useModItems(f: { kind: ModKind; status?: string; q?: string; reported?: boolean; max_rating?: number }) {
  return useInfiniteQuery({
    queryKey: ['console', 'moderation', 'items', f],
    queryFn: ({ pageParam }) => fetchItems(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useModReports(status: string) {
  return useInfiniteQuery({
    queryKey: ['console', 'moderation', 'reports', status],
    queryFn: ({ pageParam }) => fetchReports(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

function useDone() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'moderation'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
  }
}

export function useSetHidden() {
  const done = useDone()
  return useMutation({
    mutationFn: (v: { kind: ModKind; id: string; hide: boolean; reason: string }) => unwrap(api.POST('/api/v1/console/moderation/{kind}/{target_id}', { params: { path: { kind: v.kind, target_id: v.id } }, body: { hide: v.hide, reason: v.reason } })),
    onSuccess: done,
  })
}

export function useHideReported() {
  const done = useDone()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/moderation/reports/{report_id}/hide', { params: { path: { report_id: v.id } }, body: { hide: true, reason: v.reason } })),
    onSuccess: done,
  })
}

export function useDismissReport() {
  const done = useDone()
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => unwrap(api.POST('/api/v1/console/moderation/reports/{report_id}/dismiss', { params: { path: { report_id: v.id } }, body: { note: v.note } })),
    onSuccess: done,
  })
}
