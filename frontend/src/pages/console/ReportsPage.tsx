import { BarChart3, BookOpen, Coins, CreditCard, Crown, Download, Filter, GraduationCap, Layers, Receipt, RefreshCw, RotateCcw, ShoppingCart, Star, Trophy, UserCheck, Users } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Label, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AreaChart, BarList, Donut } from '@/features/console/charts'
import { type ConsoleReport, type ReportFilters, reportCsvPath, useConsoleReport, useReportFilterChoices } from '@/features/console/reports'
import { DateRangeSelect, downloadCsv, gbp, gbpShort, KpiCard, type RangeQuery, rangeLabel, StatusPill, useTabParam } from '@/features/console/ui'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

const TABS = ['overview', 'sales', 'students', 'courses', 'subscriptions'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, { label: string; Icon: typeof BarChart3 }> = {
  overview: { label: 'Overview', Icon: BarChart3 },
  sales: { label: 'Sales reports', Icon: Coins },
  students: { label: 'Student reports', Icon: Users },
  courses: { label: 'Course reports', Icon: BookOpen },
  subscriptions: { label: 'Subscription reports', Icon: Crown },
}
const TYPES = [
  { key: 'sales', label: 'Sales and revenue' },
  { key: 'students', label: 'Students' },
  { key: 'courses', label: 'Courses' },
  { key: 'subscriptions', label: 'Subscriptions' },
] as const
const COLORS = ['var(--chart-1)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const count = (n: number) => n.toLocaleString('en-GB')

/** Filters live in the URL (so a report link can be shared); the panel edits a draft and
 * "Generate report" applies it. */
function useAppliedFilters(): [ReportFilters, (f: ReportFilters) => void] {
  const [params, setParams] = useSearchParams()
  const applied: ReportFilters = {
    range: (params.get('range') as RangeQuery['range']) || '30d',
    start: params.get('start') ?? undefined,
    end: params.get('end') ?? undefined,
    category: params.get('category') ?? undefined,
    instructor: params.get('instructor') ?? undefined,
  }
  const set = (f: ReportFilters) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['range', 'start', 'end', 'category', 'instructor'] as const) {
          const v = f[k]
          const datePart = k === 'start' || k === 'end'
          if (v && (!datePart || f.range === 'custom')) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  return [applied, set]
}

function FiltersPanel({ applied, onApply, types, setTypes, onExport, exporting }: { applied: ReportFilters; onApply: (f: ReportFilters) => void; types: string[]; setTypes: (t: string[]) => void; onExport: () => void; exporting: boolean }) {
  const choices = useReportFilterChoices()
  const [draft, setDraft] = useState<ReportFilters>(applied)
  const key = JSON.stringify(applied)
  useEffect(() => setDraft(JSON.parse(key) as ReportFilters), [key])
  const dirty = JSON.stringify(draft) !== key
  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Filter className="size-4 text-primary" aria-hidden /> Report filters</span>} />
      <CardBody className="grid gap-5">
        <div className="grid gap-1.5">
          <Label>Date range</Label>
          <DateRangeSelect value={draft} onChange={(r) => setDraft({ ...draft, ...r, start: r.start, end: r.end })} />
          <p className="text-xs text-muted">{rangeLabel(draft)}</p>
        </div>
        <fieldset className="grid gap-2.5">
          <legend className="mb-1 text-[13px] font-medium">Report types</legend>
          {TYPES.map((t) => {
            const on = types.includes(t.key)
            return (
              <label key={t.key} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox checked={on} onCheckedChange={() => setTypes(on ? types.filter((x) => x !== t.key) : [...types, t.key])} aria-label={t.label} />
                {t.label}
              </label>
            )
          })}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="report-category">Course category</Label>
          <NativeSelect id="report-category" value={draft.category ?? ''} onChange={(e) => setDraft({ ...draft, category: e.target.value || undefined })}>
            <option value="">All categories</option>
            {choices.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="report-instructor">Instructor</Label>
          <NativeSelect id="report-instructor" value={draft.instructor ?? ''} onChange={(e) => setDraft({ ...draft, instructor: e.target.value || undefined })}>
            <option value="">All instructors</option>
            {choices.data?.instructors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Button onClick={() => onApply(draft)} disabled={draft.range === 'custom' && !(draft.start && draft.end)}>
            <RefreshCw /> Generate report
          </Button>
          {dirty ? <p className="text-xs text-muted">Changes apply when you generate the report.</p> : null}
          <Button variant="secondary" onClick={onExport} loading={exporting} disabled={!types.length}>
            {exporting ? null : <Download />} Export (CSV)
          </Button>
          {applied.category || applied.instructor ? (
            <Button variant="ghost" size="sm" onClick={() => onApply({ range: applied.range, start: applied.start, end: applied.end })}>
              <RotateCcw /> Clear category and instructor
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  )
}

function TrendCard({ r }: { r: ConsoleReport }) {
  const [mode, setMode] = useState<'revenue' | 'orders'>('revenue')
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Revenue trend"
        description="Course sales per day, in pounds."
        action={
          <div role="radiogroup" aria-label="Show" className="inline-flex rounded-md border border-border p-0.5 text-xs">
            {(['revenue', 'orders'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('rounded px-2.5 py-1 font-medium capitalize transition-colors', mode === m ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:text-text')}>
                {m}
              </button>
            ))}
          </div>
        }
      />
      <CardBody>
        {mode === 'revenue' ? <AreaChart points={r.revenue_series} format={gbpShort} label="Course revenue per day" /> : <AreaChart points={r.orders_series} format={count} label="Orders per day" color="var(--chart-5)" />}
      </CardBody>
    </Card>
  )
}

function EnrolmentTypes({ r }: { r: ConsoleReport }) {
  const total = r.enrolments_by_type.reduce((s, x) => s + x.value, 0)
  return (
    <Card>
      <CardHeader title="Enrolments by type" description="New enrolments in the period." />
      <CardBody>
        {total ? (
          <Donut slices={r.enrolments_by_type.map((s, i) => ({ label: s.label, value: s.value, color: COLORS[i % COLORS.length]! }))} centre={count(total)} centreLabel="Enrolments" format={count} />
        ) : (
          <EmptyState icon={<GraduationCap />} title="No enrolments" body="Nobody enrolled in this period." className="py-6" />
        )}
      </CardBody>
    </Card>
  )
}

function SalesByProduct({ r }: { r: ConsoleReport }) {
  const total = r.sales_by_product.reduce((s, x) => s + x.value, 0)
  return (
    <Card>
      <CardHeader title="Sales by product type" description={r.filtered ? 'Subscriptions are not split by course, so they are left out while a filter is on.' : undefined} />
      <CardBody>
        {total ? (
          <Donut slices={r.sales_by_product.map((s, i) => ({ label: s.label, value: s.value, color: COLORS[i]! }))} centre={gbpShort(total)} centreLabel="Revenue" format={gbp} />
        ) : (
          <EmptyState icon={<ShoppingCart />} title="No sales" body="No money came in during this period." className="py-6" />
        )}
      </CardBody>
    </Card>
  )
}

function TopCourses({ r, limit }: { r: ConsoleReport; limit?: number }) {
  const rows = limit ? r.top_courses.slice(0, limit) : r.top_courses
  return (
    <Card className="min-w-0">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Trophy className="size-4 text-warning" aria-hidden /> Top performing courses</span>} action={<Link to="/console/courses" className="text-[13px] font-medium text-primary hover:underline">View all courses</Link>} />
      {rows.length ? (
        <Table className="mt-3">
          <thead>
            <tr>
              <Th className="w-8">#</Th>
              <Th>Course</Th>
              <Th className="text-right">Enrolments</Th>
              {!limit ? <Th className="text-right">Completed</Th> : null}
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Rating</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((c, i) => (
              <Tr key={c.id}>
                <Td className="text-muted tabular">{i + 1}</Td>
                <Td className="max-w-64">
                  <Link to={`/console/courses?course=${c.id}`} className="block truncate font-medium hover:text-primary">{c.title}</Link>
                  {c.category ? <span className="block truncate text-xs text-muted">{c.category}</span> : null}
                </Td>
                <Td className="text-right tabular">{count(c.enrolments)}</Td>
                {!limit ? <Td className="text-right tabular">{count(c.completions)}</Td> : null}
                <Td className="text-right tabular">{gbp(c.revenue_gbp_minor)}</Td>
                <Td className="text-right whitespace-nowrap tabular">{c.rating_count ? <><Star className="mr-1 inline size-3.5 fill-warning text-warning" aria-hidden />{c.rating.toFixed(1)}</> : <span className="text-muted">–</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <CardBody>
          <EmptyState icon={<BookOpen />} title="No course activity" body="No enrolments in this period for these filters." className="py-6" />
        </CardBody>
      )}
    </Card>
  )
}

function RecentSales({ r }: { r: ConsoleReport }) {
  return (
    <Card className="min-w-0">
      <CardHeader title={<span className="inline-flex items-center gap-2"><ShoppingCart className="size-4 text-primary" aria-hidden /> Recent sales</span>} action={<Link to="/console/sales?tab=orders" className="text-[13px] font-medium text-primary hover:underline">View all orders</Link>} />
      {r.recent_sales.length ? (
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Customer</Th>
              <Th>Product</Th>
              <Th className="text-right">Amount</Th>
              <Th>Payment method</Th>
              <Th>Date</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {r.recent_sales.map((s) => (
              <Tr key={`${s.kind}-${s.id}`}>
                <Td className="font-medium whitespace-nowrap">
                  <Link to={s.url} className="hover:text-primary">{s.reference}</Link>
                </Td>
                <Td className="max-w-40 truncate">{s.customer || '–'}</Td>
                <Td className="max-w-56 truncate">{s.product}</Td>
                <Td className="text-right whitespace-nowrap tabular">{money(s.amount_minor, s.currency)}</Td>
                <Td className="whitespace-nowrap text-muted">{s.payment_method || '–'}</Td>
                <Td className="whitespace-nowrap text-muted">{new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Td>
                <Td><StatusPill status={s.status} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <CardBody>
          <EmptyState icon={<Receipt />} title="No sales yet" body="Paid orders and subscription payments appear here." className="py-6" />
        </CardBody>
      )}
    </Card>
  )
}

function Kpis({ children }: { children: ReactNode }) {
  return <section aria-label="Key numbers" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</section>
}

function TabBody({ tab, r, show }: { tab: Tab; r: ConsoleReport; show: (t: string) => boolean }) {
  if (tab === 'sales')
    return (
      <>
        <Kpis>
          <KpiCard label="Course revenue" kpi={r.course_revenue_gbp_minor} icon={<Coins />} format={gbp} />
          <KpiCard label="Orders" kpi={r.orders} icon={<Receipt />} tone="info" />
          <KpiCard label="Average order" kpi={r.average_order_gbp_minor} icon={<ShoppingCart />} tone="success" format={gbp} />
          <KpiCard label="Refunds" kpi={r.refunds_gbp_minor} icon={<RotateCcw />} tone="danger" format={gbp} lowerIsBetter />
        </Kpis>
        <TrendCard r={r} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SalesByProduct r={r} />
          <Card>
            <CardHeader title="Revenue by currency" description="What buyers paid, in their own currency." />
            <CardBody>
              {r.revenue_by_currency.length ? <BarList rows={r.revenue_by_currency.map((c) => ({ label: c.label, value: c.value }))} format={(v) => v.toLocaleString('en-GB')} /> : <EmptyState icon={<Coins />} title="No sales" className="py-6" />}
            </CardBody>
          </Card>
        </div>
        <RecentSales r={r} />
      </>
    )
  if (tab === 'students')
    return (
      <>
        <Kpis>
          <KpiCard label="Students" kpi={r.students} icon={<Users />} />
          <KpiCard label="New students" kpi={r.new_students} icon={<UserCheck />} tone="info" />
          <KpiCard label="Active learners" kpi={r.active_learners} icon={<GraduationCap />} tone="success" />
          <KpiCard label="Completions" kpi={r.completions} icon={<Trophy />} tone="warning" />
        </Kpis>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader title="New students" description="Sign-ups per day." />
            <CardBody><AreaChart points={r.students_series} format={count} label="New students per day" color="var(--chart-2)" /></CardBody>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Enrolments" description="New enrolments per day." />
            <CardBody><AreaChart points={r.enrolments_series} format={count} label="Enrolments per day" color="var(--chart-5)" /></CardBody>
          </Card>
        </div>
        <EnrolmentTypes r={r} />
      </>
    )
  if (tab === 'courses')
    return (
      <>
        <Kpis>
          <KpiCard label="Published courses" kpi={r.courses} icon={<BookOpen />} />
          <KpiCard label="Enrolments" kpi={r.enrolments} icon={<Layers />} tone="info" />
          <KpiCard label="Completions" kpi={r.completions} icon={<Trophy />} tone="success" />
          <KpiCard label="Course revenue" kpi={r.course_revenue_gbp_minor} icon={<Coins />} tone="warning" format={gbp} />
        </Kpis>
        <TopCourses r={r} />
      </>
    )
  if (tab === 'subscriptions')
    return (
      <>
        <Kpis>
          <KpiCard label="Active subscriptions" kpi={r.active_subscriptions} icon={<Crown />} />
          <KpiCard label="Subscription revenue" kpi={r.subscription_revenue_gbp_minor} icon={<CreditCard />} tone="success" format={gbp} />
        </Kpis>
        <Card className="min-w-0">
          <CardHeader title="Subscription revenue" description="Payments per day, converted to pounds." />
          <CardBody><AreaChart points={r.subscription_series} format={gbpShort} label="Subscription revenue per day" color="var(--chart-2)" /></CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="By plan" action={<Link to="/console/subscriptions?tab=plans" className="text-[13px] font-medium text-primary hover:underline">Manage plans</Link>} />
          {r.filtered ? (
            <CardBody><p className="text-sm text-muted">Plans are not split by course. Clear the category and instructor filters to see them.</p></CardBody>
          ) : r.plans.length ? (
            <Table className="mt-3">
              <thead><tr><Th>Plan</Th><Th className="text-right">Active now</Th><Th className="text-right">Started</Th><Th className="text-right">Cancelled</Th><Th className="text-right">Revenue</Th></tr></thead>
              <tbody className="stagger">
                {r.plans.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.name}</Td>
                    <Td className="text-right tabular">{count(p.active)}</Td>
                    <Td className="text-right tabular">{count(p.started)}</Td>
                    <Td className="text-right tabular">{count(p.cancelled)}</Td>
                    <Td className="text-right tabular">{gbp(p.revenue_gbp_minor)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody><EmptyState icon={<Crown />} title="No plans yet" className="py-6" /></CardBody>
          )}
        </Card>
      </>
    )
  return (
    <>
      <Kpis>
        <KpiCard label="Total revenue" kpi={r.revenue_gbp_minor} icon={<Coins />} format={gbp} />
        <KpiCard label="Total students" kpi={r.students} icon={<Users />} tone="info" />
        <KpiCard label="Total courses" kpi={r.courses} icon={<BookOpen />} tone="success" />
        <KpiCard label="Active subscriptions" kpi={r.active_subscriptions} icon={<Crown />} tone="warning" />
      </Kpis>
      {show('sales') || show('students') ? (
        <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
          {show('sales') ? <TrendCard r={r} /> : null}
          {show('students') ? <EnrolmentTypes r={r} /> : null}
        </div>
      ) : null}
      {show('courses') || show('sales') ? (
        <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
          {show('courses') ? <TopCourses r={r} limit={5} /> : null}
          {show('sales') ? <SalesByProduct r={r} /> : null}
        </div>
      ) : null}
      {show('sales') ? <RecentSales r={r} /> : null}
    </>
  )
}

export function ConsoleReportsPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const [applied, apply] = useAppliedFilters()
  const [types, setTypes] = useState<string[]>(TYPES.map((t) => t.key))
  const [exporting, setExporting] = useState(false)
  const q = useConsoleReport(applied)
  const r = q.data

  async function exportCsv() {
    setExporting(true)
    try {
      await downloadCsv(reportCsvPath(applied, types.length ? types : TYPES.map((t) => t.key)), 'learnhub-report.csv')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Reports and analytics"
        description="Sales, students, courses and subscriptions, with filters."
        actions={
          <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting}>
            {exporting ? null : <Download />} Export report
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Report">
          {TABS.map((t) => {
            const { label, Icon } = TAB_LABEL[t]
            return (
              <TabsTrigger key={t} value={t}>
                <Icon aria-hidden /> {label}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="order-2 grid min-w-0 content-start gap-5 lg:order-1">
          {q.error ? (
            <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
          ) : !r ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}</div>
              <Skeleton className="h-[300px]" />
              <Skeleton className="h-[260px]" />
            </>
          ) : (
            <div key={tab} className={cn('grid min-w-0 gap-5 animate-reveal', q.isFetching && 'opacity-80 transition-opacity')}>
              <TabBody tab={tab} r={r} show={(t) => types.includes(t)} />
            </div>
          )}
        </div>
        <div className="order-1 lg:order-2">
          <FiltersPanel applied={applied} onApply={apply} types={types} setTypes={setTypes} onExport={() => void exportCsv()} exporting={exporting} />
        </div>
      </div>
    </>
  )
}
