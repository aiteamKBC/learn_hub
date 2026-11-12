import { LifeBuoy, ShieldAlert, Undo2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/misc'
import { CANCEL_STATUS, CANCEL_TYPE, useCancellations, useLiveBookings, usePurchases, useSubmitCancellation } from '@/features/corporate/api'
import { gbp } from '@/features/corporate/format'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useIsOrgAdmin } from '@/features/org/api'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function RequestForm() {
  const purchases = usePurchases()
  const bookings = useLiveBookings()
  const submit = useSubmitCancellation()
  const [type, setType] = useState('recorded_refund')
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const recorded = type === 'recorded_refund'
  const options = recorded
    ? (purchases.data ?? []).filter((p) => p.status === 'paid' && p.delivery_type === 'recorded').map((p) => ({ id: p.id, label: `${p.course_title} · ${p.quantity} seats · ${shortDate(p.paid_at ?? p.created_at)}` }))
    : (bookings.data ?? []).filter((b) => ['offered', 'pending_pay', 'paid', 'active'].includes(b.status)).map((b) => ({ id: b.id, label: `${b.course_title} · ${b.approved_seats} places` }))
  const valid = !!target && reason.trim().length >= 10

  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    submit.mutate(
      { type, reason: reason.trim(), seat_purchase_id: recorded ? target : null, cohort_company_id: recorded ? null : target },
      {
        onSuccess: () => {
          toast.success('Request sent. We will reply soon.')
          setReason('')
          setTarget('')
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Card className="self-start">
      <CardHeader title="Ask for a refund or a change" description="We look at each request and reply by email." />
      <CardBody>
        <form onSubmit={send} className="grid gap-4">
          <Field label="What do you need?">
            {(p) => (
              <NativeSelect {...p} value={type} onChange={(e) => (setType(e.target.value), setTarget(''))}>
                {Object.entries(CANCEL_TYPE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={recorded ? 'Which purchase?' : 'Which booking?'} hint={options.length ? undefined : recorded ? 'You have no paid purchases.' : 'You have no open bookings.'}>
            {(p) => (
              <NativeSelect {...p} value={target} onChange={(e) => setTarget(e.target.value)} required disabled={!options.length}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Why?" hint="At least 10 characters">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 2000))} rows={4} required minLength={10} maxLength={2000} />}
          </Field>
          <p className="text-xs text-muted">Refund amounts are decided by our team for each case. Your legal rights are not affected.</p>
          <Button type="submit" loading={submit.isPending} disabled={!valid}>
            Send request
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}

function History() {
  const q = useCancellations()
  return (
    <Card>
      <CardHeader title="Your requests" />
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

export function CancellationsPage() {
  const admin = useIsOrgAdmin()
  useEffect(() => {
    document.title = 'Refunds and changes · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Refunds and changes" description="Ask us to refund seats, or to cancel or move live training." />
      {admin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <RequestForm />
          <History />
        </div>
      ) : (
        <Card>
          <EmptyState icon={<ShieldAlert />} title="Only admins can ask for refunds" body="Ask a company admin, or contact us." action={<Button asChild variant="secondary"><Link to="/support"><LifeBuoy /> Contact us</Link></Button>} />
        </Card>
      )}
    </>
  )
}
