import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Promotions (mockup 13, bottom). Keys start with ['console', 'promos', …]. A change
// also refreshes carts and course pages, which show the live offer.

export type PromoFilters = { q?: string; kind?: string; status?: string; target?: string }

const fetchPromos = (f: PromoFilters) =>
  unwrap(api.GET('/api/v1/console/promotions', { params: { query: { q: f.q || undefined, kind: f.kind || undefined, status: f.status || undefined, target: f.target || undefined } } }))
export type ConsolePromotion = Awaited<ReturnType<typeof fetchPromos>>[number]
export type PromoTargetInput = { target_type: string; target_id: string | null; segment: string }
export type PromotionInput = {
  name: string
  kind: string
  code: string
  description: string
  percent_off: number
  starts_at: string
  ends_at: string
  max_redemptions: number | null
  per_user_limit: number | null
  min_order_minor: number
  draft: boolean
  targets: PromoTargetInput[]
}

export const KIND_LABEL: Record<string, string> = { promo_code: 'Promo code', campaign: 'Campaign', subscription: 'Subscription', first_purchase: 'First purchase' }
export const STATUS_LABEL: Record<string, string> = { active: 'Active', scheduled: 'Scheduled', draft: 'Draft', ended: 'Ended' }
export const TARGET_LABEL: Record<string, string> = { all: 'Everything', course: 'Courses', category: 'Categories', plan: 'Subscription plans', user_segment: 'Groups of people' }
export const SEGMENT_LABEL: Record<string, string> = {
  new_users: 'Joined in the last 30 days',
  no_purchases: 'Never bought a course',
  learners: 'Every learner',
  company_members: 'Members of a company',
}

export function usePromoOverview() {
  return useQuery({ queryKey: ['console', 'promos', 'overview'], queryFn: () => unwrap(api.GET('/api/v1/console/promotions/overview')) })
}

export function usePromotions(f: PromoFilters) {
  return useQuery({ queryKey: ['console', 'promos', 'list', f], queryFn: () => fetchPromos(f), placeholderData: keepPreviousData })
}

export function usePromotion(id: string) {
  return useQuery({
    queryKey: ['console', 'promos', 'detail', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/promotions/{promotion_id}', { params: { path: { promotion_id: id } } })),
    enabled: !!id,
  })
}

export function usePromoOptions(q: string) {
  return useQuery({
    queryKey: ['console', 'promotions', 'options', q],
    queryFn: () => unwrap(api.GET('/api/v1/console/promotions-options', { params: { query: { q } } })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

function useDone() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'promos'] })
    void qc.invalidateQueries({ predicate: (q) => ['cart', 'courses', 'course', 'home'].includes(String(q.queryKey[0])) })
  }
}

export function useCreatePromotion() {
  const done = useDone()
  return useMutation({ mutationFn: (body: PromotionInput) => unwrap(api.POST('/api/v1/console/promotions', { body })), onSuccess: done })
}

export function useUpdatePromotion() {
  const done = useDone()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PromotionInput }) => unwrap(api.PUT('/api/v1/console/promotions/{promotion_id}', { params: { path: { promotion_id: id } }, body })),
    onSuccess: done,
  })
}

export function useDuplicatePromotion() {
  const done = useDone()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/promotions/{promotion_id}/duplicate', { params: { path: { promotion_id: id } } })), onSuccess: done })
}

export function useDeactivatePromotion() {
  const done = useDone()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.POST('/api/v1/console/promotions/{promotion_id}/deactivate', { params: { path: { promotion_id: id } }, body: { reason } })),
    onSuccess: done,
  })
}

export function promotionsCsvPath(f: PromoFilters) {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])
  return `/api/v1/console/promotions/export.csv${q.size ? `?${q}` : ''}`
}
