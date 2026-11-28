import { ArrowLeft, Plus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { CYCLE_STATUS, REVIEW_STATUS, useCreateReview, useCycleReviews, useCycles } from '@/features/pms/api'
import { MemberSelect, useMemberNames, memberName } from '@/features/pms/members'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function CreateReviewDialog({ cycleId }: { cycleId: string }) {
  const [open, setOpen] = useState(false)
  const [member, setMember] = useState('')
  const [reviewer, setReviewer] = useState('')
  const create = useCreateReview()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!member) return
    create.mutate(
      { cycle_id: cycleId, member_id: member, reviewer_id: reviewer || null },
      {
        onSuccess: () => {
          toast.success('Review created')
          setOpen(false)
          setMember('')
          setReviewer('')
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New review
      </Button>
      <DialogContent title="Start a review" description="Pick the person being reviewed and, if you like, who reviews them.">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Team member
            <MemberSelect label="Team member" value={member} onChange={setMember} allowNone noneLabel="Choose a person…" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Reviewer (optional)
            <MemberSelect label="Reviewer (optional)" value={reviewer} onChange={setReviewer} allowNone noneLabel="Assign later" />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending} disabled={!member}>
              Create review
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>()
  const admin = useIsOrgAdmin()
  const cycles = useCycles()
  const cycle = cycles.data?.find((c) => c.id === cycleId)
  const { data, isLoading, error, refetch } = useCycleReviews(cycleId)
  const names = useMemberNames()
  const cs = cycle ? CYCLE_STATUS[cycle.status] : undefined

  return (
    <>
      <PageHeader
        back={
          <Link to="/business/pms/cycles" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" /> All cycles
          </Link>
        }
        title={cycle ? cycle.name : 'Review cycle'}
        description={cycle ? `Q${cycle.quarter} ${cycle.year}` : undefined}
        actions={
          <span className="flex items-center gap-2">
            {cs ? <Badge tone={cs.tone}>{cs.label}</Badge> : null}
            {admin && cycleId ? <CreateReviewDialog cycleId={cycleId} /> : null}
          </span>
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<UserRound />} title="No reviews yet" body={admin ? 'Start a review for a team member.' : 'No reviews have been created in this cycle.'} action={admin && cycleId ? <CreateReviewDialog cycleId={cycleId} /> : undefined} />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {data.map((r) => {
            const s = REVIEW_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{memberName(names, r.member_id)}</h3>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {r.overall_rating != null ? <Badge tone="outline">Rating {r.overall_rating}/5</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      Reviewer: {memberName(names, r.reviewer_id)} · {r.objectives.length} {r.objectives.length === 1 ? 'objective' : 'objectives'}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={`/business/pms/reviews/${r.id}`}>Open review</Link>
                  </Button>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
