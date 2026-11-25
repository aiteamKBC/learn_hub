import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

export type EnrolmentFilters = { q?: string; status?: string; scope?: string; source?: string; course?: string; company?: string }

const clean = (filters: EnrolmentFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
const fetchEnrolments = (filters: EnrolmentFilters, cursor?: string) => unwrap(api.GET('/api/v1/console/enrolments', { params: { query: { ...clean(filters), cursor, limit: 25 } } }))
export type ConsoleEnrolment = Awaited<ReturnType<typeof fetchEnrolments>>['items'][number]

const page = { initialPageParam: undefined as string | undefined, getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined, placeholderData: keepPreviousData }

export function useEnrolments(filters: EnrolmentFilters) {
  return useInfiniteQuery({ queryKey: ['console', 'enrolments', 'list', filters], queryFn: ({ pageParam }) => fetchEnrolments(filters, pageParam), ...page })
}

export function useEnrolmentKpis() {
  return useQuery({ queryKey: ['console', 'enrolments', 'kpis'], queryFn: () => unwrap(api.GET('/api/v1/console/enrolments/kpis')) })
}

export function useEnrolmentOptions(enabled = true) {
  return useQuery({ queryKey: ['console', 'enrolments', 'options'], queryFn: () => unwrap(api.GET('/api/v1/console/enrolments/options')), enabled })
}

function useChanged() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['console', 'enrolments'] })
    void queryClient.invalidateQueries({ queryKey: ['console', 'people'] })
    void queryClient.invalidateQueries({ queryKey: ['console', 'reports'] })
  }
}

export function useCreateEnrolment() {
  const done = useChanged()
  return useMutation({
    mutationFn: (body: { user_id: string; course_id: string; company_id?: string | null }) => unwrap(api.POST('/api/v1/console/enrolments', { body: { ...body, company_id: body.company_id || null } })),
    onSuccess: done,
  })
}

export function useUpdateEnrolment() {
  const done = useChanged()
  return useMutation({
    mutationFn: ({ id, status, progress_pct }: { id: string; status: 'active' | 'completed' | 'expired' | 'revoked'; progress_pct: number }) => unwrap(api.PATCH('/api/v1/console/enrolments/{enrolment_id}', { params: { path: { enrolment_id: id } }, body: { status, progress_pct } })),
    onSuccess: done,
  })
}
