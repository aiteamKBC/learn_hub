import { Archive, HelpCircle, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type Question, type QuestionIn, QTYPE_LABEL, useArchiveQuestion, useCreateQuestion, useQuestions, useUpdateQuestion } from '@/features/governance/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { useCompetencies } from '@/features/frameworks/api'

type Draft = QuestionIn

function emptyDraft(): Draft {
  return { dept: '', q_type: 'mcq', prompt: '', options: ['', ''], answer_index: 0, expected: '', rationale: '', mark: 1, level: 2, course_ref: '' }
}

function QuestionForm({ initial, onSubmit, pending, editing = false }: { initial: Draft; onSubmit: (d: Draft) => void; pending: boolean; editing?: boolean }) {
  const [form, setForm] = useState<Draft>(initial)
  const set = (p: Partial<Draft>) => setForm((f) => ({ ...f, ...p }))
  const options = form.options ?? []
  const competencies = useCompetencies()
  const [error, setError] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (form.q_type === 'mcq' && (options.length < 2 || options.some((o) => !o.trim()) || form.answer_index == null || form.answer_index >= options.length)) {
      setError('Fill in every answer option and select the correct answer.')
      return
    }
    setError('')
    const body: Draft = form.q_type === 'mcq' ? { ...form, options: options.map((o) => o.trim()) } : { ...form, options: [], answer_index: null }
    onSubmit(body)
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-muted">
          Type
          <NativeSelect aria-label="Type" value={form.q_type} onChange={(e) => set({ q_type: e.target.value })} disabled={editing}>
            <option value="mcq">Multiple choice</option>
            <option value="rubric">Interview rubric</option>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Department
          <Input value={form.dept} onChange={(e) => set({ dept: e.target.value })} />
        </label>
      </div>
      {!editing ? <label className="grid gap-1 text-xs text-muted">Competency (optional)<NativeSelect aria-label="Competency (optional)" value={form.competency_id ?? ''} onChange={(e) => set({ competency_id: e.target.value || null })}><option value="">No competency link</option>{competencies.data?.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</NativeSelect>{competencies.error ? <span role="alert">Could not load competencies. You can still save without a link.</span> : null}</label> : null}
      <label className="grid gap-1 text-xs text-muted">
        Question
        <Textarea value={form.prompt} minLength={2} maxLength={4000} onChange={(e) => set({ prompt: e.target.value })} required />
      </label>

      {form.q_type === 'mcq' ? (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted">Answer options</p>
          {options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="radio" name="answer" checked={form.answer_index === i} onChange={() => set({ answer_index: i })} aria-label={`Mark option ${i + 1} correct`} />
              <Input value={o} aria-label={`Option ${i + 1}`} required onChange={(e) => set({ options: options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${i + 1}`} className="h-9" />
              {options.length > 2 ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove option" onClick={() => set({ options: options.filter((_, j) => j !== i), answer_index: 0 })}>
                  <X />
                </Button>
              ) : null}
            </label>
          ))}
          <Button type="button" variant="secondary" size="sm" className="w-fit" disabled={options.length >= 21} onClick={() => set({ options: [...options, ''] })}>
            <Plus /> Add option
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <label className="grid gap-1 text-xs text-muted">
            Expected answer
            <Textarea value={form.expected} onChange={(e) => set({ expected: e.target.value })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Rubric / rationale
            <Textarea value={form.rationale} onChange={(e) => set({ rationale: e.target.value })} />
          </label>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <label className="grid gap-1 text-xs text-muted">
          Marks
          <Input type="number" min={1} max={20} required value={form.mark} onChange={(e) => set({ mark: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Level (1–5)
          <Input type="number" min={1} max={5} value={form.level} onChange={(e) => set({ level: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Course ref
          <Input value={form.course_ref} onChange={(e) => set({ course_ref: e.target.value })} />
        </label>
      </div>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  )
}

function EditDialog({ question }: { question: Question }) {
  const [open, setOpen] = useState(false)
  const update = useUpdateQuestion(question.id)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <DialogContent title="Edit question" className="max-w-[600px]">
        <QuestionForm
          editing
          initial={{ dept: question.dept, q_type: question.q_type, prompt: question.prompt, options: question.options.length ? question.options : ['', ''], answer_index: question.answer_index ?? 0, expected: question.expected, rationale: question.rationale, mark: question.mark, level: question.level, course_ref: question.course_ref }}
          pending={update.isPending}
          onSubmit={(d) =>
            update.mutate(
              { dept: d.dept, prompt: d.prompt, options: d.options, answer_index: d.answer_index, expected: d.expected, rationale: d.rationale, mark: d.mark, level: d.level, course_ref: d.course_ref },
              { onSuccess: () => (toast.success('Question updated'), setOpen(false)), onError: (err) => toast.error((err as Error).message) },
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function ArchiveButton({ question }: { question: Question }) {
  const archive = useArchiveQuestion(question.id)
  return (
    <Button size="sm" variant="ghost" className="text-danger hover:text-danger" loading={archive.isPending} onClick={() => archive.mutate(undefined, { onSuccess: () => toast.success('Archived'), onError: (err) => toast.error((err as Error).message) })}>
      <Archive /> Archive
    </Button>
  )
}

function CreateDialog() {
  const [open, setOpen] = useState(false)
  const create = useCreateQuestion()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New question
      </Button>
      <DialogContent title="New question" description="Add a multiple-choice question or an interview question with a rubric." className="max-w-[600px]">
        <QuestionForm initial={emptyDraft()} pending={create.isPending} onSubmit={(d) => create.mutate(d, { onSuccess: () => (toast.success('Question added'), setOpen(false)), onError: (err) => toast.error((err as Error).message) })} />
      </DialogContent>
    </Dialog>
  )
}

export function QuestionsPage() {
  const admin = useIsOrgAdmin()
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading, error, refetch } = useQuestions(undefined, showArchived, admin)

  if (!admin) return <><PageHeader title="Question bank" description="Technical questions and answer keys are managed by company admins." /><Card><EmptyState icon={<HelpCircle />} title="Company admin access required" body="Please ask your company admin to manage assessment questions." /></Card></>

  return (
    <>
      <PageHeader
        title="Question bank"
        description="Technical questions used to check competence — multiple choice and interview rubrics."
        actions={
          <span className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {admin ? <CreateDialog /> : null}
          </span>
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<HelpCircle />} title="No questions yet" body={admin ? 'Add the first question to the bank.' : 'No questions have been added yet.'} action={admin ? <CreateDialog /> : undefined} />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {data.map((q) => (
            <li key={q.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={q.q_type === 'mcq' ? 'info' : 'primary'}>{QTYPE_LABEL[q.q_type] ?? q.q_type}</Badge>
                  {q.dept ? <Badge tone="outline">{q.dept}</Badge> : null}
                  <Badge tone="neutral">Level {q.level}</Badge>
                  <Badge tone="neutral">{q.mark} {q.mark === 1 ? 'mark' : 'marks'}</Badge>
                  {q.archived ? <Badge tone="warning">Archived</Badge> : null}
                  {admin && !q.archived ? (
                    <span className="ml-auto flex gap-1">
                      <EditDialog question={q} />
                      <ArchiveButton question={q} />
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-medium">{q.prompt}</p>
                {q.q_type === 'mcq' ? (
                  <ol className="mt-2 grid gap-1 text-sm">
                    {q.options.map((o, i) => (
                      <li key={i} className={i === q.answer_index ? 'font-medium text-success' : 'text-muted'}>
                        {String.fromCharCode(65 + i)}. {o} {i === q.answer_index ? '✓' : ''}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-2 grid gap-1 text-sm text-muted">
                    {q.expected ? <p><span className="font-medium text-text">Expected: </span>{q.expected}</p> : null}
                    {q.rationale ? <p><span className="font-medium text-text">Rubric: </span>{q.rationale}</p> : null}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
