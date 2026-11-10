import { CheckCircle2, Download, ExternalLink, FileText, Link2, RotateCcw, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { submissionFileUrl, useGradeEssay, useGradeSubmission, type GradingAttempt, type GradingSubmission } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { relativeDate, shortDate } from '@/lib/format'
import { Html } from '@/pages/learn/shared'

type Criterion = { criterion: string; points: number; description?: string }

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Plain text from the box becomes simple paragraphs (escaped; the server sanitises again). */
function toParagraphs(text: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function Learner({ name, when, late, extra }: { name: string; when?: string | null; late?: boolean; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-muted">
          {when ? <>Handed in {shortDate(when)} · {relativeDate(when)}</> : 'Handed in'}
          {extra ? <> · {extra}</> : null}
        </p>
      </div>
      {late ? <Badge tone="warning">Late</Badge> : <Badge tone="info">Submitted</Badge>}
    </div>
  )
}

// ---------------------------------------------------------------- assignment
export function SubmissionMarking({ item, onDone }: { item: GradingSubmission; onDone: () => void }) {
  const grade = useGradeSubmission()
  const rubric = (item.rubric as Criterion[]).filter((r) => r && typeof r.criterion === 'string')
  const [scores, setScores] = useState<string[]>(() => rubric.map(() => ''))
  const [override, setOverride] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const rubricTotal = scores.reduce((t, s) => t + (Number(s) || 0), 0)
  const scoreText = override ?? (rubric.length ? String(rubricTotal) : '')
  const score = Number(scoreText)
  const scoreValid = scoreText !== '' && Number.isInteger(score) && score >= 0 && score <= item.max_score
  const rubricValid = rubric.every((r, i) => scores[i] === '' || (Number(scores[i]) >= 0 && Number(scores[i]) <= r.points))
  const passes = scoreValid && score >= item.pass_score

  const download = async (fileId: string) => {
    setDownloading(fileId)
    try {
      const { url } = await submissionFileUrl(fileId)
      window.location.assign(url) // a signed link that downloads as an attachment
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 503 ? 'File downloads are not set up on this server yet.' : (e as Error).message)
    } finally {
      setDownloading(null)
    }
  }

  const save = (returnIt: boolean) => {
    if (!scoreValid || !rubricValid) return
    // mutateAsync: the marked item leaves the queue on refetch (unmounting this form),
    // and a mutate() callback would never run then
    grade
      .mutateAsync({
        submissionId: item.id,
        body: {
          score,
          feedback: toParagraphs(feedback),
          rubric_scores: rubric.flatMap((r, i) => (scores[i] === '' ? [] : [{ criterion: r.criterion, points: Number(scores[i]) }])),
          return_for_resubmission: returnIt,
        },
      })
      .then((r) => {
        toast.success(r.status === 'returned' ? `Returned to ${item.learner} to try again` : `Mark saved. ${item.learner} has been told.`)
        onDone()
      })
      .catch((e: Error) => toast.error(e.message))
  }
  const submit = (e: FormEvent) => (e.preventDefault(), save(false))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <Card className="min-w-0 p-4 sm:p-5">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{item.course}</p>
        <h2 className="mt-0.5 text-lg font-semibold">{item.lecture}</h2>
        <div className="mt-4 border-t border-border pt-4">
          <Learner name={item.learner} when={item.submitted_at} late={item.is_late} extra={`Attempt ${item.attempt_no}`} />
        </div>

        {item.files.length ? (
          <section className="mt-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-muted" /> Files ({item.files.length})
            </h3>
            <ul className="grid gap-2">
              {item.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                  <FileText className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.filename}</span>
                  <span className="shrink-0 text-xs text-muted tabular">{kb(f.size_bytes)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Download ${f.filename}`} loading={downloading === f.id} onClick={() => void download(f.id)}>
                    <Download />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {item.url ? (
          <section className="mt-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4 text-muted" /> Link
            </h3>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-sm break-all text-primary hover:underline">
              {item.url} <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </section>
        ) : null}

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Their answer</h3>
          {item.text ? <p className="rounded-lg border border-border bg-surface-2/40 p-4 text-sm break-words whitespace-pre-wrap">{item.text}</p> : <p className="text-sm text-muted">No written answer.</p>}
        </section>
      </Card>

      <Card className="min-w-0 self-start p-4 sm:p-5">
        <form onSubmit={submit} className="grid gap-4">
          <h3 className="font-semibold">Mark and feedback</h3>
          {rubric.length ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Rubric</legend>
              {rubric.map((r, i) => {
                const bad = scores[i] !== '' && !(Number(scores[i]) >= 0 && Number(scores[i]) <= r.points)
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <label htmlFor={`crit-${i}`} className="min-w-0 flex-1 text-sm">
                      {r.criterion}
                      {r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}
                    </label>
                    <Input
                      id={`crit-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={r.points}
                      value={scores[i]}
                      aria-invalid={bad || undefined}
                      onChange={(e) => {
                        const v = e.target.value
                        setScores((s) => s.map((x, j) => (j === i ? v : x)))
                        setOverride(null) // the total follows the rubric again
                      }}
                      className={cn('w-20 text-right tabular', bad && 'border-danger')}
                    />
                    <span className="w-12 shrink-0 text-xs text-muted tabular">/ {r.points}</span>
                  </div>
                )
              })}
            </fieldset>
          ) : null}

          <Field label={`Overall mark (out of ${item.max_score})`} hint={`Pass mark: ${item.pass_score}`} error={scoreText !== '' && !scoreValid ? `Enter a whole number from 0 to ${item.max_score}.` : undefined}>
            {(f) => <Input {...f} type="number" inputMode="numeric" min={0} max={item.max_score} value={scoreText} onChange={(e) => setOverride(e.target.value)} className="tabular" required />}
          </Field>
          {scoreValid ? (
            <p className={cn('-mt-2 text-sm font-medium', passes ? 'text-success' : 'text-warning')}>{passes ? 'This is a pass.' : 'This is below the pass mark.'}</p>
          ) : null}

          <Field label="Feedback" hint="The learner sees this with their mark.">
            {(f) => <Textarea {...f} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={20000} className="min-h-32" placeholder="What went well, and what to improve" />}
          </Field>

          <div className="grid gap-2">
            <Button type="submit" loading={grade.isPending && !grade.variables?.body.return_for_resubmission} disabled={!scoreValid || !rubricValid || grade.isPending}>
              <Save /> Save mark
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => save(true)}
              loading={grade.isPending && !!grade.variables?.body.return_for_resubmission}
              disabled={!scoreValid || !rubricValid || passes || grade.isPending}
            >
              <RotateCcw /> Return for resubmission
            </Button>
            <p className="text-xs text-muted">{passes ? 'Only work below the pass mark can be returned.' : 'Returning lets them hand in again. Either way, the learner is notified.'}</p>
          </div>
        </form>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- quiz essays
