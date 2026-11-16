import { Undo2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { CANCEL_STATUS, CANCEL_TYPE, useCancellations, useLiveBookings, usePurchases, useSubmitCancellation } from '@/features/corporate/api'
import { gbp } from '@/features/corporate/format'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { relativeDate } from '@/lib/format'

export type RequestTarget = { type: 'recorded_refund' | 'cohort_cancel' | 'postponement'; id: string; label: string }

/** Ask for a refund (a recorded purchase) or a change (a live booking), for ONE known
 * purchase or booking, opened from its own row. The server checks it is this company's,
 * still open, and not already asked about. Nothing is refunded or moved automatically. */
export function RequestDialog({ target, onClose, onSent }: { target: RequestTarget | null; onClose: () => void; onSent?: () => void }) {
  const submit = useSubmitCancellation()
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10
  const recorded = target?.type === 'recorded_refund'
  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!target || !valid || submit.isPending) return
    submit.mutate(
      { type: target.type, reason: reason.trim(), seat_purchase_id: recorded ? target.id : null, cohort_company_id: recorded ? null : target.id },
      {
        onSuccess: () => {
          toast.success('Request sent. We will reply by email.')
          setReason('')
          onClose()
          onSent?.()
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && (setReason(''), onClose())}>
      {target ? (
        <DialogContent title={CANCEL_TYPE[target.type] ?? 'Request'} description="We look at each request and reply by email.">
          <form onSubmit={send} className="grid gap-4">
            <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm">
              <p className="text-xs text-muted">{recorded ? 'Purchase' : 'Live booking'}</p>
              <p className="font-medium">{target.label}</p>
            </div>
            <Field label={target.type === 'postponement' ? 'Why, and which dates would suit you?' : 'Why?'} hint="At least 10 characters">
              {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 2000))} rows={4} required minLength={10} maxLength={2000} />}
            </Field>
            <p className="text-xs text-muted">{recorded ? 'Refund amounts are decided by our team for each case. Seats are not refunded automatically. Your legal rights are not affected.' : 'Nothing changes until our team confirms it.'}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={submit.isPending} disabled={!valid || submit.isPending}>
                Send request
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

/** Every refund and change request, with what it is about and where it stands. */
export function RequestsList() {
  const q = useCancellations()
  const purchases = usePurchases()
  const bookings = useLiveBookings()
  const about = (c: { seat_purchase_id?: string | null; cohort_company_id?: string | null }) => {
    const p = c.seat_purchase_id ? purchases.data?.find((x) => x.id === c.seat_purchase_id) : null
    if (p) return `${p.course_title} · ${p.quantity} seats · ${gbp(p.total_minor)}`
    const b = c.cohort_company_id ? bookings.data?.find((x) => x.id === c.cohort_company_id) : null
    return b ? `${b.course_title}${b.cohort_title ? ` · ${b.cohort_title}` : ''}` : null
  }
  return (
    <Card>
      <CardHeader title="Requests" description="Refunds, cancellations and date changes you have asked for" />
      <div className="mt-3">
        <QueryBlock query={q} rows={3} empty={{ icon: <Undo2 />, title: 'No requests', body: 'Refund and change requests you send will show here.' }}>
          {(rows) => (
            <ul className="stagger divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="grid gap-1 px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{CANCEL_TYPE[c.type] ?? c.type}</span>
                    <StatusBadge map={CANCEL_STATUS} status={c.status} />
                  </div>
                  {about(c) ? <p className="text-sm font-medium text-muted">{about(c)}</p> : null}
                  <p className="line-clamp-2 text-sm text-muted">{c.reason}</p>
                  <p className="text-xs text-muted">
                    Sent {relativeDate(c.created_at)}
                    {c.refund_amount_minor != null && c.status === 'processed' ? ` · ${gbp(c.refund_amount_minor)} refunded` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

/** /business/cancellations is now the "Requests" tab of Purchases & seats. */
export function CancellationsPage() {
  return <Navigate to="/business/purchases-and-seats?tab=requests" replace />
}
