import { AlertOctagon, ChevronRight, History, MailPlus, Search, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDashboard } from '@/features/compliance/api'
import { type Person, ROLE_LABEL, unitLabel, useInvites, useIsOrgAdmin, useJobRoles, usePeople, useUnits } from '@/features/org/api'
import { BulkBar, type Picked } from '@/features/org/bulk'
import { InviteForm, InviteList } from '@/features/org/invites'
import { ComplianceMiniBar, RoleBadge, useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { Link, useNavigate } from '@/lib/router'

function Kpis() {
  const admin = useIsOrgAdmin()
  const { data: d, isLoading } = useDashboard()
  const { data: units } = useUnits()
  const { data: invites } = useInvites(admin)
  // people who manage at least one unit (the unit list names them)
  const managers = useMemo(() => (units ? new Set(units.flatMap((u) => u.manager_ids)).size : null), [units])
  if (isLoading || !d || managers === null) {
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: admin ? 4 : 3 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-lg" />
        ))}
      </div>
    )
  }
  return (
    <div className={cn('stagger grid grid-cols-2 gap-4', admin ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
      <StatCard label="People" value={d.headcount} icon={<Users />} hint={admin ? 'in the company' : 'in your units'} />
      <StatCard label="Unit managers" value={managers} icon={<UserCog />} tone="info" hint="look after a location or team" />
      <StatCard label="People overdue" value={d.people_overdue} icon={<AlertOctagon />} tone="danger" hint="with overdue or expired training" />
      {admin ? <StatCard label="Pending invites" value={invites?.length ?? 0} icon={<MailPlus />} tone="warning" hint="waiting to join" /> : null}
    </div>
  )
}

function Check({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      className="size-4 shrink-0 cursor-pointer accent-[var(--color-primary)]"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
    />
  )
}

const pick = (p: Person): Picked => ({ member_id: p.member_id, name: p.name, email: p.email, units: p.units })

function PersonCard({ p }: { p: Person }) {
  return (
    <Link to={`/business/people/${p.member_id}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-sm transition-colors hover:border-border-strong">
      <Avatar name={p.name || p.email} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{p.name || p.email}</p>
          <RoleBadge role={p.role} />
        </div>
        <p className="truncate text-xs text-muted">{[p.job_title, p.units[0]].filter(Boolean).join(' · ') || p.email}</p>
        <div className="mt-2">
          <ComplianceMiniBar compliant={p.compliant} total={p.total} overdue={p.overdue} />
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-subtle" />
    </Link>
  )
}

export function PeoplePage() {
  const admin = useIsOrgAdmin()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'invites' && admin ? 'invites' : 'people'
  const filters = { q: params.get('q') ?? '', unit_id: params.get('unit') ?? '', job_role_id: params.get('job_role') ?? '', role: params.get('role') ?? '', direct: params.get('direct') === '1' }
  const [inviting, setInviting] = useState(false)
  const [history, setHistory] = useState(false)
  const { data: pendingInvites } = useInvites(admin)
  // the selection survives filtering and paging; it is only cleared on purpose
  const [selected, setSelected] = useState<Map<string, Picked>>(() => new Map())
  const toggle = (p: Person, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (on) next.set(p.member_id, pick(p))
      else next.delete(p.member_id)
      return next
    })
  const [q, setQ] = useState(filters.q)
  const debounced = useDebounced(q)
  const { data: units } = useUnits()
  const { data: roles } = useJobRoles()
  const people = usePeople(filters)
  const rows = people.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = !!(filters.q || filters.unit_id || filters.job_role_id || filters.role)
  const shownSelected = rows.filter((p) => selected.has(p.member_id)).length
  const allShown = rows.length > 0 && shownSelected === rows.length
  const selectShown = (on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev)
      for (const p of rows) {
        if (on) next.set(p.member_id, pick(p))
        else next.delete(p.member_id)
      }
      return next
    })
  const hidden = selected.size - shownSelected
  const scopeNote = hidden
    ? `${hidden} of them ${hidden === 1 ? 'is' : 'are'} hidden by the current filters`
    : `"Select all" picks the ${rows.length} people loaded${people.hasNextPage ? '. Load more to include the rest' : ''}`
  const setTab = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === 'invites') next.set('tab', 'invites')
        else next.delete('tab')
        return next
      },
      { replace: true },
    )

  // typing updates ?q= after a pause; the header search can also change ?q= while this
  // page is open, which then replaces what is in the box
  const urlQ = filters.q
  const pushed = useRef(urlQ)
  useEffect(() => {
    if (urlQ !== pushed.current) {
      pushed.current = urlQ
      setQ(urlQ)
    }
  }, [urlQ])
  useEffect(() => {
    if (debounced === pushed.current) return
    pushed.current = debounced
    set('q', debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  function set(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  return (
    <>
      <PageHeader
        title="People"
        description={admin ? 'Everyone in your company, their roles and how their training stands.' : 'The people in the units you manage.'}
        actions={
          admin ? (
            <Button onClick={() => setInviting(true)}>
              <MailPlus /> Invite people
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6">
        <Kpis />
        <Tabs value={tab} onValueChange={setTab}>
          {admin ? (
            <TabsList>
              <TabsTrigger value="people">
                <Users /> Employees
              </TabsTrigger>
              <TabsTrigger value="invites">
                <MailPlus /> Pending invitations
                {pendingInvites?.length ? <span className="ml-1 rounded-full bg-warning-soft px-1.5 text-xs text-warning tabular">{pendingInvites.length}</span> : null}
              </TabsTrigger>
            </TabsList>
          ) : null}
          <TabsContent value="people">
        <Card>
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
            <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search people" type="search" />
            <NativeSelect value={filters.unit_id} onChange={(e) => set('unit', e.target.value)} aria-label="Filter by unit">
              <option value="">All units</option>
              {units?.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u, units)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={filters.job_role_id} onChange={(e) => set('job_role', e.target.value)} aria-label="Filter by job role">
              <option value="">All job roles</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={filters.role} onChange={(e) => set('role', e.target.value)} aria-label="Filter by role">
              <option value="">All roles</option>
              {['learner', 'manager', 'admin', 'owner'].map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
            {filters.unit_id ? (
              <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2 lg:col-span-4">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={filters.direct} onChange={(e) => set('direct', e.target.checked ? '1' : '')} />
                Only people placed directly in this unit, not in the teams inside it
              </label>
            ) : null}
          </div>
          {selected.size ? <BulkBar selected={[...selected.values()]} admin={admin} scopeNote={scopeNote} onClear={() => setSelected(new Map())} /> : null}

          {people.error ? (
            <ErrorState message={(people.error as Error).message} onRetry={() => void people.refetch()} />
          ) : people.isLoading ? (
            <div className="grid gap-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={filtered ? <Search /> : <Users />}
              title={filtered ? 'Nobody matches' : 'No people yet'}
              body={filtered ? 'Try another name or clear the filters.' : admin ? 'Invite your first people and they will appear here.' : 'Nobody is in your units yet.'}
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => (setQ(''), setParams({}, { replace: true }))}>
                    Clear filters
                  </Button>
                ) : admin ? (
                  <Button onClick={() => setInviting(true)}>Invite people</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="animate-reveal">
              {/* phone: cards */}
              <ul className="stagger grid gap-3 p-3 md:hidden">
                {rows.map((p) => (
                  <li key={p.member_id} className="flex items-center gap-2">
                    <Check checked={selected.has(p.member_id)} onChange={(on) => toggle(p, on)} label={`Select ${p.name || p.email}`} />
                    <div className="min-w-0 flex-1">
                      <PersonCard p={p} />
                    </div>
                  </li>
                ))}
              </ul>
              {/* tablet and up: table */}
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-10">
                        <Check checked={allShown} indeterminate={!allShown && shownSelected > 0} onChange={selectShown} label={`Select all ${rows.length} people shown`} />
                      </Th>
                      <Th>Person</Th>
                      <Th>Units</Th>
                      <Th className="hidden xl:table-cell">Job roles</Th>
                      <Th>Role</Th>
                      <Th>Training</Th>
                      <Th className="text-right">
                        <span className="sr-only">Open</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((p) => (
                      <Tr key={p.member_id} className="cursor-pointer" onClick={() => navigate(`/business/people/${p.member_id}`)}>
                        <Td className="w-10">
                          <Check checked={selected.has(p.member_id)} onChange={(on) => toggle(p, on)} label={`Select ${p.name || p.email}`} />
                        </Td>
                        <Td>
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={p.name || p.email} size="sm" />
                            <div className="min-w-0">
                              <Link to={`/business/people/${p.member_id}`} className="block truncate font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                                {p.name || p.email}
                              </Link>
                              <p className="max-w-[16rem] truncate text-xs text-muted">{p.email}</p>
                            </div>
                          </div>
                        </Td>
                        <Td className="max-w-[14rem] truncate text-muted">{p.units.join(', ') || '–'}</Td>
                        <Td className="hidden max-w-[12rem] truncate text-muted xl:table-cell">{p.job_roles.join(', ') || '–'}</Td>
                        <Td>
                          <RoleBadge role={p.role} />
                        </Td>
                        <Td>
                          <ComplianceMiniBar compliant={p.compliant} total={p.total} overdue={p.overdue} />
                        </Td>
                        <Td className="text-right">
                          <ChevronRight className="ml-auto size-4 text-subtle" aria-hidden />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
                <span>
                  Showing {rows.length} {rows.length === 1 ? 'person' : 'people'}
                </span>
                {people.hasNextPage ? (
                  <Button variant="secondary" size="sm" loading={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
                    Load more
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="size-3.5" /> That's everyone
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>
          </TabsContent>
          {admin ? (
            <TabsContent value="invites">
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                  <div>
                    <h2 className="font-semibold">{history ? 'Past invitations' : 'Waiting to join'}</h2>
                    <p className="text-sm text-muted">{history ? 'Expired, accepted and revoked invitations.' : 'Resend a link, or revoke one you no longer need.'}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setHistory((h) => !h)} aria-pressed={history}>
                    {history ? <MailPlus /> : <History />} {history ? 'Show pending' : 'Show history'}
                  </Button>
                </div>
                <InviteList key={history ? 'history' : 'pending'} status={history ? 'history' : 'pending'} />
              </Card>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
      {admin ? (
        <Dialog open={inviting} onOpenChange={setInviting}>
          <DialogContent side="right" title="Invite people" description="Bring people into your company workspace." className="w-[min(480px,100vw)]">
            <div className="p-4">
              <InviteForm />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
