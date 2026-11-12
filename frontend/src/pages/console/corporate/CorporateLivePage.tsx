import { CalendarPlus, CheckCircle2, GraduationCap, Inbox, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/misc'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCompanies } from '@/features/console/companies'
import { Toolbar, dateTime, day } from '@/features/console/money-ui'
import { useStudents } from '@/features/console/people'
import { ConfirmDialog, DetailSheet, InfoRow, useParam, useTabParam } from '@/features/console/ui'
import { BOOKING_STATUS, MODE_LABEL, REQUEST_STATUS } from '@/features/corporate/api'
import {
  COHORT_STATUS,
  type CnCohort,
  type CnRequest,
  TUTOR_STATUS,
  useCnAddCompany,
  useCnAddSession,
  useCnAssignTutor,
  useCnCancelSession,
  useCnCohortAttendees,
  useCnCohortCompanies,
  useCnCohorts,
  useCnConfirmCohort,
  useCnCreateCohort,
  useCnCreateTutor,
  useCnOfferings,
  useCnRemoveCompany,
  useCnRequests,
  useCnSessions,
  useCnTutorAction,
  useCnTutors,
  useCnUpdateRequest,
} from '@/features/corporate/console'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useDebounced } from '@/features/org/ui'

const TABS = ['requests', 'groups', 'tutors'] as const
type Tab = (typeof TABS)[number]
const err = (e: unknown) => toast.error((e as Error).message)
const OPEN_COHORT = ['forming', 'confirmed']

// ---------------------------------------------------------------- requests

