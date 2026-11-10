import { BarChart3, BookOpen, CheckCircle2, Clock, PiggyBank, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type StudioRevenue, useStudioRevenue } from '@/features/studio/api'
import { Link } from '@/lib/router'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { useFill, useInView } from '@/lib/motion'

// Earnings arrive in GBP minor units (pence), signed: refunds are negative.
const gbp = (minor: number) => money(Math.round(minor), 'GBP')

/** The earning channels the payouts app knows, in a fixed colour order (validated for
 * colour-blind separation; the amber slot always comes with a label or the table). */
const CHANNELS = [
  { code: 'marketplace', label: 'Marketplace sales', color: 'var(--chart-1)' },
  { code: 'instructor_coupon', label: 'Your coupon sales', color: 'var(--chart-3)' },
  { code: 'subscription_pool', label: 'Personal-plan share', color: 'var(--chart-5)' },
] as const

type Month = { key: string; label: string; long: string; byChannel: Record<string, number>; total: number }

/** The last 12 calendar months (oldest first), with every channel filled in (0 when quiet). */
function lastTwelveMonths(rows: StudioRevenue['by_month']): Month[] {
  const now = new Date()
  const months: Month[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({
      key,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      long: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      byChannel: Object.fromEntries(CHANNELS.map((c) => [c.code, 0])),
      total: 0,
    })
  }
  const index = new Map(months.map((m) => [m.key, m]))
  for (const r of rows) {
    const m = index.get(r.month.slice(0, 7))
    if (!m) continue
    m.byChannel[r.channel] = (m.byChannel[r.channel] ?? 0) + r.amount
    m.total += r.amount
  }
  return months
}

/** A round axis top just above the largest month (e.g. £1,840 → £2,000). */
function niceMax(v: number) {
  if (v <= 0) return 1000
  const p = 10 ** Math.floor(Math.log10(v))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * p >= v)!
  return step * p
}

