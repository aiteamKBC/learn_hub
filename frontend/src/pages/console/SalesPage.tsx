import { BarChart3, Coins, CreditCard, Download, ExternalLink, FileText, Receipt, RotateCcw, ShoppingCart, TrendingUp, Undo2, User, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AreaChart, Donut } from '@/features/console/charts'
import { dateTime, PaymentMethod, SearchBox, Toolbar } from '@/features/console/money-ui'
import {
  type ConsoleOrderDetail,
  type ConsoleOrderRow,
  METHOD_LABEL,
  ORDER_STATUSES,
  type OrderFilters,
  ordersCsvPath,
  useConsoleInvoices,
  useConsoleOrder,
  useConsoleOrders,
  useConsoleRefund,
  useConsoleRefunds,
  useSalesFacets,
  useSalesOverview,
} from '@/features/console/sales'
import { ConfirmDialog, DateRangeSelect, DetailSheet, ExportButton, gbp, gbpShort, InfoRow, KpiCard, LoadMore, StatusPill, useParam, useRangeParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'

const TABS = ['overview', 'orders', 'refunds', 'invoices'] as const

// ---------------------------------------------------------------- overview
function Overview() {
  const [range, setRange] = useRangeParam()
  const q = useSalesOverview(range)
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  const total = d ? d.by_type.reduce((s, x) => s + x.value, 0) : 0
  return (
    <div className="grid gap-5">
      <div className="flex justify-end sm:hidden">
        <DateRangeSelect value={range} onChange={setRange} />
      </div>
      <section aria-label="Sales figures" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6', d && 'stagger')}>
        {!d ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <KpiCard label="Total sales" kpi={d.kpis.total_sales} icon={<ShoppingCart />} />
            <KpiCard label="Total revenue" kpi={d.kpis.revenue} icon={<Coins />} format={gbp} tone="success" />
            <KpiCard label="Course sales" kpi={d.kpis.course_sales} icon={<Receipt />} format={gbp} tone="info" />
            <KpiCard label="Subscriptions" kpi={d.kpis.subscriptions} icon={<CreditCard />} format={gbp} />
            <KpiCard label="Refunds" kpi={d.kpis.refunds} icon={<RotateCcw />} format={gbp} tone="danger" lowerIsBetter />
            <KpiCard label="Average order value" kpi={d.kpis.average_order} icon={<Wallet />} format={gbp} tone="warning" />
          </>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader title="Sales trend" description="Courses and subscriptions, in pounds per day." />
          <CardBody>{!d ? <Skeleton className="h-[220px]" /> : <AreaChart points={d.series} format={gbpShort} label="Revenue per day" />}</CardBody>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Sales by product type" />
          <CardBody>
            {!d ? (
              <Skeleton className="h-[220px]" />
            ) : total === 0 ? (
              <EmptyState icon={<BarChart3 />} title="No sales in this period" className="py-6" />
            ) : (
              <Donut
                slices={d.by_type.map((x, i) => ({ label: x.label, value: x.value, color: i ? 'var(--chart-5)' : 'var(--chart-1)', hint: `${Math.round((x.value * 100) / total)}%` }))}
                centre={gbpShort(total)}
                centreLabel="Total revenue"
                format={gbp}
              />
            )}
          </CardBody>
        </Card>
      </div>
      <OrdersCard compact />
    </div>
  )
}

// ---------------------------------------------------------------- orders
function OrdersCard({ compact }: { compact?: boolean }) {
  const [, setOrder] = useParam('order')
  const [user, setUser] = useParam('user')
  const [text, setText] = useState('')
  const [f, setF] = useState<OrderFilters>({})
  const q = useDebounced(text, 300)
  const filters: OrderFilters = { ...f, q: q.trim() || undefined, user: user || undefined }
  const list = useConsoleOrders(filters)
  const facets = useSalesFacets()
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const set = (k: keyof OrderFilters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || undefined })

  return (
    <Card>
      <CardHeader
        title={`${compact ? 'All orders' : 'Orders'}${list.data ? ` (${total.toLocaleString('en-GB')})` : ''}`}
        description={user ? 'Showing one customer’s orders.' : undefined}
        action={user ? <Button size="sm" variant="secondary" onClick={() => setUser('')}>Show everyone</Button> : <ExportButton path={ordersCsvPath(filters)} filename="orders.csv" />}
      />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search orders" placeholder="Order number, customer or email" className="sm:max-w-xs" />
        <NativeSelect aria-label="Status" value={f.status ?? ''} onChange={set('status')} className="w-full sm:w-44">
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Payment method" value={f.method ?? ''} onChange={set('method')} className="w-full sm:w-48">
          <option value="">All payment methods</option>
          {(facets.data?.methods ?? []).map((m) => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
          <option value="unknown">{METHOD_LABEL.unknown}</option>
        </NativeSelect>
        <NativeSelect aria-label="Currency" value={f.currency ?? ''} onChange={set('currency')} className="w-full sm:w-40">
          <option value="">All currencies</option>
          {(facets.data?.currencies ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No orders match" body="Try other filters or a wider search." />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Products</Th>
                <Th className="text-right">Amount</Th>
                <Th>Payment method</Th>
                <Th>Status</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((o) => <OrderRow key={o.id} o={o} onOpen={() => setOrder(o.id)} />)}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="orders" hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  )
}

function OrderRow({ o, onOpen }: { o: ConsoleOrderRow; onOpen: () => void }) {
  return (
    <Tr className="cursor-pointer" onClick={onOpen}>
      <Td>
        <button type="button" className="font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={(e) => (e.stopPropagation(), onOpen())}>
          {o.number}
        </button>
      </Td>
      <Td>
        <span className="block max-w-48 truncate font-medium">{o.name || o.email}</span>
        <span className="block max-w-48 truncate text-xs text-muted">{o.email}</span>
      </Td>
      <Td className="max-w-56 truncate">{o.products}</Td>
      <Td className="text-right font-medium whitespace-nowrap tabular">{money(o.total_minor, o.currency, o.exponent)}</Td>
      <Td><PaymentMethod method={o.payment_method} brand={o.card_brand} last4={o.card_last4} /></Td>
      <Td><StatusPill status={o.status} label={ORDER_STATUSES[o.status]} /></Td>
      <Td className="whitespace-nowrap text-muted">{dateTime(o.created_at)}</Td>
    </Tr>
  )
}

function OrderSheet() {
  const [id, setId] = useParam('order')
  const q = useConsoleOrder(id)
  return (
    <DetailSheet open={!!id} onOpenChange={(o) => !o && setId('')} title={q.data?.order.number ?? 'Order details'} description="Items, discounts, payment and refunds.">
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <OrderDetail d={q.data} />
      )}
    </DetailSheet>
  )
}

function OrderDetail({ d }: { d: ConsoleOrderDetail }) {
  const o = d.order
  const [, setUser] = useParam('user')
  const [, setTab] = useTabParam(TABS, 'overview')
  const [, setOrder] = useParam('order')
  const [refundItem, setRefundItem] = useState<ConsoleOrderDetail['items'][number] | null>(null)
  const refund = useConsoleRefund(o.id)
  const m = (v: number) => money(v, o.currency, o.exponent)
  const open = d.items.filter((i) => !i.refunded_at)
  return (
    <div className="grid gap-5 animate-reveal">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{dateTime(o.created_at)}</p>
        <StatusPill status={o.status} label={ORDER_STATUSES[o.status]} />
      </div>
      <section aria-labelledby="order-customer">
        <h3 id="order-customer" className="mb-2 flex items-center gap-2 text-sm font-semibold"><User className="size-4 text-primary" aria-hidden /> Customer</h3>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{o.name || '—'}</p>
            <p className="truncate text-sm text-muted">{o.email}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => (setOrder(''), setTab('orders'), setUser(o.user_id))}>
            View customer orders ({d.customer_orders})
          </Button>
        </div>
      </section>
      <section aria-labelledby="order-items">
        <h3 id="order-items" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Receipt className="size-4 text-primary" aria-hidden /> Order items ({d.items.length})</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {d.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.course_title}</p>
                {i.discount_minor ? <p className="text-xs text-muted">List price {m(i.list_minor)}</p> : null}
                {i.refunded_at ? <p className="text-xs text-danger">Refunded {dateTime(i.refunded_at)}{i.refund_reason ? `: ${i.refund_reason}` : ''}</p> : null}
              </div>
              <span className="font-semibold tabular">{m(i.gross_minor)}</span>
              {d.refundable && !i.refunded_at ? (
                <Button size="sm" variant="secondary" onClick={() => setRefundItem(i)}>
                  <Undo2 /> Refund
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Totals" className="rounded-lg bg-surface-2 p-4">
        <InfoRow label="Subtotal">{m(d.subtotal_minor)}</InfoRow>
        <InfoRow label={d.discount_label ? `Discount (${d.discount_label})` : 'Discount'}>
          <span className={d.discount_minor ? 'text-success' : undefined}>{d.discount_minor ? `−${m(d.discount_minor)}` : m(0)}</span>
        </InfoRow>
        <InfoRow label={d.prices_include_tax ? 'VAT (included in prices)' : 'VAT'}>{m(d.tax_minor)}</InfoRow>
        <div className="mt-2 flex items-center justify-between border-t border-border-strong pt-3 text-base font-semibold">
          <span>Total paid</span>
          <span className="tabular">{m(o.total_minor)}</span>
        </div>
      </section>
      <section aria-labelledby="order-payment">
        <h3 id="order-payment" className="mb-1 flex items-center gap-2 text-sm font-semibold"><CreditCard className="size-4 text-primary" aria-hidden /> Payment information</h3>
        <InfoRow label="Payment method"><PaymentMethod method={o.payment_method} brand={o.card_brand} last4={o.card_last4} /></InfoRow>
        <InfoRow label="Stripe reference"><span className="font-mono text-xs break-all">{o.payment_intent || '—'}</span></InfoRow>
        <InfoRow label="Currency">{o.currency}{d.country ? ` (regional price, ${d.country})` : ''}</InfoRow>
        <InfoRow label="Payment status"><StatusPill status={d.payment_status} /></InfoRow>
        {o.currency !== 'GBP' ? <InfoRow label="Value in pounds">{gbp(o.gbp_total_minor)}</InfoRow> : null}
      </section>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" disabled={!d.refundable || open.length === 0} onClick={() => setRefundItem(open[0] ?? null)}>
          <Undo2 /> Refund
        </Button>
        {d.invoice_url ? (
          <Button variant="secondary" asChild>
            <a href={d.invoice_url} target="_blank" rel="noopener noreferrer">
              <Download /> Download invoice <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        ) : (
          <Button variant="secondary" disabled title="Stripe hasn’t sent an invoice for this order">
            <FileText /> No invoice yet
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={!!refundItem}
        onOpenChange={(v) => !v && setRefundItem(null)}
        title="Refund this course?"
        body={refundItem ? <>We refund <strong>{m(refundItem.gross_minor)}</strong> for “{refundItem.course_title}” to the customer’s card through Stripe, and their access to the course ends. They get a notification. This can’t be undone.</> : null}
        reason="required"
        confirmLabel="Refund"
        loading={refund.isPending}
        onConfirm={(reason) =>
          refundItem &&
          refund.mutate(
            { itemId: refundItem.id, reason },
            { onSuccess: () => (toast.success('Refunded. The customer has been told.'), setRefundItem(null)), onError: (e) => toast.error((e as Error).message) },
          )
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------- refunds & invoices
function RefundsCard() {
  const [text, setText] = useState('')
  const q = useDebounced(text, 300)
  const list = useConsoleRefunds(q.trim())
  const [, setOrder] = useParam('order')
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader title="Refunds" description="Every refund, who asked for it and why." />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search refunds" placeholder="Customer email or course" className="sm:max-w-xs" />
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<RotateCcw />} title="No refunds" body="Refunds made by learners or by staff appear here." />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead>
              <tr><Th>Order</Th><Th>Customer</Th><Th>Course</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>By</Th><Th>Status</Th><Th>Date</Th></tr>
            </thead>
            <tbody className="stagger">
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setOrder(r.order_id)}>{r.order_number}</button></Td>
                  <Td className="max-w-48 truncate">{r.name || r.email}</Td>
                  <Td className="max-w-56 truncate">{r.course_title}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(r.amount_minor, r.currency, r.exponent)}</Td>
                  <Td className="max-w-64 truncate text-muted" title={r.reason}>{r.reason || '—'}</Td>
                  <Td>{r.by_staff ? 'Staff' : 'Learner'}</Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="refunds" hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  )
}

export function InvoicesCard({ kind = '', title = 'Invoices', description = 'Stripe invoices for orders and subscriptions.' }: { kind?: '' | 'order' | 'subscription'; title?: string; description?: string }) {
  const [text, setText] = useState('')
  const [k, setK] = useState<string>(kind)
  const q = useDebounced(text, 300)
  const list = useConsoleInvoices(q.trim(), k)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search invoices" placeholder="Invoice number or email" className="sm:max-w-xs" />
        {kind ? null : (
          <NativeSelect aria-label="Invoice type" value={k} onChange={(e) => setK(e.target.value)} className="w-full sm:w-48">
            <option value="">Orders and subscriptions</option>
            <option value="order">Orders</option>
            <option value="subscription">Subscriptions</option>
          </NativeSelect>
        )}
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileText />} title="No invoices yet" body="Stripe sends an invoice for every paid order and subscription payment." />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead>
              <tr><Th>Invoice</Th><Th>Type</Th><Th>Customer</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Issued</Th><Th><span className="sr-only">Download</span></Th></tr>
            </thead>
            <tbody className="stagger">
              {rows.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-medium">{i.number}</Td>
                  <Td>{i.kind === 'order' ? 'Order' : 'Subscription'}</Td>
                  <Td className="max-w-48 truncate">{i.name || i.email}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(i.amount_minor, i.currency, i.exponent)}</Td>
                  <Td><StatusPill status={i.status} /></Td>
                  <Td className="whitespace-nowrap text-muted">{dateTime(i.issued_at)}</Td>
                  <Td className="text-right">
                    {i.url ? (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={i.url} target="_blank" rel="noopener noreferrer" aria-label={`Download invoice ${i.number}`}><Download /></a>
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="invoices" hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  )
}

export function ConsoleSalesPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const [range, setRange] = useRangeParam()
  return (
    <>
      <PageHeader
        title="Sales & orders"
        description="Manage platform sales, orders, payments, refunds and invoices."
        actions={
          <>
            <div className="hidden sm:block"><DateRangeSelect value={range} onChange={setRange} /></div>
            <ExportButton path={ordersCsvPath({})} filename="orders.csv" />
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
        <TabsList aria-label="Sales sections">
          <TabsTrigger value="overview"><TrendingUp aria-hidden /> Sales overview</TabsTrigger>
          <TabsTrigger value="orders"><ShoppingCart aria-hidden /> All orders</TabsTrigger>
          <TabsTrigger value="refunds"><RotateCcw aria-hidden /> Refunds</TabsTrigger>
          <TabsTrigger value="invoices"><FileText aria-hidden /> Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="orders"><OrdersCard /></TabsContent>
        <TabsContent value="refunds"><RefundsCard /></TabsContent>
        <TabsContent value="invoices"><InvoicesCard /></TabsContent>
      </Tabs>
      <OrderSheet />
    </>
  )
}
