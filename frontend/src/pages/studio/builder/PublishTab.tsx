import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FilePlus2, Info, MessageSquareWarning, Rocket, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Label, Textarea } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/switch'
import { type StudioCourse, useNewDraft, useSubmitForReview } from '@/features/studio/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

import { VERSION_STATUS } from './status'

/** Where to fix a checklist problem. The wording comes from the API unchanged; we only
 * read it to pick a tab, and the lecture title (in quotes) to focus it there. */
function fixLink(problem: string, base: string) {
  const p = problem.toLowerCase()
  if (/price|tier/.test(p)) return { to: `${base}/pricing`, label: 'Go to pricing' }
  if (/lecture|section|quiz|video|reading|assignment|live session|question/.test(p)) {
    const title = problem.match(/^[^']*'(.*)'(?: has| is|:)/)?.[1]
    return { to: `${base}/curriculum${title ? `?focus=${encodeURIComponent(title)}` : ''}`, label: 'Go to curriculum' }
  }
  return { to: base, label: 'Go to details' }
}

/** Advice the server doesn't block on, but learners will notice. */
function recommendations(course: StudioCourse, base: string) {
  const out: { text: string; to: string }[] = []
  if (!course.description.trim()) out.push({ text: 'Add a description so learners know what the course covers.', to: base })
  if (!course.category_id) out.push({ text: 'Choose a category so learners can find the course.', to: base })
  if (!course.thumbnail_url) out.push({ text: 'Add a course image.', to: base })
  if (course.ownership !== 'organization' && !course.price) out.push({ text: 'Set a price, or make the course free.', to: `${base}/pricing` })
  return out
}

function VersionHistory({ course }: { course: StudioCourse }) {
  if (!course.versions.length) return null
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Version history</h2>
      <ol className="mt-3 grid gap-2 stagger">
        {course.versions.map((v) => {
          const s = VERSION_STATUS[v.status] ?? { label: v.status, tone: 'neutral' as const }
          return (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="font-medium">Version {v.number}</span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {v.published_at ? `Published ${shortDate(v.published_at)}` : null}
                <Badge tone={s.tone}>{s.label}</Badge>
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function SubmitPanel({ course }: { course: StudioCourse }) {
  const v = course.working_version!
  const qc = useQueryClient()
  const submit = useSubmitForReview(course.id)
  const [summary, setSummary] = useState('')
  const [redo, setRedo] = useState(false)
  const [major, setMajor] = useState(false)
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null)
  const company = course.ownership !== 'instructor' // company and platform courses publish straight away

  const onSubmit = () => {
    setError(null)
    submit.mutate(
      { versionId: v.id, change_summary: summary.trim(), requires_recompletion: v.number > 1 && redo, is_major_change: v.number > 1 && major },
      {
        onSuccess: (r) => toast.success(r.status === 'published' ? 'Published' : 'Sent for review'),
        onError: (e) => {
          const problems = e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : []
          setError({ message: (e as Error).message, problems })
          // the checklist may have changed since this page loaded
          void qc.invalidateQueries({ queryKey: ['studio', 'course', course.id] })
        },
      },
    )
  }

  return (
    <Card className="grid gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">Ready to submit</h2>
          <p className="mt-0.5 text-sm text-muted">
            {company ? 'Nothing blocks this version. Publishing makes it live straight away.' : 'Nothing blocks this version. Our team reviews it before it goes live.'}
          </p>
        </div>
      </div>
      <Field label="What changed (optional)" hint="A short note for the reviewer.">
        {(p) => <Textarea {...p} rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />}
      </Field>
      {v.number > 1 && !company ? (
        <div className="flex items-start gap-2.5">
          <Checkbox id="major" checked={major} onCheckedChange={(c) => setMajor(c === true)} className="mt-0.5" />
          <Label htmlFor="major" className="font-normal">
            This is a major change
            <span className="block text-[13px] text-muted">New sections, a different scope or a new price. The reviewer sees it flagged.</span>
          </Label>
        </div>
      ) : null}
      {v.number > 1 ? (
        <div className="flex items-start gap-2.5">
          <Checkbox id="redo" checked={redo} onCheckedChange={(c) => setRedo(c === true)} className="mt-0.5" />
          <Label htmlFor="redo" className="font-normal">
            Learners must redo the course
            <span className="block text-[13px] text-muted">Use this when the changes are big enough that earlier completions no longer count.</span>
          </Label>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <p>{error.message}</p>
          {error.problems.length ? (
            <ul className="mt-1 list-disc pl-5">
              {error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Button onClick={onSubmit} loading={submit.isPending} className="justify-self-start">
        <Send /> {company ? 'Publish' : 'Submit for review'}
      </Button>
    </Card>
  )
}

export function PublishTab({ course }: { course: StudioCourse }) {
  const base = `/studio/courses/${course.id}`
  const v = course.working_version
  const newDraft = useNewDraft(course.id)
  const notes = v ? course.versions.find((x) => x.id === v.id)?.review_notes?.trim() : ''
  const recs = recommendations(course, base)

  let main
  if (!v) {
    main = (
      <Card className="p-6 text-sm text-muted">This course has no version yet. Start with the curriculum.</Card>
    )
  } else if (v.status === 'in_review') {
    main = (
      <Card className="flex items-start gap-3 p-5 sm:p-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
          <Clock className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">Waiting for review</h2>
          <p className="mt-0.5 text-sm text-muted">Version {v.number} is with our team. We'll send you a notification when it's approved or if changes are needed. You can't edit it while it's in review.</p>
        </div>
      </Card>
    )
  } else if (v.status === 'published') {
    main = (
      <Card className="grid gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
            <Rocket className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold">Live</h2>
            <p className="mt-0.5 text-sm text-muted">
              Version {v.number} is what learners see. To change the curriculum, create a new draft. Learners keep the live version until the new one is approved.
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          className="justify-self-start"
          loading={newDraft.isPending}
          onClick={() =>
            newDraft.mutate(undefined, {
              onSuccess: (r) => toast.success(`Draft version ${r.number} created`),
              onError: (e) => toast.error((e as Error).message),
            })
          }
        >
          <FilePlus2 /> Create new draft
        </Button>
      </Card>
    )
  } else {
    // draft or changes requested: the checklist, then submit
    main = (
      <div className="grid gap-4">
        {v.status === 'changes_requested' ? (
          <Card className="border-warning/50 bg-warning-soft/40 p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MessageSquareWarning className="size-5 text-warning" aria-hidden /> Changes requested
            </h2>
            <p className="mt-2 text-sm whitespace-pre-line">{notes || 'The reviewer asked for changes but left no notes.'}</p>
            <p className="mt-2 text-xs text-muted">Make the changes, then submit again.</p>
          </Card>
        ) : null}
        {v.checklist.length ? (
          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-5 text-warning" aria-hidden /> Fix {v.checklist.length === 1 ? 'this' : `these ${v.checklist.length} problems`} before you submit
            </h2>
            <ul className="mt-4 grid gap-2 stagger">
              {v.checklist.map((problem, i) => {
                const fix = fixLink(problem, base)
                return (
                  <li key={`${i}-${problem}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 text-sm break-words">{problem}</span>
                    <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
                      <Link to={fix.to}>
                        {fix.label} <ArrowRight />
                      </Link>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Card>
        ) : (
          <SubmitPanel course={course} />
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-6">{main}</div>
      <div className="grid min-w-0 content-start gap-6">
        {recs.length && v && v.editable ? (
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Info className="size-4 text-info" aria-hidden /> Recommended
            </h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {recs.map((r) => (
                <li key={r.text}>
                  <Link to={r.to} className="text-text underline-offset-4 hover:text-primary hover:underline">
                    {r.text}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <VersionHistory course={course} />
        {course.ownership === 'instructor' ? (
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">What happens next?</h2>
            <p className="mt-1 text-muted">Our team reviews your course. You'll get a notification when it's approved, or if changes are needed.</p>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
