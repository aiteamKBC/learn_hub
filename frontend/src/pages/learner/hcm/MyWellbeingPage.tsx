import { ArrowLeft, ClipboardCheck, HeartPulse, History, RefreshCw, Send, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { type Wellbeing, type WbAnswers, WB_DIMENSIONS, WB_QUESTIONS, WB_SCALE, useMyWellbeing, useSubmitWellbeing, wbBand, wbScores, wbSubscale } from '@/features/hcm/api'
import { WellbeingBars, WellbeingResult } from '@/features/hcm/wellbeing-result'

const INTENT = [
  { value: '1', label: 'Actively looking elsewhere' },
  { value: '2', label: 'Might look' },
  { value: '3', label: 'Not sure' },
  { value: '4', label: 'Likely to stay' },
  { value: '5', label: 'Here for the long term' },
]
const SATISFACTION = [
  { value: '1', label: 'Unhappy' },
  { value: '2', label: 'Somewhat unhappy' },
  { value: '3', label: 'Neutral' },
  { value: '4', label: 'Satisfied' },
  { value: '5', label: 'Very satisfied' },
]

/** One accessible 1–5 agreement scale (native radios, styled as a row of dots). */
function Likert({ name, value, onChange }: { name: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="How much you agree" className="flex items-center gap-1.5 sm:gap-2">
      {WB_SCALE.map((opt) => {
        const active = value === opt.value
        return (
          <label key={opt.value} title={opt.label} className="cursor-pointer">
            <input type="radio" name={name} className="peer sr-only" checked={active} onChange={() => onChange(opt.value)} />
            <span
              className={cn(
                'grid size-9 place-items-center rounded-full border text-sm font-semibold tabular transition peer-focus-visible:ring-3 peer-focus-visible:ring-primary/30',
                active ? 'scale-105 border-primary bg-primary text-white shadow-sm' : 'border-border text-subtle hover:border-primary hover:text-primary',
              )}
            >
              {opt.value}
            </span>
          </label>
        )
      })}
    </div>
  )
}

function Assessment({ onDone, onCancel }: { onDone: (survey: Wellbeing) => void; onCancel: () => void }) {
  const submit = useSubmitWellbeing()
  const [answers, setAnswers] = useState<WbAnswers>({})
  const [stay, setStay] = useState('3')
  const [satisfaction, setSatisfaction] = useState('3')
  const [note, setNote] = useState('')

  const answered = Object.keys(answers).length
  const complete = answered === WB_QUESTIONS.length
  const set = (code: string, v: number) => setAnswers((a) => ({ ...a, [code]: v }))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete) {
      toast.error('Please answer every statement first.')
      return
    }
    submit.mutate(
      { ...wbScores(answers), stay_intent: (Number(stay) - 1) / 4, satisfaction: (Number(satisfaction) - 1) / 4, note, answers },
      {
        onSuccess: (survey) => {
          toast.success('Thank you. Your check-in is saved.')
          onDone(survey as Wellbeing)
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <form className="grid gap-6" onSubmit={onSubmit}>
      {/* Sticky progress + scale legend */}
      <div className="sticky top-2 z-10 grid gap-2 rounded-xl border border-border bg-surface/90 p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">
            {answered} of {WB_QUESTIONS.length} answered
          </span>
          <span className="hidden text-xs text-muted sm:inline">1 = Strongly disagree · 5 = Strongly agree</span>
        </div>
        <Progress value={(answered / WB_QUESTIONS.length) * 100} tone={complete ? 'success' : 'primary'} label="Assessment progress" />
      </div>

      {WB_DIMENSIONS.map((d) => {
        const questions = WB_QUESTIONS.filter((q) => q.dimension === d.key)
        const sub = wbSubscale(answers, d.key)
        return (
          <section key={d.key} className="grid gap-3 rounded-xl border border-border/70 p-4">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{d.label}</h3>
                <p className="text-sm text-muted">{d.blurb}</p>
              </div>
              {sub != null ? (
                <Badge tone={wbBand(sub).tone} className="shrink-0 tabular">
                  {sub} / 100
                </Badge>
              ) : null}
            </header>
            <ol className="grid gap-1">
              {questions.map((q) => (
                <li
                  key={q.code}
                  className="flex flex-col gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-surface-2/40 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <p className="text-sm text-text">{q.text}</p>
                  <div className="shrink-0">
                    <Likert name={q.code} value={answers[q.code]} onChange={(v) => set(q.code, v)} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )
      })}

      <section className="grid gap-4 rounded-xl border border-border/70 p-4">
        <header>
          <h3 className="font-semibold">A little more</h3>
          <p className="text-sm text-muted">Two quick questions and anything you want to add.</p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How likely are you to stay?">
            {(p) => (
              <NativeSelect {...p} value={stay} onChange={(e) => setStay(e.target.value)}>
                {INTENT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Job satisfaction">
            {(p) => (
              <NativeSelect {...p} value={satisfaction} onChange={(e) => setSatisfaction(e.target.value)}>
                {SATISFACTION.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wb-note">Anything you want to add</Label>
          <Textarea id="wb-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. What is going well, and what would help." />
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <ArrowLeft /> Cancel
        </Button>
        <Button type="submit" loading={submit.isPending} disabled={!complete}>
          <Send /> Submit check-in
        </Button>
      </div>
    </form>
  )
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        A short check-in on how work is going — {WB_QUESTIONS.length} quick statements across four areas, then a couple of extra questions. It takes about two minutes, and your answers form part of your company wellbeing record.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {WB_DIMENSIONS.map((d) => (
          <li key={d.key} className="flex items-start gap-2.5 rounded-lg border border-border/70 p-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{d.label}</p>
              <p className="text-xs text-muted">{d.blurb}</p>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <Button onClick={onStart}>
          <HeartPulse /> Start check-in
        </Button>
      </div>
    </div>
  )
}

function HistoryList({ items }: { items: Wellbeing[] }) {
  if (!items.length)
    return <EmptyState icon={<History />} title="No check-ins yet" body="Your first wellbeing check-in will appear here." />
  return (
    <ul className="stagger grid gap-3 p-4">
      {items.map((w) => {
        const band = wbBand(w.overall)
        return (
          <li key={w.id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{shortDate(w.submitted_at)}</p>
              <span className="inline-flex items-center gap-2 text-sm">
                <Badge tone={band.tone}>{band.label}</Badge>
                <span className="font-semibold tabular">{w.overall}</span>
                <span className="text-xs text-muted">/ 100</span>
              </span>
            </div>
            <div className="mt-3">
              <WellbeingBars survey={w} />
            </div>
            {w.note ? <p className="mt-3 text-sm text-muted">“{w.note}”</p> : null}
          </li>
        )
      })}
    </ul>
  )
}

export function MyWellbeingPage() {
  const { data, isLoading, error, refetch } = useMyWellbeing()
  const [stage, setStage] = useState<'intro' | 'form' | 'done'>('intro')
  const [result, setResult] = useState<Wellbeing | null>(null)

  const title = useMemo(() => (stage === 'form' ? 'Wellbeing check-in' : stage === 'done' ? 'Your result' : 'How are you doing?'), [stage])

  return (
    <>
      <PageHeader
        title="Wellbeing check-in"
        description="A short check-in on how work is going. Your responses form part of your company wellbeing record."
      />

      {stage === 'form' ? (
        <div className="animate-reveal mx-auto w-full max-w-3xl">
          <Card>
            <CardHeader title={title} description="Rate each statement honestly — there are no right answers." action={<ClipboardCheck className="size-5 text-muted" aria-hidden />} />
            <CardBody>
              <Assessment
                onDone={(survey) => {
                  setResult(survey)
                  setStage('done')
                }}
                onCancel={() => setStage('intro')}
              />
            </CardBody>
          </Card>
        </div>
      ) : (
        <div className="animate-reveal grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <Card>
            <CardHeader
              title={title}
              description={stage === 'done' ? 'Saved to your wellbeing record.' : 'Takes about two minutes.'}
              action={<HeartPulse className="size-5 text-muted" aria-hidden />}
            />
            <CardBody>
              {stage === 'done' && result ? (
                <div className="grid gap-6">
                  <WellbeingResult survey={result} />
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => setStage('intro')}>
                      <RefreshCw /> New check-in
                    </Button>
                  </div>
                </div>
              ) : (
                <Intro onStart={() => setStage('form')} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your recent check-ins" action={<History className="size-5 text-muted" aria-hidden />} />
            {error ? (
              <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
            ) : isLoading || !data ? (
              <div className="grid gap-2 p-4">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            ) : (
              <HistoryList items={data} />
            )}
          </Card>
        </div>
      )}
    </>
  )
}
