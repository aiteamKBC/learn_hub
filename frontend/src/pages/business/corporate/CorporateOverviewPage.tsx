import { Armchair, CalendarDays, ClipboardList, GraduationCap, PoundSterling, Send, UserCheck } from 'lucide-react'
import { useEffect } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAttendanceSummary, useCorporateDashboard, useEmployeeProgress } from '@/features/corporate/api'
import { fullDate, gbp } from '@/features/corporate/format'
import { QueryBlock } from '@/features/corporate/ui'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function Kpis() {
  const admin = useIsOrgAdmin()
  const q = useCorporateDashboard()
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  const d = q.data
  return (
    <div className="stagger grid gap-4 animate-reveal sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Seats bought" value={<CountUp value={d.total_seats_purchased} />} icon={<Armchair />} />
      <StatCard label="Seats given" value={<CountUp value={d.seats_allocated} />} icon={<UserCheck />} tone="success" hint={`${d.seats_available} free`} />
      <StatCard label="Live groups" value={<CountUp value={d.active_cohorts} />} icon={<CalendarDays />} tone="info" hint={d.pending_requests ? `${d.pending_requests} ${d.pending_requests === 1 ? 'request' : 'requests'} under review` : undefined} />
      {admin ? (
        <StatCard label="Total spent" value={<CountUp value={d.total_spend_minor} format={(n) => gbp(Math.round(n))} />} icon={<PoundSterling />} tone="warning" />
      ) : (
        <StatCard label="Requests under review" value={<CountUp value={d.pending_requests} />} icon={<Send />} tone="warning" />
      )}
    </div>
  )
}

const ENROL_TONE: Record<string, 'success' | 'primary' | 'neutral' | 'danger'> = { completed: 'success', active: 'primary', revoked: 'danger' }

function ProgressTab() {
  const q = useEmployeeProgress()
  return (
    <QueryBlock query={q} empty={{ icon: <GraduationCap />, title: 'Nobody has a seat yet', body: 'Progress shows here once you give seats to your people.', action: <Button asChild variant="secondary"><Link to="/business/seats">Give seats</Link></Button> }}>
      {(rows) => (
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th className="hidden md:table-cell">Course</Th>
              <Th>Progress</Th>
              <Th className="hidden sm:table-cell">Status</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((r, i) => (
              <Tr key={`${r.user_id}-${r.course_title}-${i}`}>
                <Td>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={r.user_name} size="sm" className="hidden sm:inline-flex" />
                    <span className="min-w-0">
                      <span className="block max-w-[12rem] truncate font-medium">{r.user_name}</span>
                      <span className="block max-w-[12rem] truncate text-xs text-muted md:hidden">{r.course_title}</span>
                    </span>
                  </div>
                </Td>
                <Td className="hidden max-w-[16rem] truncate md:table-cell">{r.course_title}</Td>
                <Td className="min-w-[7rem]">
                  <div className="flex items-center gap-2">
                    <Progress value={r.progress_pct} className="w-20" label={`${r.progress_pct}% done`} />
                    <span className="text-xs tabular-nums text-muted">{r.progress_pct}%</span>
                  </div>
                </Td>
                <Td className="hidden capitalize sm:table-cell">
                  <Badge tone={ENROL_TONE[r.enrollment_status] ?? 'neutral'}>{r.enrollment_status === 'active' ? 'In progress' : r.enrollment_status}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </QueryBlock>
  )
}

const minutes = (sec: number) => `${Math.round(sec / 60)} min`

function AttendanceTab() {
  const q = useAttendanceSummary()
  return (
    <QueryBlock query={q} empty={{ icon: <ClipboardList />, title: 'No attendance yet', body: 'Attendance from live sessions shows here after each session.' }}>
      {(rows) => (
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th className="hidden md:table-cell">Session</Th>
              <Th className="hidden sm:table-cell">Joined</Th>
              <Th className="text-right">Time</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((r, i) => (
              <Tr key={i}>
                <Td>
                  <span className="block max-w-[12rem] truncate font-medium">{r.user_name}</span>
                  <span className="block max-w-[12rem] truncate text-xs text-muted">{r.course_title}</span>
                </Td>
                <Td className="hidden md:table-cell">{r.session_title}</Td>
                <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{fullDate(r.join_at)}</Td>
                <Td className="text-right tabular-nums">
                  {minutes(r.duration_seconds)}
                  {r.match_status !== 'verified' ? (
                    <Badge tone="warning" className="ml-2">
                      Being checked
                    </Badge>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </QueryBlock>
  )
}

export function CorporateOverviewPage() {
  useEffect(() => {
    document.title = 'Company training · LearnHub'
  }, [])
  return (
    <>
      <PageHeader
        title="Company training"
        description="Seats, live groups and how your people are getting on."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/business/live-bookings">Live training</Link>
            </Button>
            <Button asChild>
              <Link to="/business/packages">Course packages</Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-6">
        <Kpis />
        <Card className="p-5">
          <Tabs defaultValue="progress">
            <TabsList aria-label="Report">
              <TabsTrigger value="progress">Progress</TabsTrigger>
              <TabsTrigger value="attendance">Live attendance</TabsTrigger>
            </TabsList>
            <TabsContent value="progress" className="-mx-5 mt-4">
              <ProgressTab />
            </TabsContent>
            <TabsContent value="attendance" className="-mx-5 mt-4">
              <AttendanceTab />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </>
  )
}
