import { AlertOctagon, ChevronRight, MailPlus, Search, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useDashboard } from '@/features/compliance/api'
import { type Person, ROLE_LABEL, unitLabel, useInvites, useIsOrgAdmin, useJobRoles, usePeople, useUnits } from '@/features/org/api'
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
  const filters = { q: params.get('q') ?? '', unit_id: params.get('unit') ?? '', job_role_id: params.get('job_role') ?? '', role: params.get('role') ?? '' }
  const [q, setQ] = useState(filters.q)
  const debounced = useDebounced(q)
  const { data: units } = useUnits()
  const { data: roles } = useJobRoles()
  const people = usePeople(filters)
  const rows = people.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = !!(filters.q || filters.unit_id || filters.job_role_id || filters.role)

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
            <Button asChild>
              <Link to="/business/invites">
                <MailPlus /> Invite people
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6">
        <Kpis />
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
          </div>

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
                  <Button asChild>
                    <Link to="/business/invites">Invite people</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="animate-reveal">
              {/* phone: cards */}
              <ul className="stagger grid gap-3 p-3 md:hidden">
                {rows.map((p) => (
                  <li key={p.member_id}>
                    <PersonCard p={p} />
                  </li>
                ))}
              </ul>
              {/* tablet and up: table */}
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
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
      </div>
    </>
  )
}
