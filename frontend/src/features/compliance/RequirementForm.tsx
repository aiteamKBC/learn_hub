import { BellRing, BookOpen, CalendarRange, Plus, Users, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox, Switch } from '@/components/ui/switch'
import { unitLevel, useJobRoles, useLibrary, useUnits } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { type Requirement, type TargetInput, useCreateRequirement, useUpdateRequirement } from './api'

type Scope = 'company' | 'units' | 'roles' | 'mixed'
const SCOPES = [
  ['company', 'Everyone'],
  ['units', 'Locations and teams'],
  ['roles', 'Job roles'],
] as const

function scopeOf(r?: Requirement): Scope {
  if (!r || !r.targets.length) return 'company'
  if (r.targets.every((t) => !t.unit_id && !t.job_role_id)) return 'company'
  if (r.targets.every((t) => t.unit_id && !t.job_role_id)) return 'units'
  if (r.targets.every((t) => t.job_role_id && !t.unit_id)) return 'roles'
  return 'mixed'
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-b border-border px-4 py-5 last:border-b-0">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-primary">
        {icon} {title}
      </p>
      {children}
    </fieldset>
  )
}

const int = (s: string) => (s.trim() === '' ? NaN : Number(s))
const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi

/**
 * Create or edit a requirement: course, schedule, reminders and who it applies to.
 * Rendered inside a right-hand sheet; `onDone` closes it.
 */
