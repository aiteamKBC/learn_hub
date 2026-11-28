import { CheckCircle2, ClipboardCheck, Sparkles, Target } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { OBJECTIVE_STATUS, PRIORITY_LABEL, type Review, REVIEW_STATUS, useAcknowledgeReview, useAnalysis, useMyReviews } from '@/features/pms/api'
import { relativeDate } from '@/lib/format'

function AckButton({ review }: { review: Review }) {
  const ack = useAcknowledgeReview(review.id)
  return (
    <Button
      loading={ack.isPending}
      onClick={() => ack.mutate(undefined, { onSuccess: () => toast.success('Thanks — your review is acknowledged'), onError: (err) => toast.error((err as Error).message) })}
    >
      <CheckCircle2 /> Acknowledge
    </Button>
  )
}

function ReviewAnalysis({ reviewId }: { reviewId: string }) {
  const { data, isLoading, error, refetch } = useAnalysis(reviewId)
  if (isLoading) return <Skeleton className="h-24 rounded-lg" />
  if (error) return <ErrorState message={error.message} onRetry={() => void refetch()} />
  if (!data) return <p className="text-sm text-muted">No development analysis has been added to this review yet.</p>
  if (data.status === 'failed') return <p role="status" className="text-sm text-muted">The analysis could not be completed. Please speak to your manager.</p>
  return <section className="grid gap-3 rounded-lg border border-border p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">Development analysis</h3><Badge tone={data.status === 'ok' ? 'success' : 'info'}>{data.status === 'ok' ? 'Completed' : 'Pending'}</Badge></div><p className="whitespace-pre-wrap text-sm">{data.summary}</p>{[['Strengths', data.strengths], ['Development', data.development], ['Suggested actions', data.suggested_actions]].map(([title, items]) => Array.isArray(items) && items.length ? <div key={String(title)}><p className="text-xs font-medium text-muted">{title}</p><ul className="list-disc pl-5 text-sm">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null)}<p className="text-xs text-muted">{data.model_id ? `Model: ${data.model_id}. ` : ''}Discuss these suggestions with your manager.</p></section>
}

function ReviewCard({ review }: { review: Review }) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const s = REVIEW_STATUS[review.status] ?? { label: review.status, tone: 'neutral' as const }
  const canAck = review.status === 'submitted'
  return (
    <Card>
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">Performance review <Badge tone={s.tone}>{s.label}</Badge></span>}
        description={review.submitted_at ? `Shared ${relativeDate(review.submitted_at)}` : 'Draft · still in progress'}
        action={canAck ? <AckButton review={review} /> : review.acknowledged_at ? <Badge tone="success">Acknowledged</Badge> : undefined}
      />
      <CardBody className="grid gap-3 pt-0">
        {review.self_summary ? <div><p className="mb-1 text-xs font-medium text-muted">Your own summary</p><p className="whitespace-pre-wrap text-sm">{review.self_summary}</p></div> : null}
        {review.submitted_at ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['Overall', review.overall_rating != null ? `${review.overall_rating}/5` : '—'],
                ['Competence', review.competence_score ?? '—'],
                ['KPI', review.kpi_score ?? '—'],
                ['Wellbeing', review.wellbeing_score ?? '—'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface-2 p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {review.manager_summary ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Summary</p>
            <p className="text-sm">{review.manager_summary}</p>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {review.strengths ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Strengths</p>
              <p className="text-sm">{review.strengths}</p>
            </div>
          ) : null}
          {review.development_areas ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Development areas</p>
              <p className="text-sm">{review.development_areas}</p>
            </div>
          ) : null}
        </div>
        {review.objectives.length ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Target className="size-3.5" /> Objectives
            </p>
            <ul className="grid gap-2">
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
          </div>
        ) : null}
        <Button size="sm" variant="secondary" className="w-fit" aria-expanded={showAnalysis} onClick={() => setShowAnalysis((shown) => !shown)}><Sparkles /> {showAnalysis ? 'Hide development analysis' : 'View development analysis'}</Button>
        {showAnalysis ? <ReviewAnalysis reviewId={review.id} /> : null}
      </CardBody>
    </Card>
  )
}

export function MyReviewsPage() {
  const { data, isLoading, error, refetch } = useMyReviews()
  return (
    <>
      <PageHeader title="My reviews" description="Your performance reviews. Please acknowledge each one once you have read it." />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-4" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck />} title="No reviews yet" body="When your manager shares a performance review, it appears here." />
        </Card>
      ) : (
        <div className="stagger grid gap-4">
          {data.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
    </>
  )
}