type Result = { points: string | null; max: number; feedback?: string }

export function EssayMarking({ item, onDone }: { item: GradingAttempt; onDone: () => void }) {
  const results = item.results as Record<string, Result>
  const entries = Object.entries(results)
  // the quiz's essay questions, in order; only those still without points need a mark
  const essays = item.essays.map((q, i) => ({ ...q, n: i + 1, max: results[q.id]?.max ?? q.points })).filter((q) => results[q.id]?.points === null)
  const marked = entries.filter(([, r]) => r.points !== null).length

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{item.course}</p>
      <h2 className="mt-0.5 text-lg font-semibold">{item.quiz}</h2>
      <div className="mt-4 border-t border-border pt-4">
        <Learner name={item.learner} when={item.submitted_at} extra={`${marked} of ${entries.length} answers marked automatically`} />
      </div>
      <ol className="stagger mt-5 grid gap-4">
        {essays.map((e) => (
          <EssayAnswer key={e.id} attemptId={item.id} questionId={e.id} number={e.n} prompt={e.prompt} max={e.max} answer={item.answers[e.id]} last={essays.length === 1} onDone={onDone} />
        ))}
      </ol>
    </Card>
  )
}

function EssayAnswer({ attemptId, questionId, number, prompt, max, answer, last, onDone }: { attemptId: string; questionId: string; number: number; prompt: string; max: number; answer: unknown; last: boolean; onDone: () => void }) {
  const grade = useGradeEssay()
  const [points, setPoints] = useState('')
  const [feedback, setFeedback] = useState('')
  const value = Number(points)
  const valid = points !== '' && value >= 0 && value <= max
  const text = typeof answer === 'string' ? answer : answer == null ? '' : JSON.stringify(answer)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    grade
      .mutateAsync({ attemptId, body: { question_id: questionId, points: value, feedback: feedback.trim() } })
      .then((r) => {
        if (last || r.status === 'graded') {
          toast.success(`Quiz marked: ${Math.round(r.score_pct)}%${r.passed ? ', a pass' : ''}. The learner has been told.`)
          onDone()
        } else toast.success('Answer marked')
      })
      .catch((er: Error) => toast.error(er.message))
  }

  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">Essay {number}</p>
          {/* prompts are sanitised on the server, like the learner's quiz view */}
          <Html html={prompt} className="mt-0.5 text-sm font-semibold" />
        </div>
        <span className="shrink-0 text-xs text-muted tabular">Up to {max} {max === 1 ? 'point' : 'points'}</span>
      </div>
      <div className="mt-2 rounded-lg bg-surface-2/60 p-3 text-sm whitespace-pre-wrap">{text || <span className="text-muted">No answer given.</span>}</div>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <Field label="Points" error={points !== '' && !valid ? `0 to ${max}` : undefined}>
          {(f) => <Input {...f} type="number" inputMode="decimal" step="0.5" min={0} max={max} value={points} onChange={(e) => setPoints(e.target.value)} className="tabular" required />}
        </Field>
        <Field label="Feedback (optional)">{(f) => <Textarea {...f} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={5000} className="min-h-10" />}</Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" size="sm" loading={grade.isPending} disabled={!valid}>
            <CheckCircle2 /> Save points
          </Button>
        </div>
      </form>
    </li>
  )
}
