import { ArrowLeft, BookOpen, Crown, Info, ListFilter, MoreHorizontal, Pencil, Percent, PieChart, Plus, Power, Search, Settings, SlidersHorizontal, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleCourses } from '@/features/console/courses'
import {
  type CommissionRule,
  type CommissionRuleIn,
  type InstructorCommission,
  SCOPE_LABEL,
  useCommissionOverview,
  useCommissionPreview,
  useCourseCommissionInstructors,
  useCommissionRules,
  useInstructorCommissions,
  useSaveCommissionSettings,
  useSaveRule,
  useSetInstructorKeeps,
} from '@/features/console/commissions'
import { day, SearchBox, toLocalInput, Toolbar } from '@/features/console/money-ui'
import { PersonCell, personStatus } from '@/features/console/people-ui'
import { ConfirmDialog, gbp, KpiCard, LoadMore, StatusPill, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { Link } from '@/lib/router'

const TABS = ['overview', 'instructors', 'courses', 'pool', 'settings'] as const
type Tab = (typeof TABS)[number]

function CommissionCoursePicker({ value, onChange }: { value: { id: string; title: string } | null; onChange: (v: { id: string; title: string } | null) => void }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const q = useDebounced(search.trim(), 200)
  const courses = useConsoleCourses({ tab: 'instructor', q })
  const rows = courses.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="grid gap-2">
      {value && !open ? <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{value.title} · Change course</Button> : <Input icon={<Search />} value={search} onFocus={() => setOpen(true)} onChange={(event) => { setSearch(event.target.value); setOpen(true) }} placeholder="Search or choose a course" aria-label="Search instructor courses" />}
      {open ? <div className="max-h-48 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Instructor courses">
        {courses.isLoading ? <p className="p-3 text-sm text-muted">Loading courses…</p> : rows.length === 0 ? <p className="p-3 text-sm text-muted">No instructor courses found.</p> : rows.map((course) => (
          <button key={course.id} type="button" role="option" aria-selected={value?.id === course.id} className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-surface-2" onClick={() => { onChange({ id: course.id, title: course.title }); setOpen(false); setSearch('') }}>
            <span className="block font-medium">{course.title}</span><span className="block text-xs text-muted">{course.status}{value?.id === course.id ? ' · Selected' : ''}</span>
          </button>
        ))}
        {courses.hasNextPage ? <Button type="button" size="sm" variant="ghost" loading={courses.isFetchingNextPage} onClick={() => void courses.fetchNextPage()}>Show more courses</Button> : null}
      </div> : null}
    </div>
  )
}

// ---------------------------------------------------------------- rule dialog
type RuleDraft = { id?: string; name: string; target: { id: string; title: string } | null; instructorId: string; keeps: string; priority: number; starts: string; ends: string; active: boolean }

const emptyRule = (): RuleDraft => ({ name: '', target: null, instructorId: '', keeps: '', priority: 0, starts: '', ends: '', active: true })

const fromRule = (r: CommissionRule): RuleDraft => ({
  id: r.id,
  name: r.name,
  target: r.target_id ? { id: r.target_id, title: r.target_label } : null,
  instructorId: r.instructor_id ?? '',
  keeps: String(r.keeps_pct),
  priority: r.priority,
  starts: r.starts_at ? toLocalInput(r.starts_at) : '',
  ends: r.ends_at ? toLocalInput(r.ends_at) : '',
  active: r.is_active,
})

