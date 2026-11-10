import { AlignLeft, ArrowLeftRight, CheckSquare, CircleDot, FileQuestion, PenLine, Plus, Pencil, ToggleLeft, Trash2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { useCurriculum, type QuizQuestionIn, type StudioQuiz, type StudioQuizQuestion } from '@/features/studio/api'
import { cn } from '@/lib/cn'

import { errText, textOf } from './shared'

type QKind = 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'fill_blank' | 'short_answer' | 'essay'

export const QUESTION_KINDS: Record<QKind, { label: string; hint: string; Icon: LucideIcon }> = {
  single_choice: { label: 'Multiple choice', hint: 'One correct answer', Icon: CircleDot },
  multiple_choice: { label: 'Multiple response', hint: 'Several correct answers', Icon: CheckSquare },
  true_false: { label: 'True or false', hint: 'A statement to judge', Icon: ToggleLeft },
  matching: { label: 'Matching', hint: 'Match the pairs', Icon: ArrowLeftRight },
  fill_blank: { label: 'Fill in the blanks', hint: 'Complete the text', Icon: AlignLeft },
  short_answer: { label: 'Short answer', hint: 'A word or phrase', Icon: PenLine },
  essay: { label: 'Essay', hint: 'Long answer, marked by you', Icon: FileQuestion },
}
const qMeta = (k: string) => QUESTION_KINDS[k as QKind] ?? QUESTION_KINDS.single_choice

type Draft = {
  kind: QKind
  prompt: string
  points: number
  explanation: string
  choices: { body: string; correct: boolean }[] // single / multiple / true-false
  pairs: { left: string; right: string }[] // matching
  answers: string[] // fill_blank: one entry per blank; short_answer: [0]. One accepted answer per line.
}

const blankCount = (prompt: string) => (prompt.match(/_{3,}/g) ?? []).length

function emptyDraft(kind: QKind): Draft {
  return {
    kind,
    prompt: '',
    points: 1,
    explanation: '',
    choices: kind === 'true_false' ? [{ body: 'True', correct: true }, { body: 'False', correct: false }] : [{ body: '', correct: true }, { body: '', correct: false }, { body: '', correct: false }],
    pairs: [{ left: '', right: '' }, { left: '', right: '' }],
    answers: [''],
  }
}

function toDraft(q: StudioQuizQuestion): Draft {
  const kind = q.kind as QKind
  const d = emptyDraft(kind)
  d.prompt = textOf(q.prompt)
  d.points = q.points
  d.explanation = textOf(q.explanation)
  if (['single_choice', 'multiple_choice', 'true_false'].includes(kind) && q.options.length) d.choices = q.options.map((o) => ({ body: o.body, correct: o.is_correct }))
  if (kind === 'matching' && q.options.length) d.pairs = q.options.map((o) => ({ left: o.body, right: o.match_text }))
  if (kind === 'fill_blank' || kind === 'short_answer') {
    const n = kind === 'fill_blank' ? Math.max(1, blankCount(d.prompt), ...q.options.map((o) => o.blank_index + 1)) : 1
    d.answers = Array.from({ length: n }, (_, i) => q.options.filter((o) => (kind === 'short_answer' ? true : o.blank_index === i)).map((o) => o.body).join('\n'))
  }
  return d
}

const lines = (s: string | undefined) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean)

function toPayload(d: Draft): QuizQuestionIn {
  const base = { kind: d.kind, prompt: d.prompt.trim(), explanation: d.explanation.trim(), points: d.points }
  switch (d.kind) {
    case 'single_choice':
    case 'multiple_choice':
    case 'true_false':
      return { ...base, options: d.choices.filter((c) => c.body.trim()).map((c) => ({ body: c.body.trim(), is_correct: c.correct, match_text: '' })) }
    case 'matching':
      return { ...base, options: d.pairs.filter((p) => p.left.trim() || p.right.trim()).map((p) => ({ body: p.left.trim(), match_text: p.right.trim(), is_correct: false })) }
    case 'fill_blank':
      return { ...base, options: d.answers.flatMap((a, i) => lines(a).map((body) => ({ body, is_correct: true, match_text: '', blank_index: i }))) }
    case 'short_answer':
      return { ...base, options: lines(d.answers[0]).map((body) => ({ body, is_correct: true, match_text: '', blank_index: 0 })) }
    default:
      return { ...base, options: [] }
  }
}

