import { HeartPulse, History, Send, Smile } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'
import { type Wellbeing, WELLBEING_FIELDS, WELLBEING_SCALE, useMyWellbeing, useSubmitWellbeing } from '@/features/hcm/api'

const LIKERT = ['Low', 'Below average', 'Average', 'Good', 'High'] as const
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

type Scores = Record<string, number>

function SurveyForm({ onDone }: { onDone: () => void }) {
  const submit = useSubmitWellbeing()
  const [scores, setScores] = useState<Scores>({ hope: 3, efficacy: 3, resilience: 3, optimism: 3, overall: 3 })
  const [stay, setStay] = useState('3')
  const [satisfaction, setSatisfaction] = useState('3')
  const [note, setNote] = useState('')

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate(
          { hope: (scores.hope - 1) * 25, efficacy: (scores.efficacy - 1) * 25, resilience: (scores.resilience - 1) * 25, optimism: (scores.optimism - 1) * 25, overall: (scores.overall - 1) * 25, stay_intent: (Number(stay) - 1) / 4, satisfaction: (Number(satisfaction) - 1) / 4, note },
          {
            onSuccess: () => {
              toast.success('Thank you. Your check-in is saved.')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {WELLBEING_FIELDS.map((f) => (
          <Field key={f.name} label={f.label} hint={f.help}>
            {(p) => (
              <NativeSelect {...p} value={String(scores[f.name])} onChange={(e) => setScores((s) => ({ ...s, [f.name]: Number(e.target.value) }))}>
                {WELLBEING_SCALE.map((n) => (
                  <option key={n} value={n}>
                    {n} — {LIKERT[n - 1]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ))}
      </div>
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
      <div className="flex justify-end">
        <Button type="submit" loading={submit.isPending}>
          <Send /> Submit check-in
        </Button>
      </div>
    </form>
  )
}

function avg(w: Wellbeing) {
  return ((w.hope + w.efficacy + w.resilience + w.optimism + w.overall) / 5).toFixed(0)
}

function HistoryList({ items }: { items: Wellbeing[] }) {
  if (!items.length)
    return <EmptyState icon={<History />} title="No check-ins yet" body="Your first wellbeing check-in will appear here." />
  return (
    <ul className="stagger grid gap-2 p-4">
      {items.map((w) => (
        <li key={w.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{shortDate(w.submitted_at)}</p>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <Smile className="size-4" aria-hidden /> Average <span className="font-semibold text-text tabular">{avg(w)}</span> / 100
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
            {WELLBEING_FIELDS.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="font-semibold tabular">{w[f.name]} / 100</dd>
              </div>
            ))}
          </dl>
          {w.note ? <p className="mt-3 text-sm text-muted">“{w.note}”</p> : null}
        </li>
      ))}
    </ul>
  )
}

export function MyWellbeingPage() {
  const { data, isLoading, error, refetch } = useMyWellbeing()
  const [open, setOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Wellbeing check-in"
        description="A quick check-in on how work is going. Your responses form part of your company wellbeing record."
      />
      <div className="animate-reveal grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card>
          <CardHeader title={open ? 'New check-in' : 'How are you doing?'} description="Takes less than a minute." action={<HeartPulse className="size-5 text-muted" aria-hidden />} />
          <CardBody>
            {open ? (
              <SurveyForm onDone={() => setOpen(false)} />
            ) : (
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-muted">Tell us how things are at work just now. You can check in as often as you like.</p>
                <Button onClick={() => setOpen(true)}>
                  <HeartPulse /> Start a check-in
                </Button>
              </div>
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
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : (
            <HistoryList items={data} />
          )}
        </Card>
      </div>
    </>
  )
}
