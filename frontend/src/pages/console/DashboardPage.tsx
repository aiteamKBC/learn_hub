import { Activity, AlertTriangle, ArrowRight, Award, BookOpen, Check, ChevronRight, CircleCheck, Coins, Cpu, CreditCard, Database, FileClock, GraduationCap, HardDrive, Layers, LifeBuoy, Mail, PenLine, Receipt, ShoppingCart, Stamp, UserPlus, Users, Video, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { AreaChart } from '@/features/console/charts'
import { type ConsoleHealth, type ConsoleOverview, useConsoleActivity, useConsoleHealth, useConsoleOverview } from '@/features/console/dashboard'
import { DateRangeSelect, gbp, gbpShort, type Kpi, KpiCard, rangeLabel, useRangeParam } from '@/features/console/ui'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** "▲ 18%" next to a small figure; nothing when there is no earlier period to compare with. */
function Change({ kpi }: { kpi: Kpi }) {
  const c = kpi.change_pct
  if (c === null) return null
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular', c >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
      {c >= 0 ? '▲' : '▼'} {Math.abs(c)}%
    </span>
  )
}

function MiniKpi({ label, kpi, icon, money }: { label: string; kpi: Kpi; icon: ReactNode; money?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate text-lg font-semibold tracking-tight text-text tabular">{money ? <CountUp value={kpi.value} format={gbp} /> : <CountUp value={kpi.value} />}</p>
        <Change kpi={kpi} />
      </div>
    </div>
  )
}

function SalesOverview({ d }: { d: ConsoleOverview }) {
  const s = d.sales
  return (
    <Card className="lg:col-span-6">
      <CardHeader title="Sales overview" description="Course sales in pounds, all currencies converted." action={<Button variant="ghost" size="sm" asChild><Link to="/console/sales">Details <ArrowRight /></Link></Button>} />
      <CardBody className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <MiniKpi label="Total revenue" kpi={s.revenue_gbp_minor} icon={<Coins />} money />
          <MiniKpi label="Courses sold" kpi={s.sales} icon={<ShoppingCart />} />
          <MiniKpi label="Subscriptions" kpi={s.subscription_revenue_gbp_minor} icon={<CreditCard />} money />
        </div>
        <AreaChart points={s.series} format={gbpShort} label="Course revenue per day" height={200} />
      </CardBody>
    </Card>
  )
}

function CountRow({ to, icon, label, n }: { to: string; icon: ReactNode; label: string; n: number }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-surface-2">
        <span className="text-primary [&_svg]:size-[18px]">{icon}</span>
        <span className="min-w-0 flex-1">{label}</span>
        <span className="inline-flex min-w-7 items-center justify-center rounded-md bg-surface-2 px-2 py-0.5 text-[13px] font-semibold tabular group-hover:bg-surface">
          <CountUp value={n} />
        </span>
      </Link>
    </li>
  )
}

function PendingApprovals({ d }: { d: ConsoleOverview }) {
  const a = d.approvals
  return (
    <Card className="flex flex-col lg:col-span-3">
      <CardHeader title="Pending approvals" action={<Link to="/console/approvals" className="text-[13px] font-medium text-primary hover:underline">View all</Link>} />
      <CardBody className="flex flex-1 flex-col gap-4">
        <ul className="stagger divide-y divide-border">
          <CountRow to="/console/approvals?tab=new" icon={<BookOpen />} label="New courses" n={a.new_courses} />
          <CountRow to="/console/approvals?tab=certificates" icon={<Award />} label="Certificate templates" n={a.certificate_templates} />
          <CountRow to="/console/approvals?tab=major" icon={<PenLine />} label="Course changes (major)" n={a.major_changes} />
          {a.other_changes ? <CountRow to="/console/approvals?tab=all" icon={<Layers />} label="Other course changes" n={a.other_changes} /> : null}
        </ul>
        <Button variant="secondary" className="mt-auto w-full" asChild>
          <Link to="/console/approvals">
            <Check /> Review pending items
          </Link>
        </Button>
      </CardBody>
    </Card>
  )
}

function PayoutRequests({ d }: { d: ConsoleOverview }) {
  const p = d.payout_requests
  return (
    <Card className="flex flex-col lg:col-span-3">
      <CardHeader title="Payout requests" action={<Link to="/console/payouts?tab=requests" className="text-[13px] font-medium text-primary hover:underline">View all</Link>} />
      <CardBody className="flex flex-1 flex-col gap-4">
        <ul className="divide-y divide-border text-sm">
          <li className="flex items-center gap-3 px-2 py-2.5">
            <UserPlus className="size-[18px] text-primary" aria-hidden />
            <span className="flex-1">Waiting for a decision</span>
            <span className="font-semibold tabular"><CountUp value={p.pending} /></span>
          </li>
          <li className="flex items-center gap-3 px-2 py-2.5">
            <Wallet className="size-[18px] text-primary" aria-hidden />
            <span className="flex-1">Total amount</span>
            <span className="font-semibold tabular"><CountUp value={p.total_gbp_minor} format={gbp} /></span>
          </li>
        </ul>
        <Button className="mt-auto w-full" asChild>
          <Link to="/console/payouts?tab=requests">
            <Wallet /> Review payout requests
          </Link>
        </Button>
      </CardBody>
    </Card>
  )
}

