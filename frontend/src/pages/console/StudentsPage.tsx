import { Activity, Award, BookOpen, CalendarDays, Download, MoreHorizontal, Pause, Pencil, Play, Search, Trash2, TrendingUp, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { day, SearchBox, Toolbar } from '@/features/console/money-ui'
import {
  fetchStudentsExport,
  type StudentDetail,
  type StudentFilters,
  type StudentRow,
  saveCsv,
  useDeleteAccount,
  useEditAccount,
  useReactivateAccount,
  useStudent,
  useStudentKpis,
  useStudents,
  useSuspendAccount,
} from '@/features/console/people'
import { PeopleSwitch, PersonCell, ProgressCell, personStatus } from '@/features/console/people-ui'
import { ConfirmDialog, DetailSheet, InfoRow, KpiCard, LoadMore, StatusPill, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { Link } from '@/lib/router'

// ---------------------------------------------------------------- account actions (shared by the row menu and the panel)
type Pending = { kind: 'suspend' | 'reactivate' | 'delete' | 'edit'; id: string; name: string; email: string } | null

function AccountDialogs({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const suspend = useSuspendAccount()
  const reactivate = useReactivateAccount()
  const del = useDeleteAccount()
  const fail = (e: Error) => toast.error(e.message)
  return (
    <>
      <ConfirmDialog
        open={pending?.kind === 'suspend'}
        onOpenChange={(o) => !o && onClose()}
        title={`Suspend ${pending?.name || 'this account'}?`}
        body="They are signed out everywhere and can't sign in until you reactivate the account. Their courses, orders and certificates stay. They are told by email."
        confirmLabel="Suspend account"
        reason="required"
        loading={suspend.isPending}
        onConfirm={(reason) => suspend.mutate({ id: pending!.id, reason }, { onSuccess: () => (toast.success('Account suspended'), onClose()), onError: fail })}
      />
      <ConfirmDialog
        open={pending?.kind === 'reactivate'}
        onOpenChange={(o) => !o && onClose()}
        title={`Reactivate ${pending?.name || 'this account'}?`}
        body="They can sign in again straight away."
        confirmLabel="Reactivate"
        tone="primary"
        loading={reactivate.isPending}
        onConfirm={() => reactivate.mutate(pending!.id, { onSuccess: () => (toast.success('Account reactivated'), onClose()), onError: fail })}
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && onClose()}
        title="Delete this account?"
        body={
          <>
            <strong className="text-danger">This can't be undone.</strong> Their name and email are removed for good and they can never sign in again. Learning, purchase and compliance records stay as anonymous history; issued certificates keep the printed name.
          </>
        }
        confirmLabel="Delete account"
        phrase="DELETE"
        loading={del.isPending}
        onConfirm={() => del.mutate(pending!.id, { onSuccess: () => (toast.success('Account deleted'), onClose()), onError: fail })}
      />
      <EditAccountDialog pending={pending?.kind === 'edit' ? pending : null} onClose={onClose} />
    </>
  )
}

function EditAccountDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const edit = useEditAccount()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [key, setKey] = useState('')
  if (pending && key !== pending.id) {
    setKey(pending.id)
    setName(pending.name)
    setEmail(pending.email)
  }
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && (onClose(), setKey(''))}>
      <DialogContent title="Edit account" description="A new email is used to sign in from now on.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            edit.mutate(
              { id: pending!.id, full_name: name.trim(), email: email.trim() },
              { onSuccess: () => (toast.success('Account saved'), onClose(), setKey('')), onError: (err) => toast.error((err as Error).message) },
            )
          }}
        >
          <Field label="Full name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="off" />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoComplete="off" />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={edit.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- KPIs
