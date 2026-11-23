import { ArrowLeft, Check, FilePlus2, Plus, Save, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import {
  ADOPTION_STAGES,
  adoptionTone,
  type AllocationIn,
  DOC_TYPE_LABEL,
  type Policy,
  POLICY_STATUS,
  type PolicySection,
  type PolicyVersion,
  policySections,
  policyCheck,
  SCOPE_LABEL,
  type Allocation,
  useAddObservation,
  useAllocation,
  useApprovePolicyVersion,
  usePolicy,
  usePolicyRecords,
  usePolicyVersions,
  useSetAllocation,
  useStartPolicyVersion,
  useUpdatePolicyVersion,
  VERSION_STATUS,
} from '@/features/governance/api'
import { MemberSelect, useMemberNames, memberName } from '@/features/governance/members'
import { useIsOrgAdmin } from '@/features/org/api'
import { relativeDate } from '@/lib/format'
import { Link } from '@/lib/router'

// ---- content tab -----------------------------------------------------------
function ContentTab({ policy, version, admin }: { policy: Policy; version: PolicyVersion; admin: boolean }) {
  const update = useUpdatePolicyVersion(version.id, policy.id)
  const approve = useApprovePolicyVersion(version.id, policy.id)
  const startNew = useStartPolicyVersion(policy.id)
  const editable = admin && version.status === 'draft'
  const [summary, setSummary] = useState(version.summary)
  const [sections, setSections] = useState<PolicySection[]>(policySections(version.sections))
  const check = policyCheck(version.understanding_check)
  const [question, setQuestion] = useState(check.question ?? '')
  const [options, setOptions] = useState<string[]>(check.options ?? ['', ''])
  const [answer, setAnswer] = useState<number>(check.answer ?? 0)
  const [effectiveDate, setEffectiveDate] = useState(version.effective_date ?? '')
  const [reviewDate, setReviewDate] = useState(version.review_date ?? '')
  const [saved, setSaved] = useState({ summary: version.summary, sections: JSON.stringify(policySections(version.sections)), question: check.question ?? '', options: JSON.stringify(check.options ?? ['', '']), answer: check.answer ?? 0, effectiveDate: version.effective_date ?? '', reviewDate: version.review_date ?? '' })
  const dirty = summary !== saved.summary || JSON.stringify(sections) !== saved.sections || question !== saved.question || JSON.stringify(options) !== saved.options || answer !== saved.answer || effectiveDate !== saved.effectiveDate || reviewDate !== saved.reviewDate
  const st = VERSION_STATUS[version.status] ?? { label: version.status, tone: 'neutral' as const }

  function save() {
    if (question.trim() && (options.length < 2 || options.some((o) => !o.trim()) || answer >= options.length)) { toast.error('Complete every answer option and select the correct answer.'); return }
    const understanding_check = question.trim() ? { q: question.trim(), options: options.map((o) => o.trim()), answer } : {}
    update.mutate(
      { summary, sections, understanding_check, effective_date: effectiveDate || null, review_date: reviewDate || null },
      { onSuccess: () => { toast.success('Saved'); setSaved({ summary, sections: JSON.stringify(sections), question, options: JSON.stringify(options), answer, effectiveDate, reviewDate }) }, onError: (err) => toast.error((err as Error).message) },
    )
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2">Version {version.number} <Badge tone={st.tone}>{st.label}</Badge></span>}
          description={editable ? 'Write the document, then approve it to publish.' : 'Read-only.'}
          action={
            <span className="flex gap-2">
              {editable ? (
                <Button size="sm" disabled={dirty || update.isPending} loading={approve.isPending} onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success('Published'), onError: (err) => toast.error((err as Error).message) })}>
                  <Check /> {dirty ? 'Save changes first' : 'Approve'}
                </Button>
              ) : null}
              {admin && version.status !== 'draft' ? (
                <Button size="sm" variant="secondary" loading={startNew.isPending} onClick={() => startNew.mutate(undefined, { onSuccess: () => toast.success('New draft version started'), onError: (err) => toast.error((err as Error).message) })}>
                  <FilePlus2 /> New version
                </Button>
              ) : null}
            </span>
          }
        />
        <CardBody className="grid gap-3 pt-0">
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-muted">Effective date<Input type="date" value={effectiveDate} disabled={!editable} onChange={(e) => setEffectiveDate(e.target.value)} /></label><label className="grid gap-1 text-xs text-muted">Review date<Input type="date" value={reviewDate} disabled={!editable} onChange={(e) => setReviewDate(e.target.value)} /></label></div>
          <label className="grid gap-1 text-xs text-muted">
            Summary
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!editable} />
          </label>

          <div className="grid gap-2">
            <p className="text-xs text-muted">Sections</p>
            {sections.map((sec, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex gap-2">
                  <Input value={sec.heading ?? ''} aria-label={`Section ${i + 1} heading`} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, heading: e.target.value } : s)))} placeholder="Heading" disabled={!editable} className="h-9" />
                  {editable ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove section" onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  ) : null}
                </div>
                <Textarea value={sec.body ?? ''} aria-label={`Section ${i + 1} body`} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)))} placeholder="Body" disabled={!editable} />
              </div>
            ))}
            {sections.length === 0 ? <p className="text-sm text-muted">No sections yet.</p> : null}
            {editable ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setSections([...sections, { heading: '', body: '' }])}>
                <Plus /> Add section
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted">Understanding check</p>
            <label className="grid gap-1 text-xs text-muted">
              Question
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!editable} />
            </label>
            {options.map((o, i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <input type="radio" name="correct-answer" checked={answer === i} onChange={() => setAnswer(i)} disabled={!editable} aria-label={`Mark option ${i + 1} correct`} />
                <Input value={o} aria-label={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} disabled={!editable} className="h-9" />
                {editable && options.length > 2 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove option ${i + 1}`} onClick={() => { setOptions(options.filter((_, j) => j !== i)); setAnswer(answer === i ? 0 : answer > i ? answer - 1 : answer) }}>
                    <X />
                  </Button>
                ) : null}
              </label>
            ))}
            {editable ? (
              <Button type="button" variant="secondary" size="sm" className="w-fit" disabled={options.length >= 21} onClick={() => setOptions([...options, ''])}>
                <Plus /> Add option
              </Button>
            ) : null}
            <p className="text-xs text-muted">The selected option is the correct answer.</p>
          </div>

          {editable ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={save} loading={update.isPending}>
                <Save /> Save
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}

// ---- allocation tab --------------------------------------------------------
const LIST_FIELDS: { key: keyof Pick<AllocationIn, 'depts' | 'titles' | 'sites'>; label: string; scope: string }[] = [
  { key: 'depts', label: 'Departments', scope: 'dept' },
  { key: 'titles', label: 'Job titles', scope: 'title' },
  { key: 'sites', label: 'Sites', scope: 'site' },
]

function TagInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="grid gap-1 text-xs text-muted">
      {label}
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <Badge key={i} tone="primary">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="ml-1 hover:text-danger" onClick={() => onChange(values.filter((_, j) => j !== i))}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        <Input value={draft} aria-label={`Add ${label.toLowerCase()}`} onChange={(e) => setDraft(e.target.value)} className="h-9" placeholder={`Add ${label.toLowerCase()}`} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), draft.trim() && (onChange([...values, draft.trim()]), setDraft('')))} />
        <Button type="button" size="sm" variant="secondary" onClick={() => draft.trim() && (onChange([...values, draft.trim()]), setDraft(''))}>
          Add
        </Button>
      </div>
    </div>
  )
}

function AllocationTab({ pid, admin }: { pid: string; admin: boolean }) {
  const alloc = useAllocation(pid)
  // alloc GET 404s when no rule exists yet; that's expected, so wait for a settled fetch
  // (success or error) before mounting the form so its initial state is correct.
  if (alloc.isLoading) return <Skeleton className="h-64 rounded-lg" />
  if (alloc.error && !(alloc.error instanceof ApiError && alloc.error.status === 404)) return <ErrorState message={alloc.error.message} onRetry={() => void alloc.refetch()} />
  return <AllocationForm pid={pid} admin={admin} existing={alloc.data} />
}

function AllocationForm({ pid, admin, existing }: { pid: string; admin: boolean; existing?: Allocation }) {
  const save = useSetAllocation(pid)
  const [scope, setScope] = useState<string>(existing?.scope ?? 'org')
  const [depts, setDepts] = useState<string[]>(existing?.depts ?? [])
  const [titles, setTitles] = useState<string[]>(existing?.titles ?? [])
  const [sites, setSites] = useState<string[]>(existing?.sites ?? [])
  const workerTypes = existing?.worker_types ?? []
  const [persons, setPersons] = useState<string[]>(existing?.persons ?? [])
  const [reack, setReack] = useState(existing?.require_reack ?? true)
  const lists = { depts: [depts, setDepts], titles: [titles, setTitles], sites: [sites, setSites] } as const
  const names = useMemberNames()

  function submit() {
    save.mutate(
      { scope, depts, titles, sites, worker_types: workerTypes, persons, require_reack: reack },
      { onSuccess: () => toast.success('Allocation saved'), onError: (err) => toast.error((err as Error).message) },
    )
  }

  return (
    <Card>
      <CardHeader title="Who it applies to" description="Choose who must read and adopt this document." />
      <CardBody className="grid gap-4 pt-0">
        <label className="grid max-w-60 gap-1 text-xs text-muted">
          Scope
          <NativeSelect aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={!admin}>
            {Object.entries(SCOPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </label>
        {scope !== 'org' ? (
          <fieldset disabled={!admin} className="grid gap-4 sm:grid-cols-2">
            {LIST_FIELDS.map((f) => {
              const [val, setVal] = lists[f.key as keyof typeof lists]
              return <TagInput key={f.key} label={f.label} values={val as string[]} onChange={setVal as (v: string[]) => void} />
            })}
            {scope === 'depts' ? (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-xs text-muted">Named people</p>
                <MemberSelect label="Named people" value="" onChange={(v) => v && !persons.includes(v) && setPersons([...persons, v])} allowNone noneLabel="Add a person…" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {persons.map((p, i) => (
                    <Badge key={i} tone="primary">
                      {memberName(names, p)}
                      <button type="button" aria-label="Remove person" className="ml-1 hover:text-danger" onClick={() => setPersons(persons.filter((_, j) => j !== i))}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </fieldset>
        ) : (
          <p className="text-sm text-muted">This document applies to everyone in the company.</p>
        )}
        {workerTypes.length ? <p className="text-sm text-warning">An existing worker-type filter is saved for this policy. Worker classification is not available in the current company directory; this filter needs review.</p> : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reack} onChange={(e) => setReack(e.target.checked)} disabled={!admin} />
          Ask people to acknowledge again when a new version is published
        </label>
        {admin ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} loading={save.isPending}>
              <Save /> Save allocation
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

// ---- adoption tab ----------------------------------------------------------
function ObservationDialog({ pid }: { pid: string }) {
  const [open, setOpen] = useState(false)
  const add = useAddObservation(pid)
  const [member, setMember] = useState('')
  const [note, setNote] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!member) return
    add.mutate(
      { member_id: member, note: note.trim() },
      {
        onSuccess: () => {
          toast.success('Observation recorded')
          setOpen(false)
          setMember('')
          setNote('')
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Add observation
      </Button>
      <DialogContent title="Record an observation" description="Note that a person is applying this policy in practice.">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Person
            <MemberSelect label="Person" value={member} onChange={setMember} allowNone noneLabel="Choose a person…" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Note
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} required />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={add.isPending} disabled={!member}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AdoptionTab({ pid, admin }: { pid: string; admin: boolean }) {
  const { data, isLoading, error, refetch } = usePolicyRecords(pid)
  const names = useMemberNames()
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !data) return <Skeleton className="h-64 rounded-lg" />

  const total = data.length
  const counts = ADOPTION_STAGES.map((_, i) => data.filter((r) => r.adoption_stage === i).length)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {ADOPTION_STAGES.map((label, i) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular">{counts[i]}</p>
            <Progress value={total ? (counts[i] / total) * 100 : 0} tone={i >= 3 ? 'success' : 'primary'} className="mt-2" label={`${label} share`} />
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="People" description="Where each person is on the adoption journey." action={admin ? <ObservationDialog pid={pid} /> : undefined} />
        <CardBody className="pt-0">
          {total === 0 ? (
            <EmptyState icon={<Users />} title="No one allocated yet" body="Set who this applies to on the previous tab." />
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>Person</Th>
                  <Th>Stage</Th>
                  <Th>Read</Th>
                  <Th>Acknowledged</Th>
                  <Th>Check</Th>
                </Tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <Tr key={r.member_id}>
                    <Td className="font-medium">{memberName(names, r.member_id)}</Td>
                    <Td>
                      <Badge tone={adoptionTone(r.adoption_stage)}>{r.adoption_label || ADOPTION_STAGES[r.adoption_stage]}</Badge>
                    </Td>
                    <Td className="text-sm text-muted">{r.read_at ? relativeDate(r.read_at) : '—'}</Td>
                    <Td className="text-sm text-muted">{r.ack_at ? relativeDate(r.ack_at) : '—'}</Td>
                    <Td className="text-sm tabular">{r.check_at ? `${r.check_score ?? 0}%` : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ---- page ------------------------------------------------------------------
export function PolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>()
  const admin = useIsOrgAdmin()
  const policy = usePolicy(policyId)
  const versions = usePolicyVersions(policyId)
  const [selected, setSelected] = useState<string | null>(null)
  const vlist = versions.data ?? []
  const current = vlist.find((v) => v.id === selected) ?? vlist[0]

  if (policy.error) return <ErrorState message={(policy.error as Error).message} onRetry={() => void policy.refetch()} />
  if (policy.isLoading || !policy.data)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )

  const p = policy.data
  const s = POLICY_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as const }

  return (
    <>
      <PageHeader
        back={
          <Link to="/business/governance/policies" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" /> All documents
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.title} <Badge tone="neutral">{DOC_TYPE_LABEL[p.doc_type] ?? p.doc_type}</Badge> <Badge tone={s.tone}>{s.label}</Badge>
          </span>
        }
        description={`${p.code}${p.category ? ` · ${p.category}` : ''}`}
        actions={
          vlist.length > 1 ? (
            <NativeSelect aria-label="Policy version" value={current?.id ?? ''} onChange={(e) => setSelected(e.target.value)} className="w-44">
              {vlist.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.number} · {VERSION_STATUS[v.status]?.label ?? v.status}
                </option>
              ))}
            </NativeSelect>
          ) : null
        }
      />
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          {admin ? <TabsTrigger value="allocation">Who it applies to</TabsTrigger> : null}
          {admin ? <TabsTrigger value="adoption">Adoption</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="content">
          {versions.error ? <ErrorState message={versions.error.message} onRetry={() => void versions.refetch()} /> : versions.isLoading ? <Skeleton className="h-64 rounded-lg" /> : current ? <ContentTab key={`${current.id}-${current.status}`} policy={p} version={current} admin={admin} /> : <Card><EmptyState icon={<FilePlus2 />} title="No version" body="This document has no versions." /></Card>}
        </TabsContent>
        {admin ? <TabsContent value="allocation">{policyId ? <AllocationTab pid={policyId} admin={admin} /> : null}</TabsContent> : null}
        {admin ? <TabsContent value="adoption">{policyId ? <AdoptionTab pid={policyId} admin={admin} /> : null}</TabsContent> : null}
      </Tabs>
    </>
  )
}
