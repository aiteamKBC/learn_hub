import { Armchair, CalendarDays, ClipboardCheck, FileText, Inbox, PoundSterling, UserCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { NativeSelect } from '@/components/ui/input'
import { ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { AreaChart, BarList } from '@/features/console/charts'
import { Toolbar, dateTime } from '@/features/console/money-ui'
import { KpiCard, gbp, gbpShort } from '@/features/console/ui'
import { useCnAttendance, useCnAttendanceAction, useCnOverview, useCnRankings, useCnRevenueSeries } from '@/features/corporate/console'
import { QueryBlock } from '@/features/corporate/ui'

const RANGES = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['12m', 'Last 12 months'],
] as const
const err = (e: unknown) => toast.error((e as Error).message)

function Overview({ range }: { range: string }) {
  const q = useCnOverview(range)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  const d = q.data
  return (
    <div className="stagger grid gap-4 animate-reveal sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard label="Company revenue" kpi={d.revenue} icon={<PoundSterling />} format={gbpShort} />
      <KpiCard label="Seats sold" kpi={d.seats_sold} icon={<Armchair />} tone="info" />
      <KpiCard label="Seats given to people" kpi={d.allocations_made} icon={<UserCheck />} tone="success" />
      <StatCard label="Live groups running" value={<CountUp value={d.active_cohorts} />} icon={<CalendarDays />} tone="info" />
      <StatCard label="Requests to review" value={<CountUp value={d.pending_requests} />} icon={<Inbox />} tone="warning" />
      <StatCard label="Quotes waiting for payment" value={<CountUp value={d.open_quotes} />} icon={<FileText />} />
    </div>
  )
}

function Revenue({ range }: { range: string }) {
  const q = useCnRevenueSeries(range)
  return (
    <Card>
      <CardHeader title="Company revenue" description="Paid seat purchases by day" />
      <CardBody>
        <QueryBlock query={q} rows={3}>
          {(rows) => (rows.length ? <AreaChart points={rows.map((r) => ({ day: r.day, value: r.revenue }))} format={gbpShort} label="Company revenue by day" /> : <p className="py-10 text-center text-sm text-muted">No sales in this period.</p>)}
        </QueryBlock>
      </CardBody>
    </Card>
  )
}

function Rankings() {
  const q = useCnRankings()
  return (
    <Card>
      <CardHeader title="Top companies" description="By total spend" />
      <CardBody>
        <QueryBlock query={q} rows={4}>
          {(rows) =>
            rows.length ? (
              <BarList rows={rows.map((r) => ({ label: r.org_name, value: r.total_spend, hint: `${r.total_seats} seats` }))} format={gbp} />
            ) : (
              <p className="py-10 text-center text-sm text-muted">No company purchases yet.</p>
            )
          }
        </QueryBlock>
      </CardBody>
    </Card>
  )
}

/** Zoom attendance that could not be matched to a person by email (I02): staff decide. */
function AttendanceReview() {
  const [status, setStatus] = useState('unresolved')
  const q = useCnAttendance(status)
  const act = useCnAttendanceAction()
  return (
    <Card>
      <CardHeader title="Attendance" description="Check sessions where we could not be sure who joined." />
      <Toolbar>
        <NativeSelect aria-label="Match" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="unresolved">Needs checking</option>
          <option value="verified">Matched</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <ClipboardCheck />, title: 'Nothing to check', body: 'Attendance we could not match will show here.' }}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="hidden md:table-cell">Session</Th>
                <Th className="hidden sm:table-cell">Joined</Th>
                <Th className="text-right">Time</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <span className="block max-w-[12rem] truncate font-medium">{a.user_name || a.user_email}</span>
                    <span className="block max-w-[12rem] truncate text-xs text-muted">{a.org_name}</span>
                  </Td>
                  <Td className="hidden md:table-cell">
                    {a.session_sequence}. {a.session_title}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{dateTime(a.join_at)}</Td>
                  <Td className="text-right tabular-nums">{Math.round(a.duration_seconds / 60)} min</Td>
                  <Td className="whitespace-nowrap text-right">
                    {a.match_status === 'unresolved' ? (
                      <>
                        <Button size="sm" variant="soft" onClick={() => act.mutate({ id: a.id, action: 'verify' }, { onSuccess: () => toast.success('Attendance confirmed'), onError: err })}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: a.id, action: 'reject' }, { onSuccess: () => toast.success('Attendance rejected'), onError: err })}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Badge tone={a.match_status === 'verified' ? 'success' : 'neutral'}>{a.match_status === 'verified' ? 'Matched' : 'Rejected'}</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBlock>
    </Card>
  )
}

export function ConsoleCorporateReportsPage() {
  const [range, setRange] = useState('30d')
  useEffect(() => {
    document.title = 'Company reports · Console · LearnHub'
  }, [])
  return (
    <>
      <PageHeader
        title="Company reports"
        description="Company sales, seats, live groups and attendance."
        actions={
          <NativeSelect aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)} className="w-44">
            {RANGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <div className="grid gap-6">
        <Overview range={range} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Revenue range={range} />
          <Rankings />
        </div>
        <AttendanceReview />
      </div>
    </>
  )
}