function RuleDialog({ draft, onClose }: { draft: RuleDraft | null; onClose: () => void }) {
  const save = useSaveRule()
  const existing = useCommissionRules('course')
  const [d, setD] = useState<RuleDraft>(emptyRule())
  const [key, setKey] = useState<string | null>(null)
  const draftKey = draft ? (draft.id ?? 'new-course') : null
  if (draft && key !== draftKey) {
    setKey(draftKey)
    setD(draft)
  }
  const close = () => { setKey(null); onClose() }
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((s) => ({ ...s, [k]: v }))
  const instructors = useCourseCommissionInstructors(d.target?.id ?? '')

  function submit() {
    const keeps = Number(d.keeps)
    if (d.keeps.trim() === '' || !(keeps >= 0 && keeps <= 100)) return toast.error('Enter what the instructor keeps, between 0% and 100%.')
    if (!d.target) return toast.error('Choose the course this rate is for.')
    if (!instructors.data?.length) return toast.error('This course needs a linked instructor before you can set a commission.')
    if (!d.id && !d.instructorId) return toast.error('Choose the instructor whose rate you want to set.')
    if (d.instructorId && !instructors.data.some((instructor) => instructor.id === d.instructorId)) return toast.error('Choose an instructor linked to this course.')
    if (existing.data?.some((rule) => rule.target_id === d.target?.id && rule.instructor_id === (d.instructorId || null) && rule.id !== d.id && rule.is_active)) {
      return toast.error('This instructor already has an active rate for this course. Edit that rule instead.')
    }
    const body: CommissionRuleIn = {
      name: d.name.trim(),
      scope: 'course',
      target_id: d.target.id,
      instructor_id: d.instructorId || null,
      band_min_gbp_minor: null,
      band_max_gbp_minor: null,
      keeps_pct: keeps,
      priority: d.priority,
      is_active: d.active,
      starts_at: d.starts ? new Date(d.starts).toISOString() : null,
      ends_at: d.ends ? new Date(d.ends).toISOString() : null,
    }
    save.mutate(
      { id: d.id, body },
      { onSuccess: () => (toast.success(d.id ? 'Rule saved. It applies to sales from now on.' : 'Rule added. It applies to sales from now on.'), onClose(), setKey(null)), onError: (e) => toast.error((e as Error).message) },
    )
  }

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={d.id ? 'Edit course commission' : 'Set a course-specific commission'}
        description="Choose one course and set the instructor's share of future marketplace sales."
        className="max-w-2xl"
      >
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), submit())}>
          <div className="rounded-lg border border-primary/20 bg-primary-soft/40 p-3 text-sm text-primary-soft-text">
            <p className="font-medium">What this changes</p>
            <p className="mt-1">This rate replaces the instructor's usual rate for the selected course only. A promotion may lower the customer's price; it does not create or edit this rate.</p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Course</span>
            <CommissionCoursePicker value={d.target} onChange={(v) => { set('target', v); set('instructorId', '') }} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Instructor for this rule</span>
            {!d.target ? <p className="text-sm text-muted">Choose a course to see its instructors.</p> : instructors.isLoading ? <p className="text-sm text-muted">Loading instructors…</p> : instructors.error ? <p className="text-sm text-danger">Could not load this course’s instructors.</p> : <NativeSelect value={d.instructorId} onChange={(event) => set('instructorId', event.target.value)} aria-label="Instructor for this course rule">
              <option value="">{d.id && !d.instructorId ? 'All instructors (existing rule)' : 'Choose an instructor'}</option>
              {instructors.data?.map((instructor) => <option key={instructor.id} value={instructor.id}>{instructor.name}</option>)}
            </NativeSelect>}
            <p className="text-xs text-muted">Each instructor’s percentage applies to their own share of this course. Add a separate rule for another instructor.</p>
          </div>
          <div className="grid gap-3">
            <Field label="Instructor keeps from this course (%)" hint="For example, 70 means the instructor receives 70% of the eligible sale amount for this course.">{(p) => <Input {...p} inputMode="decimal" value={d.keeps} onChange={(e) => set('keeps', e.target.value)} required placeholder="70" />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" hint="Empty = now.">{(p) => <Input {...p} type="datetime-local" value={d.starts} onChange={(e) => set('starts', e.target.value)} />}</Field>
            <Field label="Ends" hint="Empty = no end.">{(p) => <Input {...p} type="datetime-local" value={d.ends} onChange={(e) => set('ends', e.target.value)} />}</Field>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rule-active">Active</Label>
            <Switch id="rule-active" checked={d.active} onCheckedChange={(v) => set('active', v)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {d.id ? 'Save rule' : 'Add rule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- rules list
function RulesList({ scope, addLabel = 'Add commission rule', onEdit, onAdd }: { scope: string; addLabel?: string; onEdit: (r: CommissionRule) => void; onAdd: () => void }) {
  const q = useCommissionRules(scope)
  const save = useSaveRule()
  const [toggling, setToggling] = useState<CommissionRule | null>(null)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data)
    return (
      <div className="grid gap-3 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  const rules = q.data
  if (rules.length === 0)
    return (
      <EmptyState
        icon={<SlidersHorizontal />}
        title="No rules yet"
        body="Without rules, each instructor keeps their own rate or the platform default."
        action={
          <Button onClick={onAdd}>
            <Plus /> {addLabel}
          </Button>
        }
      />
    )
  const toggle = (r: CommissionRule) =>
    save.mutate(
      {
        id: r.id,
        body: { name: r.name, scope: r.scope as CommissionRuleIn['scope'], target_id: r.target_id, instructor_id: r.instructor_id, band_min_gbp_minor: r.band_min_gbp_minor, band_max_gbp_minor: r.band_max_gbp_minor, keeps_pct: r.keeps_pct, priority: r.priority, is_active: !r.is_active, starts_at: r.starts_at, ends_at: r.ends_at },
      },
      { onSuccess: () => (toast.success(r.is_active ? 'Rule switched off' : 'Rule switched on'), setToggling(null)), onError: (e) => toast.error((e as Error).message) },
    )
  return (
    <div className="animate-reveal">
      <ul className="stagger grid gap-3 p-3 md:hidden">
        {rules.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-3.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name || r.target_label}</p>
                <p className="text-xs text-muted">
                  {SCOPE_LABEL[r.scope]} · {r.target_label} · {r.instructor_name || 'All instructors'}
                </p>
              </div>
              <span className="font-semibold tabular">{r.keeps_pct}%</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusPill status={r.is_live ? 'active' : r.is_active ? 'scheduled' : 'ended'} label={r.is_live ? 'Live' : r.is_active ? 'Not in dates' : 'Off'} />
              <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>
                <Pencil /> Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>Rule</Th>
              <Th>Applies to</Th>
              <Th className="text-right">Instructor keeps</Th>
              <Th className="hidden lg:table-cell">Dates</Th>
              <Th>Status</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {rules.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <p className="font-medium">{r.target_label}</p>
                  <p className="text-xs text-muted">{SCOPE_LABEL[r.scope]} · {r.instructor_name || 'All instructors'}</p>
                </Td>
                <Td className="max-w-[16rem] truncate">{r.target_label}</Td>
                <Td className="text-right font-medium tabular">{r.keeps_pct}%</Td>
                <Td className="hidden text-xs text-muted lg:table-cell">
                  {r.starts_at ? day(r.starts_at) : 'Now'} – {r.ends_at ? day(r.ends_at) : 'no end'}
                </Td>
                <Td>
                  <StatusPill status={r.is_live ? 'active' : r.is_active ? 'scheduled' : 'ended'} label={r.is_live ? 'Live' : r.is_active ? 'Not in dates' : 'Off'} />
                </Td>
                <Td className="text-right">
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name || r.target_label}`}>
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => onEdit(r)}>
                        <Pencil /> Edit
                      </MenuItem>
                      <MenuItem onSelect={() => setToggling(r)}>
                        <Power /> {r.is_active ? 'Switch off' : 'Switch on'}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.is_active ? 'Switch this rule off?' : 'Switch this rule on?'}
        body="It changes the rate for sales from now on. Earnings already recorded keep their rate."
        confirmLabel={toggling?.is_active ? 'Switch off' : 'Switch on'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        loading={save.isPending}
        onConfirm={() => toggle(toggling!)}
      />
    </div>
  )
}

function LegacyRulesNotice() {
  const rules = useCommissionRules('')
  const save = useSaveRule()
  const legacy = rules.data?.filter((rule) => rule.scope !== 'course' && rule.is_active) ?? []
  if (legacy.length === 0) return null
  return (
    <Card>
      <CardHeader title="Existing broader commission rules" description="These older instructor, category or price rules can still affect future sales. Review them before relying on a standard instructor rate." />
      <CardBody className="grid gap-3 text-sm">
        {legacy.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div><p className="font-medium">{rule.name || rule.target_label} · {SCOPE_LABEL[rule.scope]}</p><p className="text-muted">{rule.keeps_pct}% to instructor · {rule.is_live ? 'Applies now' : 'Outside scheduled dates'}</p></div>
            <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate({ id: rule.id, body: { name: rule.name, scope: rule.scope as CommissionRuleIn['scope'], target_id: rule.target_id, instructor_id: rule.instructor_id, band_min_gbp_minor: rule.band_min_gbp_minor, band_max_gbp_minor: rule.band_max_gbp_minor, keeps_pct: rule.keeps_pct, priority: rule.priority, is_active: false, starts_at: rule.starts_at, ends_at: rule.ends_at } }, { onSuccess: () => toast.success('Older rule switched off. Past earnings are unchanged.'), onError: (error) => toast.error((error as Error).message) })}>Switch off</Button>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- instructor commissions
function RateDialog({ row, onClose }: { row: InstructorCommission | null; onClose: () => void }) {
  const save = useSetInstructorKeeps()
  const [value, setValue] = useState('')
  const [key, setKey] = useState('')
  if (row && key !== row.user_id) (setKey(row.user_id), setValue(String(row.keeps_pct)))
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && (onClose(), setKey(''))}>
      <DialogContent title={`Commission for ${row?.name ?? ''}`} description="What this instructor keeps of each marketplace sale. Course and instructor rules still take priority.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value)
            if (!(n >= 0 && n <= 100)) return toast.error('Enter a rate between 0% and 100%.')
            save.mutate({ id: row!.user_id, keeps_pct: n }, { onSuccess: () => (toast.success('Rate saved. The instructor was told.'), onClose(), setKey('')), onError: (err) => toast.error((err as Error).message) })
          }}
        >
          <Field label="Instructor keeps (%)">{(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            {row?.fee_is_custom ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => save.mutate({ id: row.user_id, keeps_pct: null }, { onSuccess: () => (toast.success('Back to the platform default'), onClose(), setKey('')) })}
              >
                Use the default
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save rate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InstructorCommissions({ compact, onBack }: { compact?: boolean; onBack?: () => void }) {
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const [status, setStatus] = useState('')
  const list = useInstructorCommissions(q, status)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const [editing, setEditing] = useState<InstructorCommission | null>(null)
  return (
    <>
      <Toolbar>
        {onBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> Back to overview
          </Button>
        ) : null}
        <SearchBox value={qText} onChange={setQText} label="Search instructors" placeholder="Search instructors" className="sm:max-w-xs" />
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          <option value="approved">Active</option>
          <option value="suspended">Suspended</option>
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={q || status ? <Search /> : <Users />} title={q || status ? 'Nobody matches' : 'No instructors yet'} />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-3 md:hidden">
            {rows.map((r) => (
              <li key={r.user_id}>
                <button type="button" onClick={() => setEditing(r)} className="w-full rounded-lg border border-border p-3.5 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <PersonCell name={r.name} email={r.email} />
                    <span className="font-semibold tabular">{r.rule_keeps_pct ?? r.keeps_pct}%</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {r.courses} courses · {gbp(r.earnings_gbp_minor)} earned{r.pool_share_pct !== null ? ` · ${r.pool_share_pct}% of the pool` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Instructor</Th>
                  <Th className="text-right">Courses</Th>
                  <Th className="text-right">Individual commission</Th>
                  <Th className="text-right">Subscription share</Th>
                  <Th className="text-right">Total earnings</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((r) => (
                  <Tr key={r.user_id}>
                    <Td>
                      <Link to={`/console/instructors?user=${r.user_id}`} className="hover:text-primary">
                        <PersonCell name={r.name} email={r.email} />
                      </Link>
                    </Td>
                    <Td className="text-right tabular">{r.courses}</Td>
                    <Td className="text-right tabular">
                      {r.rule_keeps_pct !== null ? (
                        <span title={`Rule: ${r.rule_name}`}>
                          {r.rule_keeps_pct}% <Badge tone="info">Rule</Badge>
                        </span>
                      ) : (
                        <>
                          {r.keeps_pct}% {r.fee_is_custom ? <Badge tone="info">Own</Badge> : null}
                        </>
                      )}
                    </Td>
                    <Td className="text-right tabular">{r.pool_share_pct === null ? '—' : `${r.pool_share_pct}%`}</Td>
                    <Td className="text-right tabular">{gbp(r.earnings_gbp_minor)}</Td>
                    <Td>
                      <StatusPill status={r.status} label={personStatus(r.status)} />
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Set commission for ${r.name}`}>
                        <Percent /> Set rate
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          {compact ? null : <LoadMore shown={rows.length} noun={rows.length === 1 ? 'instructor' : 'instructors'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />}
        </div>
      )}
      <RateDialog row={editing} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------- preview ("which rate applies?")
function RatePreview() {
  const [course, setCourse] = useState<{ id: string; title: string } | null>(null)
  const [instructorId, setInstructorId] = useState('')
  const instructors = useCourseCommissionInstructors(course?.id ?? '')
  const p = useCommissionPreview(course?.id ?? '', instructorId)
  const source = { rule: 'a commission rule', instructor: "the instructor's own rate", default: 'the platform default' } as Record<string, string>
  return (
    <Card>
      <CardHeader title="Which rate applies?" description="Pick a course and one of its instructors to check the rate on a sale today." />
      <CardBody className="grid gap-3">
        <CommissionCoursePicker value={course} onChange={(value) => { setCourse(value); setInstructorId('') }} />
        {course && instructors.data?.length ? <NativeSelect aria-label="Instructor to check" value={instructorId} onChange={(event) => setInstructorId(event.target.value)}>
          <option value="">Choose an instructor</option>
          {instructors.data.map((instructor) => <option key={instructor.id} value={instructor.id}>{instructor.name}</option>)}
        </NativeSelect> : null}
        {course && instructorId ? (
          p.error ? (
            <p className="text-sm text-danger">{(p.error as Error).message}</p>
          ) : !p.data ? (
            <Skeleton className="h-14" />
          ) : (
            <div className="animate-reveal rounded-lg bg-primary-soft p-3 text-sm text-primary-soft-text">
              <p>
                <strong className="text-lg tabular">{p.data.keeps_pct}%</strong> to {p.data.instructor ?? 'the instructor'} of {gbp(p.data.price_gbp_minor)}, from {source[p.data.source]}
                {p.data.rule_name ? ` (“${p.data.rule_name}”)` : ''}.
              </p>
            </div>
          )
        ) : null}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- settings forms
function SettingsForm({ only }: { only?: 'pool' }) {
  const o = useCommissionOverview()
  const save = useSaveCommissionSettings()
  const [form, setForm] = useState<{ keeps: string; pool: string; coupon: string; discount: boolean } | null>(null)
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  if (!o.data) return <Skeleton className="h-48" />
  const d = o.data
  const f = form ?? { keeps: String(d.default_keeps_pct), pool: String(d.pool_pct), coupon: String(d.coupon_keeps_pct), discount: d.discount_reduces_commission }
  const set = (k: keyof typeof f, v: string | boolean) => setForm({ ...f, [k]: v })
  const num = (s: string) => Number(s)
  const ok = (s: string) => s.trim() !== '' && num(s) >= 0 && num(s) <= 100
  const dirty = !!form
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (![f.keeps, f.pool, f.coupon].every(ok)) return toast.error('Rates must be between 0% and 100%.')
        save.mutate(
          only === 'pool' ? { pool_pct: num(f.pool) } : { default_keeps_pct: num(f.keeps), coupon_keeps_pct: num(f.coupon), discount_reduces_commission: f.discount },
          { onSuccess: () => (toast.success('Saved. It applies to sales from now on.'), setForm(null)), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      {only === 'pool' ? (
        <Field label="Instructors' share of subscription revenue (%)" hint="Split between instructors by the minutes learners watch their courses each month.">
          {(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.pool} onChange={(e) => set('pool', e.target.value)} />}
        </Field>
      ) : (
        <>
          <Field label="Default commission: instructor keeps (%)" hint="Given to instructors when they are approved. Instructors already approved keep their rate.">
            {(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.keeps} onChange={(e) => set('keeps', e.target.value)} />}
          </Field>
          <Field label="Sales through the instructor's own coupon: instructor keeps (%)">{(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.coupon} onChange={(e) => set('coupon', e.target.value)} />}</Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <Label htmlFor="discount-impact">Discounts reduce the instructor's share</Label>
              <p className="mt-0.5 text-xs text-muted">A Promotion changes the customer's checkout price, not the instructor's rate. On: calculate the share from the amount paid. Off: calculate from the original price, capped at the amount paid. Example: £100 course, 20% discount, 70% instructor rate → £56 on, £70 off.</p>
            </div>
            <Switch id="discount-impact" checked={f.discount} onCheckedChange={(v) => set('discount', v)} />
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty} onClick={() => setForm(null)}>
          Discard
        </Button>
        <Button type="submit" disabled={!dirty} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- overview
function Overview({ go }: { go: (t: Tab) => void }) {
  const o = useCommissionOverview()
  const d = o.data
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  return (
    <div className="grid gap-5">
      <section aria-label="Commission figures" className={d ? 'stagger grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 xl:grid-cols-4'}>
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <StatCard label="Default commission" value={`${d.default_keeps_pct}%`} icon={<Percent />} hint="to the instructor" />
            <KpiCard label="Platform commission (this month)" kpi={d.commissions_month} icon={<PieChart />} format={gbp} tone="success" />
            <KpiCard label="Subscription revenue pool" kpi={d.pool_month} icon={<Crown />} format={gbp} tone="info" />
            <StatCard label="Active instructors" value={d.active_instructors} icon={<Users />} tone="warning" hint={`${d.active_rules} active commission rules across all types`} />
          </>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader title="Instructor commissions" action={<Button size="sm" variant="ghost" onClick={() => go('instructors')}>View all</Button>} />
          <InstructorCommissions compact />
        </Card>
        <div className="grid content-start gap-5 lg:col-span-4">
          <Card>
            <CardHeader title="Commission settings" />
            <CardBody className="grid gap-1 p-2">
              {[
                { t: 'settings' as Tab, Icon: Percent, label: 'Default commission rate', hint: "The platform's default for course sales", value: d ? `${d.default_keeps_pct}%` : '' },
                { t: 'pool' as Tab, Icon: Crown, label: 'Subscription revenue pool', hint: 'The share of subscription revenue', value: d ? `${d.pool_pct}%` : '' },
                { t: 'courses' as Tab, Icon: BookOpen, label: 'Course-specific rates', hint: 'Exceptions for individual courses', value: '' },
                { t: 'settings' as Tab, Icon: ListFilter, label: 'Discount impact', hint: 'How discounts affect commissions', value: d ? (d.discount_reduces_commission ? 'Shared' : 'Platform') : '' },
              ].map((x) => (
                <button key={x.label} type="button" onClick={() => go(x.t)} className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4">
                    <x.Icon aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{x.label}</span>
                    <span className="block text-xs text-muted">{x.hint}</span>
                  </span>
                  <span className="text-sm font-semibold tabular">{x.value}</span>
                </button>
              ))}
            </CardBody>
          </Card>
          <Card className="bg-primary-soft/50">
            <CardBody className="flex gap-3 text-sm">
              <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="font-medium">About commissions</p>
                <p className="mt-1 text-muted">Set the default, customise per instructor or course, and share subscription revenue through the pool. Promotions set customer discounts on their own page. Each sale stores its instructor rate, so changes never rewrite past earnings.</p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export function ConsoleCommissionsPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const o = useCommissionOverview()
  return (
    <>
      <PageHeader
        title="Commission management"
        description="Set instructors' earnings from course sales and the personal subscription pool. Customer discounts are managed in Promotions."
        actions={
          <Button onClick={() => setDraft(emptyRule())}>
            <Plus /> Add course rule
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Commission sections" className="mb-5">
          <TabsTrigger value="overview">
            <PieChart /> Overview
          </TabsTrigger>
          <TabsTrigger value="instructors">
            <Users /> Instructor commissions
          </TabsTrigger>
          <TabsTrigger value="courses">
            <BookOpen /> Course commissions
          </TabsTrigger>
          <TabsTrigger value="pool">
            <Crown /> Subscription revenue pool
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-0">
          <Overview go={setTab} />
        </TabsContent>
        <TabsContent value="instructors" className="pt-0">
          <Card>
            <CardHeader title="Instructor commissions" description="Set an instructor’s usual share for future marketplace sales. A course-specific rate can override it." />
            <InstructorCommissions onBack={() => setTab('overview')} />
          </Card>
        </TabsContent>
        <TabsContent value="courses" className="grid gap-5 pt-0 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader
              title="Course commissions"
              description="Set a different share for one course. It overrides that instructor’s normal rate for this course only."
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setTab('overview')}>
                    <ArrowLeft /> Back
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDraft(emptyRule())}>
                    <Plus /> Add course rule
                  </Button>
                </div>
              }
            />
            <CardBody className="border-b border-border bg-surface-2/40 text-sm text-muted">
              Example: an instructor normally keeps 37%. Set SQL for Analysts to 70%, and that instructor keeps 70% on future SQL for Analysts sales only. No learner is selected here.
            </CardBody>
            <RulesList scope="course" addLabel="Add course rule" onEdit={(r) => setDraft(fromRule(r))} onAdd={() => setDraft(emptyRule())} />
          </Card>
          <div className="grid content-start gap-5 lg:col-span-4">
            <RatePreview />
            <LegacyRulesNotice />
          </div>
        </TabsContent>
        <TabsContent value="pool" className="pt-0">
          <div className="grid gap-5 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader title="Subscription revenue pool" description="This is a share of personal subscription revenue, not a percentage of a course price." action={<Button size="sm" variant="ghost" onClick={() => setTab('overview')}><ArrowLeft /> Back</Button>} />
              <CardBody>
                <SettingsForm only="pool" />
              </CardBody>
            </Card>
            <div className="grid content-start gap-5 lg:col-span-5">
              {o.data ? <KpiCard label="Paid to instructors (last settled month)" kpi={o.data.pool_month} icon={<Crown />} format={gbp} tone="info" /> : <Skeleton className="h-[118px]" />}
              <Card>
                <CardHeader title="How the monthly pool is shared" description="A simple example using a £20 personal subscription and a 25% pool." />
                <CardBody className="grid gap-3 text-sm">
                  <div className="rounded-lg bg-surface-2 p-3"><strong>1. Build the pool</strong><p className="mt-1 text-muted">£20 subscription × 25% = £5 for instructors. The remaining £15 belongs to the platform before its operating costs.</p></div>
                  <div className="rounded-lg bg-surface-2 p-3"><strong>2. Measure learning</strong><p className="mt-1 text-muted">At month end, we total recorded learning time on instructor-owned courses watched through the personal plan.</p></div>
                  <div className="rounded-lg bg-surface-2 p-3"><strong>3. Pay by share of learning</strong><p className="mt-1 text-muted">If learners spent 60% of their time in Ahmed’s courses and 40% in Sara’s, Ahmed receives £3 and Sara receives £2 from this subscription’s pool.</p></div>
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="settings" className="pt-0">
          <Card className="max-w-2xl">
            <CardHeader title="Commission settings" description="Client decisions: change them here, never in code." />
            <CardBody>
              <SettingsForm />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
      <RuleDialog draft={draft} onClose={() => setDraft(null)} />
    </>
  )
}
