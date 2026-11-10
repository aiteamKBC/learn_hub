import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

import type { RangeQuery } from './ui'

// Console > Sales & orders (mockup 22). Keys start with ['console', 'sales', …].

export type OrderFilters = { q?: string; status?: string; method?: string; currency?: string; product?: string; user?: string; start?: string; end?: string }

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>

const fetchOverview = (r: RangeQuery) => unwrap(api.GET('/api/v1/console/sales/overview', { params: { query: r } }))
export type SalesOverview = Awaited<ReturnType<typeof fetchOverview>>
const fetchOrders = (f: OrderFilters, cursor?: string) => unwrap(api.GET('/api/v1/console/orders', { params: { query: { ...clean(f), cursor, limit: 25 } } }))
export type ConsoleOrderRow = Awaited<ReturnType<typeof fetchOrders>>['items'][number]
const fetchOrder = (id: string) => unwrap(api.GET('/api/v1/console/orders/{order_id}', { params: { path: { order_id: id } } }))
export type ConsoleOrderDetail = Awaited<ReturnType<typeof fetchOrder>>
const fetchRefunds = (q: string, cursor?: string) => unwrap(api.GET('/api/v1/console/refunds', { params: { query: { q: q || undefined, cursor, limit: 25 } } }))
export type ConsoleRefundRow = Awaited<ReturnType<typeof fetchRefunds>>['items'][number]
const fetchInvoices = (q: string, kind: string, cursor?: string) => unwrap(api.GET('/api/v1/console/invoices', { params: { query: { q: q || undefined, kind: kind || undefined, cursor, limit: 25 } } }))
export type ConsoleInvoiceRow = Awaited<ReturnType<typeof fetchInvoices>>['items'][number]

export const ORDER_STATUSES: Record<string, string> = { paid: 'Paid', pending: 'Awaiting payment', partially_refunded: 'Partly refunded', refunded: 'Refunded', failed: 'Payment failed' }
export const METHOD_LABEL: Record<string, string> = { card: 'Card', paypal: 'PayPal', link: 'Link', bacs_debit: 'Bacs Direct Debit', sepa_debit: 'SEPA Direct Debit', unknown: 'Not recorded' }

export function useSalesOverview(r: RangeQuery) {
  return useQuery({
    queryKey: ['console', 'sales', 'overview', r],
    queryFn: () => fetchOverview(r),
    enabled: r.range !== 'custom' || Boolean(r.start && r.end),
    placeholderData: keepPreviousData,
  })
}

export function useSalesFacets() {
  return useQuery({ queryKey: ['console', 'sales', 'facets'], queryFn: () => unwrap(api.GET('/api/v1/console/sales/facets')), staleTime: 5 * 60_000 })
}

export function useConsoleOrders(f: OrderFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'sales', 'orders', f],
    queryFn: ({ pageParam }) => fetchOrders(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useConsoleOrder(id: string) {
  return useQuery({ queryKey: ['console', 'sales', 'order', id], queryFn: () => fetchOrder(id), enabled: !!id })
}

export function useConsoleRefunds(q: string) {
  return useInfiniteQuery({
    queryKey: ['console', 'sales', 'refunds', q],
    queryFn: ({ pageParam }) => fetchRefunds(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useConsoleInvoices(q: string, kind = '') {
  return useInfiniteQuery({
    queryKey: ['console', 'sales', 'invoices', q, kind],
    queryFn: ({ pageParam }) => fetchInvoices(q, kind, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

/** Refund one course of an order: money back, access removed, the learner is told. */
export function useConsoleRefund(orderId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) =>
      unwrap(api.POST('/api/v1/console/orders/items/{item_id}/refund', { params: { path: { item_id: itemId } }, body: { reason } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'sales'] })
      void qc.invalidateQueries({ queryKey: ['console', 'dashboard'] })
      void qc.invalidateQueries({ queryKey: ['console', 'reports'] })
      void qc.invalidateQueries({ queryKey: ['console', 'sales', 'order', orderId] })
    },
  })
}

export function ordersCsvPath(f: OrderFilters) {
  const q = new URLSearchParams(clean({ ...f, user: undefined }) as Record<string, string>)
  return `/api/v1/console/orders/export.csv${q.size ? `?${q}` : ''}`
}