// ---------------------------------------------------------------- chart
function EarningsChart({ months }: { months: Month[] }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const k = useFill(1, seen)
  const [active, setActive] = useState<number | null>(null)
  // bars stack only what was earned; a month whose refunds outweigh sales shows empty
  // (the tooltip and the table still give the real, signed numbers)
  const stackTotal = (m: Month) => CHANNELS.reduce((s, c) => s + Math.max(0, m.byChannel[c.code] ?? 0), 0)
  const top = niceMax(Math.max(...months.map(stackTotal)))
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  const shown = CHANNELS.filter((c) => months.some((m) => m.byChannel[c.code]))
  const legend = shown.length ? shown : CHANNELS.slice(0, 1)
  const a = active === null ? null : months[active]!

  return (
    <div>
      {/* legend above the plot, always present (identity is never colour alone) */}
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {legend.map((c) => (
          <li key={c.code} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden />
            {c.label}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative flex h-56 gap-2 sm:gap-3">
        {/* y axis */}
        <div className="relative w-12 shrink-0 text-right text-[11px] text-subtle tabular" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
              {money(Math.round((top * t) / 100) * 100, 'GBP', 2).replace(/\.00$/, '')}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-border-strong' : 'border-dashed border-border')} style={{ top: `${(1 - t) * 100}%` }} aria-hidden />
          ))}
          <div
            className="absolute inset-0 flex items-end gap-1 sm:gap-2"
            role="group"
            aria-label={`Earnings per month for the last 12 months. Highest: ${gbp(Math.max(...months.map((m) => m.total)))}. The table below lists every month.`}
          >
            {months.map((m, i) => {
              const h = (stackTotal(m) / top) * 100
              const segs = CHANNELS.filter((c) => (m.byChannel[c.code] ?? 0) > 0)
              return (
                <div
                  key={m.key}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  aria-label={`${m.long}: ${gbp(m.total)}`}
                >
                  {/* hover column: a hit target taller than the bar */}
                  <span className={cn('absolute inset-0 rounded-md transition-colors duration-150', active === i ? 'bg-primary-soft/60' : 'group-focus-visible:bg-primary-soft/60')} aria-hidden />
                  <div
                    className="relative flex w-full max-w-9 flex-col-reverse gap-[2px] transition-transform duration-300 ease-out motion-reduce:transition-none"
                    style={{ height: `${h}%`, transform: `scaleY(${k})`, transformOrigin: 'bottom' }}
                    aria-hidden
                  >
                    {segs.map((c, j) => (
                      <span
                        key={c.code}
                        className={cn('block min-h-[2px] w-full', j === segs.length - 1 && 'rounded-t-[4px]')}
                        style={{ flexGrow: m.byChannel[c.code], flexBasis: 0, background: c.color }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {a ? (
            <div
              className="pointer-events-none absolute -top-2 z-10 w-48 -translate-y-full rounded-lg border border-border bg-surface p-3 text-xs shadow-lg animate-fade-in"
              style={{ left: `clamp(0px, calc(${((active! + 0.5) / months.length) * 100}% - 96px), calc(100% - 192px))` }}
              aria-hidden
            >
              <p className="font-semibold text-text">{a.long}</p>
              <ul className="mt-1.5 grid gap-1">
                {CHANNELS.filter((c) => a.byChannel[c.code]).map((c) => (
                  <li key={c.code} className="flex items-center justify-between gap-2 text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: c.color }} aria-hidden />
                      {c.label}
                    </span>
                    <span className="text-text tabular">{gbp(a.byChannel[c.code]!)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex justify-between border-t border-border pt-1.5 font-medium text-text">
                <span>Total</span>
                <span className="tabular">{gbp(a.total)}</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>
      {/* month labels: every other one on phones */}
      <div className="mt-2 flex gap-2 pl-14 text-[11px] text-subtle sm:gap-3 sm:pl-[60px]" aria-hidden>
        <div className="flex flex-1 gap-1 sm:gap-2">
          {months.map((m, i) => (
            <span key={m.key} className={cn('min-w-0 flex-1 text-center', i % 2 === 1 && 'max-sm:invisible')}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-[13px] font-medium text-primary hover:underline">Show as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">Earnings per month and channel</caption>
            <thead className="text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Month</th>
                {CHANNELS.map((c) => (
                  <th key={c.code} className="py-1.5 pr-3 text-right font-medium">{c.label}</th>
                ))}
                <th className="py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {months.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className="py-1.5 pr-3 font-normal">{m.long}</th>
                  {CHANNELS.map((c) => (
                    <td key={c.code} className="py-1.5 pr-3 text-right tabular">{gbp(m.byChannel[c.code] ?? 0)}</td>
                  ))}
                  <td className="py-1.5 text-right font-medium tabular">{gbp(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

// ---------------------------------------------------------------- per course
function CourseRow({ title, amount, share, rank }: { title: string; amount: number; share: number; rank: number }) {
  const [ref, seen] = useInView<HTMLLIElement>()
  const w = useFill(Math.max(0, share), seen)
  return (
    <li ref={ref} className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="w-4 shrink-0 text-xs text-subtle tabular">{rank}</span>
          <span className="truncate font-medium">{title}</span>
        </span>
        <span className="shrink-0 font-semibold tabular">{gbp(amount)}</span>
      </div>
      <div className="mt-2 ml-6 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${w}%` }} />
      </div>
      <p className="mt-1 ml-6 text-xs text-muted">{share.toFixed(0)}% of your earnings</p>
    </li>
  )
}

function Loading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading earnings">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-[380px] rounded-xl" />
        <Skeleton className="h-[380px] rounded-xl" />
      </div>
    </div>
  )
}

export function RevenuePage() {
  const q = useStudioRevenue()
  const data = q.data
  const months = useMemo(() => (data ? lastTwelveMonths(data.by_month) : []), [data])
  const yearTotal = months.reduce((s, m) => s + m.total, 0)
  const allTime = data ? data.by_course.reduce((s, c) => s + c.amount, 0) : 0
  const channelTotals = CHANNELS.map((c) => ({ ...c, total: months.reduce((s, m) => s + (m.byChannel[c.code] ?? 0), 0) }))
  const positiveCourseTotal = data ? data.by_course.reduce((s, c) => s + Math.max(0, c.amount), 0) : 0
  const money$ = (n: number) => gbp(n)

  return (
    <div>
      <PageHeader title="Sales & earnings" description="What your courses have earned, month by month and course by course." />
      {data ? (
        // the rate is set by LearnHub staff; past sales keep the rate they were made at
        <p className="-mt-2 mb-5 text-sm text-muted">
          You keep <span className="font-medium text-text tabular">{Math.round((100 - data.platform_fee_pct) * 100) / 100}%</span> of each marketplace sale. LearnHub’s fee is{' '}
          <span className="tabular">{data.platform_fee_pct}%</span>{data.fee_is_custom ? ', agreed for your account' : ''}.
        </p>
      ) : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError || !data ? (
        <Card>
          <ErrorState onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <div className="animate-reveal grid gap-6">
          <ul className="stagger grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <li className="min-w-0">
              <StatCard label="Earned, all time" icon={<PiggyBank />} value={<CountUp value={allTime} format={money$} />} hint="After refunds" />
            </li>
            <li className="min-w-0">
              <StatCard label="Available" tone="success" icon={<Wallet />} value={<CountUp value={data.balance.available} format={money$} />} hint="Ready for your next payout" />
            </li>
            <li className="min-w-0">
              <StatCard label="Pending" tone="warning" icon={<Clock />} value={<CountUp value={data.balance.pending} format={money$} />} hint="Inside the refund window" />
            </li>
            <li className="min-w-0">
              <StatCard label="Paid out" tone="info" icon={<CheckCircle2 />} value={<CountUp value={data.balance.paid} format={money$} />} hint={<Link to="/studio/payouts" className="font-medium text-primary hover:underline">See payouts</Link>} />
            </li>
          </ul>

          {data.by_month.length === 0 && data.by_course.length === 0 ? (
            <Card>
              <EmptyState
                icon={<BarChart3 />}
                title="No earnings yet"
                body="When someone buys one of your courses, or learns it on a personal plan, the money you earn shows here."
                action={<Link to="/studio/courses" className="text-sm font-medium text-primary hover:underline">Go to my courses</Link>}
              />
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card className="min-w-0">
                <CardHeader title="Earnings overview" description={<>Last 12 months: <span className="font-medium text-text tabular">{gbp(yearTotal)}</span></>} />
                <CardBody>
                  <EarningsChart months={months} />
                  <ul className="stagger mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
                    {channelTotals.map((c) => (
                      <li key={c.code} className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden />
                          {c.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular">
                          <CountUp value={c.total} format={money$} />
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
              <Card className="min-w-0">
                <CardHeader title="Earnings by course" description="All time, after refunds" />
                <CardBody>
                  {data.by_course.length ? (
                    <ol className="stagger divide-y divide-border">
                      {data.by_course.map((c, i) => (
                        <CourseRow
                          key={c.course_id}
                          rank={i + 1}
                          title={c.course__title}
                          amount={c.amount}
                          share={positiveCourseTotal ? (Math.max(0, c.amount) / positiveCourseTotal) * 100 : 0}
                        />
                      ))}
                    </ol>
                  ) : (
                    <EmptyState icon={<BookOpen />} title="No course earnings yet" className="py-6" />
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