function Kpis() {
  const q = useStudentKpis()
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  return (
    <section aria-label="Student figures" className={d ? 'stagger grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 xl:grid-cols-4'}>
      {!d ? (
        Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
      ) : (
        <>
          <StatCard label="Total students" value={d.total} icon={<Users />} hint="accounts, not counting staff" />
          <StatCard label="Active students" value={d.active} icon={<BookOpen />} tone="success" hint="can sign in" />
          <StatCard label="Suspended" value={d.suspended} icon={<Pause />} tone="danger" hint="can't sign in" />
          <KpiCard label="New (last 30 days)" kpi={d.new_30d} icon={<UserPlus />} tone="info" />
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- detail panel
function StudentPanel({ id, onAction }: { id: string; onAction: (p: Pending) => void }) {
  const q = useStudent(id)
  const s = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!s) return <Skeleton className="h-72" />
  const p = { id: s.id, name: s.name, email: s.email }
  return (
    <div className="animate-reveal grid gap-5">
      <div className="flex items-center gap-3">
        <PersonCell name={s.name} email={s.email} />
        <span className="ml-auto">
          <StatusPill status={s.status} label={personStatus(s.status)} />
        </span>
      </div>
      <Tabs defaultValue="overview">
        <TabsList aria-label="Student details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="enrolments">Enrolments</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <InfoRow label="Joined on">{day(s.joined)}</InfoRow>
          <InfoRow label="Last signed in">{s.last_login ? day(s.last_login) : 'Never'}</InfoRow>
          <InfoRow label="Total enrolments">{s.enrolments}</InfoRow>
          <InfoRow label="Completed">{s.completed}</InfoRow>
          <InfoRow label="Average progress">{s.avg_progress}%</InfoRow>
          <InfoRow label="Certificates earned">{s.certificates}</InfoRow>
          <InfoRow label="Orders">
            {s.orders ? (
              <Link to={`/console/sales?tab=orders&user=${s.id}`} className="text-primary hover:underline">
                {s.orders} · view orders
              </Link>
            ) : (
              0
            )}
          </InfoRow>
          {s.companies.length ? <InfoRow label="Companies">{s.companies.join(', ')}</InfoRow> : null}
          {s.is_instructor ? (
            <InfoRow label="Also teaches">
              <Link to={`/console/instructors?user=${s.id}`} className="text-primary hover:underline">
                Open instructor profile
              </Link>
            </InfoRow>
          ) : null}
        </TabsContent>
        <TabsContent value="enrolments">
          <EnrolmentList s={s} />
        </TabsContent>
        <TabsContent value="progress">
          {s.enrolment_list.length === 0 ? (
            <EmptyState icon={<TrendingUp />} title="Nothing to show yet" body="Progress appears once they enrol in a course." className="py-6" />
          ) : (
            <ul className="stagger grid gap-4">
              {s.enrolment_list.map((e) => (
                <li key={e.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{e.course}</span>
                    <span className="text-xs text-muted tabular">{Math.round(e.progress_pct)}%</span>
                  </div>
                  <Progress value={e.progress_pct} tone={e.status === 'completed' ? 'success' : 'primary'} label={`${e.course}: ${Math.round(e.progress_pct)}%`} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="activity">
          {s.activity.length === 0 ? (
            <EmptyState icon={<Activity />} title="No activity yet" className="py-6" />
          ) : (
            <ol className="stagger grid gap-3">
              {s.activity.map((a, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    {a.url ? (
                      <Link to={a.url} className="font-medium hover:text-primary">
                        {a.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{a.title}</p>
                    )}
                    <p className="text-xs text-muted">{day(a.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
      {s.status !== 'deleted' && !s.is_staff ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" onClick={() => onAction({ kind: 'edit', ...p })}>
            <Pencil /> Edit account
          </Button>
          {s.status === 'active' ? (
            <Button variant="secondary" size="sm" onClick={() => onAction({ kind: 'suspend', ...p })}>
              <Pause /> Suspend
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onAction({ kind: 'reactivate', ...p })}>
              <Play /> Reactivate
            </Button>
          )}
          <Button variant="danger" size="sm" disabled={!s.can_delete} title={s.can_delete ? undefined : 'Demo and staff accounts cannot be deleted'} onClick={() => onAction({ kind: 'delete', ...p })}>
            <Trash2 /> Delete
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function EnrolmentList({ s }: { s: StudentDetail }) {
  if (s.enrolment_list.length === 0) return <EmptyState icon={<BookOpen />} title="No enrolments yet" className="py-6" />
  return (
    <ul className="stagger grid gap-2">
      {s.enrolment_list.map((e) => (
        <li key={e.id} className="rounded-lg border border-border p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <Link to={`/console/courses?course=${e.course_id}`} className="min-w-0 truncate font-medium hover:text-primary">
              {e.course}
            </Link>
            <StatusPill status={e.status} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {e.source}
            {e.company ? ` · ${e.company}` : ''} · enrolled {day(e.enrolled_at)}
            {e.certificate_code ? (
              <>
                {' · '}
                <Award className="inline size-3.5" aria-hidden /> certificate
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- page
function RowMenu({ r, onAction }: { r: StudentRow; onAction: (p: Pending) => void }) {
  const p = { id: r.id, name: r.name, email: r.email }
  if (r.status === 'deleted') return null
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name || r.email}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent onClick={(e) => e.stopPropagation()}>
        <MenuItem onSelect={() => onAction({ kind: 'edit', ...p })}>
          <Pencil /> Edit account
        </MenuItem>
        {r.status === 'active' ? (
          <MenuItem onSelect={() => onAction({ kind: 'suspend', ...p })}>
            <Pause /> Suspend
          </MenuItem>
        ) : (
          <MenuItem onSelect={() => onAction({ kind: 'reactivate', ...p })}>
            <Play /> Reactivate
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

export function ConsoleStudentsPage() {
  const [userId, setUserId] = useParam('user')
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const [status, setStatus] = useState<StudentFilters['status']>('')
  const [enrolment, setEnrolment] = useState<StudentFilters['enrolment']>('')
  const filters: StudentFilters = { q, status, enrolment }
  const list = useStudents(filters)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const [pending, setPending] = useState<Pending>(null)
  const [exporting, setExporting] = useState(false)
  const filtered = !!(q || status || enrolment)

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await fetchStudentsExport(filters)
      saveCsv(
        'students.csv',
        ['Name', 'Email', 'Status', 'Enrolments', 'Average progress %', 'Joined', 'Last signed in', 'Also an instructor'],
        all.map((r) => [r.name, r.email, personStatus(r.status), r.enrolments, r.avg_progress, r.joined.slice(0, 10), r.last_login?.slice(0, 10) ?? '', r.is_instructor ? 'Yes' : 'No']),
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader title="Student management" description="Manage student accounts, see enrolments and progress, and control account status." actions={<PeopleSwitch active="students" />} />
      <div className="grid gap-6">
        <Kpis />
        <Card>
          <Toolbar>
            <SearchBox value={qText} onChange={setQText} label="Search students" placeholder="Search students by name or email" className="sm:max-w-xs" />
            <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StudentFilters['status'])} className="w-auto">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </NativeSelect>
            <NativeSelect aria-label="Filter by enrolments" value={enrolment} onChange={(e) => setEnrolment(e.target.value as StudentFilters['enrolment'])} className="w-auto">
              <option value="">All enrolments</option>
              <option value="any">Enrolled in something</option>
              <option value="active">Learning now</option>
              <option value="completed">Completed a course</option>
              <option value="none">Not enrolled</option>
            </NativeSelect>
            <Button variant="secondary" className="sm:ml-auto" loading={exporting} onClick={() => void exportCsv()}>
              {exporting ? null : <Download />} Export
            </Button>
          </Toolbar>
          {list.error ? (
            <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
          ) : list.isLoading ? (
            <div className="grid gap-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={filtered ? <Search /> : <Users />}
              title={filtered ? 'Nobody matches' : 'No students yet'}
              body={filtered ? 'Try another name or clear the filters.' : 'People who sign up appear here.'}
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => (setQText(''), setStatus(''), setEnrolment(''))}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="animate-reveal">
              <ul className="stagger grid gap-3 p-3 md:hidden">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setUserId(r.id)} className="w-full rounded-lg border border-border bg-surface p-3.5 text-left shadow-sm transition-colors hover:border-border-strong">
                      <div className="flex items-start justify-between gap-3">
                        <PersonCell name={r.name} email={r.email} />
                        <StatusPill status={r.status} label={personStatus(r.status)} />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
                        <span>
                          {r.enrolments} enrolments · joined {day(r.joined)}
                        </span>
                        <ProgressCell value={r.avg_progress} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Student</Th>
                      <Th className="text-right">Enrolments</Th>
                      <Th>Progress (avg)</Th>
                      <Th className="hidden lg:table-cell">Joined on</Th>
                      <Th>Status</Th>
                      <Th className="text-right">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((r) => (
                      <Tr key={r.id} className="cursor-pointer" onClick={() => setUserId(r.id)}>
                        <Td>
                          <button type="button" className="text-left" onClick={(e) => (e.stopPropagation(), setUserId(r.id))}>
                            <PersonCell name={r.name} email={r.email} />
                          </button>
                        </Td>
                        <Td className="text-right tabular">{r.enrolments}</Td>
                        <Td>
                          <ProgressCell value={r.avg_progress} />
                        </Td>
                        <Td className="hidden text-muted lg:table-cell">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="size-3.5" aria-hidden />
                            {day(r.joined)}
                          </span>
                        </Td>
                        <Td>
                          <StatusPill status={r.status} label={personStatus(r.status)} />
                        </Td>
                        <Td className="text-right">
                          <RowMenu r={r} onAction={setPending} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <LoadMore shown={rows.length} noun={rows.length === 1 ? 'student' : 'students'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
            </div>
          )}
        </Card>
      </div>
      <DetailSheet open={!!userId} onOpenChange={(o) => !o && setUserId('')} title="Student details">
        {userId ? <StudentPanel id={userId} onAction={setPending} /> : null}
      </DetailSheet>
      <AccountDialogs pending={pending} onClose={() => setPending(null)} />
    </>
  )
}
