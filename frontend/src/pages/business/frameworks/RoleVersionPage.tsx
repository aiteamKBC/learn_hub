import { CheckCircle2, ClipboardList, GaugeCircle, Plus, Save, Send, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import {
  KIND_LABEL,
  REQUIREMENT_KIND_OPTIONS,
  PRIORITY_OPTIONS,
  PRIORITY_TONE,
  type Version,
  VERSION_STATUS,
  useAddRequirement,
  useCompetencies,
  useUpdateVersion,
  useVersion,
  useVersionTransition,
} from '@/features/frameworks/api'
import { useQualifications } from '@/features/hcm/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function QualPicker({ label, ids, all, onToggle }: { label: string; ids: string[]; all: { id: string; name: string }[]; onToggle: (id: string, on: boolean) => void }) {
  if (!all.length) return null
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="grid gap-1.5 rounded-md border border-border p-3 sm:grid-cols-2">
        {all.map((q) => (
          <label key={q.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={ids.includes(q.id)} onChange={(e) => onToggle(q.id, e.target.checked)} />
            <span className="truncate">{q.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function DraftForm({ version, onDirtyChange }: { version: Version; onDirtyChange: (dirty: boolean) => void }) {
  const save = useUpdateVersion(version.id)
  const quals = useQualifications()
  const active = quals.data?.filter((q) => !q.archived) ?? []
  const [form, setForm] = useState({
    job_description: version.job_description,
    person_spec: version.person_spec,
    required_hours: String(version.required_hours),
    recommended_hours: version.recommended_hours != null ? String(version.recommended_hours) : '',
    cpd_period: version.cpd_period,
    required_qualification_ids: version.required_qualification_ids,
    recommended_qualification_ids: version.recommended_qualification_ids,
  })

  const toggle = (field: 'required_qualification_ids' | 'recommended_qualification_ids', id: string, on: boolean) =>
    setForm((f) => ({ ...f, [field]: on ? [...f[field], id] : f[field].filter((x) => x !== id) }))

  return (
    <form
      className="grid gap-4"
      onChangeCapture={() => onDirtyChange(true)}
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          {
            job_description: form.job_description,
            person_spec: form.person_spec,
            required_hours: Number(form.required_hours) || 0,
            recommended_hours: form.recommended_hours === '' ? null : Number(form.recommended_hours),
            cpd_period: form.cpd_period,
            required_qualification_ids: form.required_qualification_ids,
            recommended_qualification_ids: form.recommended_qualification_ids,
          },
          { onSuccess: () => { toast.success('Draft saved'); onDirtyChange(false) }, onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <Field label="Job description">{(p) => <Textarea {...p} value={form.job_description} onChange={(e) => setForm((f) => ({ ...f, job_description: e.target.value }))} />}</Field>
      <Field label="Person specification">{(p) => <Textarea {...p} value={form.person_spec} onChange={(e) => setForm((f) => ({ ...f, person_spec: e.target.value }))} />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Required CPD hours">{(p) => <Input {...p} type="number" min={0} value={form.required_hours} onChange={(e) => setForm((f) => ({ ...f, required_hours: e.target.value }))} />}</Field>
        <Field label="Recommended hours" hint="Optional.">{(p) => <Input {...p} type="number" min={0} value={form.recommended_hours} onChange={(e) => setForm((f) => ({ ...f, recommended_hours: e.target.value }))} />}</Field>
        <Field label="CPD period">
          {(p) => (
            <NativeSelect {...p} value={form.cpd_period} onChange={(e) => setForm((f) => ({ ...f, cpd_period: e.target.value }))}>
              <option value="year">Per year</option>
              <option value="quarter">Per quarter</option>
              <option value="month">Per month</option>
            </NativeSelect>
          )}
        </Field>
      </div>
      <QualPicker label="Required qualifications" ids={form.required_qualification_ids} all={active} onToggle={(id, on) => toggle('required_qualification_ids', id, on)} />
      <QualPicker label="Recommended qualifications" ids={form.recommended_qualification_ids} all={active} onToggle={(id, on) => toggle('recommended_qualification_ids', id, on)} />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          <Save /> Save draft
        </Button>
      </div>
    </form>
  )
}

function RequirementForm({ versionId, onDone }: { versionId: string; onDone: () => void }) {
  const add = useAddRequirement(versionId)
  const competencies = useCompetencies()
  const [form, setForm] = useState({ kind: 'skill', text: '', competency_id: '', level: '3', priority: 'essential', weight: '5' })
  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate(
          { kind: form.kind, text: form.text.trim(), competency_id: form.competency_id || null, level: Number(form.level), priority: form.priority, weight: Number(form.weight), source: '' },
          {
            onSuccess: () => {
              toast.success('Requirement added')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind">
          {(p) => (
            <NativeSelect {...p} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              {REQUIREMENT_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Competency" hint="Optional. Link to a competency.">
          {(p) => (
            <NativeSelect {...p} value={form.competency_id} onChange={(e) => setForm((f) => ({ ...f, competency_id: e.target.value }))}>
              <option value="">None</option>
              {competencies.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <Field label="What is required">{(p) => <Textarea {...p} required value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder="Describe the requirement." />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Level">{(p) => <Input {...p} type="number" min={1} max={5} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} />}</Field>
        <Field label="Priority">
          {(p) => (
            <NativeSelect {...p} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Weight">{(p) => <Input {...p} type="number" min={1} max={10} value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} />}</Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={add.isPending} disabled={!form.text.trim()}>
          <Plus /> Add requirement
        </Button>
      </div>
    </form>
  )
}

function Workflow({ version, admin, dirty }: { version: Version; admin: boolean; dirty: boolean }) {
  const submit = useVersionTransition(version.id, 'submit')
  const approve = useVersionTransition(version.id, 'approve')
  const reject = useVersionTransition(version.id, 'request-changes')
  const [comment, setComment] = useState('')

  if (!admin) return null
  const pending = dirty || submit.isPending || approve.isPending || reject.isPending
  const run = (m: typeof submit, done: string) => m.mutate(comment, { onSuccess: () => (toast.success(done), setComment('')), onError: (err) => toast.error((err as Error).message) })

  if (version.status === 'approved' || version.status === 'superseded')
    return <p className="text-sm text-muted">This version is {VERSION_STATUS[version.status]?.label.toLowerCase()}. Start a new draft from the role page to make changes.</p>

  return (
    <div className="grid gap-3">
      {dirty ? <p className="text-sm text-warning" role="status">Save your draft changes before submitting it for review.</p> : null}
      <div className="grid gap-1.5">
        <Label htmlFor="wf-comment">Comment</Label>
        <Textarea id="wf-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note for the record. Optional." className="min-h-16" />
      </div>
      <div className="flex flex-wrap gap-2">
        {version.status === 'draft' || version.status === 'changes_requested' ? (
          <Button loading={submit.isPending} disabled={pending} onClick={() => run(submit, 'Sent for review')}>
            <Send /> Submit for review
          </Button>
        ) : null}
        {version.status === 'submitted' ? (
          <>
            <Button loading={approve.isPending} disabled={pending} onClick={() => run(approve, 'Version approved')}>
              <CheckCircle2 /> Approve
            </Button>
            <Button variant="secondary" loading={reject.isPending} disabled={pending} onClick={() => run(reject, 'Changes requested')}>
              <Undo2 /> Request changes
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function RoleVersionPage() {
  const { versionId = '' } = useParams()
  const admin = useIsOrgAdmin()
  const { data: version, isLoading, error, refetch } = useVersion(versionId)
  const [adding, setAdding] = useState(false)
  const [dirty, setDirty] = useState(false)
  const editable = admin && (version?.status === 'draft' || version?.status === 'changes_requested')

  const back = (
    <Link to={version ? `/business/frameworks/roles/${version.framework_id}` : '/business/frameworks/roles'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
      ← Back to role
    </Link>
  )

  return (
    <>
      <PageHeader
        title={version ? `Version ${version.number}` : 'Role version'}
        description="The job description, requirements and approval state of this version."
        back={back}
        actions={
          version ? (
            <Button variant="secondary" asChild>
              <Link to={`/learn/competence?version=${version.id}`}>
                <GaugeCircle /> Preview readiness
              </Link>
            </Button>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !version ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      ) : (
        <div className="animate-reveal grid gap-6 lg:grid-cols-2">
          <div className="grid gap-6">
            <Card>
              <CardHeader
                title="Details"
                action={<Badge tone={VERSION_STATUS[version.status]?.tone ?? 'neutral'}>{VERSION_STATUS[version.status]?.label ?? version.status}</Badge>}
              />
              <CardBody>
                {editable ? (
                  <DraftForm key={version.id} version={version} onDirtyChange={setDirty} />
                ) : (
                  <div className="grid gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted">Job description</p>
                      <p className="whitespace-pre-wrap">{version.job_description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Person specification</p>
                      <p className="whitespace-pre-wrap">{version.person_spec || '—'}</p>
                    </div>
                    <p className="text-muted">
                      Required CPD: <span className="font-medium text-text tabular">{version.required_hours}h</span> per {version.cpd_period}
                      {version.recommended_hours ? ` · recommended ${version.recommended_hours}h` : ''}
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Approval" />
              <CardBody>
                <Workflow version={version} admin={admin} dirty={dirty} />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title={`Requirements (${version.requirements.length})`}
              description="The knowledge, skills and behaviours this role needs."
              action={
                editable ? (
                  <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                    <Plus /> Add
                  </Button>
                ) : null
              }
            />
            {version.requirements.length === 0 ? (
              <EmptyState icon={<ClipboardList />} title="No requirements yet" body={editable ? 'Add the KSBs this role needs.' : 'No requirements have been set.'} />
            ) : (
              <ul className="stagger grid gap-2 p-4">
                {version.requirements.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_LABEL[r.kind]?.tone ?? 'neutral'}>{KIND_LABEL[r.kind]?.label ?? r.kind}</Badge>
                      {r.competency_code ? <span className="text-xs text-muted tabular">{r.competency_code}</span> : null}
                      <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge>
                      <span className="ml-auto text-xs text-muted">Level {r.level}</span>
                    </div>
                    <p className="mt-2 text-sm">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {editable ? (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent title="Add requirement" description="Add a KSB requirement to this draft.">
            <RequirementForm versionId={versionId} onDone={() => setAdding(false)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
