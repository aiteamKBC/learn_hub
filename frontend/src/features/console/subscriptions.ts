import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

import type { RangeQuery } from './ui'

// Console > Subscriptions (mockup 20). Keys start with ['console', 'subs', …].

const fetchOverview = (r: RangeQuery) => unwrap(api.GET('/api/v1/console/subscriptions/overview', { params: { query: r } }))
export type SubsOverview = Awaited<ReturnType<typeof fetchOverview>>
export type PlanFilters = { q?: string; status?: string; currency?: string }
const fetchPlans = (f: PlanFilters) => unwrap(api.GET('/api/v1/console/plans', { params: { query: { q: f.q || undefined, status: f.status || undefined, currency: f.currency || undefined } } }))
export type ConsolePlan = Awaited<ReturnType<typeof fetchPlans>>[number]
const fetchSubscribers = (f: { q?: string; plan?: string; status?: string }, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/subscribers', { params: { query: { q: f.q || undefined, plan: f.plan || undefined, status: f.status || undefined, cursor, limit: 25 } } }))
export type ConsoleSubscriber = Awaited<ReturnType<typeof fetchSubscribers>>['items'][number]
const fetchEvents = (kind: string, cursor?: string) => unwrap(api.GET('/api/v1/console/subscription-events', { params: { query: { kind: kind || undefined, cursor, limit: 25 } } }))
export type ConsoleSubEvent = Awaited<ReturnType<typeof fetchEvents>>['items'][number]

export type PlanPriceInput = { currency: string; amount_minor: number; stripe_price_id: string; create_stripe_price: boolean }
export type PlanInput = { name: string; code: string; description: string; audience: string; interval: string; trial_days: number; min_seats: number; renewal: string; prices: PlanPriceInput[]; course_ids: string[] }

export const EVENT_LABEL: Record<string, string> = { created: 'Started', upgraded: 'Upgraded', downgraded: 'Downgraded', seats_changed: 'Seats changed', renewed: 'Renewed', cancelled: 'Cancelled', payment_failed: 'Payment failed' }
export const SUB_STATUSES: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Past due', canceled: 'Cancelled', unpaid: 'Unpaid' }

export function useSubsOverview(r: RangeQuery) {
  return useQuery({ queryKey: ['console', 'subs', 'overview', r], queryFn: () => fetchOverview(r), enabled: r.range !== 'custom' || Boolean(r.start && r.end), placeholderData: keepPreviousData })
}

export function usePlans(f: PlanFilters = {}) {
  return useQuery({ queryKey: ['console', 'subs', 'plans', f], queryFn: () => fetchPlans(f), placeholderData: keepPreviousData })
}

export function usePlanCourses(id: string) {
  return useQuery({ queryKey: ['console', 'subs', 'plan-courses', id], queryFn: () => unwrap(api.GET('/api/v1/console/plans/{plan_id}/courses', { params: { path: { plan_id: id } } })), enabled: !!id })
}

export function useSubscribers(f: { q?: string; plan?: string; status?: string }) {
  return useInfiniteQuery({
    queryKey: ['console', 'subs', 'subscribers', f],
    queryFn: ({ pageParam }) => fetchSubscribers(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useSubEvents(kind: string) {
  return useInfiniteQuery({
    queryKey: ['console', 'subs', 'events', kind],
    queryFn: ({ pageParam }) => fetchEvents(kind, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}


function useInvalidatePlans() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'subs'] })
    void qc.invalidateQueries({ queryKey: ['console', 'pricing', 'plans'] })
    void qc.invalidateQueries({ queryKey: ['plans'] }) // the public plans page
  }
}

export function useCreatePlan() {
  const done = useInvalidatePlans()
  return useMutation({ mutationFn: (body: PlanInput) => unwrap(api.POST('/api/v1/console/plans', { body })), onSuccess: done })
}

export function useUpdatePlan(id: string) {
  const done = useInvalidatePlans()
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; trial_days?: number; min_seats?: number; renewal?: string }) =>
      unwrap(api.PATCH('/api/v1/console/plans/{plan_id}', { params: { path: { plan_id: id } }, body })),
    onSuccess: done,
  })
}

export function usePlanStatus() {
  const done = useInvalidatePlans()
  return useMutation({
    mutationFn: ({ id, is_active, reason }: { id: string; is_active: boolean; reason: string }) =>
      unwrap(api.POST('/api/v1/console/plans/{plan_id}/status', { params: { path: { plan_id: id } }, body: { is_active, reason } })),
    onSuccess: done,
  })
}

export function useDuplicatePlan() {
  const done = useInvalidatePlans()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/plans/{plan_id}/duplicate', { params: { path: { plan_id: id } } })), onSuccess: done })
}

export function useSetPlanPrice(id: string) {
  const done = useInvalidatePlans()
  return useMutation({ mutationFn: (body: PlanPriceInput) => unwrap(api.PUT('/api/v1/console/plans/{plan_id}/prices', { params: { path: { plan_id: id } }, body })), onSuccess: done })
}

export function useSetPlanCourses(id: string) {
  const done = useInvalidatePlans()
  return useMutation({ mutationFn: (course_ids: string[]) => unwrap(api.PUT('/api/v1/console/plans/{plan_id}/courses', { params: { path: { plan_id: id } }, body: { course_ids } })), onSuccess: done })
}

export function useCancelSubscriber() {
  const done = useInvalidatePlans()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/subscribers/{subscription_id}/cancel', { params: { path: { subscription_id: id } }, body: { reason } })),
    onSuccess: done,
  })
}

/** Course search for the "included courses" picker (reuses the promotions picker endpoint). */
export function useCourseOptions(q: string) {
  return useQuery({
    queryKey: ['console', 'promotions', 'options', q],
    queryFn: () => unwrap(api.GET('/api/v1/console/promotions-options', { params: { query: { q } } })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}
