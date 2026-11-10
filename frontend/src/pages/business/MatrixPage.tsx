import { AlertOctagon, CalendarClock, ChevronRight, Download, Gauge, Grid3x3, Search, SearchX, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { complianceTone, downloadExport, type MatrixFilters, type MatrixRow, STATUS, STATUS_ORDER, statusOf, useDashboard, useMatrix, worstStatus } from '@/features/compliance/api'
import { PersonRequirements } from '@/features/compliance/PersonRequirements'
import { unitLabel, useJobRoles, useUnits } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const KEYS = ['unit', 'role', 'status', 'req', 'q'] as const

function Kpis() {
  const { data: d, isLoading } = useDashboard()
  if (isLoading || !d)
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-lg" />
        ))}
      </div>
    )
  return (
    <div className="stagger grid gap-4 sm:grid-cols-3">
      <StatCard label="Compliance" value={<CountUp value={d.compliance_pct} format={(n) => `${n.toFixed(0)}%`} />} icon={<Gauge />} tone={complianceTone(d.compliance_pct)} hint={`${d.headcount} people`} />
      <StatCard label="Overdue" value={d.overdue} icon={<AlertOctagon />} tone="danger" hint={d.expired ? `plus ${d.expired} expired` : 'past their due date'} />
      <StatCard label="Expiring in 30 days" value={d.expiring_30} icon={<CalendarClock />} tone="warning" hint="renewals coming up" />
    </div>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border px-5 py-4 text-xs text-muted" aria-label="Status colours">
      {STATUS_ORDER.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: STATUS[k].color }} aria-hidden /> {STATUS[k].label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden>–</span> Does not apply
      </li>
    </ul>
  )
}

type Selection = { row: MatrixRow; requirementId?: string; requirementName?: string }

