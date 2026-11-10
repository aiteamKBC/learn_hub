import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Clock, Hourglass, ListChecks, RotateCcw, Trophy, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Ring } from '@/components/ui/ring'
import { type Answer, type Attempt, type LearnerQuestion, type Lecture, type ReviewItem, useAttempt, useStartAttempt, useSubmitAttempt } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

import { lectureUrl } from './shared'
import { Sheet } from './stages'

type Props = { lecture: Lecture; enrollmentId: string; slug: string }

/** Drafts survive a reload (or a dropped connection) until the attempt is submitted. */
const draftKey = (id: string) => `quiz-draft:${id}`
function loadDraft(id: string): Record<string, Answer> {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(id)) ?? '{}') as Record<string, Answer>
  } catch {
    return {}
  }
}
function saveDraft(id: string, a: Record<string, Answer>) {
  try {
    sessionStorage.setItem(draftKey(id), JSON.stringify(a))
  } catch {
    /* private mode: drafts just aren't kept */
  }
}

function answered(q: LearnerQuestion, a: Answer | undefined) {
  if (a === undefined) return false
  if (typeof a === 'string') return a.trim() !== ''
  if (Array.isArray(a)) return q.kind === 'fill_blank' ? a.some((x) => x.trim()) : a.length > 0
  return Object.values(a).some(Boolean)
}

