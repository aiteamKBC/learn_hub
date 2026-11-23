import { ArrowLeft, Check, Plus, Save, Sparkles, Target } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { type ObjectiveIn, OBJECTIVE_STATUS, PRIORITY_LABEL, REVIEW_STATUS, type Review, useAddObjective, useAnalysis, useGenerateAnalysis, useReview, useSubmitReview, useUpdateReview } from '@/features/pms/api'
import { useMemberNames, memberName } from '@/features/pms/members'
import { useIsOrgAdmin } from '@/features/org/api'
import { relativeDate } from '@/lib/format'
import { Link } from '@/lib/router'

function EditForm({ review, onDirtyChange }: { review: Review; onDirtyChange: (dirty: boolean) => void }) {
  const update = useUpdateReview(review.id)
  const locked = review.status === 'acknowledged'
  const [self, setSelf] = useState(review.self_summary)
  const [manager, setManager] = useState(review.manager_summary)
  const [strengths, setStrengths] = useState(review.strengths)
  const [dev, setDev] = useState(review.development_areas)
  const [rating, setRating] = useState<number | ''>(review.overall_rating ?? '')

  function save() {
    update.mutate(
      { self_summary: self, manager_summary: manager, strengths, development_areas: dev, ...(rating === '' ? {} : { overall_rating: Number(rating) }) },
      { onSuccess: () => { toast.success('Saved'); onDirtyChange(false) }, onError: (err) => toast.error((err as Error).message) },
    )
  }

  return (
    <Card>
      <CardHeader title="Manager assessment" description={locked ? 'This review has been acknowledged and can no longer be edited.' : 'Record the discussion and set an overall rating. Save before submitting.'} />
      <CardBody className="grid gap-3 pt-0" onChange={() => onDirtyChange(true)}>
        <label className="grid gap-1 text-xs text-muted">Person's own summary<Textarea value={self} maxLength={8000} onChange={(e) => setSelf(e.target.value)} disabled={locked} /></label>
        <label className="grid gap-1 text-xs text-muted">
          Manager summary
          <Textarea value={manager} onChange={(e) => setManager(e.target.value)} disabled={locked} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            Strengths
            <Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} disabled={locked} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Development areas
            <Textarea value={dev} onChange={(e) => setDev(e.target.value)} disabled={locked} />
          </label>
        </div>
        <label className="grid max-w-40 gap-1 text-xs text-muted">
          Overall rating (1–5)
          <NativeSelect aria-label="Overall rating (1–5)" value={String(rating)} onChange={(e) => { setRating(e.target.value === '' ? '' : Number(e.target.value)); onDirtyChange(true) }} disabled={locked}>
            {review.overall_rating == null ? <option value="">Not set</option> : null}
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
        {!locked ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={update.isPending}>
              <Save /> Save
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

function AddObjectiveDialog({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false)
  const add = useAddObjective(reviewId)
  const [form, setForm] = useState<ObjectiveIn>({ title: '', measure: '', priority: 'medium', progress_pct: 0, status: 'open' })
  const set = (p: Partial<ObjectiveIn>) => setForm((f) => ({ ...f, ...p }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    add.mutate(form, {
      onSuccess: () => {
        toast.success('Objective added')
        setOpen(false)
        setForm({ title: '', measure: '', priority: 'medium', progress_pct: 0, status: 'open' })
      },
      onError: (err) => toast.error((err as Error).message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Add objective
      </Button>
      <DialogContent title="Add a SMART objective" description="Specific, measurable and time-bound.">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Objective
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} required />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            How it is measured
            <Textarea value={form.measure} onChange={(e) => set({ measure: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Priority
              <NativeSelect aria-label="Priority" value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Progress %
              <Input type="number" min={0} max={100} value={form.progress_pct} onChange={(e) => set({ progress_pct: Number(e.target.value) })} />
            </label>
          </div>
          <label className="grid gap-1 text-xs text-muted">Status<NativeSelect aria-label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })}>{Object.entries(OBJECTIVE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={add.isPending}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AnalysisPanel({ reviewId, canGenerate }: { reviewId: string; canGenerate: boolean }) {
  const { data, isLoading, error, refetch } = useAnalysis(reviewId)
  const generate = useGenerateAnalysis(reviewId)
  const list = (items: string[], title: string) =>
    items.length ? (
      <div>
        <p className="mb-1 text-xs font-medium text-muted">{title}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <Card>
      <CardHeader
        title="AI analysis"
        description="Development suggestions drawn from the review's scores and notes. Check them before making decisions."
        action={
          canGenerate ? (
            <Button
              size="sm"
              variant="secondary"
              loading={generate.isPending}
              onClick={() => generate.mutate(undefined, { onSuccess: () => toast.success('Analysis generated'), onError: (err) => toast.error((err as Error).message) })}
            >
              <Sparkles /> {data && data.status !== 'pending' ? 'Regenerate' : 'Generate'}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-0">
        {isLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : !data ? (
          <p className="text-sm text-muted">No analysis yet. {canGenerate ? 'Generate one once the review has scores.' : ''}</p>
        ) : data.status === 'failed' ? (
          <p className="text-sm text-danger">Could not generate: {data.error || 'unknown error'}</p>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={data.status === 'ok' ? 'success' : 'info'}>{data.status === 'ok' ? 'Completed' : 'Pending'}</Badge>
              {data.model_id ? <span>Model: {data.model_id}</span> : null}
              {data.generated_at ? <span>· {relativeDate(data.generated_at)}</span> : null}
            </div>
            {data.summary ? <p className="text-sm">{data.summary}</p> : null}
            {list(data.strengths, 'Strengths')}
            {list(data.development, 'Development')}
            {list(data.suggested_actions, 'Suggested actions')}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function ReviewPage() {
  const { reviewId } = useParams<{ reviewId: string }>()
  const admin = useIsOrgAdmin()
  const { data: review, isLoading, error, refetch } = useReview(reviewId)
  const submit = useSubmitReview(reviewId ?? '', review?.cycle_id)
  const names = useMemberNames()
  const [dirty, setDirty] = useState(false)

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !review)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )

  const s = REVIEW_STATUS[review.status] ?? { label: review.status, tone: 'neutral' as const }
  const editable = review.status !== 'acknowledged'

  return (
    <>
      <PageHeader
        back={
          <Link to={`/business/pms/cycles/${review.cycle_id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Review cycle</Link>
        }
        title={memberName(names, review.member_id)}
        description={`Reviewer: ${memberName(names, review.reviewer_id)}`}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            {admin && review.status === 'draft' ? (
              <Button
                loading={submit.isPending}
                disabled={dirty}
                onClick={() => submit.mutate(undefined, { onSuccess: () => toast.success('Review submitted — scores snapshotted'), onError: (err) => toast.error((err as Error).message) })}
              >
                <Check /> {dirty ? 'Save changes first' : 'Submit review'}
              </Button>
            ) : null}
          </span>
        }
      />

      {review.submitted_at ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['Overall', review.overall_rating != null ? `${review.overall_rating}/5` : '—'],
              ['Competence', review.competence_score ?? '—'],
              ['KPI', review.kpi_score ?? '—'],
              ['Wellbeing', review.wellbeing_score ?? '—'],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular">{value}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4">
        {admin ? <EditForm key={review.id} review={review} onDirtyChange={setDirty} /> : <Card><CardHeader title="Review discussion" /><CardBody className="grid gap-3">{[['Own summary', review.self_summary], ['Manager summary', review.manager_summary], ['Strengths', review.strengths], ['Development areas', review.development_areas]].map(([label, value]) => <div key={label}><p className="text-xs font-medium text-muted">{label}</p><p className="whitespace-pre-wrap text-sm">{value || 'Not recorded'}</p></div>)}</CardBody></Card>}

        <Card>
          <CardHeader title="Objectives" description="SMART goals for the period ahead." action={admin && editable && reviewId ? <AddObjectiveDialog reviewId={reviewId} /> : undefined} />
          <CardBody className="pt-0">
            {review.objectives.length === 0 ? (
              <EmptyState icon={<Target />} title="No objectives yet" body={admin ? 'Add a SMART objective.' : 'No objectives have been set.'} />
            ) : (
              <ul className="grid gap-3">
                {review.objectives.map((o) => (
                  <li key={o.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.title}</span>
                      <Badge tone={o.priority === 'high' ? 'warning' : 'neutral'}>{PRIORITY_LABEL[o.priority] ?? o.priority}</Badge>
                      <Badge tone="outline">{OBJECTIVE_STATUS[o.status] ?? o.status}</Badge>
                    </div>
                    {o.measure ? <p className="mt-1 text-sm text-muted">{o.measure}</p> : null}
                    <div className="mt-2 flex items-center gap-3">
                      <Progress value={o.progress_pct} className="flex-1" label={`${o.title} progress`} />
                      <span className="text-xs tabular text-muted">{o.progress_pct}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {reviewId ? <AnalysisPanel reviewId={reviewId} canGenerate={admin && !dirty} /> : null}
      </div>
    </>
  )
}
