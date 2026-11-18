import { FileText, ListChecks, Plus, Save, Trash2, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useCurrencies } from '@/features/commerce/api'
import {
  useCourseInstalmentContent,
  useCourseInstalmentLearners,
  useCourseInstalmentPlan,
  useSaveCourseInstalments,
  useSetCourseInstalmentEligibility,
} from '@/features/console/courses'
import { money } from '@/lib/format'

type StageDraft = { title: string; release_month: string; lecture_keys: string[]; instalment_numbers: number[] }

const LESSON_KIND_LABEL: Record<string, string> = {
  video: 'Video', article: 'Reading', quiz: 'Quiz', assignment: 'Assignment',
  live_session: 'Live session', external_link: 'Link', download: 'Download',
}

function LessonKind({ kind }: { kind: string }) {
  const Icon = kind === 'video' ? Video : kind === 'quiz' ? ListChecks : FileText
  return <span className="inline-flex shrink-0 items-center gap-1 text-muted" title={LESSON_KIND_LABEL[kind] ?? 'Lesson'}><Icon className="size-3.5" aria-hidden="true" /><span>{LESSON_KIND_LABEL[kind] ?? 'Lesson'}</span></span>
}

function nextReleaseMonth(rows: StageDraft[]) {
  const latest = Math.max(0, ...rows.map((stage) => Number(stage.release_month) || 0))
  return String(Math.min(120, latest + 1))
}

function minorToInput(minor: number, exponent: number): string {
  if (!exponent) return String(minor)
  const digits = String(minor).padStart(exponent + 1, '0')
  const whole = digits.slice(0, -exponent)
  const fraction = digits.slice(-exponent).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function inputToMinor(value: string, exponent: number): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!match || (match[2] ?? '').length > exponent) return null
  const scale = 10 ** exponent
  const minor = Number(match[1]) * scale + Number((match[2] ?? '').padEnd(exponent, '0') || '0')
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

