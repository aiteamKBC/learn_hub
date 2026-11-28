/**
 * Console > Employee invitations: employers' employee lists for paid recorded seats.
 * When "Require Admin Approval for Employee Invitations" is on (Settings > Payment), new
 * lists wait here; approving sends the invites, rejecting frees the seats. Lists sent
 * while approval was off show here as approved automatically.
 */
import { Check, MailCheck, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type SeatRequest, useConsoleSeatRequests, useReviewSeatRequest } from '@/features/corporate/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'
import { toast } from '@/lib/toast'

const STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

type Row = SeatRequest & { org_name: string }

function Review({ req, approve, onClose }: { req: Row | null; approve: boolean; onClose: () => void }) {
  const [note, setNote] = useState('')
  const review = useReviewSeatRequest()
  if (!req) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={approve ? 'Approve and send invitations?' : 'Reject this list?'}
        description={approve ? `${req.rows.length} ${req.rows.length === 1 ? 'person' : 'people'} at ${req.org_name} will be emailed (or get the course now if already in the company).` : 'Nothing is sent and the seats become free again for the company.'}
      >
        <label className="grid gap-1 text-sm">
          Note (optional)
          <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={approve ? '' : 'Why it was rejected'} />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={approve ? 'primary' : 'danger'}
            loading={review.isPending}
            onClick={() =>
              review.mutate(
                { id: req.id, approve, note },
                { onSuccess: () => (toast.success(approve ? 'Approved. Invitations are on their way.' : 'Rejected. The seats are free again.'), onClose()), onError: (e) => toast.error((e as Error).message) },
              )
            }
          >
            {approve ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConsoleSeatRequestsPage() {
  const [status, setStatus] = useState('pending_approval')
  const q = useConsoleSeatRequests(status)
  const [act, setAct] = useState<{ req: Row; approve: boolean } | null>(null)
  return (
    <>
      <PageHeader
        title="Employee invitations"
        description={
          <>
            Employee lists companies sent for their paid seats. Approval is needed only while it is switched on in{' '}
            <Link to="/console/settings" className="font-medium text-primary hover:underline">
              Settings › Payment
            </Link>
            .
          </>
        }
      />
      <Tabs value={status} onValueChange={setStatus} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending_approval">Waiting</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : !q.data.length ? (
        <Card>
          <EmptyState icon={<MailCheck />} title={status === 'pending_approval' ? 'Nothing waiting' : 'No lists here'} body="Lists appear here when a company sends employees for its paid seats." />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {q.data.map((r) => (
            <li key={r.id}>
              <Card className="grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.org_name}</p>
                    <p className="text-sm text-muted">
                      {r.course_title} · {r.rows.length} {r.rows.length === 1 ? 'person' : 'people'} · {r.source === 'csv' ? 'CSV file' : 'typed in'} · sent by {r.submitted_by}, {shortDate(r.submitted_at)}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS[r.status]?.tone ?? 'warning'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.auto_approved ? <Badge tone="outline">No approval needed</Badge> : null}
                  </span>
                </div>
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {r.rows.map((p) => (
                    <li key={p.id} className="min-w-0 truncate">
                      <span className="font-medium">{p.email}</span>
                      {p.full_name || p.job_title ? <span className="text-muted"> · {[p.full_name, p.job_title].filter(Boolean).join(', ')}</span> : null}
                    </li>
                  ))}
                </ul>
                {r.review_note ? <p className="text-xs text-muted">Note: {r.review_note}</p> : null}
                {r.status === 'pending_approval' ? (
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setAct({ req: r, approve: false })}>
                      <X /> Reject
                    </Button>
                    <Button size="sm" onClick={() => setAct({ req: r, approve: true })}>
                      <Check /> Approve
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Review key={act?.req.id} req={act?.req ?? null} approve={!!act?.approve} onClose={() => setAct(null)} />
    </>
  )
}