export function QuizStage({ lecture, enrollmentId, slug }: Props) {
  const quiz = lecture.quiz!
  const open = quiz.attempts.find((a) => a.status === 'in_progress')
  // one attempt in view: in progress -> taking it; submitted -> its result. Deciding by
  // the attempt's own status means the result shows as soon as the submit lands.
  const [attemptId, setAttemptId] = useState<string | null>(open?.id ?? null)
  const start = useStartAttempt(enrollmentId, lecture.key)
  const attempt = useAttempt(attemptId)

  const done = quiz.attempts.filter((a) => a.status !== 'in_progress')
  const best = done.reduce<number | null>((m, a) => (a.score_pct != null && (m == null || a.score_pct > m) ? a.score_pct : m), null)
  const passed = done.some((a) => a.passed)
  const left = quiz.max_attempts ? quiz.max_attempts - quiz.attempts.length : null

  const begin = () =>
    start.mutate(undefined, {
      onSuccess: (a) => setAttemptId(a.id),
      onError: (e) => toast.error(e.message),
    })

  const a = attemptId ? attempt.data : undefined
  if (a?.status === 'in_progress' && a.quiz) {
    return <TakeQuiz attempt={a} enrollmentId={enrollmentId} title={lecture.title} />
  }
  if (a && a.status !== 'in_progress') {
    return <QuizResult attempt={a} lecture={lecture} slug={slug} passMark={quiz.pass_mark_pct} canRetry={!a.passed && (left == null || left > 0)} onRetry={begin} retrying={start.isPending} onBack={() => setAttemptId(null)} />
  }

  return (
    <Sheet lecture={lecture} meta={`${quiz.question_count} question${quiz.question_count === 1 ? '' : 's'}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact icon={<Trophy />} label="Pass mark" value={`${quiz.pass_mark_pct}%`} />
        <Fact icon={<Clock />} label="Time limit" value={quiz.time_limit_sec ? `${Math.round(quiz.time_limit_sec / 60)} min` : 'None'} />
        <Fact icon={<RotateCcw />} label="Attempts" value={quiz.max_attempts ? `${quiz.attempts.length} of ${quiz.max_attempts} used` : 'Unlimited'} />
      </div>
      {quiz.mode === 'practice' ? <p className="mt-4 text-sm text-muted">This is a practice quiz: it doesn't count towards your result, so try it as often as you like.</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {open ? (
          <Button size="lg" onClick={() => setAttemptId(open.id)} loading={attempt.isLoading && !!attemptId}>
            Resume attempt <ArrowRight />
          </Button>
        ) : left === 0 ? (
          <p className="text-sm text-muted">You have used all your attempts{passed ? '' : '. Ask the instructor if you need another try'}.</p>
        ) : (
          <Button size="lg" onClick={begin} loading={start.isPending}>
            {done.length ? 'Try again' : 'Start quiz'} <ArrowRight />
          </Button>
        )}
        {best != null ? (
          <span className="text-sm text-muted">
            Best score <span className={cn('font-semibold tabular', passed ? 'text-success' : 'text-text')}>{Math.round(best)}%</span>
          </span>
        ) : null}
      </div>

      {done.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Your attempts</h2>
          <ul className="stagger grid gap-2">
            {done
              .slice()
              .reverse()
              .map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setAttemptId(a.id)} className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow">
                    <span className={cn('flex size-9 items-center justify-center rounded-full', a.passed ? 'bg-success-soft text-success' : a.status === 'needs_grading' ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted')}>
                      {a.passed ? <Check className="size-4" /> : a.status === 'needs_grading' ? <Hourglass className="size-4" /> : <X className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Attempt {a.attempt_no}</span>
                      <span className="block text-xs text-muted">{a.submitted_at ? shortDate(a.submitted_at) : ''}</span>
                    </span>
                    {a.status === 'needs_grading' ? <Badge tone="warning">Being marked</Badge> : <span className="text-sm font-semibold tabular">{a.score_pct != null ? `${Math.round(a.score_pct)}%` : '—'}</span>}
                    <ChevronRight className="size-4 text-subtle group-hover:text-primary" />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm">
      <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text [&_svg]:size-4">{icon}</span>
      <span>
        <span className="block text-xs text-muted">{label}</span>
        <span className="block text-sm font-semibold">{value}</span>
      </span>
    </div>
  )
}

function useCountdown(expiresAt: string | null | undefined, onZero: () => void) {
  const [left, setLeft] = useState<number | null>(() => (expiresAt ? new Date(expiresAt).getTime() - Date.now() : null))
  const fired = useRef(false)
  const zero = useRef(onZero)
  zero.current = onZero
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now()
      setLeft(ms)
      if (ms <= 0 && !fired.current) {
        fired.current = true
        zero.current()
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])
  return left
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One question at a time, with a map of all of them, a timer and a confirm step. */
function TakeQuiz({ attempt, enrollmentId, title }: { attempt: Attempt; enrollmentId: string; title: string }) {
  const questions = attempt.quiz!.questions
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => loadDraft(attempt.id))
  const [i, setI] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const submit = useSubmitAttempt(enrollmentId)
  const q = questions[i]!
  const count = questions.filter((x) => answered(x, answers[x.id])).length

  const set = (id: string, a: Answer) =>
    setAnswers((prev) => {
      const next = { ...prev, [id]: a }
      saveDraft(attempt.id, next)
      return next
    })

  const send = useCallback(() => {
    if (submit.isPending || submit.isSuccess) return
    submit.mutate(
      { id: attempt.id, answers },
      {
        // the result replaces this screen by itself (the attempt is no longer in progress)
        onSuccess: () => {
          try {
            sessionStorage.removeItem(draftKey(attempt.id))
          } catch {
            /* ignore */
          }
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }, [submit, attempt.id, answers])

  const left = useCountdown(attempt.expires_at, () => {
    toast.info("Time's up: your answers have been sent.")
    send()
  })

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted tabular">
              {count} of {questions.length} answered
            </p>
          </div>
          {left != null ? (
            <span role="timer" aria-label="Time left" className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular', left < 60_000 ? 'animate-pulse bg-danger-soft text-danger' : 'bg-surface-2 text-text')}>
              <Clock className="size-4" /> {clock(left)}
            </span>
          ) : null}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${(count / questions.length) * 100}%` }} />
        </div>
      </div>

      <nav aria-label="Questions" className="mb-6 flex flex-wrap gap-1.5">
        {questions.map((x, n) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setI(n)}
            aria-current={n === i ? 'step' : undefined}
            aria-label={`Question ${n + 1}${answered(x, answers[x.id]) ? ', answered' : ''}`}
            className={cn(
              'size-8 rounded-md text-xs font-semibold tabular transition-all',
              n === i ? 'scale-105 bg-primary text-on-primary shadow' : answered(x, answers[x.id]) ? 'bg-primary-soft text-primary-soft-text' : 'border border-border bg-surface text-muted hover:border-border-strong',
            )}
          >
            {n + 1}
          </button>
        ))}
      </nav>

      <section key={q.id} className="animate-reveal" aria-labelledby={`q-${q.id}`}>
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          Question {i + 1} of {questions.length} · {q.points} point{q.points === 1 ? '' : 's'}
        </p>
        <div id={`q-${q.id}`} className="prose-lesson mt-2 text-[17px] font-medium" dangerouslySetInnerHTML={{ __html: q.prompt }} />
        <div className="mt-5">
          <QuestionInput q={q} value={answers[q.id]} onChange={(a) => set(q.id, a)} />
        </div>
      </section>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft /> Previous
        </Button>
        {i < questions.length - 1 ? (
          <Button onClick={() => setI(i + 1)}>
            Next <ArrowRight />
          </Button>
        ) : (
          <Button onClick={() => (count < questions.length ? setConfirm(true) : send())} loading={submit.isPending}>
            Submit answers <Check />
          </Button>
        )}
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Submit with unanswered questions?" description={`You've answered ${count} of ${questions.length}. Unanswered questions score nothing.`}>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep going</Button>
            </DialogClose>
            <Button onClick={() => (setConfirm(false), send())} loading={submit.isPending}>
              Submit anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Choice({ checked, multi, onSelect, children }: { checked: boolean; multi?: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border bg-surface p-3.5 text-left text-[15px] shadow-sm transition-all active:scale-[0.99]',
        checked ? 'border-primary bg-primary-soft/60 ring-3 ring-primary/15' : 'border-border hover:border-border-strong hover:bg-surface-2/50',
      )}
    >
      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 transition-colors', multi ? 'rounded-[5px]' : 'rounded-full', checked ? 'border-primary bg-primary text-on-primary' : 'border-border-strong')}>
        {checked ? multi ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-2 rounded-full bg-on-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

function QuestionInput({ q, value, onChange }: { q: LearnerQuestion; value: Answer | undefined; onChange: (a: Answer) => void }) {
  switch (q.kind) {
    case 'single_choice':
    case 'true_false':
      return (
        <div role="radiogroup" className="grid gap-2">
          {(q.options ?? []).map((o) => (
            <Choice key={o.id} checked={value === o.id} onSelect={() => onChange(o.id)}>
              {o.body}
            </Choice>
          ))}
        </div>
      )
    case 'multiple_choice': {
      const chosen = Array.isArray(value) ? value : []
      return (
        <div className="grid gap-2">
          <p className="text-sm text-muted">Choose all that apply.</p>
          {(q.options ?? []).map((o) => (
            <Choice key={o.id} multi checked={chosen.includes(o.id)} onSelect={() => onChange(chosen.includes(o.id) ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])}>
              {o.body}
            </Choice>
          ))}
        </div>
      )
    }
    case 'matching': {
      const pairs = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      return (
        <div className="grid gap-2">
          <p className="text-sm text-muted">Match each item with its pair.</p>
          {(q.left ?? []).map((l) => (
            <div key={l.id} className="grid items-center gap-2 rounded-lg border border-border bg-surface p-3 shadow-sm sm:grid-cols-[1fr_minmax(0,1fr)]">
              <span className="text-[15px]">{l.body}</span>
              <NativeSelect aria-label={`Match for ${l.body}`} value={pairs[l.id] ?? ''} onChange={(e) => onChange({ ...pairs, [l.id]: e.target.value })}>
                <option value="">Choose…</option>
                {(q.right ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
      )
    }
    case 'fill_blank': {
      const n = Math.max(1, q.blanks ?? 1)
      const blanks = Array.isArray(value) ? value : []
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: n }, (_, k) => (
            <label key={k} className="grid gap-1 text-sm">
              <span className="text-muted">Blank {k + 1}</span>
              <Input value={blanks[k] ?? ''} onChange={(e) => onChange(Array.from({ length: n }, (_, j) => (j === k ? e.target.value : (blanks[j] ?? ''))))} />
            </label>
          ))}
        </div>
      )
    }
    case 'essay':
      return <Textarea aria-label="Your answer" className="min-h-48" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder="Write your answer. The instructor will mark it." />
    default:
      return <Input aria-label="Your answer" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" />
  }
}

function QuizResult({ attempt, lecture, slug, passMark, canRetry, onRetry, retrying, onBack }: { attempt: Attempt; lecture: Lecture; slug: string; passMark: number; canRetry: boolean; onRetry: () => void; retrying: boolean; onBack: () => void }) {
  const waiting = attempt.status === 'needs_grading'
  const score = attempt.score_pct ?? 0
  return (
    <Sheet lecture={lecture} meta={`Attempt ${attempt.attempt_no}`}>
      <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-surface p-6 text-center shadow-sm sm:flex-row sm:text-left">
        {waiting ? (
          <span className="flex size-[132px] items-center justify-center rounded-full bg-warning-soft text-warning">
            <Hourglass className="size-12" />
          </span>
        ) : (
          <Ring value={score} label={`pass ${passMark}%`} color={attempt.passed ? 'var(--success)' : 'var(--danger)'} />
        )}
        <div className="min-w-0 flex-1">
          {waiting ? (
            <>
              <h2 className="text-lg font-semibold">Waiting for the instructor</h2>
              <p className="mt-1 text-sm text-muted">Some answers are marked by hand. You'll get a notification when your score is ready.</p>
            </>
          ) : attempt.passed ? (
            <>
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-success">
                <CheckCircle2 className="size-5 animate-pop" /> You passed
              </h2>
              <p className="mt-1 text-sm text-muted">Nice work. This lecture is now complete.</p>
            </>
          ) : (
            <>
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
                <XCircle className="size-5 text-danger" /> Not this time
              </h2>
              <p className="mt-1 text-sm text-muted">You need {passMark}% to pass. Review the answers below and try again.</p>
            </>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {canRetry && !waiting ? (
              <Button onClick={onRetry} loading={retrying}>
                <RotateCcw /> Try again
              </Button>
            ) : null}
            {attempt.passed && lecture.next_key ? (
              <Button asChild>
                <Link to={lectureUrl(slug, lecture.next_key)}>
                  Next lecture <ChevronRight />
                </Link>
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onBack}>
              <ListChecks /> All attempts
            </Button>
          </div>
        </div>
      </div>
      {attempt.review?.length ? <Review items={attempt.review} /> : !waiting ? <p className="mt-6 text-sm text-muted">The answers for this quiz are not shown{passMark ? ' until you pass' : ''}.</p> : null}
    </Sheet>
  )
}

function shown(item: ReviewItem): string {
  const a = item.your_answer as Answer | null | undefined
  if (a == null || a === '') return 'No answer'
  const label = (id: string) => item.options?.find((o) => o.id === id)?.body ?? id
  if (typeof a === 'string') return ['single_choice', 'true_false'].includes(item.kind) ? label(a) : a
  if (Array.isArray(a)) return item.kind === 'multiple_choice' ? a.map(label).join(', ') : a.join(' · ')
  return Object.entries(a)
    .map(([k, v]) => `${label(k)} → ${v || '—'}`)
    .join('; ')
}

function Review({ items }: { items: ReviewItem[] }) {
  const byId = useMemo(() => items, [items])
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">Review your answers</h2>
      <ol className="stagger grid gap-3">
        {byId.map((item, n) => {
          const full = item.points != null && item.points >= item.max
          const pending = item.points == null
          const correct = new Set(item.correct_option_ids ?? [])
          return (
            <li key={item.question_id} className={cn('rounded-xl border bg-surface p-4 shadow-sm', pending ? 'border-border' : full ? 'border-success/40' : 'border-danger/30')}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium text-muted">Question {n + 1}</p>
                <Badge tone={pending ? 'warning' : full ? 'success' : item.points ? 'warning' : 'danger'}>{pending ? 'Being marked' : `${item.points} / ${item.max}`}</Badge>
              </div>
              <div className="prose-lesson mt-1 text-[15px] font-medium" dangerouslySetInnerHTML={{ __html: item.prompt }} />
              {correct.size && item.options?.length ? (
                <ul className="mt-3 grid gap-1.5">
                  {item.options.map((o) => {
                    const mine = Array.isArray(item.your_answer) ? (item.your_answer as string[]).includes(o.id) : item.your_answer === o.id
                    return (
                      <li key={o.id} className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', correct.has(o.id) ? 'bg-success-soft text-success' : mine ? 'bg-danger-soft text-danger' : 'text-muted')}>
                        {correct.has(o.id) ? <Check className="size-4 shrink-0" /> : mine ? <X className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                        <span className="min-w-0 flex-1">{o.body}</span>
                        {mine ? <span className="text-xs font-medium">Your answer</span> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm">
                  <span className="text-muted">Your answer: </span>
                  {shown(item)}
                </p>
              )}
              {item.explanation ? <div className="prose-lesson mt-3 rounded-md bg-surface-2 p-3 text-sm" dangerouslySetInnerHTML={{ __html: item.explanation }} /> : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