export function CourseInstalments({ courseId }: { courseId: string }) {
  const plan = useCourseInstalmentPlan(courseId)
  const content = useCourseInstalmentContent(courseId)
  const currencies = useCurrencies()
  const save = useSaveCourseInstalments(courseId)
  const [enabled, setEnabled] = useState(false)
  const [currency, setCurrency] = useState('GBP')
  const [total, setTotal] = useState('')
  const [count, setCount] = useState('')
  const [start, setStart] = useState('')
  const [earlyRelease, setEarlyRelease] = useState<'immediate' | 'scheduled'>('immediate')
  const [retryCount, setRetryCount] = useState('')
  const [retryInterval, setRetryInterval] = useState('')
  const [stages, setStages] = useState<StageDraft[]>([])
  const [learnerSearch, setLearnerSearch] = useState('')
  const learners = useCourseInstalmentLearners(courseId, learnerSearch)
  const eligibility = useSetCourseInstalmentEligibility(courseId)

  useEffect(() => {
    if (!plan.data) return
    setEnabled(plan.data.enabled)
    setCurrency(plan.data.currency ?? 'GBP')
    const exponent = currencies.data?.find((item) => item.code === (plan.data.currency ?? 'GBP'))?.exponent ?? 2
    setTotal(plan.data.total_minor == null ? '' : minorToInput(plan.data.total_minor, exponent))
    setCount(plan.data.instalment_count == null ? '' : String(plan.data.instalment_count))
    setStart(plan.data.schedule_start ?? '')
    setEarlyRelease(plan.data.early_release === 'scheduled' ? 'scheduled' : 'immediate')
    setRetryCount(plan.data.retry_count == null ? '' : String(plan.data.retry_count))
    setRetryInterval(plan.data.retry_interval_days == null ? '' : String(plan.data.retry_interval_days))
    setStages(plan.data.stages.map((s) => ({ title: s.title, release_month: String(s.release_month),
      lecture_keys: s.lecture_keys, instalment_numbers: s.instalment_numbers })))
  }, [plan.data, currencies.data])

  const toggleStageNumber = (index: number, number: number) => setStages((rows) => rows.map((row, i) =>
    i !== index ? row : { ...row, instalment_numbers: row.instalment_numbers.includes(number)
      ? row.instalment_numbers.filter((n) => n !== number) : [...row.instalment_numbers, number].sort((a, b) => a - b) },
  ))
  const toggleLecture = (index: number, key: string) => setStages((rows) => {
    const selected = rows[index]!.lecture_keys.includes(key)
    return rows.map((row, i) => {
      if (i === index) return { ...row, lecture_keys: selected ? row.lecture_keys.filter((k) => k !== key) : [...row.lecture_keys, key] }
      return selected ? row : { ...row, lecture_keys: row.lecture_keys.filter((k) => k !== key) }
    })
  })
  const submit = () => {
    const selectedCurrency = currencies.data?.find((c) => c.code === currency)
    if (!selectedCurrency) return toast.error('Choose an available currency.')
    const totalMinor = inputToMinor(total, selectedCurrency.exponent)
    if (!totalMinor || !count || !start || !stages.length) return toast.error('Complete the price, schedule and content stages.')
    save.mutate({ enabled, currency, total_minor: totalMinor, instalment_count: Number(count), schedule_start: start,
      early_release: earlyRelease, retry_count: retryCount === '' ? null : Number(retryCount),
      retry_interval_days: retryInterval === '' ? null : Number(retryInterval),
      stages: stages.map((s) => ({ title: s.title, release_month: Number(s.release_month),
        lecture_keys: s.lecture_keys, instalment_numbers: s.instalment_numbers })),
    }, { onSuccess: () => toast.success('A new instalment plan version was saved.'), onError: (error) => toast.error((error as Error).message) })
  }

  if (plan.isLoading || content.isLoading) return <p className="text-sm text-muted">Loading instalment settings…</p>
  if (plan.error || content.error) return <p role="alert" className="text-sm text-danger">Could not load the instalment setup.</p>
  const paymentCount = Math.max(0, Math.min(120, Number(count) || 0))
  const allCurrencies = currencies.data ?? []

  return (
    <div className="grid gap-4">
      <Card className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold">Fixed course instalments</h3><p className="mt-1 text-sm text-muted">A separate fixed total, divided evenly across monthly instalments. Payment collection and automatic retries will be connected by a later payment integration; this never creates a subscription.</p></div>
          <label className="flex items-center gap-2 text-sm">Available to learners <Switch checked={enabled} onCheckedChange={setEnabled} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Separate instalment total" hint="The total is split evenly. The final payment absorbs any minor-unit remainder.">{(p) => <Input {...p} type="number" min="0.01" step="any" value={total} onChange={(e) => setTotal(e.target.value)} />}</Field>
          <Field label="Currency">{(p) => <NativeSelect {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>{allCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</NativeSelect>}</Field>
          <Field label="Number of monthly payments">{(p) => <Input {...p} type="number" min="1" max="120" value={count} onChange={(e) => setCount(e.target.value)} />}</Field>
          <Field label="Schedule start date">{(p) => <Input {...p} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Early-payment stage release">{(p) => <NativeSelect {...p} value={earlyRelease} onChange={(e) => setEarlyRelease(e.target.value as 'immediate' | 'scheduled')}><option value="immediate">Release mapped stages as soon as paid</option><option value="scheduled">Wait until each stage release date</option></NativeSelect>}</Field>
          <Field label="Retry count for future integration" hint="Required before enabling. No retry count is assumed.">{(p) => <Input {...p} type="number" min="0" max="30" value={retryCount} onChange={(e) => setRetryCount(e.target.value)} />}</Field>
          <Field label="Days between retries" hint="Used when automatic payment integration is connected.">{(p) => <Input {...p} type="number" min="1" max="365" value={retryInterval} onChange={(e) => setRetryInterval(e.target.value)} />}</Field>
        </div>
        {total && count && allCurrencies.find((c) => c.code === currency) ? <p className="text-xs text-muted">Fixed total: {money(inputToMinor(total, allCurrencies.find((c) => c.code === currency)!.exponent) ?? 0, currency, allCurrencies.find((c) => c.code === currency)!.exponent)} · {count} monthly payments.</p> : null}
      </Card>

      <Card className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Content stages and payment mapping</h3><p className="mt-1 text-sm text-muted">Name each stage, then assign its lessons and payment. Lessons already assigned to an earlier stage are hidden from the next one.</p></div><Button size="sm" variant="secondary" onClick={() => setStages((rows) => [...rows, { title: '', release_month: nextReleaseMonth(rows), lecture_keys: [], instalment_numbers: [] }])}><Plus /> Add stage</Button></div>
        {stages.map((stage, index) => (
          <section key={`stage-${index}`} className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex items-end gap-2"><div className="flex-1"><Field label={`Stage ${index + 1} · Rename stage`}>{(p) => <Input {...p} value={stage.title} onChange={(e) => setStages((rows) => rows.map((r, i) => i === index ? { ...r, title: e.target.value } : r))} placeholder={`e.g. Stage ${index + 1}: Foundations`} />}</Field></div><div className="w-28"><Field label="Release month">{(p) => <Input {...p} type="number" min="1" max="120" value={stage.release_month} onChange={(e) => setStages((rows) => rows.map((r, i) => i === index ? { ...r, release_month: e.target.value } : r))} />}</Field></div><Button variant="ghost" size="icon" aria-label={`Remove stage ${index + 1}`} onClick={() => setStages((rows) => rows.filter((_, i) => i !== index))}><Trash2 /></Button></div>
            <div><p className="mb-2 text-xs font-medium">Lessons in this stage</p><div className="grid gap-1 sm:grid-cols-2">{content.data?.filter((lecture) => !stages.slice(0, index).some((earlier) => earlier.lecture_keys.includes(lecture.lecture_key))).map((lecture) => <label key={lecture.lecture_key} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={stage.lecture_keys.includes(lecture.lecture_key)} onChange={() => toggleLecture(index, lecture.lecture_key)} className="mt-0.5 accent-primary" /><span className="flex min-w-0 items-center gap-1.5"><LessonKind kind={lecture.kind} /><span aria-hidden="true">·</span><span>{lecture.section} · {lecture.title}</span></span></label>)}</div></div>
            <div><p className="mb-2 text-xs font-medium">Payments that unlock this stage</p><div className="flex flex-wrap gap-3">{Array.from({ length: paymentCount }, (_, n) => n + 1).map((number) => <label key={number} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={stage.instalment_numbers.includes(number)} onChange={() => toggleStageNumber(index, number)} className="accent-primary" />Payment {number}</label>)}</div></div>
          </section>
        ))}
        <Button onClick={submit} loading={save.isPending}><Save /> Save new plan version</Button>
      </Card>

      <Card className="grid gap-3 p-4">
        <div><h3 className="font-semibold">Per-learner schedule and existing learners</h3><p className="mt-1 text-sm text-muted">Allow a learner to opt in. For a late entrant, set their schedule start date. Existing cash, token or subscription access remains unchanged.</p></div>
        <Field label="Find learner by name or email">{(p) => <Input {...p} value={learnerSearch} onChange={(e) => setLearnerSearch(e.target.value)} placeholder="Search current or late entrants" />}</Field>
        <ul className="grid gap-2">{learners.data?.map((learner) => <li key={learner.user_id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{learner.full_name || learner.email}</p><p className="truncate text-xs text-muted">{learner.email}</p></div><label className="flex items-center gap-2 text-xs">Allow opt-in <Switch checked={learner.eligible} disabled={eligibility.isPending} onCheckedChange={(checked) => eligibility.mutate({ userId: learner.user_id, enabled: checked, scheduleStart: learner.schedule_start })} /></label><Input type="date" aria-label={`Schedule start for ${learner.email}`} value={learner.schedule_start ?? ''} onChange={(e) => eligibility.mutate({ userId: learner.user_id, enabled: learner.eligible, scheduleStart: e.target.value || null })} className="w-40" /></li>)}</ul>
      </Card>
    </div>
  )
}
