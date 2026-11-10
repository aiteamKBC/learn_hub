/** Cart, wishlist, checkout, orders and subscriptions. Every price shown comes from the
 * server (the same pricing code that charges the card). */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { useMe } from '@/features/identity/auth'
import { useCurrency } from '@/lib/currency'
import { emit } from '@/lib/motion'

const PERSONAL = { 'X-Org-Id': '' } // personal purchases, whichever space is selected

export function useCurrencies() {
  return useQuery({ queryKey: ['currencies'], queryFn: () => unwrap(api.GET('/api/v1/commerce/currencies')), staleTime: 30 * 60_000 })
}

export function useCartCount() {
  const { data: me } = useMe()
  return useQuery({ queryKey: ['cart-count'], queryFn: () => unwrap(api.GET('/api/v1/commerce/cart/count')), enabled: !!me, staleTime: 60_000 })
}

export function useCart(coupon?: string) {
  const { code } = useCurrency()
  // keep showing the current cart while a new coupon or currency is priced (no flash)
  return useQuery({ queryKey: ['cart', code, coupon ?? ''], queryFn: () => unwrap(api.GET('/api/v1/commerce/cart', { params: { query: { currency: code, coupon } } })), placeholderData: keepPreviousData })
}

function useCommerceRefresh() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => ['cart', 'cart-count', 'wishlist', 'course', 'my-courses'].includes(String(q.queryKey[0])) })
}

export function useAddToCart() {
  const refresh = useCommerceRefresh()
  return useMutation({
    mutationFn: (courseId: string) => unwrap(api.POST('/api/v1/commerce/cart', { body: { course_id: courseId } })),
    onSuccess: async () => {
      emit('cart:added')
      await refresh()
    },
  })
}

export function useRemoveFromCart() {
  const refresh = useCommerceRefresh()
  return useMutation({
    mutationFn: (courseId: string) => unwrap(api.DELETE('/api/v1/commerce/cart/{course_id}', { params: { path: { course_id: courseId } } })),
    onSuccess: () => refresh(),
  })
}

export function useWishlist() {
  const { code } = useCurrency()
  return useQuery({ queryKey: ['wishlist', code], queryFn: () => unwrap(api.GET('/api/v1/commerce/wishlist', { params: { query: { currency: code } } })) })
}

export function useToggleWishlist() {
  const refresh = useCommerceRefresh()
  return useMutation({
    mutationFn: (courseId: string) => unwrap(api.POST('/api/v1/commerce/wishlist/{course_id}/toggle', { params: { path: { course_id: courseId } } })),
    onSuccess: () => refresh(),
  })
}

export function useCheckout() {
  const refresh = useCommerceRefresh()
  return useMutation({
    mutationFn: (v: { courseIds: string[]; currency: string; coupon?: string }) =>
      unwrap(api.POST('/api/v1/commerce/checkout', { body: { course_ids: v.courseIds, currency: v.currency, coupon: v.coupon || null } })),
    onSuccess: () => refresh(),
  })
}

/** The order on the thank-you page, re-checked until Stripe's webhook marks it paid. */
export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/orders/{order_id}', { params: { path: { order_id: id! } } })),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'pending' && q.state.dataUpdateCount < 40 ? 1500 : false),
  })
}

export function useOrders() {
  return useInfiniteQuery({
    queryKey: ['orders'],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/commerce/orders', { params: { query: { cursor: pageParam, limit: 10 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useRefund() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { itemId: string; reason: string }) => unwrap(api.POST('/api/v1/commerce/orders/items/{item_id}/refund', { params: { path: { item_id: v.itemId } }, body: { reason: v.reason } })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['orders', 'my-courses', 'course'].includes(String(q.queryKey[0])) }),
  })
}

export function useMySubscriptions(enabled = true, poll = false) {
  return useQuery({
    queryKey: ['subscriptions', 'personal'],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/subscriptions', { headers: PERSONAL })),
    enabled,
    // the thank-you page checks until Stripe's webhook has started the subscription
    refetchInterval: (q) => (poll && !q.state.data?.some((s) => ['active', 'trialing'].includes(s.status)) && q.state.dataUpdateCount < 40 ? 1500 : false),
  })
}

export function useSubscribe() {
  return useMutation({
    mutationFn: (v: { planId: string; currency: string; seats?: number; orgId?: string }) =>
      unwrap(api.POST('/api/v1/commerce/subscriptions', { body: { plan_id: v.planId, currency: v.currency, seats: v.seats ?? 1, promo_code: '' }, headers: { 'X-Org-Id': v.orgId ?? '' } })),
  })
}

export function useBillingPortal() {
  return useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/commerce/billing-portal', { headers: PERSONAL })) })
}

export function usePlanEnroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => unwrap(api.POST('/api/v1/commerce/plan/enroll', { body: { course_id: courseId } })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['course', 'my-courses'].includes(String(q.queryKey[0])) }),
  })
}