export function MatrixPage() {
  const [params, setParams] = useSearchParams()
  const filters: MatrixFilters = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]))
  const matrix = useMatrix(filters)
  const units = useUnits()
  const roles = useJobRoles()

  const set = (key: (typeof KEYS)[number], value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  // search: typed into local state, written to the URL after a short pause
  const urlQ = params.get('q') ?? ''
  const [text, setText] = useState(urlQ)
  useEffect(() => setText(urlQ), [urlQ])
  useEffect(() => {
    if (text.trim() === urlQ) return
    const t = window.setTimeout(() => set('q', text.trim()), 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const [sel, setSel] = useState<Selection | null>(null)
  const [open, setOpen] = useState(false)
  const pick = (s: Selection) => (setSel(s), setOpen(true))

  const pages = matrix.data?.pages ?? []
  const requirements = pages[0]?.requirements ?? []
  const rows = pages.flatMap((p) => p.rows)
  const active = KEYS.some((k) => params.get(k))
  const stale = matrix.isPlaceholderData && matrix.isFetching

  return (
    <>
      <PageHeader
        title="Training matrix"
        description="Everyone you manage against every requirement. Select a cell to see the details and act."
        actions={
          <Button variant="secondary" onClick={() => downloadExport(filters.unit).catch((e: Error) => toast.error(e.message))}>
            <Download /> Export CSV
          </Button>
        }
      />
      <div className="grid gap-6">
        <Kpis />

        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
            <Input type="search" icon={<Search />} placeholder="Search people" aria-label="Search people" value={text} onChange={(e) => setText(e.target.value)} />
            <NativeSelect aria-label="Location or team" value={filters.unit ?? ''} onChange={(e) => set('unit', e.target.value)}>
              <option value="">All locations</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u, units.data!)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Job role" value={filters.role ?? ''} onChange={(e) => set('role', e.target.value)}>
              <option value="">All job roles</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any status</option>
              {STATUS_ORDER.map((k) => (
                <option key={k} value={k}>
                  {STATUS[k].label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Requirement" value={filters.req ?? ''} onChange={(e) => set('req', e.target.value)}>
              <option value="">All requirements</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {active ? (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => (setText(''), setParams({}, { replace: true }))}>
                <X /> Clear filters
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          {matrix.error ? (
            <ErrorState message={(matrix.error as Error).message} onRetry={() => void matrix.refetch()} />
          ) : matrix.isLoading || !matrix.data ? (
            <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading the matrix">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : requirements.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck />}
              title="No requirements yet"
              body="Add the training your people must complete, and the matrix fills in."
              action={
                <Button asChild>
                  <Link to="/business/requirements">Set up requirements</Link>
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={active ? <SearchX /> : <Grid3x3 />}
              title={active ? 'Nobody matches these filters' : 'No people yet'}
              body={active ? 'Try another location, status or search.' : 'Invite people to the company and their training shows up here.'}
              action={
                active ? (
                  <Button variant="secondary" onClick={() => (setText(''), setParams({}, { replace: true }))}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={cn('animate-reveal transition-opacity duration-200', stale && 'opacity-60')} aria-busy={stale || undefined}>
              {/* wide screens: the grid itself; it scrolls inside this box, never the page */}
              <div className="relative hidden max-h-[min(70vh,760px)] overflow-auto overscroll-x-contain md:block">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <caption className="sr-only">Training status by person and requirement</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="sticky top-0 left-0 z-30 min-w-[220px] border-r border-b border-border bg-surface px-5 py-3 text-left text-xs font-medium text-muted">
                        Person
                      </th>
                      {requirements.map((r) => (
                        <th key={r.id} scope="col" className="sticky top-0 z-20 border-b border-border bg-surface px-3 py-3 text-left align-bottom text-xs font-medium text-muted">
                          <span className="line-clamp-2 block max-w-[140px] min-w-[104px]" title={r.name}>
                            {r.name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((row) => (
                      <tr key={row.member_id} className="group">
                        <th scope="row" className="sticky left-0 z-10 border-r border-b border-border bg-surface px-5 py-2.5 text-left font-normal transition-colors group-hover:bg-surface-2">
                          <button type="button" onClick={() => pick({ row })} className="flex max-w-[260px] items-center gap-3 rounded-md text-left" aria-label={`${row.name}: all requirements`}>
                            <Avatar name={row.name} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{row.name}</span>
                              <span className="block truncate text-xs text-muted">{row.job_title || row.email}</span>
                            </span>
                          </button>
                        </th>
                        {requirements.map((r) => {
                          const c = row.cells[r.id]
                          if (!c)
                            return (
                              <td key={r.id} className="border-b border-border px-3 py-2.5 text-subtle transition-colors group-hover:bg-surface-2/60">
                                <span aria-hidden>–</span>
                                <span className="sr-only">Does not apply</span>
                              </td>
                            )
                          const s = statusOf(c.status)
                          const when = c.status === 'compliant' || c.status === 'expiring_soon' ? (c.expires_at ? `expires ${shortDate(c.expires_at)}` : null) : c.due_at ? `due ${shortDate(c.due_at)}` : null
                          return (
                            <td key={r.id} className="border-b border-border px-3 py-2.5 transition-colors group-hover:bg-surface-2/60">
                              <button
                                type="button"
                                onClick={() => pick({ row, requirementId: r.id, requirementName: r.name })}
                                className="rounded-full transition-transform duration-150 hover:scale-[1.04] active:scale-[0.97]"
                                aria-label={`${row.name} – ${r.name}: ${s.label}${when ? `, ${when}` : ''}`}
                                title={when ?? undefined}
                              >
                                <Badge tone={s.tone} dot>
                                  {s.label}
                                </Badge>
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* phones: one line per person with their most urgent status */}
              <ul className="stagger divide-y divide-border md:hidden">
                {rows.map((row) => {
                  const cells = Object.values(row.cells)
                  const worst = worstStatus(cells.map((c) => c.status))
                  const s = worst ? STATUS[worst] : null
                  const late = cells.filter((c) => c.status === 'overdue' || c.status === 'expired').length
                  return (
                    <li key={row.member_id}>
                      <button type="button" onClick={() => pick({ row })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60" aria-label={`${row.name}: ${s ? s.label : 'nothing required'}`}>
                        <Avatar name={row.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{row.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {late ? `${late} overdue or expired · ` : ''}
                            {cells.length} required
                          </span>
                        </span>
                        {s ? (
                          <Badge tone={s.tone} dot>
                            {s.label}
                          </Badge>
                        ) : null}
                        <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
                <p className="text-xs text-muted" aria-live="polite">
                  Showing {rows.length} {rows.length === 1 ? 'person' : 'people'}
                </p>
                {matrix.hasNextPage ? (
                  <Button variant="secondary" size="sm" loading={matrix.isFetchingNextPage} onClick={() => void matrix.fetchNextPage()}>
                    Load more
                  </Button>
                ) : null}
              </div>
              <Legend />
            </div>
          )}
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {sel ? (
          <DialogContent side="right" title={sel.row.name} description={sel.requirementName ?? (sel.row.job_title || sel.row.email)} className="w-[min(640px,100vw)]">
            <div className="grid gap-5 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={sel.row.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{sel.row.job_title || 'No job title'}</p>
                  <p className="truncate text-xs text-muted">
                    {sel.row.email}
                    {sel.row.employee_ref ? ` · ${sel.row.employee_ref}` : ''}
                  </p>
                </div>
                <Button variant="link" size="sm" asChild>
                  <Link to={`/business/people/${sel.row.member_id}`}>Open profile</Link>
                </Button>
              </div>
              <PersonRequirements key={`${sel.row.member_id}:${sel.requirementId ?? ''}`} memberId={sel.row.member_id} focusRequirementId={sel.requirementId} />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
