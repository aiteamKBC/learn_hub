import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Pricing (mockup 13, top). Keys start with ['console', 'pricing', …]. Price
// changes also refresh the catalogue's and cart's own queries, so nothing shows an old price.

export type GridFilters = { q?: string; category?: string; status?: string; kind?: string }

const fetchGrid = (f: GridFilters, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/pricing/courses', { params: { query: { q: f.q || undefined, category: f.category || undefined, status: f.status || undefined, kind: f.kind || undefined, cursor, limit: 25 } } }))
export type CoursePriceRow = Awaited<ReturnType<typeof fetchGrid>>['items'][number]
const fetchTiers = (currency: string) => unwrap(api.GET('/api/v1/console/price-tiers', { params: { query: { currency } } }))
export type TierRow = Awaited<ReturnType<typeof fetchTiers>>[number]
const fetchCurrencies = () => unwrap(api.GET('/api/v1/console/currencies'))
export type CurrencyRow = Awaited<ReturnType<typeof fetchCurrencies>>[number]
const fetchRegional = () => unwrap(api.GET('/api/v1/console/pricing/regional'))
export type RegionalRow = Awaited<ReturnType<typeof fetchRegional>>[number]
const fetchRules = () => unwrap(api.GET('/api/v1/console/pricing/rules'))
export type RuleRow = Awaited<ReturnType<typeof fetchRules>>[number]

export const PRICING_TYPE: Record<string, string> = { standard: 'Standard', custom: 'Custom', free: 'Free', unpriced: 'No price' }

export function usePricingOverview() {
  return useQuery({ queryKey: ['console', 'pricing', 'overview'], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/overview')) })
}

export function useCoursePrices(f: GridFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'pricing', 'courses', f],
    queryFn: ({ pageParam }) => fetchGrid(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useTiers(currency = 'GBP') {
  return useQuery({ queryKey: ['console', 'pricing', 'tiers', currency], queryFn: () => fetchTiers(currency), placeholderData: keepPreviousData })
}

export function useCurrencies() {
  return useQuery({ queryKey: ['console', 'pricing', 'currencies'], queryFn: fetchCurrencies })
}

export function useRegional() {
  return useQuery({ queryKey: ['console', 'pricing', 'regional'], queryFn: fetchRegional })
}

export function useRules() {
  return useQuery({ queryKey: ['console', 'pricing', 'rules'], queryFn: fetchRules })
}

export function useRulePreview(id: string) {
  return useQuery({
    queryKey: ['console', 'pricing', 'rule-preview', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/pricing/rules/{rule_id}/preview', { params: { path: { rule_id: id } } })),
    enabled: !!id,
    staleTime: 0,
  })
}

export function usePricingSettings() {
  return useQuery({ queryKey: ['console', 'pricing', 'settings'], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/settings')) })
}

export function useCategories() {
  return useQuery({ queryKey: ['console', 'promotions', 'options', ''], queryFn: () => unwrap(api.GET('/api/v1/console/promotions-options', { params: { query: { q: '' } } })), staleTime: 60_000 })
}

/** Everything a price change can touch: console pricing, the catalogue, carts and plans. */
function usePriceInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'pricing'] })
    void qc.invalidateQueries({ queryKey: ['console', 'subs'] })
    void qc.invalidateQueries({ queryKey: ['console', 'settings'] })
    void qc.invalidateQueries({ predicate: (q) => ['courses', 'course', 'cart', 'wishlist', 'plans', 'currencies', 'home'].includes(String(q.queryKey[0])) })
  }
}

function useWrite<T>(fn: (v: T) => Promise<unknown>) {
  const done = usePriceInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: done })
}

export const useSetCoursePrice = () =>
  useWrite(({ id, tier_id, is_free }: { id: string; tier_id: string | null; is_free: boolean }) =>
    unwrap(api.PUT('/api/v1/console/pricing/courses/{course_id}', { params: { path: { course_id: id } }, body: { tier_id, is_free } })))
export const useBulkPrice = () =>
  useWrite((body: { course_ids: string[]; tier_id: string | null; is_free: boolean }) => unwrap(api.POST('/api/v1/console/pricing/bulk', { body })))
export const useCreateRegional = () =>
  useWrite((body: { course_id: string | null; tier_id: string | null; country: string; currency: string; amount_minor: number }) => unwrap(api.POST('/api/v1/console/pricing/regional', { body })))
export const useUpdateRegional = () =>
  useWrite(({ id, ...body }: { id: string; amount_minor?: number; is_active?: boolean }) => unwrap(api.PATCH('/api/v1/console/pricing/regional/{regional_id}', { params: { path: { regional_id: id } }, body })))
export const useCreateRule = () =>
  useWrite((body: { name: string; scope: string; target_id: string | null; action: string; tier_id: string | null; percent: number | null; rounding: string }) => unwrap(api.POST('/api/v1/console/pricing/rules', { body })))
export const useApplyRule = () => useWrite((id: string) => unwrap(api.POST('/api/v1/console/pricing/rules/{rule_id}/apply', { params: { path: { rule_id: id } } })))
export const useRuleOff = () => useWrite((id: string) => unwrap(api.POST('/api/v1/console/pricing/rules/{rule_id}/off', { params: { path: { rule_id: id } } })))
export const useUpdateTier = () =>
  useWrite(({ id, gbp_minor }: { id: string; gbp_minor: number }) => unwrap(api.PATCH('/api/v1/console/price-tiers/{tier_id}', { params: { path: { tier_id: id } }, body: { gbp_minor } })))
export const useSetTierAmount = () =>
  useWrite(({ id, code, amount_minor, lock }: { id: string; code: string; amount_minor: number; lock: boolean }) =>
    unwrap(api.PUT('/api/v1/console/price-tiers/{tier_id}/amounts/{code}', { params: { path: { tier_id: id, code } }, body: { amount_minor, lock } })))
export const useUpdateCurrency = () =>
  useWrite(({ code, ...body }: { code: string; is_active?: boolean; stripe_supported?: boolean }) => unwrap(api.PATCH('/api/v1/console/currencies/{code}', { params: { path: { code } }, body })))
export const useManualRate = () => useWrite((body: { code: string; rate: string }) => unwrap(api.POST('/api/v1/console/fx-rates', { body: { code: body.code, rate: body.rate } })))
export const useRefreshRates = () => useWrite(() => unwrap(api.POST('/api/v1/console/fx-rates/refresh')))
export const useSaveSetting = () =>
  useWrite(({ key, value }: { key: string; value: unknown }) => unwrap(api.PUT('/api/v1/console/settings/{key}', { params: { path: { key } }, body: { value } as never })))

export function pricingCsvPath(f: GridFilters) {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])
  return `/api/v1/console/pricing/courses/export.csv${q.size ? `?${q}` : ''}`
}
