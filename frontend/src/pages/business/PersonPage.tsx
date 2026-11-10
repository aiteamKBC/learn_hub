import { ArrowLeft, Award, BookOpen, Mail, Trash2, UserX } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePersonCompliance } from '@/features/compliance/api'
import { PersonRequirements } from '@/features/compliance/PersonRequirements'
import { useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { type MemberPatch, ROLE_LABEL, useAssignableRoles, useIsOrgAdmin, useJobRoles, useRemovePerson, useUnits, useUpdatePerson } from '@/features/org/api'
import { CheckList, RoleBadge, SavedTick, UnitPicker } from '@/features/org/ui'
import { shortDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

type PersonData = NonNullable<ReturnType<typeof usePersonCompliance>['data']>

const COURSE_STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  completed: { label: 'Completed', tone: 'success' },
  active: { label: 'In progress', tone: 'info' },
  expired: { label: 'Expired', tone: 'warning' },
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function ProfileForm({ person }: { person: PersonData }) {
  const { org } = useWorkspace()
  const admin = useIsOrgAdmin()
  const assignable = useAssignableRoles()
  const { data: units, isLoading: unitsLoading } = useUnits()
  const { data: roles, isLoading: rolesLoading } = useJobRoles()
  const update = useUpdatePerson()
  const initial = useMemo(
    () => ({ role: person.role, job_title: person.job_title, employee_ref: person.employee_ref, unit_ids: person.units.map((u) => u.id), job_role_ids: person.job_roles.map((r) => r.id) }),
    [person],
  )
  const [form, setForm] = useState(initial)
  const [saved, setSaved] = useState(false)
  useEffect(() => setForm(initial), [initial])

  // only owners change admins and owners (the API refuses anyone else)
  const roleLocked = !admin || (org?.role !== 'owner' && ['admin', 'owner'].includes(person.role))
  const roleOptions = roleLocked ? [person.role] : Array.from(new Set([...assignable, person.role]))

  const body: MemberPatch = {}
  if (form.role !== initial.role) body.role = form.role
  if (form.job_title.trim() !== initial.job_title) body.job_title = form.job_title.trim()
  if (form.employee_ref.trim() !== initial.employee_ref) body.employee_ref = form.employee_ref.trim()
  if (!same(form.unit_ids, initial.unit_ids)) body.unit_ids = form.unit_ids
  if (!same([...form.job_role_ids].sort(), [...initial.job_role_ids].sort())) body.job_role_ids = form.job_role_ids
  const dirty = Object.keys(body).length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!dirty) return
    update.mutate(
      { memberId: person.member_id, body },
      {
        onSuccess: () => {
          toast.success('Profile saved')
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  if (!admin) {
    return (
      <Card>
        <CardHeader title="Profile" description="Only company admins can change these details." />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {[
              ['Role', <RoleBadge key="r" role={person.role} />],
              ['Job title', person.job_title || '–'],
              ['Employee reference', person.employee_ref || '–'],
              ['Joined', shortDate(person.joined_at)],
              ['Units', person.units.map((u) => u.name).join(', ') || '–'],
              ['Job roles', person.job_roles.map((r) => r.name).join(', ') || '–'],
            ].map(([k, v]) => (
              <div key={k as string} className="min-w-0">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-1 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Details" description="Role, job title and reference number" />
        <CardBody className="grid gap-4">
          <Field label="Role" hint={roleLocked ? 'Only an owner can change admins and owners.' : 'Managers see the people in the units they manage. Admins see everything.'}>
            {(p) => (
              <NativeSelect {...p} value={form.role} disabled={roleLocked} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Job title">{(p) => <Input {...p} value={form.job_title} maxLength={120} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />}</Field>
          <Field label="Employee reference" hint="Optional. Your own HR or payroll number.">
            {(p) => <Input {...p} value={form.employee_ref} maxLength={64} onChange={(e) => setForm({ ...form, employee_ref: e.target.value })} />}
          </Field>
          <p className="text-xs text-muted">Joined {shortDate(person.joined_at)}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Where they work" description="Units decide who manages them and which training applies." />
        <CardBody className="grid gap-5">
          <div className="grid gap-1.5">
            <Label>Units</Label>
            <p className="-mt-1 text-[13px] text-muted">The first one you pick is their main unit.</p>
            {unitsLoading || !units ? <Skeleton className="h-40" /> : <UnitPicker units={units} value={form.unit_ids} onChange={(unit_ids) => setForm({ ...form, unit_ids })} />}
          </div>
          <div className="grid gap-1.5">
            <Label>Job roles</Label>
            <CheckList
              label="Job roles"
              loading={rolesLoading}
              items={roles ?? []}
              selected={form.job_role_ids}
              getId={(r) => r.id}
              onToggle={(id, on) => setForm({ ...form, job_role_ids: on ? [...form.job_role_ids, id] : form.job_role_ids.filter((x) => x !== id) })}
              render={(r) => r.name}
              empty="No job roles yet. Add them under Locations & teams."
            />
          </div>
        </CardBody>
      </Card>
      <div className="flex items-center justify-end gap-3 lg:col-span-2">
        {saved ? <SavedTick /> : null}
        <Button type="button" variant="ghost" disabled={!dirty || update.isPending} onClick={() => setForm(initial)}>
          Undo changes
        </Button>
        <Button type="submit" disabled={!dirty} loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

function Training({ person, focus }: { person: PersonData; focus?: string }) {
  return (
    <div className="grid gap-6">
      <PersonRequirements memberId={person.member_id} focusRequirementId={focus} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Courses" description="Everything they are enrolled on through the company" />
          <CardBody>
            {person.courses.length === 0 ? (
              <EmptyState className="py-6" icon={<BookOpen />} title="No courses yet" body="Assign training and it shows up here." />
            ) : (
              <ul className="stagger grid gap-4">
                {person.courses.map((c, i) => {
                  const s = COURSE_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }
                  return (
                    <li key={`${c.course_title}-${i}`}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium">{c.course_title}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <Progress value={c.progress_pct} tone={c.status === 'completed' ? 'success' : 'primary'} label={`${c.course_title}: ${Math.round(c.progress_pct)}% done`} />
                      <p className="mt-1 text-xs text-muted">
                        {Math.round(c.progress_pct)}% · {c.completed_at ? `finished ${shortDate(c.completed_at)}` : `started ${shortDate(c.enrolled_at)}`}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Certificates" description="Earned inside the company" />
          <CardBody>
            {person.certificates.length === 0 ? (
              <EmptyState className="py-6" icon={<Award />} title="No certificates yet" body="They appear when a course is finished." />
            ) : (
              <ul className="stagger grid gap-2">
                {person.certificates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
                      <Award className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.course_title}</p>
                      <p className="text-xs text-muted">Issued {shortDate(c.issued_at)}</p>
                    </div>
                    <Button variant="link" size="sm" asChild>
                      <Link to={`/verify/${c.code}`}>Verify</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function RemoveButton({ person }: { person: PersonData }) {
  const navigate = useNavigate()
  const remove = useRemovePerson()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" className="text-danger" onClick={() => setOpen(true)}>
        <UserX /> Remove from company
      </Button>
      <DialogContent title={`Remove ${person.name || person.email}?`} description="They lose access to the company's training straight away. Their records stay for your audits.">
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(person.member_id, {
                onSuccess: () => {
                  toast.success(`${person.name || person.email} was removed`)
                  setOpen(false)
                  navigate('/business/people', { replace: true })
                },
                onError: (e) => toast.error((e as Error).message),
              })
            }
          >
            <Trash2 /> Remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PersonPage() {
  const { memberId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { org } = useWorkspace()
  const admin = useIsOrgAdmin()
  const { data: person, isLoading, error, refetch } = usePersonCompliance(memberId)
  const focus = params.get('requirement') ?? undefined
  const tab = params.get('tab') ?? (focus ? 'training' : 'profile')
  const { data: me } = useMe()
  // the API refuses removing yourself, so don't offer it
  const isSelf = !!me && !!person && me.email.toLowerCase() === person.email.toLowerCase()
  const canRemove = admin && person && !isSelf && (org?.role === 'owner' || !['admin', 'owner'].includes(person.role))

  const back = (
    <Link to="/business/people" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
      <ArrowLeft className="size-4" /> People
    </Link>
  )

  if (error) {
    return (
      <>
        <PageHeader title="Person" back={back} />
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </Card>
      </>
    )
  }

  if (isLoading || !person) {
    return (
      <>
        {back}
        <div className="mb-6 flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="mb-5 h-10 w-64" />
        <Skeleton className="h-96 rounded-lg" />
      </>
    )
  }

  return (
    <div className="animate-reveal">
      <PageHeader
        back={back}
        title={
          <span className="flex min-w-0 items-center gap-4">
            <Avatar name={person.name || person.email} size="lg" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate">{person.name || person.email}</span>
                <RoleBadge role={person.role} />
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal tracking-normal text-muted">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" /> <span className="truncate">{person.email}</span>
                </span>
                {person.job_title ? <span>{person.job_title}</span> : null}
                {person.units[0] ? <span>{person.units[0].name}</span> : null}
              </span>
            </span>
          </span>
        }
        actions={canRemove ? <RemoveButton person={person} /> : null}
      />
      <Tabs value={tab} onValueChange={(v) =>
          setParams(
            (p) => {
              const next = new URLSearchParams(p)
              next.set('tab', v)
              return next
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileForm person={person} />
        </TabsContent>
        <TabsContent value="training">
          <Training person={person} focus={focus} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