function NeedsAttention({ d }: { d: ConsoleOverview }) {
  return (
    <Card className="lg:col-span-5">
      <CardHeader title="Needs attention" />
      <CardBody>
        {d.attention.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-3 text-sm text-success">
            <CircleCheck className="size-4" aria-hidden /> Nothing needs you right now.
          </p>
        ) : (
          <ul className="stagger grid gap-2">
            {d.attention.map((a) => (
              <li key={a.key}>
                <Link to={a.url} className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-surface-2">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]', a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
                    <AlertTriangle />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{a.title}</span>
                    <span className="block text-[13px] text-muted">{a.detail}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

const ACTIVITY_ICONS: Record<string, ReactNode> = {
  course_submitted: <Stamp />, course_published: <CircleCheck />, instructor_applied: <GraduationCap />,
  payout_requested: <Wallet />, order: <Receipt />, ticket: <LifeBuoy />, subscription: <CreditCard />,
}

function RecentActivity() {
  const q = useConsoleActivity(8)
  return (
    <Card className="lg:col-span-7">
      <CardHeader title="Recent activity" action={<Link to="/console/audit" className="text-[13px] font-medium text-primary hover:underline">View all</Link>} />
      <CardBody>
        {q.error ? (
          <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="grid gap-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<Activity />} title="Nothing yet" body="New orders, applications and course submissions appear here." className="py-6" />
        ) : (
          <ul className="stagger divide-y divide-border animate-reveal">
            {q.data.items.map((i) => (
              <li key={`${i.kind}-${i.url}-${i.at}`}>
                <Link to={i.url} className="flex items-center gap-3 rounded-md px-1 py-2.5 text-sm transition-colors hover:bg-surface-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text [&_svg]:size-4">{ACTIVITY_ICONS[i.kind] ?? <Activity />}</span>
                  <span className="min-w-0 flex-1 truncate">{i.text}</span>
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">{relativeDate(i.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

const HEALTH_ICONS: Record<string, ReactNode> = {
  database: <Database />, cache: <Cpu />, queue: <FileClock />, storage: <HardDrive />, video: <Video />, email: <Mail />, payments: <CreditCard />,
}
const HEALTH_TONE = {
  ok: { dot: 'bg-success', text: 'text-success', label: 'Working' },
  warning: { dot: 'bg-warning', text: 'text-warning', label: 'Check' },
  down: { dot: 'bg-danger', text: 'text-danger', label: 'Down' },
} as const

function HealthTiles() {
  const q = useConsoleHealth()
  const tiles: ConsoleHealth['tiles'] | undefined = q.data?.tiles
  return (
    <section id="health" aria-labelledby="health-title" className="scroll-mt-24">
      <h2 id="health-title" className="mb-3 text-[15px] font-semibold tracking-tight">System health</h2>
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <ul className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7', tiles && 'stagger')}>
          {!tiles
            ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)
            : tiles.map((t) => {
                const tone = HEALTH_TONE[t.status as keyof typeof HEALTH_TONE] ?? HEALTH_TONE.warning
                return (
                  <li key={t.key} className="min-w-0 rounded-lg border border-border bg-surface p-3 shadow-sm" title={t.detail}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted [&_svg]:size-4">{HEALTH_ICONS[t.key] ?? <Activity />}</span>
                      <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold', tone.text)}>
                        <span className={cn('size-2 rounded-full', tone.dot, t.status === 'ok' && 'motion-safe:animate-pulse')} aria-hidden />
                        {tone.label}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold">{t.label}</p>
                    <p className="line-clamp-2 text-xs text-muted">
                      {t.detail}
                      {t.latency_ms !== null && t.latency_ms !== undefined ? ` ${t.latency_ms} ms.` : ''}
                    </p>
                  </li>
                )
              })}
        </ul>
      )}
    </section>
  )
}

export function ConsoleDashboardPage() {
  const [range, setRange] = useRangeParam()
  const q = useConsoleOverview(range)
  const d = q.data
  const vs = `vs previous ${range.range === 'custom' ? 'period' : rangeLabel(range).replace('Last ', '')}`

  return (
    <>
      <PageHeader title="Admin dashboard" description="Platform overview, key numbers and the things that need your attention." actions={<DateRangeSelect value={range} onChange={setRange} />} />
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-6">
          <section aria-label="Platform overview" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', d && 'stagger')}>
            {!d ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
            ) : (
              <>
                <KpiCard label="Students" kpi={d.students} icon={<Users />} />
                <KpiCard label="Instructors" kpi={d.instructors} icon={<GraduationCap />} tone="info" />
                <KpiCard label="Courses" kpi={d.courses} icon={<BookOpen />} tone="success" />
                <KpiCard label="Enrolments" kpi={d.enrolments} icon={<Layers />} tone="warning" />
              </>
            )}
          </section>
          {d ? <p className="-mt-3 text-xs text-muted">Totals at the end of the period, {vs}.</p> : null}

          <div className={cn('grid gap-4 lg:grid-cols-12', q.isFetching && d && 'opacity-80 transition-opacity')}>
            {!d ? (
              <>
                <Skeleton className="h-[360px] lg:col-span-6" />
                <Skeleton className="h-[360px] lg:col-span-3" />
                <Skeleton className="h-[360px] lg:col-span-3" />
              </>
            ) : (
              <>
                <SalesOverview d={d} />
                <PendingApprovals d={d} />
                <PayoutRequests d={d} />
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            {!d ? <Skeleton className="h-[260px] lg:col-span-5" /> : <NeedsAttention d={d} />}
            <RecentActivity />
          </div>

          <HealthTiles />
        </div>
      )}
    </>
  )
}
