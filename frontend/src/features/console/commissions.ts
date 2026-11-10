import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// Console > Commissions (mockup 33, top). Keys start with ['console', 'commissions', …].
// Rates are what the INSTRUCTOR keeps (70% = the platform takes 30%).

export type CommissionRuleIn = components['schemas']['ConsoleCommissionRuleIn']
export type CommissionSettingsIn = components['schemas']['ConsoleCommissionSettingsIn']

const fetchOverview = () => unwrap(api.GET('/api/v1/console/commissions/overview'))
export type CommissionOverview = Awaited<ReturnType<typeof fetchOverview>>
const fetchInstructors = (q: string, status: string, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/commissions/instructors', { params: { query: { q: q || undefined, status: status || undefined, cursor, limit: 25 } } }))
export type InstructorCommission = Awaited<ReturnType<typeof fetchInstructors>>['items'][number]
const fetchRules = (scope: string) => unwrap(api.GET('/api/v1/console/commissions/rules', { params: { query: { scope: scope || undefined } } }))
export type CommissionRule = Awaited<ReturnType<typeof fetchRules>>[number]

export const SCOPE_LABEL: Record<string, string> = { course: 'Course', instructor: 'Instructor', category: 'Category', price_band: 'Price band' }

export function useCommissionOverview() {
  return useQuery({ queryKey: ['console', 'commissions', 'overview'], queryFn: fetchOverview })
}

export function useInstructorCommissions(q: string, status: string) {
  return useInfiniteQuery({
    queryKey: ['console', 'commissions', 'instructors', q, status],
    queryFn: ({ pageParam }) => fetchInstructors(q, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useCommissionRules(scope = '') {
  return useQuery({ queryKey: ['console', 'commissions', 'rules', scope], queryFn: () => fetchRules(scope) })
}

export function useCommissionPreview(courseId: string) {
  return useQuery({
    queryKey: ['console', 'commissions', 'preview', courseId],
    queryFn: () => unwrap(api.GET('/api/v1/console/commissions/preview', { params: { query: { course_id: courseId } } })),
    enabled: !!courseId,
  })
}

/** Category names for rule targets (the public catalogue list). */
export function useCategoryOptions() {
  return useQuery({ queryKey: ['categories'], queryFn: () => unwrap(api.GET('/api/v1/catalog/categories')), staleTime: 10 * 60_000 })
}

function useChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'commissions'] })
    void qc.invalidateQueries({ queryKey: ['console', 'people', 'instructors'] })
  }
}

export function useSaveCommissionSettings() {
  const done = useChanged()
  return useMutation({ mutationFn: (body: CommissionSettingsIn) => unwrap(api.PUT('/api/v1/console/commissions/settings', { body })), onSuccess: done })
}

export function useSetInstructorKeeps() {
  const done = useChanged()
  return useMutation({
    mutationFn: (v: { id: string; keeps_pct: number | null }) => unwrap(api.PUT('/api/v1/console/commissions/instructors/{user_id}', { params: { path: { user_id: v.id } }, body: { keeps_pct: v.keeps_pct } })),
    onSuccess: done,
  })
}

export function useSaveRule() {
  const done = useChanged()
  return useMutation({
    mutationFn: (v: { id?: string; body: CommissionRuleIn }) =>
      v.id ? unwrap(api.PUT('/api/v1/console/commissions/rules/{rule_id}', { params: { path: { rule_id: v.id } }, body: v.body })) : unwrap(api.POST('/api/v1/console/commissions/rules', { body: v.body })),
    onSuccess: done,
  })
}
