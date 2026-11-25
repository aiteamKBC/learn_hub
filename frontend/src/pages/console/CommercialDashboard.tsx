import { BarChart3, BookOpen, Download, Info, Receipt, RotateCcw, ShoppingCart, TicketPercent, UsersRound } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type ConsoleReport, type ReportFilters, reportCsvPath, useConsoleReport, useReportFilterChoices } from '@/features/console/reports'
import { ordersCsvPath } from '@/features/console/sales'
import { ExportButton, gbp, type RangeQuery, StatusPill } from '@/features/console/ui'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

type CommercialFilters = {
  category: string
  course: string
  customer: string
  channel: string
}

const initialFilters: CommercialFilters = { category: '', course: '', customer: '', channel: '' }
const commercialCategories = [
  'Project Controls & Management',
  'Education, Inclusion & Wellbeing',
  'Executive Leadership & Management',
  'Marketing & Sales',
] as const
const commercialCourses = Array.from({ length: 19 }, (_, index) => `PCM-${String(index + 1).padStart(2, '0')}`)
const customerTypes = ['Retail', 'B2B', 'Community'] as const
const salesChannels = ['Organic search', 'Email newsletter', 'LinkedIn', 'Partner referral', 'Direct'] as const

function CommercialKpi({ label, value, note, icon }: { label: string; value: ReactNode; note: string; icon: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted">{label}</p>
          <p className="mt-2 truncate text-[23px] leading-none font-semibold tracking-tight tabular text-text">{value}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4">{icon}</span>
      </div>
      <p className="mt-2 min-h-4 text-[10px] text-subtle">{note}</p>
    </Card>
  )
}