export function RequirementForm({ requirement, onDone }: { requirement?: Requirement; onDone: () => void }) {
  const editing = !!requirement
  const library = useLibrary()
  const units = useUnits()
  const roles = useJobRoles()
  const create = useCreateRequirement()
  const update = useUpdateRequirement()

  const [courseId, setCourseId] = useState(requirement?.course_id ?? '')
  const [name, setName] = useState(requirement?.name ?? '')
  const [description, setDescription] = useState(requirement?.description ?? '')
  const [dueDays, setDueDays] = useState(String(requirement?.due_days ?? 30))
  const [renews, setRenews] = useState(requirement ? requirement.renewal_months != null : false)
  const [renewal, setRenewal] = useState(String(requirement?.renewal_months ?? 12))
  const [soonDays, setSoonDays] = useState(String(requirement?.expiring_soon_days ?? 30))
  const [reminders, setReminders] = useState<number[]>(requirement?.reminder_days ?? [14, 3])
  const [newReminder, setNewReminder] = useState('')
  const [overdueEvery, setOverdueEvery] = useState(String(requirement?.overdue_every_days ?? 7))
  const [scope, setScope] = useState<Scope>(scopeOf(requirement))
  const [unitIds, setUnitIds] = useState<string[]>(() => requirement?.targets.filter((t) => t.unit_id && !t.job_role_id).map((t) => t.unit_id!) ?? [])
  const [roleIds, setRoleIds] = useState<string[]>(() => requirement?.targets.filter((t) => t.job_role_id && !t.unit_id).map((t) => t.job_role_id!) ?? [])
  const [subunits, setSubunits] = useState(requirement?.targets.find((t) => t.unit_id)?.include_subunits ?? true)
  const [targetsTouched, setTargetsTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const touchTargets = () => setTargetsTouched(true)
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const addReminder = () => {
    const n = int(newReminder)
    if (!inRange(n, 1, 365)) return setErrors((e) => ({ ...e, reminder: 'Enter a number of days from 1 to 365.' }))
    if (reminders.length >= 8) return setErrors((e) => ({ ...e, reminder: 'You can set up to 8 reminders.' }))
    setErrors((e) => ({ ...e, reminder: undefined }))
    setReminders((r) => [...new Set([...r, n])].sort((a, b) => b - a))
    setNewReminder('')
  }

  const targets = (): TargetInput[] =>
    scope === 'units'
      ? unitIds.map((id) => ({ unit_id: id, job_role_id: null, include_subunits: subunits }))
      : scope === 'roles'
        ? roleIds.map((id) => ({ unit_id: null, job_role_id: id, include_subunits: true }))
        : [{ unit_id: null, job_role_id: null, include_subunits: true }]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string | undefined> = {
      course: !editing && !courseId ? 'Choose a course.' : undefined,
      name: name.trim().length < 2 ? 'Give it a name (at least 2 characters).' : undefined,
      dueDays: inRange(int(dueDays), 0, 365) ? undefined : 'Enter 0 to 365 days.',
      renewal: renews && !inRange(int(renewal), 1, 120) ? 'Enter 1 to 120 months.' : undefined,
      soonDays: inRange(int(soonDays), 1, 180) ? undefined : 'Enter 1 to 180 days.',
      overdueEvery: inRange(int(overdueEvery), 0, 90) ? undefined : 'Enter 0 to 90 days.',
      targets: scope === 'units' && !unitIds.length ? 'Choose at least one location or team.' : scope === 'roles' && !roleIds.length ? 'Choose at least one job role.' : undefined,
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    const common = {
      name: name.trim(),
      description: description.trim(),
      due_days: int(dueDays),
      renewal_months: renews ? int(renewal) : null,
      expiring_soon_days: int(soonDays),
      reminder_days: reminders,
      overdue_every_days: int(overdueEvery),
    }
    const opts = { onSuccess: () => (toast.success(editing ? 'Requirement saved' : 'Requirement created. Statuses update in a moment.'), onDone()), onError: (err: Error) => toast.error(err.message) }
    if (editing) update.mutate({ id: requirement.id, body: { ...common, ...(targetsTouched && scope !== 'mixed' ? { targets: targets() } : {}) } }, opts)
    else create.mutate({ ...common, course_id: courseId, targets: targets() }, opts)
  }

  const pending = create.isPending || update.isPending

  return (
    <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
      <Section icon={<BookOpen />} title="Course">
        {editing ? (
          <div className="grid gap-1.5">
            <Label>Course</Label>
            <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-sm">{requirement.course_title}</p>
            <p className="text-[13px] text-muted">To require a different course, archive this one and create a new requirement.</p>
          </div>
        ) : library.isLoading ? (
          <Skeleton className="h-10" />
        ) : (
          <Field label="Course" error={errors.course} hint={library.data?.length ? undefined : 'Your company library is empty.'}>
            {(p) => (
              <NativeSelect
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value)
                  const title = library.data?.find((c) => c.id === e.target.value)?.title
                  if (title && !name.trim()) setName(title)
                }}
                {...p}
              >
                <option value="">Choose a course…</option>
                {library.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
        <Field label="Name" error={errors.name} hint="What people and managers will see, for example “Fire safety”.">
          {(p) => <Input maxLength={160} value={name} onChange={(e) => setName(e.target.value)} {...p} />}
        </Field>
        <Field label="Description (optional)">{(p) => <Textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" {...p} />}</Field>
      </Section>

      <Section icon={<CalendarRange />} title="Schedule">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due within (days)" error={errors.dueDays} hint="Counted from when it first applies.">
            {(p) => <Input type="number" inputMode="numeric" min={0} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} {...p} />}
          </Field>
          <Field label="Expiring soon (days before)" error={errors.soonDays}>
            {(p) => <Input type="number" inputMode="numeric" min={1} max={180} value={soonDays} onChange={(e) => setSoonDays(e.target.value)} {...p} />}
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
          <label htmlFor="req-renews" className="text-sm">
            <span className="font-medium">Needs renewing</span>
            <span className="block text-[13px] text-muted">{renews ? 'People retake it after the period below.' : 'Done once, never expires.'}</span>
          </label>
          <Switch id="req-renews" checked={renews} onCheckedChange={setRenews} />
        </div>
        {renews ? (
          <Field label="Renew every (months)" error={errors.renewal}>
            {(p) => <Input type="number" inputMode="numeric" min={1} max={120} value={renewal} onChange={(e) => setRenewal(e.target.value)} {...p} />}
          </Field>
        ) : null}
      </Section>

      <Section icon={<BellRing />} title="Reminders">
        <div className="grid gap-2">
          <Label htmlFor="req-reminder">Remind people this many days before the due date</Label>
          <ul className="flex flex-wrap gap-2" aria-label="Reminder days">
            {reminders.length === 0 ? <li className="text-[13px] text-muted">No reminders before the due date.</li> : null}
            {reminders.map((d) => (
              <li key={d} className="animate-reveal inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-xs font-medium text-primary-soft-text">
                {d} {d === 1 ? 'day' : 'days'}
                <button type="button" onClick={() => setReminders((r) => r.filter((x) => x !== d))} className="rounded-full p-0.5 hover:bg-primary/15" aria-label={`Remove the reminder ${d} days before`}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              id="req-reminder"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              placeholder="Days"
              className="w-28"
              value={newReminder}
              aria-invalid={errors.reminder ? true : undefined}
              aria-describedby={errors.reminder ? 'req-reminder-err' : undefined}
              onChange={(e) => setNewReminder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addReminder()
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addReminder}>
              <Plus /> Add
            </Button>
          </div>
          {errors.reminder ? (
            <p id="req-reminder-err" className="text-[13px] text-danger">
              {errors.reminder}
            </p>
          ) : null}
        </div>
        <Field label="When overdue, remind again every (days)" error={errors.overdueEvery} hint="Set to 0 for no reminders once overdue.">
          {(p) => <Input type="number" inputMode="numeric" min={0} max={90} value={overdueEvery} onChange={(e) => setOverdueEvery(e.target.value)} {...p} />}
        </Field>
      </Section>

      <Section icon={<Users />} title="Who it applies to">
        <div role="radiogroup" aria-label="Who it applies to" className="grid gap-2 sm:grid-cols-3">
          {SCOPES.map(([value, label], i) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              tabIndex={radioTabIndex(i, SCOPES.findIndex(([v]) => v === scope))}
              onKeyDown={(e) => radioKeyDown(e, i, SCOPES.length, (j) => (setScope(SCOPES[j][0]), touchTargets()))}
              onClick={() => (setScope(value), touchTargets())}
              className={cn('rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-150', scope === value ? 'border-primary bg-primary-soft text-primary-soft-text' : 'border-border hover:bg-surface-2')}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === 'mixed' && requirement ? (
          <p className="text-[13px] text-muted">
            This requirement uses combined rules ({requirement.targets.map((t) => [t.unit_name, t.job_role_name].filter(Boolean).join(' + ')).join(', ')}). They stay as they are unless you choose an option above.
          </p>
        ) : null}
        {scope === 'company' ? <p className="text-[13px] text-muted">Everyone in the company, including people who join later.</p> : null}
        {scope === 'units' ? (
          <>
            <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-md border border-border p-2" aria-label="Locations and teams">
              {units.isLoading ? <Skeleton className="h-8" /> : null}
              {units.data?.map((u) => (
                <li key={u.id} style={{ paddingLeft: `${unitLevel(u, units.data!) * 14}px` }}>
                  <label className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                    <Checkbox checked={unitIds.includes(u.id)} onCheckedChange={() => (setUnitIds((l) => toggle(l, u.id)), touchTargets())} />
                    <span className="truncate">{u.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Include the teams inside them</span>
              <Switch checked={subunits} onCheckedChange={(v) => (setSubunits(v), touchTargets())} />
            </label>
          </>
        ) : null}
        {scope === 'roles' ? (
          roles.data?.length === 0 ? (
            <p className="text-[13px] text-muted">No job roles yet. Add them under Locations and teams.</p>
          ) : (
            <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-md border border-border p-2" aria-label="Job roles">
              {roles.isLoading ? <Skeleton className="h-8" /> : null}
              {roles.data?.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                    <Checkbox checked={roleIds.includes(r.id)} onCheckedChange={() => (setRoleIds((l) => toggle(l, r.id)), touchTargets())} />
                    <span className="truncate">{r.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {errors.targets ? (
          <p className="text-[13px] text-danger" role="alert">
            {errors.targets}
          </p>
        ) : null}
        {units.data && scope === 'units' && unitIds.length ? (
          <p className="text-xs text-muted">
            Chosen: {units.data.filter((u) => unitIds.includes(u.id)).map((u) => u.name).join(', ')}
          </p>
        ) : null}
      </Section>

      <div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t border-border bg-surface px-4 py-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {editing ? 'Save changes' : 'Create requirement'}
        </Button>
      </div>
    </form>
  )
}
