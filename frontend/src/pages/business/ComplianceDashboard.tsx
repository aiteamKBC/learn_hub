import { AlertOctagon, BellRing, CalendarClock, Download, GraduationCap, ShieldAlert, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { type Dashboard, downloadExport, type RequirementSummary, STATUS, type StatusKey, useDashboard, useRemind, useSummary } from '@/features/compliance/api'
import { useWorkspace } from '@/features/identity/workspace'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'
import { useFill, useInView } from '@/lib/motion'
import { Link } from '@/lib/router'

const ORDER: StatusKey[] = ['compliant', 'expiring_soon', 'in_progress', 'not_started', 'overdue', 'expired', 'exempt']

function toneFor(pct: number) {
  return pct >= 85 ? 'success' : pct >= 65 ? 'warning' : 'danger'
}
const toneText = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const
const toneFill = { success: 'var(--chart-2)', warning: 'var(--chart-3)', danger: 'var(--chart-4)' } as const

/** One requirement: its stacked status bar grows in from the left when it scrolls into view. */
function RequirementRow({ r }: { r: RequirementSummary }) {
  const [ref, seen] = useInView<HTMLLIElement>()
  const k = useFill(1, seen)
  return (
    <li ref={ref}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium">{r.requirement__name}</span>
        <span className="shrink-0 text-muted">
          <span className={cn('font-semibold tabular', toneText[toneFor(r.compliance_pct)])}>{r.compliance_pct.toFixed(0)}%</span> · {r.total} people
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${r.requirement__name}: ${r.compliance_pct}% compliant`}>
        {ORDER.map((key) => {
          const n = r[key]
          return n ? (
            <Tooltip key={key} content={`${STATUS[key].label}: ${n}`}>
              <span className="h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full" style={{ width: `${((n / r.total) * 100) * k}%`, background: STATUS[key].color }} />
            </Tooltip>
          ) : null
        })}
      </div>
    </li>
  )
}

function ByRequirement() {
  const { data, isLoading } = useSummary()
  return (
    <Card>
      <CardHeader title="Compliance by requirement" description="Where each required course stands across your people" />
      <CardBody>
        {isLoading || !data ? (
          <div className="grid gap-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No requirements yet" body="Add the training your people must complete, and progress shows up here." />
        ) : (
          <>
            <ul className="stagger grid gap-5">
              {data.map((r) => (
                <RequirementRow key={r.requirement_id} r={r} />
              ))}
            </ul>
            <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted">
              {ORDER.map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: STATUS[k].color }} /> {STATUS[k].label}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Attention({ rows }: { rows: Dashboard['attention'] }) {
  const remind = useRemind()
  return (
    <Card>
      <CardHeader
        title="Needs attention"
        description="Overdue and expired training, oldest first"
        action={
          <Button variant="link" size="sm" asChild>
            <Link to="/business/matrix">Open matrix</Link>
          </Button>
        }
      />
      <div className="mt-3">
        {rows.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="Everyone is up to date" body="Nobody has overdue or expired training." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Requirement</Th>
                <Th>Status</Th>
                <Th className="hidden sm:table-cell">Due</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.slice(0, 8).map((r) => {
                const s = STATUS[r.status as StatusKey] ?? STATUS.overdue
                return (
                  <Tr key={r.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.member__user__full_name} size="sm" />
                        <span className="font-medium whitespace-nowrap">{r.member__user__full_name}</span>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{r.requirement__name}</Td>
                    <Td>
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                    </Td>
                    <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{r.due_at ? relativeDate(r.due_at) : '–'}</Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={remind.isPending && remind.variables === r.id}
                        onClick={() =>
                          remind.mutate(r.id, {
                            onSuccess: () => toast.success(`Reminder sent to ${r.member__user__full_name}`),
                            onError: (e) => toast.error((e as Error).message),
                          })
                        }
                      >
                        <BellRing /> Remind
                      </Button>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  )
}

export function ComplianceDashboard() {
  const { org } = useWorkspace()
  const { data: d, isLoading, error, refetch } = useDashboard()

  return (
    <>
      <PageHeader
        title="Compliance overview"
        description={org ? `${org.name} · training status for everyone you manage` : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadExport().catch((e: Error) => toast.error(e.message))}>
              <Download /> Export CSV
            </Button>
            <Button asChild>
              <Link to="/business/assign">
                <UserPlus /> Assign training
              </Link>
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-6">
          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]', d && 'stagger')}>
            <Card className="flex items-center gap-6 p-5 sm:col-span-2 xl:col-span-1">
              {isLoading || !d ? <Skeleton className="size-[132px] rounded-full" /> : <Ring value={d.compliance_pct} label="compliant" color={toneFill[toneFor(d.compliance_pct)]} />}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-muted">Overall compliance</p>
                <p className="mt-1 text-sm">{d ? `${d.ok} of ${d.total - d.exempt} required trainings are complete and in date.` : <Skeleton className="h-10 w-40" />}</p>
                {d ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
                    <Users className="size-3.5" /> {d.headcount} people
                  </p>
                ) : null}
              </div>
            </Card>
            {isLoading || !d ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[132px] rounded-lg" />)
            ) : (
              <>
                <StatCard label="Overdue" value={d.overdue} icon={<AlertOctagon />} tone="danger" hint="past their due date" />
                <StatCard label="Expired" value={d.expired} icon={<ShieldAlert />} tone="warning" hint="certificates out of date" />
                <StatCard label="Due in 30 days" value={d.due_30 + d.expiring_30} icon={<CalendarClock />} tone="info" hint={`${d.expiring_30} renewals coming up`} />
              </>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <ByRequirement />
            <Card>
              <CardHeader title="By location" description="Compliance in each unit" />
              <CardBody className={cn('grid gap-5', d && 'stagger')}>
                {isLoading || !d
                  ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)
                  : d.units.map((u) => (
                      <div key={u.unit_id}>
                        <div className="mb-2 flex items-baseline justify-between text-sm">
                          <span className="font-medium">{u.name}</span>
                          <span className="text-muted tabular">{u.compliance_pct.toFixed(0)}%</span>
                        </div>
                        <Progress value={u.compliance_pct} tone={toneFor(u.compliance_pct)} className="h-2" label={`${u.name} compliance`} />
                        <p className="mt-1.5 text-xs text-muted">{u.overdue_or_expired ? `${u.overdue_or_expired} overdue or expired` : 'All in date'}</p>
                      </div>
                    ))}
                {d ? (
                  <div className="mt-1 grid grid-cols-3 gap-3 border-t border-border pt-5 text-center">
                    {[
                      ['Active (30d)', d.learning.active_30],
                      ['In progress', d.learning.in_progress],
                      ['Completed (30d)', d.learning.completed_30],
                    ].map(([label, n]) => (
                      <div key={label as string}>
                        <p className="text-xl font-semibold tabular">{n}</p>
                        <p className="text-[11px] text-muted">{label}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {d ? <Attention rows={d.attention} /> : <Skeleton className="h-80 rounded-lg" />}
          <p className="flex items-center justify-center gap-2 text-xs text-subtle">
            <GraduationCap className="size-3.5" /> Statuses update as people finish courses, and every night at 00:05 UTC.
          </p>
        </div>
      )}
    </>
  )
}