function PlaceRequest({ r, onClose }: { r: CnRequest; onClose: () => void }) {
  const cohorts = useCnCohorts('')
  const options = (cohorts.data ?? []).filter((c) => c.course_id === r.course_id && OPEN_COHORT.includes(c.status))
  const [cohortId, setCohortId] = useState('')
  const [seats, setSeats] = useState(r.requested_seats)
  const add = useCnAddCompany(cohortId)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Place ${r.org_name}`} description={`${r.course_title} · asked for ${r.requested_seats}`}>
        <div className="grid gap-4">
          <Field label="Group" hint={options.length ? undefined : 'No open group for this course. Create one on the Groups tab.'}>
            {(p) => (
              <NativeSelect {...p} value={cohortId} onChange={(e) => setCohortId(e.target.value)} disabled={!options.length}>
                <option value="">Choose a group…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || c.intake || 'Group'} · {c.current_seats}/{c.max_learners} places
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Places">{(p) => <Input {...p} type="number" min={1} value={seats} onChange={(e) => setSeats(parseInt(e.target.value, 10) || 0)} className="w-28" />}</Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={!cohortId || seats < 1}
              loading={add.isPending}
              onClick={() => add.mutate({ org_id: r.org_id, seats, training_request_id: r.id }, { onSuccess: () => (toast.success('Company placed in the group'), onClose()), onError: err })}
            >
              Place
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Requests() {
  const [status, setStatus] = useState('')
  const q = useCnRequests(status)
  const update = useCnUpdateRequest()
  const [placing, setPlacing] = useState<CnRequest | null>(null)
  return (
    <Card>
      <CardHeader title="Training requests" description="What companies have asked for. Group them, then confirm the dates." />
      <Toolbar>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {['submitted', 'under_review', 'scheduling', 'offered', 'declined', 'cancelled'].map((k) => (
            <option key={k} value={k}>
              {REQUEST_STATUS[k]!.label}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <Inbox />, title: 'No requests' }}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th className="hidden md:table-cell">Course</Th>
                <Th className="text-right">People</Th>
                <Th className="hidden lg:table-cell">Wishes</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <span className="block max-w-[12rem] truncate font-medium">{r.org_name}</span>
                    <span className="block text-xs text-muted">{day(r.created_at)}</span>
                  </Td>
                  <Td className="hidden max-w-[14rem] truncate md:table-cell">{r.course_title}</Td>
                  <Td className="text-right tabular-nums">{r.requested_seats}</Td>
                  <Td className="hidden text-muted lg:table-cell">{[r.preferred_intake, MODE_LABEL[r.preferred_delivery_mode]].filter(Boolean).join(' · ') || 'None'}</Td>
                  <Td>
                    <StatusBadge map={REQUEST_STATUS} status={r.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {r.status === 'submitted' ? (
                      <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: r.id, status: 'under_review', status_label: 'Under review' }, { onSuccess: () => toast.success('Marked as under review'), onError: err })}>
                        Review
                      </Button>
                    ) : null}
                    {['submitted', 'under_review'].includes(r.status) ? (
                      <Button variant="soft" size="sm" onClick={() => setPlacing(r)}>
                        Place
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBlock>
      {placing ? <PlaceRequest r={placing} onClose={() => setPlacing(null)} /> : null}
    </Card>
  )
}

// ---------------------------------------------------------------- group detail

function Companies({ c }: { c: CnCohort }) {
  const q = useCnCohortCompanies(c.id)
  const remove = useCnRemoveCompany(c.id)
  const [cq, setCq] = useState('')
  const orgs = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const [seats, setSeats] = useState(1)
  const add = useCnAddCompany(c.id)
  const [removing, setRemoving] = useState<string | null>(null)
  return (
    <section className="grid gap-3" aria-labelledby="co-h">
      <h3 id="co-h" className="text-sm font-semibold">
        Companies ({c.current_seats}/{c.max_learners} places)
      </h3>
      <QueryBlock query={q} rows={2} empty={{ icon: <Users />, title: 'No companies yet' }}>
        {(rows) => (
          <ul className="grid gap-1.5">
            {rows.map((cc) => (
              <li key={cc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{cc.org_name}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted">{cc.approved_seats} places</span>
                  <StatusBadge map={BOOKING_STATUS} status={cc.status} />
                  {cc.payment_deadline ? <span className="text-xs text-muted">pay by {day(cc.payment_deadline)}</span> : null}
                  {OPEN_COHORT.includes(c.status) && !['paid', 'active'].includes(cc.status) ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${cc.org_name}`} onClick={() => setRemoving(cc.org_id)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryBlock>
      {OPEN_COHORT.includes(c.status) ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_80px_auto] sm:items-end">
          <Field label="Find company">{(p) => <Input {...p} value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
          <Field label="Company">
            {(p) => (
              <NativeSelect {...p} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">Choose…</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Places">{(p) => <Input {...p} type="number" min={1} value={seats} onChange={(e) => setSeats(parseInt(e.target.value, 10) || 0)} />}</Field>
          <Button variant="secondary" disabled={!orgId || seats < 1} loading={add.isPending} onClick={() => add.mutate({ org_id: orgId, seats }, { onSuccess: () => (toast.success('Company added'), setOrgId('')), onError: err })}>
            <Plus /> Add
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this company from the group?"
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(removing!, { onSuccess: () => (toast.success('Company removed'), setRemoving(null)), onError: err })}
      />
    </section>
  )
}

function Sessions({ c }: { c: CnCohort }) {
  const q = useCnSessions(c.id)
  const add = useCnAddSession(c.id)
  const cancel = useCnCancelSession()
  const [when, setWhen] = useState('')
  const [mins, setMins] = useState(90)
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const next = (q.data?.reduce((m, s) => Math.max(m, s.sequence), 0) ?? 0) + 1
  const save = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      { sequence: next, scheduled_at: new Date(when).toISOString(), duration_min: mins, title, location, delivery_mode: null },
      { onSuccess: () => (toast.success('Session added'), setWhen(''), setTitle('')), onError: err },
    )
  }
  return (
    <section className="grid gap-3" aria-labelledby="se-h">
      <h3 id="se-h" className="text-sm font-semibold">
        Sessions
      </h3>
      <QueryBlock query={q} rows={2} empty={{ icon: <CalendarPlus />, title: 'No sessions yet', body: 'Add at least one before confirming.' }}>
        {(rows) => (
          <ol className="grid gap-1.5">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">
                    {s.sequence}. {s.title || `Session ${s.sequence}`}
                  </span>
                  <span className="block text-xs text-muted">
                    {dateTime(s.scheduled_at)} · {s.duration_min} min · {MODE_LABEL[s.delivery_mode] ?? s.delivery_mode}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={s.status === 'cancelled' ? 'neutral' : s.status === 'completed' ? 'success' : 'info'}>{s.status}</Badge>
                  {s.status === 'scheduled' ? (
                    <Button variant="ghost" size="sm" loading={cancel.isPending && cancel.variables === s.id} onClick={() => cancel.mutate(s.id, { onSuccess: () => toast.success('Session cancelled'), onError: err })}>
                      Cancel
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </QueryBlock>
      {OPEN_COHORT.includes(c.status) ? (
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />}</Field>
          <Field label="Length (minutes)">{(p) => <Input {...p} type="number" min={15} value={mins} onChange={(e) => setMins(parseInt(e.target.value, 10) || 0)} required />}</Field>
          <Field label="Title (optional)">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Place (in person)">{(p) => <Input {...p} value={location} onChange={(e) => setLocation(e.target.value)} />}</Field>
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!when || mins < 15} className="sm:col-span-2 sm:justify-self-start">
            <CalendarPlus /> Add session {next}
          </Button>
        </form>
      ) : null}
    </section>
  )
}

function TutorAndPeople({ c }: { c: CnCohort }) {
  const tutors = useCnTutors('approved')
  const assign = useCnAssignTutor()
  const people = useCnCohortAttendees(c.id)
  const [tutorId, setTutorId] = useState('')
  return (
    <>
      <section className="grid gap-2" aria-labelledby="tu-h">
        <h3 id="tu-h" className="text-sm font-semibold">
          Tutor
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Assign an approved tutor">
            {(p) => (
              <NativeSelect {...p} value={tutorId} onChange={(e) => setTutorId(e.target.value)} className="w-64">
                <option value="">Choose…</option>
                {tutors.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user_name || t.user_email}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Button variant="secondary" disabled={!tutorId} loading={assign.isPending} onClick={() => assign.mutate({ tutorId, cohortId: c.id }, { onSuccess: () => toast.success('Tutor assigned'), onError: err })}>
            Assign
          </Button>
        </div>
      </section>
      <section className="grid gap-2" aria-labelledby="pe-h">
        <h3 id="pe-h" className="text-sm font-semibold">
          Named attendees
        </h3>
        <QueryBlock query={people} rows={2} empty={{ icon: <Users />, title: 'Nobody named yet', body: 'Companies name their people after paying.' }}>
          {(rows) => (
            <ul className="grid gap-1 text-sm">
              {rows.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="truncate">{a.user_name}</span>
                  <span className="truncate text-muted">{a.org_name}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryBlock>
      </section>
    </>
  )
}

function ConfirmGroup({ c }: { c: CnCohort }) {
  const confirm = useCnConfirmCohort()
  const [open, setOpen] = useState(false)
  const [deadline, setDeadline] = useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <CheckCircle2 /> Confirm dates
      </Button>
      <DialogContent title="Confirm the dates?" description="Each company in the group is asked to pay by the deadline. The dates are then fixed.">
        <div className="grid gap-4">
          <Field label="Payment deadline">{(p) => <Input {...p} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />}</Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={!deadline}
              loading={confirm.isPending}
              onClick={() => confirm.mutate({ id: c.id, payment_deadline: new Date(deadline).toISOString() }, { onSuccess: () => (toast.success('Dates confirmed. Companies can now pay.'), setOpen(false)), onError: err })}
            >
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GroupDetail({ c, onClose }: { c: CnCohort; onClose: () => void }) {
  return (
    <DetailSheet open onOpenChange={(o) => !o && onClose()} title={c.title || c.course_title} description={c.course_title}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <StatusBadge map={COHORT_STATUS} status={c.status} />
            <Badge tone="outline">{MODE_LABEL[c.delivery_mode] ?? c.delivery_mode}</Badge>
          </div>
          {c.status === 'forming' ? <ConfirmGroup c={c} /> : null}
        </div>
        <div className="grid gap-1 text-sm">
          <InfoRow label="Intake">{c.intake || 'None'}</InfoRow>
          <InfoRow label="Size">
            {c.min_learners} to {c.max_learners} people
          </InfoRow>
          {c.notes ? <InfoRow label="Notes">{c.notes}</InfoRow> : null}
        </div>
        <Companies c={c} />
        <Sessions c={c} />
        <TutorAndPeople c={c} />
      </div>
    </DetailSheet>
  )
}

function NewGroup({ onClose }: { onClose: () => void }) {
  const offerings = useCnOfferings()
  const live = (offerings.data ?? []).filter((o) => o.delivery_type === 'live')
  const create = useCnCreateCohort()
  const [courseId, setCourseId] = useState('')
  const [mode, setMode] = useState('online')
  const [min, setMin] = useState(1)
  const [max, setMax] = useState(20)
  const [intake, setIntake] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const save = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({ course_id: courseId, delivery_mode: mode, min_learners: min, max_learners: max, intake, title, notes }, { onSuccess: () => (toast.success('Group created'), onClose()), onError: err })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New live group" description="Companies from several organisations can share one group.">
        <form onSubmit={save} className="grid gap-4">
          <Field label="Course" hint={live.length ? undefined : 'Create a live package first.'}>
            {(p) => (
              <NativeSelect {...p} value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
                <option value="">Choose…</option>
                {live.map((o) => (
                  <option key={o.id} value={o.course_id}>
                    {o.course_title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Format">
              {(p) => (
                <NativeSelect {...p} value={mode} onChange={(e) => setMode(e.target.value)}>
                  {Object.entries(MODE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Fewest people">{(p) => <Input {...p} type="number" min={1} value={min} onChange={(e) => setMin(parseInt(e.target.value, 10) || 0)} />}</Field>
            <Field label="Most people">{(p) => <Input {...p} type="number" min={1} value={max} onChange={(e) => setMax(parseInt(e.target.value, 10) || 0)} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intake (optional)">{(p) => <Input {...p} value={intake} onChange={(e) => setIntake(e.target.value)} maxLength={50} />}</Field>
            <Field label="Name (optional)">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field>
          </div>
          <Field label="Notes (staff only)">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!courseId || min < 1 || max < min}>
              Create group
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Groups() {
  const [status, setStatus] = useState('')
  const q = useCnCohorts(status)
  const [openId, setOpenId] = useParam('group')
  const [creating, setCreating] = useState(false)
  const open = q.data?.find((c) => c.id === openId)
  return (
    <Card>
      <CardHeader title="Live groups" description="Form a group, add sessions and a tutor, then confirm the dates." action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New group</Button>} />
      <Toolbar>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {Object.entries(COHORT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <Users />, title: 'No groups yet' }}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th className="hidden md:table-cell">Format</Th>
                <Th className="text-right">Places</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((c) => (
                <Tr key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <Td>
                    <button type="button" className="block max-w-[16rem] truncate text-left font-medium hover:underline" onClick={() => setOpenId(c.id)}>
                      {c.course_title}
                    </button>
                    <span className="block text-xs text-muted">{c.title || c.intake || day(c.created_at)}</span>
                  </Td>
                  <Td className="hidden md:table-cell">{MODE_LABEL[c.delivery_mode] ?? c.delivery_mode}</Td>
                  <Td className="text-right tabular-nums">
                    {c.current_seats}/{c.max_learners}
                  </Td>
                  <Td>
                    <StatusBadge map={COHORT_STATUS} status={c.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBlock>
      {open ? <GroupDetail c={open} onClose={() => setOpenId('')} /> : null}
      {creating ? <NewGroup onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}

// ---------------------------------------------------------------- tutors

function NewTutor({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const people = useStudents({ q: useDebounced(q) })
  const create = useCnCreateTutor()
  const [userId, setUserId] = useState('')
  const [type, setType] = useState('internal')
  const [bio, setBio] = useState('')
  const [topics, setTopics] = useState('')
  const list = people.data?.pages.flatMap((p) => p.items).slice(0, 20) ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a tutor" description="New tutors wait for approval before they can be assigned.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              { user_id: userId, type, bio, specializations: topics.split(',').map((t) => t.trim()).filter(Boolean) },
              { onSuccess: () => (toast.success('Tutor added'), onClose()), onError: err },
            )
          }}
          className="grid gap-4"
        >
          <Field label="Find the person">{(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />}</Field>
          <Field label="Person">
            {(p) => (
              <NativeSelect {...p} value={userId} onChange={(e) => setUserId(e.target.value)} required>
                <option value="">Choose…</option>
                {list.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email} ({u.email})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Type">
            {(p) => (
              <NativeSelect {...p} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="internal">Our staff</option>
                <option value="external">External tutor</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="Topics (comma separated)">{(p) => <Input {...p} value={topics} onChange={(e) => setTopics(e.target.value)} />}</Field>
          <Field label="About (optional)">{(p) => <Textarea {...p} value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!userId}>
              Add tutor
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Tutors() {
  const q = useCnTutors()
  const act = useCnTutorAction()
  const [creating, setCreating] = useState(false)
  return (
    <Card>
      <CardHeader title="Tutors" description="Only approved tutors can lead a group." action={<Button size="sm" onClick={() => setCreating(true)}><UserPlus /> Add tutor</Button>} />
      <div className="mt-3">
        <QueryBlock query={q} empty={{ icon: <GraduationCap />, title: 'No tutors yet' }}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <Th>Tutor</Th>
                  <Th className="hidden md:table-cell">Type</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <span className="block max-w-[14rem] truncate font-medium">{t.user_name || t.user_email}</span>
                      <span className="block max-w-[14rem] truncate text-xs text-muted">{(t.specializations as string[]).join(', ') || t.user_email}</span>
                    </Td>
                    <Td className="hidden md:table-cell">{t.type === 'internal' ? 'Our staff' : 'External'}</Td>
                    <Td>
                      <StatusBadge map={TUTOR_STATUS} status={t.status} />
                    </Td>
                    <Td className="text-right">
                      {t.status !== 'approved' ? (
                        <Button size="sm" variant="soft" onClick={() => act.mutate({ id: t.id, action: 'approve' }, { onSuccess: () => toast.success('Tutor approved'), onError: err })}>
                          Approve
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'suspend' }, { onSuccess: () => toast.success('Tutor suspended'), onError: err })}>
                          Suspend
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryBlock>
      </div>
      {creating ? <NewTutor onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}

export function ConsoleCorporateLivePage() {
  const [tab, setTab] = useTabParam(TABS, 'requests')
  useEffect(() => {
    document.title = 'Live training · Console · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Live training" description="Company requests, live groups, sessions and tutors." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Live training sections">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="tutors">Tutors</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-5">
          <Requests />
        </TabsContent>
        <TabsContent value="groups" className="mt-5">
          <Groups />
        </TabsContent>
        <TabsContent value="tutors" className="mt-5">
          <Tutors />
        </TabsContent>
      </Tabs>
    </>
  )
}