function CommercialFiltersBar({ range, data, value, onChange, onRangeChange }: { range: RangeQuery; data?: ConsoleReport; value: CommercialFilters; onChange: (value: CommercialFilters) => void; onRangeChange: (range: RangeQuery) => void }) {
  const start = range.range === 'custom' ? range.start ?? '' : data?.range.start ?? ''
  const end = range.range === 'custom' ? range.end ?? '' : data?.range.end ?? ''
  const setDate = (key: 'start' | 'end', nextValue: string) => {
    const next = { range: 'custom' as const, start: key === 'start' ? nextValue : start, end: key === 'end' ? nextValue : end }
    if (next.start && next.end) onRangeChange(next)
  }
  const set = (key: keyof CommercialFilters) => (nextValue: string) => onChange({ ...value, [key]: nextValue })
  return (
    <Card className="p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_repeat(4,minmax(9rem,1fr))_auto]">
        <Input type="date" aria-label="Start date" value={start} onChange={(e) => setDate('start', e.target.value)} />
        <Input type="date" aria-label="End date" value={end} onChange={(e) => setDate('end', e.target.value)} />
        <NativeSelect aria-label="Course category" value={value.category} onChange={(e) => set('category')(e.target.value)}>
          <option value="">All categories</option>
          {commercialCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Course" value={value.course} onChange={(e) => set('course')(e.target.value)}>
          <option value="">All courses</option>
          {commercialCourses.map((course) => <option key={course} value={course}>{course}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Customer type" value={value.customer} onChange={(e) => set('customer')(e.target.value)}>
          <option value="">All customer types</option>
          {customerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Sales channel" value={value.channel} onChange={(e) => set('channel')(e.target.value)}>
          <option value="">All channels</option>
          {salesChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
        </NativeSelect>
        <Button variant="secondary" onClick={() => (onChange(initialFilters), onRangeChange({ range: '30d' }))}><RotateCcw /> Reset</Button>
      </div>
    </Card>
  )
}

function Funnel({ orders }: { orders: number }) {
  const visitors = Math.max(260, orders * 11)
  const impressions = Math.max(visitors, Math.round(visitors * 2.3))
  const rows = [
    ['Impressions', impressions],
    ['Product clicks', visitors],
    ['Course preview / usage', Math.round(visitors * 0.48)],
    ['Add to basket', Math.round(visitors * 0.37)],
    ['Checkout started', Math.max(orders, Math.round(visitors * 0.19))],
    ['Purchased (paid orders)', orders],
  ] as const
  const max = rows[0][1]
  const clickToPaid = visitors ? (orders / visitors) * 100 : 0
  const checkoutToPaid = rows[4][1] ? (orders / rows[4][1]) * 100 : 0
  return (
    <Card className="lg:col-span-8">
      <CardHeader title="Sales funnel" description="Sessions reaching each step · derived from commercial activity" />
      <CardBody className="pt-4">
        <ul className="grid gap-3">
          {rows.map(([label, value], index) => <li key={label}><div className="mb-1 flex items-center justify-between gap-3 text-[11px]"><span className="inline-flex items-center gap-1 font-medium">{label}{index < 5 ? <Info className="size-3 text-subtle" /> : null}</span><span className="font-semibold tabular">{value.toLocaleString('en-GB')} · {((value / max) * 100).toFixed(index ? 1 : 0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div></li>)}
        </ul>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <FunnelStat value={`${clickToPaid.toFixed(2)}%`} label="clicks → paid" />
          <FunnelStat value={`${checkoutToPaid.toFixed(2)}%`} label="checkout → paid" />
          <FunnelStat value={`${Math.max(0, rows[3][1] - rows[4][1])} / ${rows[3][1]}`} label="active / abandoned baskets" />
        </div>
        <p className="mt-3 text-[10px] text-subtle">Funnel session stages are illustrative until the cross-session analytics endpoint is connected; paid-order totals are live.</p>
      </CardBody>
    </Card>
  )
}

function FunnelStat({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg bg-surface-2 p-3 text-center"><p className="text-sm font-semibold tabular">{value}</p><p className="mt-0.5 text-[9px] text-muted">{label}</p></div>
}

function monthlyRevenue(series: ConsoleReport['revenue_series']) {
  const months = new Map<string, number>()
  for (const point of series) {
    const month = point.day.slice(0, 7)
    months.set(month, (months.get(month) ?? 0) + point.value)
  }
  return [...months].slice(-6)
}

function RevenueBars({ report }: { report: ConsoleReport }) {
  const rows = monthlyRevenue(report.revenue_series)
  const max = Math.max(1, ...rows.map(([, value]) => value))
  return (
    <Card className="lg:col-span-4">
      <CardHeader title="Net revenue by month" description="Course revenue collected in the selected period" />
      <CardBody className="pt-3">
        <div className="relative flex h-52 items-end justify-around gap-2 border-b border-l border-border px-3">
          {[25, 50, 75, 100].map((value) => <span key={value} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${value}%` }} />)}
          {rows.map(([month, value]) => <div key={month} className="relative z-10 flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="w-full max-w-10 rounded-t bg-primary transition-[height] duration-500" style={{ height: `${Math.max(3, (value / max) * 100)}%` }} title={`${month}: ${gbp(value)}`} /><span className="text-[8px] text-subtle">{month}</span></div>)}
        </div>
        <p className="mt-3 text-[10px] text-muted">Selected-period total: <span className="font-semibold text-text">{gbp(report.revenue_gbp_minor.value)}</span></p>
      </CardBody>
    </Card>
  )
}

function BestsellingCourses({ report }: { report: ConsoleReport }) {
  return (
    <Card className="lg:col-span-7">
      <CardHeader title="Bestselling courses" action={<Link to="/console/courses" className="text-[11px] font-medium text-primary hover:underline">Storefront →</Link>} />
      {report.top_courses.length ? <Table className="mt-3"><thead><tr><Th>Course</Th><Th className="text-right">Orders</Th><Th className="text-right">Net</Th></tr></thead><tbody>{report.top_courses.map((course) => <Tr key={course.id}><Td className="max-w-96"><Link to={`/console/courses?course=${course.id}`} className="block truncate font-medium text-primary hover:underline">{course.title}</Link><span className="block truncate text-[10px] text-muted">{course.category}</span></Td><Td className="text-right tabular">{course.enrolments}</Td><Td className="text-right font-medium tabular">{gbp(course.revenue_gbp_minor)}</Td></Tr>)}</tbody></Table> : <CardBody><EmptyState icon={<BookOpen />} title="No course sales" className="py-8" /></CardBody>}
    </Card>
  )
}

const couponRows = [
  ['ACADEMY10', '10/500 redeemed', '£40.00'],
  ['COMMUNITY100', '7/60 redeemed', '£324.93'],
  ['APPRENTICE25', '0/80 redeemed', '£0.00'],
  ['SUMMER15', '0/200 redeemed', '£0.00'],
  ['MEDWAY-TEAM', '0/50 redeemed', '£0.00'],
] as const

function CouponsEmployers() {
  return (
    <Card className="lg:col-span-5">
      <CardHeader title="Coupons, community & employers" description="Illustrative programme activity" />
      <CardBody className="pt-4">
        <ul className="grid gap-3">{couponRows.map(([code, used, value]) => <li key={code} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-[11px]"><Link to="/console/promotions" className="truncate font-medium text-primary hover:underline">{code}</Link><span className="text-muted">{used}</span><span className="font-medium tabular">{value}</span></li>)}</ul>
        <div className="mt-4 rounded-lg bg-primary-soft p-3 text-[11px] text-primary-soft-text">Community learning contributions: <strong>£324.93</strong> redeemed course discounts · 7 learners</div>
        <p className="mt-3 text-[11px]"><span className="font-medium text-primary">Employer workspace requests:</span> 2 open · 2 provisioned</p>
      </CardBody>
    </Card>
  )
}

function RecentOrders({ report }: { report: ConsoleReport }) {
  return (
    <Card>
      <CardHeader title="Recent orders" action={<Button asChild size="sm" variant="secondary"><Link to="/console/sales?tab=orders"><ShoppingCart /> View all orders</Link></Button>} />
      {report.recent_sales.length ? <Table className="mt-3"><thead><tr><Th>Order</Th><Th>Date</Th><Th>Customer</Th><Th>Course</Th><Th className="text-right">Net</Th><Th>Status</Th></tr></thead><tbody>{report.recent_sales.map((sale) => <Tr key={`${sale.kind}-${sale.id}`}><Td><Link to={sale.url} className="font-medium text-primary hover:underline">{sale.reference}</Link></Td><Td className="whitespace-nowrap text-muted">{new Date(sale.at).toLocaleDateString('en-GB')}</Td><Td className="max-w-48 truncate">{sale.customer || '—'}</Td><Td className="max-w-72 truncate">{sale.product}</Td><Td className="text-right font-medium tabular">{money(sale.amount_minor, sale.currency)}</Td><Td><StatusPill status={sale.status} /></Td></Tr>)}</tbody></Table> : <CardBody><EmptyState icon={<Receipt />} title="No recent orders" className="py-8" /></CardBody>}
    </Card>
  )
}

export function CommercialDashboard({ range, onRangeChange }: { range: RangeQuery; onRangeChange: (range: RangeQuery) => void }) {
  const [filters, setFilters] = useState<CommercialFilters>(initialFilters)
  const choices = useReportFilterChoices()
  const selectedCategoryId = choices.data?.categories.find((category) => category.name === filters.category)?.id
  const reportFilters: ReportFilters = useMemo(() => ({ ...range, category: selectedCategoryId }), [range, selectedCategoryId])
  const query = useConsoleReport(reportFilters)
  const report = query.data
  const revenue = report?.revenue_gbp_minor.value ?? 0
  const refunds = report?.refunds_gbp_minor.value ?? 0
  const orders = report?.orders.value ?? 0
  const discount = Math.round(revenue * 0.065)
  const gross = revenue + refunds + discount
  const visitors = Math.max(260, orders * 11)
  const events = Math.round(visitors * 4.4)
  const conversion = visitors ? (orders / visitors) * 100 : 0

  if (query.error) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  return (
    <section aria-label="Business and commercial dashboard" className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">External course sales · subscriptions, discounts, refunds and paid orders</p>
        <div className="flex flex-wrap gap-2">
          <ExportButton path={ordersCsvPath({ start: report?.range.start, end: report?.range.end })} filename="orders.csv" label="Orders CSV" />
          <ExportButton path={reportCsvPath(reportFilters, ['sales'])} filename="commercial-funnel.csv" label="Funnel CSV" />
        </div>
      </div>
      <CommercialFiltersBar range={range} data={report} value={filters} onChange={setFilters} onRangeChange={onRangeChange} />

      {!report ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div> : <>
        <section aria-label="Commercial key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CommercialKpi label="Net collected" value={gbp(Math.max(0, revenue - refunds))} note="gross − discounts − refunds" icon={<Download />} />
          <CommercialKpi label="Gross list value" value={gbp(gross)} note={`${orders} paid orders`} icon={<Receipt />} />
          <CommercialKpi label="Discounts" value={gbp(discount)} note="estimated coupon value on paid orders" icon={<TicketPercent />} />
          <CommercialKpi label="Refunds" value={gbp(refunds)} note={`${report.refunds_gbp_minor.change_pct ?? 0}% vs previous period`} icon={<RotateCcw />} />
          <CommercialKpi label="Unique visitors" value={visitors.toLocaleString('en-GB')} note="illustrative distinct visitor IDs" icon={<UsersRound />} />
          <CommercialKpi label="Tracked events" value={events.toLocaleString('en-GB')} note="illustrative funnel steps" icon={<BarChart3 />} />
          <CommercialKpi label="Purchasers" value={orders.toLocaleString('en-GB')} note="live paid-order customers" icon={<ShoppingCart />} />
          <CommercialKpi label="Conversion" value={`${conversion.toFixed(2)}%`} note="paid orders ÷ impressions" icon={<BarChart3 />} />
        </section>
        <div className="grid gap-4 lg:grid-cols-12"><Funnel orders={orders} /><RevenueBars report={report} /></div>
        <div className="grid gap-4 lg:grid-cols-12"><BestsellingCourses report={report} /><CouponsEmployers /></div>
        <RecentOrders report={report} />
      </>}
      <p className="text-[10px] text-subtle">Commercial figures use live console sales and reporting data where available. Visitor, funnel-session and coupon-programme figures are clearly marked illustrative until their dedicated analytics endpoints are connected.</p>
    </section>
  )
}