/** What the server's publish checklist would complain about, caught before saving. */
function problems(d: Draft): string[] {
  const out: string[] = []
  if (!d.prompt.trim()) out.push('Write the question.')
  if (!(d.points >= 1 && d.points <= 100)) out.push('Marks must be between 1 and 100.')
  const filled = d.choices.filter((c) => c.body.trim())
  if (d.kind === 'single_choice' || d.kind === 'multiple_choice') {
    if (filled.length < 2) out.push('Add at least two answer options.')
    const correct = filled.filter((c) => c.correct).length
    if (!correct) out.push('Mark the correct answer.')
    if (d.kind === 'single_choice' && correct > 1) out.push('Multiple choice has one correct answer. Use "Multiple response" for more.')
  }
  if (d.kind === 'true_false' && !d.choices.some((c) => c.correct)) out.push('Choose whether the statement is true or false.')
  if (d.kind === 'matching' && d.pairs.filter((p) => p.left.trim() && p.right.trim()).length < 2) out.push('Add at least two complete pairs.')
  if (d.kind === 'matching' && d.pairs.some((p) => !!p.left.trim() !== !!p.right.trim())) out.push('Every pair needs both sides.')
  if (d.kind === 'fill_blank') {
    const n = blankCount(d.prompt)
    if (!n) out.push('Mark each blank in the question with ___ (three underscores).')
    else if (d.answers.slice(0, n).some((a) => !lines(a).length) || d.answers.length < n) out.push('Give at least one accepted answer for every blank.')
  }
  if (d.kind === 'short_answer' && !lines(d.answers[0]).length) out.push('Give at least one accepted answer.')
  return out
}

// ---------------------------------------------------------------- settings
type SettingsDraft = { mode: string; pass_mark_pct: string; time_limit_min: string; max_attempts: string; shuffle_questions: boolean; shuffle_options: boolean; reveal_answers: string }

export function quizSettingsDraft(q: StudioQuiz): SettingsDraft {
  return {
    mode: q.mode,
    pass_mark_pct: String(q.pass_mark_pct),
    time_limit_min: q.time_limit_sec ? String(Math.round(q.time_limit_sec / 60)) : '',
    max_attempts: q.max_attempts ? String(q.max_attempts) : '',
    shuffle_questions: q.shuffle_questions,
    shuffle_options: q.shuffle_options,
    reveal_answers: q.reveal_answers,
  }
}
export type { SettingsDraft as QuizSettingsDraft }

export function quizSettingsErrors(s: SettingsDraft) {
  const e: Partial<Record<keyof SettingsDraft, string>> = {}
  const pass = Number(s.pass_mark_pct)
  if (!Number.isInteger(pass) || pass < 0 || pass > 100) e.pass_mark_pct = 'Between 0 and 100.'
  if (s.time_limit_min && !(Number(s.time_limit_min) >= 1 && Number(s.time_limit_min) <= 240)) e.time_limit_min = 'Between 1 and 240 minutes, or empty for no limit.'
  if (s.max_attempts && !(Number.isInteger(Number(s.max_attempts)) && Number(s.max_attempts) >= 1 && Number(s.max_attempts) <= 100)) e.max_attempts = 'Between 1 and 100, or empty for unlimited.'
  return e
}

export function quizSettingsPayload(s: SettingsDraft) {
  return {
    mode: s.mode,
    pass_mark_pct: Number(s.pass_mark_pct),
    time_limit_sec: s.time_limit_min ? Math.round(Number(s.time_limit_min) * 60) : null,
    max_attempts: s.max_attempts ? Number(s.max_attempts) : null,
    shuffle_questions: s.shuffle_questions,
    shuffle_options: s.shuffle_options,
    reveal_answers: s.reveal_answers,
  }
}

