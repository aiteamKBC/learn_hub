import { BookOpen, Building2, CheckCircle2, GraduationCap, Plus, RotateCcw, Search, UserRound, Users, XCircle } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type ConsoleEnrolment, type EnrolmentFilters, useCreateEnrolment, useEnrolmentKpis, useEnrolmentOptions, useEnrolments, useUpdateEnrolment } from '@/features/console/enrolments'
import { ConfirmDialog, DetailSheet, InfoRow, LoadMore, StatusPill, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { count, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const STATUSES = { active: 'Active', completed: 'Completed', expired: 'Expired', revoked: 'Revoked' }
const SOURCES = { purchase: 'Purchased', free: 'Free course', subscription: 'Subscription', organization: 'Assigned by company', admin_grant: 'Granted by staff', instalment: 'Instalment purchase' }

function Kpis() {
  const query = useEnrolmentKpis()
  if (query.isLoading) return <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[112px] rounded-xl" />)}</div>
  if (!query.data) return null
  const data = query.data
  return (
    <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Total enrolments" value={count(data.total)} icon={<GraduationCap />} />
      <StatCard label="Active" value={count(data.active)} icon={<BookOpen />} tone="success" />
      <StatCard label="Completed" value={count(data.completed)} icon={<CheckCircle2 />} tone="info" />
      <StatCard label="Personal" value={count(data.personal)} icon={<UserRound />} />
      <StatCard label="Company" value={count(data.company)} icon={<Building2 />} tone="warning" />
      <StatCard label="Cancelled / expired" value={count(data.cancelled)} icon={<XCircle />} tone={data.cancelled ? 'danger' : 'success'} />
    </div>
  )
}

function CreateEnrolment({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const options = useEnrolmentOptions(open)
  const create = useCreateEnrolment()
  const [student, setStudent] = useState('')
  const [course, setCourse] = useState('')
  const [scope, setScope] = useState<'personal' | 'company'>('personal')
  const [company, setCompany] = useState('')
  const close = () => (onOpenChange(false), setStudent(''), setCourse(''), setScope('personal'), setCompany(''))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate({ user_id: student, course_id: course, company_id: scope === 'company' ? company : null }, {
      onSuccess: () => (toast.success('Enrolment added'), close()),
      onError: (error) => toast.error(error.message),
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="w-[min(520px,100vw)]" title="Add enrolment" description="Grant a learner access personally or through a company workspace.">
        <form className="grid gap-4 p-4" onSubmit={submit}>
          {options.error ? <ErrorState message={options.error.message} onRetry={() => void options.refetch()} /> : null}
          <Field label="Student">{(field) => <NativeSelect {...field} value={student} onChange={(event) => setStudent(event.target.value)} required disabled={options.isLoading}><option value="">Choose a student</option>{options.data?.students.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.detail}</option>)}</NativeSelect>}</Field>
          <Field label="Course">{(field) => <NativeSelect {...field} value={course} onChange={(event) => setCourse(event.target.value)} required disabled={options.isLoading}><option value="">Choose a published course</option>{options.data?.courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect>}</Field>
          <Field label="Enrolment type">{(field) => <NativeSelect {...field} value={scope} onChange={(event) => (setScope(event.target.value as 'personal' | 'company'), setCompany(''))}><option value="personal">Personal</option><option value="company">Company employee</option></NativeSelect>}</Field>
          {scope === 'company' ? <Field label="Company" hint="The student must already be an active member of this company.">{(field) => <NativeSelect {...field} value={company} onChange={(event) => setCompany(event.target.value)} required><option value="">Choose a company</option>{options.data?.companies.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect>}</Field> : null}
          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!student || !course || (scope === 'company' && !company)}><Plus /> Add enrolment</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EnrolmentEditor({ item, onClose }: { item: ConsoleEnrolment; onClose: () => void }) {
  const update = useUpdateEnrolment()
  const [status, setStatus] = useState<keyof typeof STATUSES>(item.status as keyof typeof STATUSES)
  const [progress, setProgress] = useState(String(item.progress_pct))
  const [revoking, setRevoking] = useState(false)
  const save = (event: FormEvent) => {
    event.preventDefault()
    const value = Math.max(0, Math.min(100, Number(progress)))
    update.mutate({ id: item.id, status, progress_pct: status === 'completed' ? 100 : value }, {
      onSuccess: () => (toast.success('Enrolment updated'), onClose()),
      onError: (error) => toast.error(error.message),
    })
  }
  return (
    <div className="grid gap-6">
      <div>
        <InfoRow label="Student"><Link to={`/console/students?user=${item.user_id}`} className="font-medium text-primary hover:underline">{item.student}</Link></InfoRow>
        <InfoRow label="Email">{item.email}</InfoRow>
        <InfoRow label="Course"><Link to={`/console/courses?course=${item.course_id}`} className="font-medium text-primary hover:underline">{item.course}</Link></InfoRow>
        <InfoRow label="Workspace">{item.company ?? 'Personal learning'}</InfoRow>
        <InfoRow label="Source">{item.source_label}</InfoRow>
        <InfoRow label="Enrolled">{shortDate(item.enrolled_at)}</InfoRow>
        <InfoRow label="Last activity">{item.last_accessed_at ? shortDate(item.last_accessed_at) : 'Not started'}</InfoRow>
      </div>
      <form className="grid gap-4 rounded-xl border border-border p-4" onSubmit={save}>
        <h3 className="text-sm font-semibold">Status and progress</h3>
        <Field label="Status">{(field) => <NativeSelect {...field} value={status} onChange={(event) => setStatus(event.target.value as keyof typeof STATUSES)}>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>}</Field>
        <Field label="Progress" hint={status === 'completed' ? 'Completed enrolments are saved at 100%.' : 'From 0 to 100%.'}>{(field) => <Input {...field} type="number" min="0" max="100" step="0.01" value={status === 'completed' ? '100' : progress} onChange={(event) => setProgress(event.target.value)} disabled={status === 'completed'} required />}</Field>
        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="danger" onClick={() => setRevoking(true)} disabled={item.status === 'revoked'}><XCircle /> Revoke access</Button>
          <Button type="submit" loading={update.isPending}>Save changes</Button>
        </div>
      </form>
      <ConfirmDialog open={revoking} onOpenChange={setRevoking} title="Revoke this enrolment?" body="The learner loses course access. Their progress and history stay available for audit and reporting." confirmLabel="Revoke access" loading={update.isPending} onConfirm={() => update.mutate({ id: item.id, status: 'revoked', progress_pct: item.progress_pct }, { onSuccess: () => (toast.success('Enrolment revoked'), setRevoking(false), onClose()), onError: (error) => toast.error(error.message) })} />
    </div>
  )
}

export function ConsoleEnrolmentsPage() {
  const [openId, setOpenId] = useParam('enrolment')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<EnrolmentFilters>({})
  const [creating, setCreating] = useState(false)
  const options = useEnrolmentOptions()
  const queryFilters = { ...filters, q: useDebounced(search).trim() || undefined }
  const query = useEnrolments(queryFilters)
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  const current = rows.find((item) => item.id === openId)
  const filtered = !!(queryFilters.q || filters.status || filters.scope || filters.source || filters.course || filters.company)
  const set = (key: keyof EnrolmentFilters) => (event: ChangeEvent<HTMLSelectElement>) => setFilters((currentFilters) => ({ ...currentFilters, [key]: event.target.value || undefined }))
  const reset = () => (setSearch(''), setFilters({}))

  return (
    <>
      <PageHeader title="Enrolment management" description="Manage personal and company course registrations, access and learner progress." actions={<Button onClick={() => setCreating(true)}><Plus /> Add enrolment</Button>} />
      <div className="grid gap-6">
        <Kpis />
        <Card className="min-w-0 overflow-hidden">
          <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-2 xl:grid-cols-[minmax(13rem,1fr)_repeat(5,minmax(9rem,auto))_auto]">
            <Input icon={<Search />} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student, course or company" aria-label="Search enrolments" />
            <NativeSelect aria-label="Filter by status" value={filters.status ?? ''} onChange={set('status')}><option value="">All statuses</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
            <NativeSelect aria-label="Filter by type" value={filters.scope ?? ''} onChange={set('scope')}><option value="">All types</option><option value="personal">Personal</option><option value="company">Company</option></NativeSelect>
            <NativeSelect aria-label="Filter by source" value={filters.source ?? ''} onChange={set('source')}><option value="">All sources</option>{Object.entries(SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
            <NativeSelect aria-label="Filter by course" value={filters.course ?? ''} onChange={set('course')}><option value="">All courses</option>{options.data?.courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect>
            <NativeSelect aria-label="Filter by company" value={filters.company ?? ''} onChange={set('company')}><option value="">All companies</option>{options.data?.companies.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect>
            <Button variant="secondary" onClick={reset} disabled={!filtered}><RotateCcw /> Reset</Button>
          </div>
          {query.error ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : query.isLoading ? <div className="grid gap-2 p-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-14" />)}</div> : !rows.length ? <EmptyState icon={<GraduationCap />} title={filtered ? 'No enrolments match' : 'No enrolments yet'} body={filtered ? 'Try changing or clearing the filters.' : 'Add a learner to a published course to get started.'} /> : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table><thead><tr><Th>Student</Th><Th>Course</Th><Th>Type</Th><Th>Progress</Th><Th>Status</Th><Th>Enrolled</Th></tr></thead><tbody className="stagger">{rows.map((item) => <Tr key={item.id} className="cursor-pointer" onClick={() => setOpenId(item.id)}><Td><button type="button" className="block max-w-56 truncate text-left font-medium hover:text-primary" onClick={(event) => (event.stopPropagation(), setOpenId(item.id))}>{item.student}</button><span className="block max-w-56 truncate text-xs text-muted">{item.email}</span></Td><Td><span className="block max-w-64 truncate">{item.course}</span><span className="text-xs text-muted">{item.source_label}</span></Td><Td>{item.company ? <span className="inline-flex items-center gap-1.5 text-sm"><Building2 className="size-3.5 text-primary" /> {item.company}</span> : <span className="inline-flex items-center gap-1.5 text-sm"><UserRound className="size-3.5 text-muted" /> Personal</span>}</Td><Td className="min-w-32"><div className="flex items-center gap-2"><Progress value={item.progress_pct} className="w-20" label={`${item.student} progress`} /><span className="text-xs tabular">{Math.round(item.progress_pct)}%</span></div></Td><Td><StatusPill status={item.status} /></Td><Td className="text-xs text-muted tabular">{shortDate(item.enrolled_at)}</Td></Tr>)}</tbody></Table>
              </div>
              <ul className="stagger grid gap-2 p-3 md:hidden">{rows.map((item) => <li key={item.id}><button type="button" onClick={() => setOpenId(item.id)} className="w-full rounded-lg border border-border p-3 text-left"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{item.student}</span><StatusPill status={item.status} /></span><span className="mt-1 block truncate text-xs text-muted">{item.course} · {item.company ?? 'Personal'}</span><span className="mt-2 flex items-center gap-2"><Progress value={item.progress_pct} className="flex-1" /><span className="text-xs tabular">{Math.round(item.progress_pct)}%</span></span></button></li>)}</ul>
              <LoadMore shown={rows.length} noun={rows.length === 1 ? 'enrolment' : 'enrolments'} hasMore={!!query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
            </>
          )}
        </Card>
      </div>
      <CreateEnrolment open={creating} onOpenChange={setCreating} />
      <DetailSheet open={!!openId} onOpenChange={(open) => !open && setOpenId('')} title={current?.student ?? 'Enrolment details'} description={current?.course}>{current ? <EnrolmentEditor key={`${current.id}-${current.status}-${current.progress_pct}`} item={current} onClose={() => setOpenId('')} /> : query.isLoading ? <Skeleton className="h-72" /> : <EmptyState icon={<Users />} title="Enrolment not found" />}</DetailSheet>
    </>
  )
}
