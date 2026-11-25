import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, ExternalLink, Plus, Search, Trash2, Users, type LucideIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS, usePersonCompliance, useRemind, useRequirements } from '@/features/compliance/api'
import { AssignWizard } from '@/features/org/AssignWizard'
import { useAddTrainingPlanItem, useCompleteTrainingPlanItem, useDeleteTrainingPlanItem, useTrainingPlan, useUpdateTrainingPlan } from '@/features/hcm/api'
import { useLibrary, usePeople } from '@/features/org/api'
import { Link } from '@/lib/router'
import { toast } from '@/lib/toast'

const tabs = ['Plans', 'Calendar', 'Allocate courses'] as const
type Tab = (typeof tabs)[number]
type PlanScope = 'all' | 'required' | 'optional'

const dateText = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString()
const isOpenStatus = (status: string) => !['compliant', 'exempt', 'completed', 'cancelled'].includes(status)

/** Company training-plan workspace backed by compliance, enrolment, and HR development-plan data. */
export function TrainingPlansPage() {
  const [tab, setTab] = useState<Tab>('Plans')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const people = usePeople({ q: query || undefined })
  const requirements = useRequirements()
  const personOptions = people.data?.pages.flatMap((page) => page.items) ?? []
  const selected = personOptions.find((person) => person.member_id === selectedId) ?? personOptions[0]
  const personData = usePersonCompliance(selected?.member_id)
  const plan = useTrainingPlan(selected?.member_id)
  const savePlan = useUpdateTrainingPlan(selected?.member_id ?? '')
  const addPlanItem = useAddTrainingPlanItem(selected?.member_id ?? '')
  const completePlanItem = useCompleteTrainingPlanItem(selected?.member_id ?? '')
  const deletePlanItem = useDeleteTrainingPlanItem(selected?.member_id ?? '')
  const remind = useRemind()
  const library = useLibrary()
  const requiredItems = personData.data?.requirements ?? []
  const enrolledCourses = personData.data?.courses ?? []
  const plannedItems = plan.data?.items.filter((item) => item.status !== 'cancelled') ?? []

  const [planOwnerId, setPlanOwnerId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [showAddItem, setShowAddItem] = useState(false)
  const [itemKind, setItemKind] = useState<'course' | 'external'>('course')
  const [courseId, setCourseId] = useState('')
  const [externalTitle, setExternalTitle] = useState('')
  const [provider, setProvider] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [itemPurpose, setItemPurpose] = useState('self_directed')
  const [itemSource, setItemSource] = useState('manager')
  const [sourceDetail, setSourceDetail] = useState('')
  const [itemOwner, setItemOwner] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [completionHours, setCompletionHours] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [deadlineFilter, setDeadlineFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<PlanScope>('all')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    setPlanOwnerId(plan.data?.owner_id ?? '')
    setPeriodStart(plan.data?.period_start ?? '')
    setPeriodEnd(plan.data?.period_end ?? '')
  }, [plan.data])

  const submitPlanItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    addPlanItem.mutate(
      {
        kind: itemKind,
        course_id: itemKind === 'course' ? courseId : null,
        title: itemKind === 'external' ? externalTitle : '',
        provider,
        external_url: externalUrl,
        purpose: itemPurpose as 'corrective' | 'preventive' | 'self_directed',
        source: itemSource as 'manager' | 'career_path' | 'competency_gap' | 'external',
        source_detail: sourceDetail,
        owner_id: itemOwner || null,
        due_at: dueAt || null,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
      },
      {
        onSuccess: () => {
          toast.success(itemKind === 'course' ? 'Course added to the plan' : 'External learning added to the plan')
          setShowAddItem(false)
          setCourseId('')
          setExternalTitle('')
          setProvider('')
          setExternalUrl('')
          setSourceDetail('')
          setDueAt('')
          setEstimatedHours('')
        },
        onError: (error) => toast.error((error as Error).message),
      },
    )
  }

  const counts = useMemo(() => ({
    required: requiredItems.length,
    completed: requiredItems.filter((item) => ['compliant', 'exempt'].includes(item.status)).length,
    dueSoon: requiredItems.filter((item) => item.status === 'expiring_soon').length,
    overdue: requiredItems.filter((item) => ['overdue', 'expired'].includes(item.status)).length,
  }), [requiredItems])
  const stats: { label: string; value: string | number; Icon: LucideIcon }[] = [
    { label: 'People in view', value: personOptions.length, Icon: Users },
    { label: 'Required items', value: counts.required, Icon: ClipboardList },
    { label: 'Completed', value: counts.completed, Icon: CheckCircle2 },
    { label: 'Overdue', value: counts.overdue, Icon: CalendarDays },
  ]

  const requiredRows = scopeFilter === 'optional' ? [] : requiredItems.map((item) => {
    const course = enrolledCourses.find((entry) => entry.course_id === requirements.data?.find((req) => req.id === item.requirement_id)?.course_id)
    const requirement = requirements.data?.find((req) => req.id === item.requirement_id)
    return { kind: 'required' as const, key: item.status_id, item, course, requirement }
  })
  const optionalRows = scopeFilter === 'required' ? [] : plannedItems.map((item) => ({ kind: 'optional' as const, key: item.id, item, course: item.course_id ? enrolledCourses.find((entry) => entry.course_id === item.course_id) : undefined }))
  const requiredCourseIds = new Set((requirements.data ?? []).map((requirement) => requirement.course_id))
  const plannedCourseIds = new Set(plannedItems.flatMap((item) => item.course_id ? [item.course_id] : []))
  const assignedRows = scopeFilter === 'required' ? [] : enrolledCourses
    .filter((course) => !requiredCourseIds.has(course.course_id) && !plannedCourseIds.has(course.course_id))
    .map((course) => ({ kind: 'assigned' as const, key: course.course_id, course, libraryCourse: library.data?.find((entry) => entry.id === course.course_id) }))
  const totalRows = requiredRows.length + optionalRows.length + assignedRows.length
  const rows = [...requiredRows, ...optionalRows, ...assignedRows].filter((row) => {
    const status = row.kind === 'required' ? row.item.status : row.kind === 'optional' ? row.item.status === 'completed' ? 'completed' : row.course?.status === 'completed' ? 'completed' : row.course?.progress_pct ? 'in_progress' : 'not_started' : row.course.status === 'completed' ? 'completed' : row.course.progress_pct > 0 ? 'in_progress' : 'not_started'
    const itemType = row.kind === 'optional' && row.item.kind === 'external' ? 'external' : 'course'
    const due = row.kind === 'assigned' ? null : row.item.due_at
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dueDate = due ? new Date(`${due.slice(0, 10)}T00:00:00`) : null
    const days = dueDate ? Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000) : null
    const deadlineMatches = deadlineFilter === 'all' || (deadlineFilter === 'no_due' && !dueDate) || (deadlineFilter === 'overdue' && days !== null && days < 0 && isOpenStatus(status)) || (deadlineFilter === 'next_30' && days !== null && days >= 0 && days <= 30 && isOpenStatus(status))
    return (statusFilter === 'all' || status === statusFilter) && (typeFilter === 'all' || itemType === typeFilter) && deadlineMatches
  })

  return (
    <>
      <PageHeader title="Training plans" description="Review each person’s required learning, progress and deadlines across your company." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <label className="relative min-w-[15rem] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person…" aria-label="Find a person" />
          </label>
          <div className="flex max-w-full gap-2 overflow-x-auto">
            {personOptions.slice(0, 8).map((person) => <Button key={person.member_id} size="sm" variant={selected?.member_id === person.member_id ? 'secondary' : 'ghost'} onClick={() => setSelectedId(person.member_id)}>{person.name}</Button>)}
          </div>
        </div>
        <Button variant="secondary" asChild><Link to="/business/matrix"><Users /> View training matrix</Link></Button>
      </div>

      <nav aria-label="Training plan sections" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {tabs.map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === item ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2 hover:text-text'}`}>{item}</button>)}
      </nav>

      {tab === 'Allocate courses' ? (
        !selected ? <Card><EmptyState icon={<Users />} title="Choose a person" body="Search for a company member before assigning a course." /></Card> : <div className="grid gap-4"><div><h2 className="text-lg font-semibold">Allocate learning to {selected.name}</h2><p className="text-sm text-muted">Choose a company course, review access and seat availability, then assign it.</p></div><AssignWizard key={selected.member_id} preset={null} picked={[{ id: selected.member_id, name: selected.name }]} onSeeProgress={() => setTab('Plans')} /></div>
      ) : tab === 'Calendar' ? (
        <Card><CardHeader title="Upcoming deadlines" description="Required training and planned learning, ordered by due date." action={<CalendarDays className="size-5 text-muted" aria-hidden />} />{personData.isLoading || plan.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : personData.error || plan.error ? <ErrorState message={((personData.error ?? plan.error) as Error).message} onRetry={() => { void personData.refetch(); void plan.refetch() }} /> : !selected ? <EmptyState icon={<Users />} title="Choose a person" body="Search for a company member to see their training deadlines." /> : <ul className="grid gap-2 p-4">{[
          ...requiredItems.filter((item) => item.due_at && isOpenStatus(item.status)).map((item) => ({ key: item.status_id, name: item.name, due: item.due_at!, status: item.status, kind: 'Required' })),
          ...plannedItems.filter((item) => item.due_at && item.status !== 'completed').map((item) => ({ key: item.id, name: item.title, due: item.due_at!, status: 'planned', kind: 'Plan' })),
        ].sort((a, b) => a.due.localeCompare(b.due)).map((item) => <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><span className="min-w-0 flex-1"><span className="block font-medium">{item.name}</span><span className="text-xs text-muted">{item.kind}</span></span><span className="text-sm text-muted">Due {dateText(item.due)}</span><Badge tone={(STATUS[item.status as keyof typeof STATUS]?.tone ?? 'neutral') as 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'outline'}>{STATUS[item.status as keyof typeof STATUS]?.label ?? (item.status === 'planned' ? 'Planned' : item.status)}</Badge></li>)}{!requiredItems.some((item) => item.due_at && isOpenStatus(item.status)) && !plannedItems.some((item) => item.due_at && item.status !== 'completed') ? <li className="text-sm text-muted">No upcoming deadlines.</li> : null}</ul>}</Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, Icon }) => <Card key={label}><CardBody className="flex items-center justify-between"><div><p className="text-sm text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div><Icon className="size-5 text-primary" aria-hidden /></CardBody></Card>)}
          </div>
          {people.error || requirements.error ? <ErrorState message={((people.error ?? requirements.error) as Error).message} onRetry={() => { void people.refetch(); void requirements.refetch() }} /> : null}
          {people.isLoading || requirements.isLoading ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : !selected ? <Card><EmptyState icon={<Users />} title="No people found" body="Search for a company member to view their assigned training." /></Card> : (
            <>
              <Card className="mb-4"><CardBody className="flex flex-wrap items-center gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{selected.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</div>
                <div className="min-w-0 flex-1"><h2 className="font-semibold">{selected.name}</h2><p className="text-sm text-muted">{selected.job_title || selected.email} · Development plan {plan.data?.owner_name ? `· owner ${plan.data.owner_name}` : ''}</p><p className="text-xs text-muted">{plan.data?.period_start || plan.data?.period_end ? `${plan.data.period_start ? dateText(plan.data.period_start) : 'Start not set'} – ${plan.data.period_end ? dateText(plan.data.period_end) : 'End not set'}` : 'Plan period not set'}</p></div>
                <div className="flex gap-5 text-center text-sm"><div><b>{counts.required ? Math.round(counts.completed / counts.required * 100) : 0}%</b><p className="text-xs text-muted">required progress</p></div><div><b>{counts.dueSoon}</b><p className="text-xs text-muted">due soon</p></div><div><b className={counts.overdue ? 'text-danger' : ''}>{counts.overdue}</b><p className="text-xs text-muted">overdue</p></div></div>
              </CardBody>{counts.required ? <div className="px-4 pb-4"><Progress value={counts.required ? counts.completed / counts.required * 100 : 0} label={`Required training: ${counts.completed} of ${counts.required} complete`} /></div> : null}</Card>

              <Card className="mb-4">
                <CardHeader title="Plan details" description="Set the review period and who owns this person’s development plan." action={<Button size="sm" variant="secondary" onClick={() => setShowAddItem((open) => !open)}><Plus /> Add learning</Button>} />
                <CardBody className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                  <Field label="Plan owner">{(props) => <NativeSelect {...props} value={planOwnerId} onChange={(event) => setPlanOwnerId(event.target.value)}><option value="">Not assigned</option>{personOptions.map((person) => <option key={person.member_id} value={person.member_id}>{person.name}</option>)}</NativeSelect>}</Field>
                  <Field label="Period starts">{(props) => <Input {...props} type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />}</Field>
                  <Field label="Period ends">{(props) => <Input {...props} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />}</Field>
                  <Button loading={savePlan.isPending} onClick={() => savePlan.mutate({ owner_id: planOwnerId || null, period_start: periodStart || null, period_end: periodEnd || null }, { onSuccess: () => toast.success('Plan details saved'), onError: (error) => toast.error((error as Error).message) })}>Save plan</Button>
                </CardBody>
              </Card>
              {showAddItem ? (
                <Card className="mb-4">
                  <CardHeader title="Add learning to plan" description="Add a LearnHub course or planned external learning for this person." />
                  <CardBody><form className="grid gap-4" onSubmit={submitPlanItem}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Learning type">{(props) => <NativeSelect {...props} value={itemKind} onChange={(event) => setItemKind(event.target.value as 'course' | 'external')}><option value="course">LearnHub course</option><option value="external">External learning</option></NativeSelect>}</Field>
                    {itemKind === 'course' ? <Field label="Course">{(props) => <NativeSelect {...props} required value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Choose a course</option>{(library.data ?? []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</NativeSelect>}</Field> : <Field label="Activity title">{(props) => <Input {...props} required value={externalTitle} onChange={(event) => setExternalTitle(event.target.value)} placeholder="For example: Site safety workshop" />}</Field>}
                    {itemKind === 'external' ? <Field label="Provider">{(props) => <Input {...props} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider or organisation" />}</Field> : null}
                    {itemKind === 'external' ? <Field label="Link">{(props) => <Input {...props} type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://" />}</Field> : null}
                    <Field label="Purpose">{(props) => <NativeSelect {...props} value={itemPurpose} onChange={(event) => setItemPurpose(event.target.value)}><option value="self_directed">Self-directed</option><option value="corrective">Corrective</option><option value="preventive">Preventive</option></NativeSelect>}</Field>
                    <Field label="Added because">{(props) => <NativeSelect {...props} value={itemSource} onChange={(event) => setItemSource(event.target.value)}><option value="manager">Manager assigned</option><option value="career_path">Career pathway</option><option value="competency_gap">Competency gap</option><option value="external">External learning</option></NativeSelect>}</Field>
                    <Field label="Assigned owner">{(props) => <NativeSelect {...props} value={itemOwner} onChange={(event) => setItemOwner(event.target.value)}><option value="">No owner</option>{personOptions.map((person) => <option key={person.member_id} value={person.member_id}>{person.name}</option>)}</NativeSelect>}</Field>
                    <Field label="Due date">{(props) => <Input {...props} type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />}</Field>
                    <Field label="Estimated hours">{(props) => <Input {...props} type="number" min="0.25" step="0.25" value={estimatedHours} onChange={(event) => setEstimatedHours(event.target.value)} placeholder="e.g. 2" />}</Field>
                    <Field label="Reason or source detail">{(props) => <Input {...props} value={sourceDetail} onChange={(event) => setSourceDetail(event.target.value)} placeholder="Why this learning is on the plan" />}</Field>
                  </div><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowAddItem(false)}>Cancel</Button><Button type="submit" loading={addPlanItem.isPending} disabled={itemKind === 'course' ? !courseId : !externalTitle.trim()}>Add to plan</Button></div></form></CardBody>
                </Card>
              ) : null}

              <Card className="mb-4">
                <CardHeader title="Learning plan" description="Required compliance and individual development, with recorded course progress and deadlines." action={<span className="text-sm text-muted">{rows.length} of {totalRows} items</span>} />
                <CardBody className="grid gap-3 border-b border-border sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="Status">{(props) => <NativeSelect {...props} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="compliant">Compliant</option><option value="expiring_soon">Expiring soon</option><option value="in_progress">In progress</option><option value="not_started">Not started / planned</option><option value="overdue">Overdue</option><option value="expired">Expired</option><option value="exempt">Exempt</option><option value="completed">Completed</option></NativeSelect>}</Field>
                  <Field label="Deadlines">{(props) => <NativeSelect {...props} value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value)}><option value="all">All deadlines</option><option value="next_30">Due in 30 days</option><option value="overdue">Past due</option><option value="no_due">No deadline</option></NativeSelect>}</Field>
                  <Field label="Plan scope">{(props) => <NativeSelect {...props} value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as PlanScope)}><option value="all">Required and optional</option><option value="required">Required only</option><option value="optional">Development only</option></NativeSelect>}</Field>
                  <Field label="Learning type">{(props) => <NativeSelect {...props} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="course">LearnHub courses</option><option value="external">External learning</option></NativeSelect>}</Field>
                </CardBody>
                {personData.error || plan.error ? <ErrorState message={((personData.error ?? plan.error) as Error).message} onRetry={() => { void personData.refetch(); void plan.refetch() }} /> : personData.isLoading || plan.isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : rows.length ? <ul className="grid gap-3 p-4">
                  {rows.map((row) => {
                    if (row.kind === 'required') {
                      const { item, course, requirement } = row
                      const meta = STATUS[item.status as keyof typeof STATUS]
                      return <li key={row.key} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{requirement?.course_slug ? <Link to={`/courses/${requirement.course_slug}`} className="hover:text-primary hover:underline">{item.name}</Link> : item.name}</h3><Badge tone="outline">Required</Badge><Badge tone={(meta?.tone ?? 'neutral') as 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'outline'}>{meta?.label ?? item.status}</Badge></div><p className="mt-1 text-sm text-muted">{item.course_title || requirement?.course_title || 'Required course'} · Compliance requirement</p><p className="mt-1 text-xs text-muted">{course ? `${Math.round(course.progress_pct)}% course progress · enrolled ${dateText(course.enrolled_at)}` : 'No course activity recorded'}{course?.completed_at ? ` · completed ${dateText(course.completed_at)}` : ''}</p></div><div className="flex flex-wrap items-center gap-2">{item.due_at ? <span className="text-sm text-muted">Due {dateText(item.due_at)}</span> : <span className="text-sm text-muted">No deadline</span>}{requirement?.course_slug ? <Button size="sm" asChild><Link to={`/learn/${requirement.course_slug}`}>{course?.status === 'completed' ? 'Review course' : course?.progress_pct ? 'Resume' : 'Start'} <ExternalLink /></Link></Button> : null}{isOpenStatus(item.status) ? <Button size="sm" variant="secondary" loading={remind.isPending} onClick={() => remind.mutate(item.status_id, { onSuccess: () => toast.success(`Reminder sent to ${selected.name}`), onError: (error) => toast.error((error as Error).message) })}>Remind</Button> : null}<Button size="sm" variant="ghost" asChild><Link to={requirement?.course_slug ? `/courses/${requirement.course_slug}` : `/business/people/${selected.member_id}?tab=training&requirement=${item.requirement_id}`}>Details</Link></Button></div></div>{course ? <div className="mt-3 max-w-2xl"><Progress value={course.progress_pct} tone={course.status === 'completed' ? 'success' : 'primary'} label={`${item.name}: ${Math.round(course.progress_pct)}% complete`} /></div> : null}</li>
                    }
                    if (row.kind === 'assigned') {
                      const { course, libraryCourse } = row
                      const complete = course.status === 'completed'
                      const statusLabel = complete ? 'Completed' : course.progress_pct > 0 ? 'In progress' : 'Assigned'
                      const tone = complete ? 'success' as const : course.progress_pct > 0 ? 'info' as const : 'neutral' as const
                      return <li key={row.key} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{libraryCourse ? <Link to={`/courses/${libraryCourse.slug}`} className="hover:text-primary hover:underline">{course.course_title}</Link> : course.course_title}</h3><Badge tone="outline">Assigned course</Badge><Badge tone={tone}>{statusLabel}</Badge></div><p className="mt-1 text-xs text-muted">Assigned learning · enrolled {dateText(course.enrolled_at)}{course.completed_at ? ` · completed ${dateText(course.completed_at)}` : ''}</p></div>{libraryCourse ? <Button size="sm" asChild><Link to={`/learn/${libraryCourse.slug}`}>{complete ? 'Review course' : course.progress_pct > 0 ? 'Resume' : 'Start'} <ExternalLink /></Link></Button> : null}</div><div className="mt-3 max-w-2xl"><Progress value={course.progress_pct} tone={complete ? 'success' : 'primary'} label={`${course.course_title}: ${Math.round(course.progress_pct)}% complete`} /></div></li>
                    }
                    const { item, course } = row
                    const complete = item.status === 'completed' || course?.status === 'completed'
                    const progress = course?.progress_pct ?? 0
                    const statusLabel = complete ? 'Completed' : progress > 0 ? 'In progress' : 'Planned'
                    const tone = complete ? 'success' as const : progress > 0 ? 'info' as const : 'neutral' as const
                    return <li key={row.key} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.course_slug ? <Link to={`/courses/${item.course_slug}`} className="hover:text-primary hover:underline">{item.title}</Link> : item.title}</h3><Badge tone="outline">Optional</Badge><Badge tone={tone}>{statusLabel}</Badge><Badge tone="outline">{item.purpose.replace(/_/g, ' ')}</Badge></div><p className="mt-1 text-xs text-muted">{item.source_detail || item.source.replace(/_/g, ' ')} · {item.owner_name ? `owner ${item.owner_name}` : `assigned by ${item.assigned_by_name}`} · assigned {dateText(item.assigned_at)}{item.provider ? ` · ${item.provider}` : ''}{item.estimated_hours ? ` · ${item.estimated_hours}h estimated` : ''}{item.completed_hours ? ` · ${item.completed_hours}h recorded` : ''}</p></div><div className="flex flex-wrap items-center gap-2">{item.due_at ? <span className="text-sm text-muted">Due {dateText(item.due_at)}</span> : <span className="text-sm text-muted">No deadline</span>}{item.course_slug ? <Button size="sm" asChild><Link to={`/learn/${item.course_slug}`}>{course?.progress_pct ? 'Resume' : 'Start'} <ExternalLink /></Link></Button> : null}{item.external_url ? <Button size="sm" variant="secondary" asChild><a href={item.external_url} target="_blank" rel="noreferrer">Open provider <ExternalLink /></a></Button> : null}<Button size="sm" variant="ghost" aria-label={`Remove ${item.title} from plan`} loading={deletePlanItem.isPending} onClick={() => deletePlanItem.mutate(item.id, { onSuccess: () => toast.success('Removed from plan'), onError: (error) => toast.error((error as Error).message) })}><Trash2 /> Remove</Button></div></div>{course ? <div className="mt-3 max-w-2xl"><Progress value={progress} tone={complete ? 'success' : 'primary'} label={`${item.title}: ${Math.round(progress)}% complete`} /></div> : null}{item.kind === 'external' && !complete ? <div className="mt-3 flex flex-wrap items-end justify-end gap-2"><Field label="Hours completed">{(props) => <Input {...props} type="number" min="0.25" step="0.25" required className="w-36" value={completionHours[item.id] ?? ''} onChange={(event) => setCompletionHours((hours) => ({ ...hours, [item.id]: event.target.value }))} placeholder={item.estimated_hours ? `Estimate ${item.estimated_hours}` : 'Enter hours'} />}</Field><Button size="sm" variant="secondary" disabled={!completionHours[item.id] || Number(completionHours[item.id]) <= 0} loading={completePlanItem.isPending} onClick={() => completePlanItem.mutate({ itemId: item.id, hours: Number(completionHours[item.id]) }, { onSuccess: () => toast.success('External learning completed and CPD recorded'), onError: (error) => toast.error((error as Error).message) })}>Mark complete</Button></div> : null}</li>
                  })}
                </ul> : <div className="p-6"><EmptyState icon={<BookOpen />} title="No learning matches these filters" body="Change the filters or add learning to this person’s plan." action={<Button onClick={() => setShowAddItem(true)}><Plus /> Add learning</Button>} /></div>}
              </Card>
            </>
          )}
        </>
      )}
    </>
  )
}
