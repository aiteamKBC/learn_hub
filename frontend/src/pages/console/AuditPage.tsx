import { ChevronDown, ScrollText, Search, X } from 'lucide-react'
import { Fragment, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type AuditFilters, type AuditRow, auditCsvPath, useAudit, useAuditActions } from '@/features/console/audit'
import { useBroadcastCompanies } from '@/features/console/comms'
import { ExportButton, LoadMore, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** "company.addon_on" → "Company · addon on" */
const actionLabel = (a: string) => {
  const [area, ...rest] = a.split('.')
  return `${area.charAt(0).toUpperCase()}${area.slice(1).replace(/_/g, ' ')}${rest.length ? ` · ${rest.join(' ').replace(/_/g, ' ')}` : ''}`
}

function Detail({ r }: { r: AuditRow }) {
  return (
    <div className="grid animate-reveal gap-3 text-xs sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dl className="grid content-start gap-1.5">
        <div><dt className="text-muted">Target</dt><dd className="font-mono break-all">{r.target_type} {r.target_id}</dd></div>
        {r.actor_email ? <div><dt className="text-muted">Email</dt><dd className="break-all">{r.actor_email}</dd></div> : null}
        {r.ip ? <div><dt className="text-muted">IP address</dt><dd className="font-mono">{r.ip}</dd></div> : null}
        {r.request_id ? <div><dt className="text-muted">Request</dt><dd className="font-mono break-all">{r.request_id}</dd></div> : null}
      </dl>
      <pre className="max-h-72 min-w-0 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono whitespace-pre-wrap break-all">{JSON.stringify(r.data, null, 2)}</pre>
    </div>
  )
}

function RowCard({ r, open, onToggle }: { r: AuditRow; open: boolean; onToggle: () => void }) {
  return (
    <li className="rounded-lg border border-border bg-surface shadow-sm">
      <button type="button" className="grid w-full gap-1 p-3 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="min-w-0 flex-1 truncate">{actionLabel(r.action)}</span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
        </span>
        <span className="text-xs text-muted">
          {r.actor_name ?? 'System'}{r.company ? ` · ${r.company}` : ''} · {when(r.created_at)}
        </span>
      </button>
      {open ? <div className="border-t border-border p-3"><Detail r={r} /></div> : null}
    </li>
  )
}

/** Console > Audit log: who did what and when, with filters, the full detail of each
 * entry and a CSV export of the same view. */
export function ConsoleAuditPage() {
  const [actor, setActor] = useParam('actor')
  const [org, setOrg] = useParam('company')
  const [action, setAction] = useParam('action')
  const [start, setStart] = useParam('start')
  const [end, setEnd] = useParam('end')
  const [q, setQ] = useState('')
  const [actorText, setActorText] = useState(actor)
  const debouncedQ = useDebounced(q)
  const debouncedActor = useDebounced(actorText)
  const filters: AuditFilters = { actor: debouncedActor || actor, org_id: org, action, start, end, q: debouncedQ }
  const list = useAudit(filters)
  const actions = useAuditActions()
  const companies = useBroadcastCompanies(true)
  const [open, setOpen] = useState<number | null>(null)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = Object.values(filters).some((v) => v && String(v).trim())
  const clear = () => (setActor(''), setActorText(''), setOrg(''), setAction(''), setStart(''), setEnd(''), setQ(''))
  return (
    <>
      <PageHeader title="Audit log" description="Every change made by staff and company admins: who, what, when and from where." actions={<ExportButton path={auditCsvPath(filters)} filename="audit-log.csv" label="Export CSV" />} />
      <Card className="min-w-0">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Search">{(f) => <Input {...f} icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Target, reason or any detail" />}</Field>
          <Field label="Who">{(f) => <Input {...f} value={actorText} onChange={(e) => (setActorText(e.target.value), setActor(''))} placeholder="Name or email" />}</Field>
          <Field label="Action">
            {(f) => (
              <NativeSelect {...f} value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">All actions</option>
                {(actions.data ?? []).map((a) => (
                  <option key={a.action} value={a.action}>
                    {actionLabel(a.action)} ({a.count})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Company">
            {(f) => (
              <NativeSelect {...f} value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">All companies and the platform</option>
                {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="From">{(f) => <Input {...f} type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        {filtered ? (
          <div className="flex justify-end border-b border-border px-4 py-2">
            <Button variant="ghost" size="sm" onClick={clear}>
              <X /> Clear filters
            </Button>
          </div>
        ) : null}
        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="grid gap-3 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !rows.length ? (
          <EmptyState icon={<ScrollText />} title={filtered ? 'Nothing matches' : 'No entries yet'} body={filtered ? 'Try other filters or a wider date range.' : 'Changes made in the console and company workspaces appear here.'} />
        ) : (
          <div className="animate-reveal">
            <ul className="stagger grid gap-2.5 p-3 md:hidden">
              {rows.map((r) => <RowCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
            </ul>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>Action</Th>
                    <Th className="hidden lg:table-cell">Company</Th>
                    <Th className="hidden xl:table-cell">Target</Th>
                    <Th><span className="sr-only">Detail</span></Th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {rows.map((r) => (
                    <Fragment key={r.id}>
                      <Tr className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        <Td className="text-xs whitespace-nowrap text-muted tabular">{when(r.created_at)}</Td>
                        <Td className="max-w-[12rem] truncate">{r.actor_name ?? <span className="text-muted">System</span>}</Td>
                        <Td className="font-medium">{actionLabel(r.action)}</Td>
                        <Td className="hidden max-w-[12rem] truncate lg:table-cell">{r.company ?? <span className="text-muted">Platform</span>}</Td>
                        <Td className="hidden max-w-[14rem] truncate font-mono text-xs text-muted xl:table-cell">{r.target_type}</Td>
                        <Td className="text-right">
                          <button type="button" className="rounded p-1 text-muted hover:text-text" aria-expanded={open === r.id} aria-label="Show detail" onClick={(e) => (e.stopPropagation(), setOpen(open === r.id ? null : r.id))}>
                            <ChevronDown className={cn('size-4 transition-transform duration-200', open === r.id && 'rotate-180')} />
                          </button>
                        </Td>
                      </Tr>
                      {open === r.id ? (
                        <tr>
                          <td colSpan={6} className="border-b border-border bg-surface-2/40 px-5 py-4">
                            <Detail r={r} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </div>
            <LoadMore shown={rows.length} noun="entries" hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </div>
        )}
      </Card>
    </>
  )
}
