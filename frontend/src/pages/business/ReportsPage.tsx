import { BarChart3, Building2, Download, History, ScrollText, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import {
  type AuditEntry,
  complianceTone,
  type Dashboard,
  downloadExport,
  type RequirementSummary,
  STATUS,
  STATUS_ORDER,
  TONE_FILL,
  TONE_TEXT,
  useAudit,
  useDashboard,
  useSummary,
} from '@/features/compliance/api'
import { unitLabel, useIsOrgAdmin, useUnits } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { useFill, useInView } from '@/lib/motion'

// ---------------------------------------------------------------- shared pieces
function UnitSelect({ value, onChange, label, allLabel = 'Whole company' }: { value: string; onChange: (v: string) => void; label: string; allLabel?: string }) {
  const units = useUnits()
  return (
    <NativeSelect aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full sm:w-60">
      <option value="">{allLabel}</option>
      {units.data?.map((u) => (
        <option key={u.id} value={u.id}>
          {unitLabel(u, units.data!)}
        </option>
      ))}
    </NativeSelect>
  )
}

/** One requirement as a stacked status bar that grows in when it scrolls into view. */
function StackedRow({ r }: { r: RequirementSummary }) {
  const [ref, seen] = useInView<HTMLLIElement>()
  const k = useFill(1, seen)
  const tone = complianceTone(r.compliance_pct)
  return (
    <li ref={ref}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{r.requirement__name}</span>
        <span className="shrink-0 text-muted">
          <CountUp value={r.compliance_pct} format={(n) => `${n.toFixed(0)}%`} className={cn('font-semibold tabular', TONE_TEXT[tone])} /> · {r.total} people
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${r.requirement__name}: ${r.compliance_pct.toFixed(0)}% compliant, ${r.overdue + r.expired} overdue or expired`}>
        {STATUS_ORDER.map((key) => {
          const n = r[key]
          return n ? (
            <Tooltip key={key} content={`${STATUS[key].label}: ${n}`}>
              <span className="h-full transition-[width] duration-700 ease-out" style={{ width: `${(n / r.total) * 100 * k}%`, background: STATUS[key].color }} />
            </Tooltip>
          ) : null
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {r.overdue + r.expired ? `${r.overdue + r.expired} overdue or expired` : 'Nobody overdue'}
        {r.requirement__renewal_months ? ` · renews every ${r.requirement__renewal_months} months` : ''}
      </p>
    </li>
  )
}

function Legend({ totals }: { totals?: Record<string, number> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted">
      {STATUS_ORDER.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: STATUS[k].color }} aria-hidden /> {STATUS[k].label}
          {totals ? <span className="font-medium text-text tabular">{totals[k] ?? 0}</span> : null}
        </li>
      ))}
    </ul>
  )
}

function RequirementBars({ unitId }: { unitId: string }) {
  const { data, isLoading, error, refetch, isPlaceholderData, isFetching } = useSummary(unitId || undefined)
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !data)
    return (
      <div className="grid gap-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  if (!data.length) return <EmptyState icon={<ShieldCheck />} title="Nothing to report yet" body="No requirements apply to anyone here." />
  const totals = Object.fromEntries(STATUS_ORDER.map((k) => [k, data.reduce((a, r) => a + r[k], 0)]))
  return (
    <div className={cn('animate-reveal grid gap-6 transition-opacity duration-200', isPlaceholderData && isFetching && 'opacity-60')}>
      <ul className="stagger grid gap-5">
        {data.map((r) => (
          <StackedRow key={r.requirement_id} r={r} />
        ))}
      </ul>
      <Legend totals={totals} />
    </div>
  )
}

// ---------------------------------------------------------------- tab: by requirement
function ByRequirement({ unitId, setUnitId }: { unitId: string; setUnitId: (v: string) => void }) {
  const { data: d, isLoading } = useDashboard()
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="flex flex-col items-center gap-5 p-6 text-center">
        {isLoading || !d ? (
          <>
            <Skeleton className="size-[160px] rounded-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : (
          <div className="animate-reveal flex flex-col items-center gap-5">
            <Ring value={d.compliance_pct} size={160} stroke={14} label="compliant" color={TONE_FILL[complianceTone(d.compliance_pct)]} />
            <p className="text-sm text-muted">
              {d.ok} of {d.total - d.exempt} required trainings are complete and in date, across {d.headcount} people.
            </p>
            <dl className="stagger grid w-full grid-cols-3 gap-3 border-t border-border pt-5">
              {(
                [
                  ['Overdue', d.overdue, 'text-danger'],
                  ['Expired', d.expired, 'text-danger'],
                  ['Exempt', d.exempt, 'text-muted'],
                ] as const
              ).map(([label, n, cls]) => (
                <div key={label} className="flex flex-col-reverse">
                  <dt className="text-[11px] text-muted">{label}</dt>
                  <dd className={cn('text-xl font-semibold tabular', n ? cls : '')}>
                    <CountUp value={n} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Compliance by requirement" description="Where each required course stands" action={<UnitSelect value={unitId} onChange={setUnitId} label="Show for location or team" />} className="flex-wrap" />
        <CardBody>
          <RequirementBars unitId={unitId} />
        </CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- tab: by unit
function UnitBar({ u, active, onPick }: { u: Dashboard['units'][number]; active: boolean; onPick: () => void }) {
  const tone = complianceTone(u.compliance_pct)
  return (
    <li>
      <button type="button" onClick={onPick} aria-pressed={active} className={cn('w-full rounded-md p-3 text-left transition-colors duration-150 hover:bg-surface-2', active && 'bg-primary-soft/60 ring-1 ring-primary/30')}>
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium">{u.name}</span>
          <CountUp value={u.compliance_pct} format={(n) => `${n.toFixed(0)}%`} className={cn('shrink-0 font-semibold tabular', TONE_TEXT[tone])} />
        </div>
        <Progress value={u.compliance_pct} tone={tone} className="h-2.5" label={`${u.name} compliance`} />
        <p className="mt-1.5 text-xs text-muted">
          {u.people_rows} required trainings · {u.overdue_or_expired ? `${u.overdue_or_expired} overdue or expired` : 'all in date'}
        </p>
      </button>
    </li>
  )
}

function ByUnit() {
  const { data: d, isLoading, error, refetch } = useDashboard()
  // null: nothing picked yet, so show the lowest-scoring location; '': the whole company
  const [picked, setPicked] = useState<string | null>(null)
  const units = useUnits()
  const selected = picked ?? d?.units[0]?.unit_id ?? ''
  const name = selected ? (units.data?.find((u) => u.id === selected)?.name ?? d?.units.find((u) => u.unit_id === selected)?.name) : 'Whole company'
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader title="Compliance by location" description="Lowest first. Select one to see its requirements." />
        <CardBody>
          {isLoading || !d ? (
            <div className="grid gap-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : d.units.length === 0 ? (
            <EmptyState icon={<Building2 />} title="No locations yet" body="Add locations and teams to compare them here." />
          ) : (
            <ul className="stagger grid gap-1">
              {d.units.map((u) => (
                <UnitBar key={u.unit_id} u={u} active={u.unit_id === selected} onPick={() => setPicked(u.unit_id)} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={name ? `${name}: by requirement` : 'By requirement'} description={selected ? 'Includes the teams inside it' : 'Everyone you manage'} action={<UnitSelect value={selected} onChange={setPicked} label="Location or team" />} className="flex-wrap" />
        <CardBody>{d || picked !== null ? <RequirementBars unitId={selected} /> : <Skeleton className="h-40" />}</CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- tab: audit
const ACTIONS: Record<string, string> = {
  'requirement.create': 'Created a requirement',
  'requirement.update': 'Changed a requirement',
  'requirement.archive': 'Archived a requirement',
  'compliance.extend': 'Extended a due date',
  'compliance.exempt': 'Granted an exemption',
  'compliance.exemption_revoke': 'Revoked an exemption',
  'compliance.record': 'Recorded a completion',
  'compliance.void': 'Voided a completion',
  'compliance.remind': 'Sent a reminder',
  'compliance.export': 'Exported the compliance report',
  'unit.create': 'Created a location or team',
  'unit.update': 'Changed a location or team',
  'unit.archive': 'Archived a location or team',
  'unit.managers': 'Changed managers',
  'member.update': 'Changed a person',
  'member.remove': 'Removed a person',
  'invite.create': 'Invited someone',
  'invite.revoke': 'Cancelled an invitation',
  'invite.accept': 'Accepted an invitation',
  'training.assign': 'Assigned training',
  'company.branding': 'Changed the branding',
  'job_role.create': 'Created a job role',
  'job_role.update': 'Changed a job role',
  'job_role.archive': 'Archived a job role',
}

const FILTERS = [
  ['', 'Everything'],
  ['requirement', 'Requirements'],
  ['compliance', 'Compliance actions'],
  ['unit', 'Locations and teams'],
  ['member', 'People'],
  ['invite', 'Invitations'],
  ['training', 'Assigned training'],
  ['job_role', 'Job roles'],
  ['company', 'Company settings'],
] as const

const humanise = (action: string) => ACTIONS[action] ?? action.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** A short readable summary of what the entry touched. */
function detail(e: AuditEntry) {
  const d = e.data ?? {}
  const pick = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : typeof d[k] === 'number' ? String(d[k]) : null)
  if (e.action === 'training.assign' && pick('people')) return `${pick('people')} people`
  return pick('name') ?? pick('email') ?? pick('reason') ?? pick('note') ?? e.target_type.replace(/_/g, ' ')
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function AuditTrail() {
  const [action, setAction] = useState('')
  const audit = useAudit(action)
  const items = audit.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader
        title="Audit trail"
        description="Every change and export in your company, newest first"
        className="flex-wrap"
        action={
          <NativeSelect aria-label="Show actions" value={action} onChange={(e) => setAction(e.target.value)} className="w-full sm:w-56">
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <div className="mt-4">
        {audit.error ? (
          <ErrorState message={(audit.error as Error).message} onRetry={() => void audit.refetch()} />
        ) : audit.isLoading || !audit.data ? (
          <div className="grid gap-3 px-5 pb-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Nothing recorded yet" body={action ? 'No actions of this kind so far.' : 'Changes and exports show up here as they happen.'} />
        ) : (
          <div className={cn('animate-reveal transition-opacity duration-200', audit.isPlaceholderData && audit.isFetching && 'opacity-60')}>
            <ol className="stagger divide-y divide-border border-t border-border">
              {items.map((e) => (
                <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={e.actor_name || 'System'} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{humanise(e.action)}</p>
                      <p className="truncate text-xs text-muted">{e.actor_name || 'System'}</p>
                    </div>
                  </div>
                  <p className="min-w-0 truncate pl-10 text-[13px] text-muted sm:pl-0" title={detail(e)}>
                    {detail(e)}
                  </p>
                  <time dateTime={e.created_at} className="pl-10 text-xs whitespace-nowrap text-muted tabular sm:pl-0 sm:text-right">
                    {when(e.created_at)}
                  </time>
                </li>
              ))}
            </ol>
            {audit.hasNextPage ? (
              <div className="flex justify-center border-t border-border p-4">
                <Button variant="secondary" size="sm" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- page
export function ReportsPage() {
  const admin = useIsOrgAdmin()
  const [params, setParams] = useSearchParams()
  const [unitId, setUnitId] = useState('')
  const [exporting, setExporting] = useState(false)
  const raw = params.get('tab') ?? 'requirements'
  const tab = raw === 'units' || (raw === 'audit' && admin) ? raw : 'requirements'

  const exportCsv = () => {
    setExporting(true)
    downloadExport(unitId || undefined)
      .then(() => toast.success('Your CSV is downloading'))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setExporting(false))
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Compliance across your company, by requirement and by location, plus a record of every change."
        actions={
          <>
            <UnitSelect value={unitId} onChange={setUnitId} label="Export for" allLabel="Export: whole company" />
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <Download /> Export CSV
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'requirements' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="requirements">
            <BarChart3 /> Compliance
          </TabsTrigger>
          <TabsTrigger value="units">
            <Building2 /> By location
          </TabsTrigger>
          {admin ? (
            <TabsTrigger value="audit">
              <History /> Audit trail
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="requirements">
          <ByRequirement unitId={unitId} setUnitId={setUnitId} />
        </TabsContent>
        <TabsContent value="units">
          <ByUnit />
        </TabsContent>
        {admin ? (
          <TabsContent value="audit">
            <AuditTrail />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  )
}