// ---------------------------------------------------------------- questions
/** The question list with an inline editor (one question open at a time). */
export function QuizQuestions({ courseId, quiz, readOnly, onDirty }: { courseId: string; quiz: StudioQuiz; readOnly?: boolean; onDirty: (dirty: boolean) => void }) {
  const { deleteQuestion } = useCurriculum(courseId)
  const [open, setOpen] = useState<{ id: string | null; kind: QKind } | null>(null) // id null = new
  const [error, setError] = useState('')

  const confirmSwitch = (dirtyNow: boolean) => !dirtyNow || window.confirm('Discard your changes to this question?')
  const [formDirty, setFormDirty] = useState(false)
  useEffect(() => onDirty(formDirty), [formDirty, onDirty])
  const openEditor = (next: { id: string | null; kind: QKind } | null) => {
    if (!confirmSwitch(formDirty)) return
    setFormDirty(false)
    setOpen(next)
  }

  const total = quiz.questions.reduce((n, q) => n + q.points, 0)

  return (
    <section aria-labelledby={`qs-${quiz.id}`} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id={`qs-${quiz.id}`} className="text-sm font-semibold">Questions ({quiz.questions.length})</h3>
          <p className="text-[13px] text-muted">{total} {total === 1 ? 'mark' : 'marks'} in total</p>
        </div>
        {readOnly ? null : (
          <Menu>
            <MenuTrigger asChild>
              <Button type="button" size="sm"><Plus /> Add question</Button>
            </MenuTrigger>
            <MenuContent className="w-64">
              {(Object.keys(QUESTION_KINDS) as QKind[]).map((k) => {
                const m = QUESTION_KINDS[k]
                return (
                  <MenuItem key={k} onSelect={() => openEditor({ id: null, kind: k })}>
                    <m.Icon aria-hidden />
                    <span className="grid">
                      <span>{m.label}</span>
                      <span className="text-xs text-muted">{m.hint}</span>
                    </span>
                  </MenuItem>
                )
              })}
            </MenuContent>
          </Menu>
        )}
      </div>
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}

      {open?.id === null ? (
        <QuestionForm key={`new-${open.kind}`} courseId={courseId} quizId={quiz.id} initial={emptyDraft(open.kind)} onDirty={setFormDirty} onDone={() => (setFormDirty(false), setOpen(null))} />
      ) : null}

      {quiz.questions.length ? (
        <ol className="stagger grid gap-2">
          {quiz.questions.map((q, i) => {
            const m = qMeta(q.kind)
            const editing = open?.id === q.id
            return (
              <li key={q.id} className={cn('rounded-lg border bg-surface transition-colors', editing ? 'border-primary/50' : 'border-border')}>
                <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text"><m.Icon className="size-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i + 1}. {textOf(q.prompt) || 'Untitled question'}</p>
                    <p className="text-xs text-muted">{m.label} · {q.points} {q.points === 1 ? 'mark' : 'marks'}</p>
                  </div>
                  {readOnly ? null : (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit question ${i + 1}`} aria-expanded={editing} onClick={() => openEditor(editing ? null : { id: q.id, kind: q.kind as QKind })}>
                        {editing ? <X /> : <Pencil />}
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete question ${i + 1}`}
                        onClick={() => window.confirm(`Delete question ${i + 1}?`) && deleteQuestion.mutate(q.id, { onError: (e) => setError(errText(e)), onSuccess: () => editing && (setFormDirty(false), setOpen(null)) })}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                {editing ? (
                  <div className="border-t border-border p-3">
                    <QuestionForm key={q.id} courseId={courseId} questionId={q.id} quizId={quiz.id} initial={toDraft(q)} onDirty={setFormDirty} onDone={() => (setFormDirty(false), setOpen(null))} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : open ? null : (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted">No questions yet. Add the first one.</p>
      )}
    </section>
  )
}

function QuestionForm({ courseId, quizId, questionId, initial, onDirty, onDone }: { courseId: string; quizId: string; questionId?: string; initial: Draft; onDirty: (d: boolean) => void; onDone: () => void }) {
  const { addQuestion, replaceQuestion } = useCurriculum(courseId)
  const [d, setD] = useState(initial)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState('')
  const startJson = useMemo(() => JSON.stringify(initial), [initial])
  const dirty = JSON.stringify(d) !== startJson
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const uid = useId()
  const list = problems(d)
  const meta = qMeta(d.kind)
  const n = blankCount(d.prompt)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const saving = addQuestion.isPending || replaceQuestion.isPending

  const save = async () => {
    setTried(true)
    setError('')
    if (list.length) return
    try {
      const body = toPayload(d)
      if (questionId) await replaceQuestion.mutateAsync({ questionId, body })
      else await addQuestion.mutateAsync({ quizId, body })
      onDone()
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <div className="animate-reveal grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary"><meta.Icon className="size-3.5" aria-hidden /> {meta.label}</Badge>
        {questionId ? <span className="text-xs text-muted">To change the type, delete this question and add a new one.</span> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Question" hint={d.kind === 'fill_blank' ? 'Type ___ (three underscores) where each blank goes.' : undefined}>
          {(p) => <Textarea {...p} value={d.prompt} maxLength={5000} rows={3} onChange={(e) => set({ prompt: e.target.value })} placeholder={d.kind === 'fill_blank' ? 'The capital of France is ___.' : 'What would you like to ask?'} />}
        </Field>
        <Field label="Marks">{(p) => <Input {...p} type="number" min={1} max={100} value={d.points} onChange={(e) => set({ points: Number(e.target.value) })} />}</Field>
      </div>

      {d.kind === 'single_choice' || d.kind === 'multiple_choice' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Answer options <span className="font-normal text-muted">· {d.kind === 'single_choice' ? 'select the correct one' : 'tick every correct one'}</span></legend>
          {d.choices.map((c, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2">
              <input
                type={d.kind === 'single_choice' ? 'radio' : 'checkbox'}
                name={`${uid}-correct`}
                checked={c.correct}
                aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                className="size-4 shrink-0 accent-[var(--primary)]"
                onChange={(e) => set({ choices: d.choices.map((x, j) => (d.kind === 'single_choice' ? { ...x, correct: j === i } : j === i ? { ...x, correct: e.target.checked } : x)) })}
              />
              <span className="w-4 shrink-0 text-center text-xs font-semibold text-muted" aria-hidden>{String.fromCharCode(65 + i)}</span>
              <Input aria-label={`Option ${String.fromCharCode(65 + i)}`} value={c.body} maxLength={1000} onChange={(e) => set({ choices: d.choices.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
              {c.correct ? <Badge tone="success" className="hidden shrink-0 sm:inline-flex">Correct</Badge> : null}
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove option ${String.fromCharCode(65 + i)}`} disabled={d.choices.length <= 2} onClick={() => set({ choices: d.choices.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" className="justify-self-start" disabled={d.choices.length >= 20} onClick={() => set({ choices: [...d.choices, { body: '', correct: false }] })}><Plus /> Add option</Button>
        </fieldset>
      ) : null}

      {d.kind === 'true_false' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">The statement is</legend>
          <div className="flex gap-2">
            {d.choices.map((c, i) => (
              <label key={c.body} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors', c.correct ? 'border-primary bg-primary-soft text-primary-soft-text' : 'border-border hover:bg-surface-2')}>
                <input type="radio" name={`${uid}-tf`} className="size-4 accent-[var(--primary)]" checked={c.correct} onChange={() => set({ choices: d.choices.map((x, j) => ({ ...x, correct: j === i })) })} />
                {c.body}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {d.kind === 'matching' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Pairs <span className="font-normal text-muted">· learners match each left item to its right item</span></legend>
          {d.pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <Input aria-label={`Pair ${i + 1}, left`} placeholder="Item" value={p.left} maxLength={1000} onChange={(e) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })} />
              <ArrowLeftRight className="hidden size-4 text-muted sm:block" aria-hidden />
              <Input aria-label={`Pair ${i + 1}, right`} placeholder="Its match" value={p.right} maxLength={500} className="max-sm:col-start-1" onChange={(e) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove pair ${i + 1}`} className="max-sm:row-start-1 max-sm:col-start-2" disabled={d.pairs.length <= 2} onClick={() => set({ pairs: d.pairs.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" className="justify-self-start" disabled={d.pairs.length >= 20} onClick={() => set({ pairs: [...d.pairs, { left: '', right: '' }] })}><Plus /> Add pair</Button>
        </fieldset>
      ) : null}

      {d.kind === 'fill_blank' ? (
        <div className="grid gap-3">
          {n ? (
            Array.from({ length: n }, (_, i) => (
              <Field key={i} label={`Accepted answers for blank ${i + 1}`} hint="One per line. Marking ignores capital letters.">
                {(p) => <Textarea {...p} rows={2} className="min-h-16" value={d.answers[i] ?? ''} onChange={(e) => set({ answers: Array.from({ length: Math.max(n, d.answers.length) }, (_, j) => (j === i ? e.target.value : (d.answers[j] ?? ''))) })} />}
              </Field>
            ))
          ) : (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted">Add ___ to the question to create a blank.</p>
          )}
        </div>
      ) : null}

      {d.kind === 'short_answer' ? (
        <Field label="Accepted answers" hint="One per line. Marking ignores capital letters.">
          {(p) => <Textarea {...p} rows={3} value={d.answers[0] ?? ''} onChange={(e) => set({ answers: [e.target.value] })} />}
        </Field>
      ) : null}

      {d.kind === 'essay' ? <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted">Learners write a long answer. You mark it in Assignments, and the quiz result waits for your mark.</p> : null}

      <Field label="Explanation (optional)" hint="Shown after answering, depending on the quiz settings.">
        {(p) => <Textarea {...p} rows={2} className="min-h-16" value={d.explanation} maxLength={5000} onChange={(e) => set({ explanation: e.target.value })} />}
      </Field>

      {tried && list.length ? (
        <ul role="alert" className="grid gap-1 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {list.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => (!dirty || window.confirm('Discard your changes to this question?')) && onDone()}>Cancel</Button>
        <Button type="button" size="sm" loading={saving} onClick={() => void save()}>{questionId ? 'Save question' : 'Add question'}</Button>
      </div>
    </div>
  )
}

