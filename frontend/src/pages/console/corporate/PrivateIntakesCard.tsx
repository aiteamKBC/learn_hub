/** Console: companies asking for a live intake of their own. Approve with a start date, or say no. */
import { Building2, Check, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { type CnPrivateIntake, useCnDecidePrivate, useCnPrivateIntakes } from '@/features/corporate/console'
import { gbp } from '@/features/corporate/format'
import { QueryBlock } from '@/features/corporate/ui'
import { shortDate } from '@/lib/format'
import { toast } from '@/lib/toast'

const STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'info' | 'neutral' }> = {
  submitted: { label: 'New', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  booked: { label: 'Booked and paid', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
}

export function PrivateIntakesCard() {
  const q = useCnPrivateIntakes()
  return (
    <Card>
      <CardHeader title="Private intakes" description="Companies asking for an intake of their own, at the course's private price. Approving creates the intake on the date you pick." />
      <div className="p-5 pt-0">
        <QueryBlock query={q} rows={2} empty={{ icon: <Building2 />, title: 'No requests yet', body: 'Companies ask from a live course.' }}>
          {(rows) => (
            <ul className="stagger grid gap-3">
              {rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ul>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

function Row({ r }: { r: CnPrivateIntake }) {
  const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
  return (
    <li className="grid gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {r.company} · {r.course_title}
        </p>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="text-sm text-muted">
        {gbp(r.price_minor)} · {r.expected_people ? `about ${r.expected_people} people` : 'head count not given'} · asked {shortDate(r.created_at)} by {r.requester_email}
        {r.starts_on ? ` · starts ${shortDate(String(r.starts_on))}` : ''}
      </p>
      {r.message ? <p className="rounded-md bg-surface-2 p-2.5 text-sm">{r.message}</p> : null}
      {r.admin_reply ? <p className="text-sm text-muted">Your reply: {r.admin_reply}</p> : null}
      {r.status === 'submitted' ? (
        <div className="flex flex-wrap gap-2">
          <Decide r={r} approve />
          <Decide r={r} approve={false} />
        </div>
      ) : null}
    </li>
  )
}

function Decide({ r, approve }: { r: CnPrivateIntake; approve: boolean }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [reply, setReply] = useState('')
  const m = useCnDecidePrivate()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const go = () =>
    m.mutate(
      { id: r.id, approve, starts_on: date, reply },
      { onSuccess: () => (toast.success(approve ? 'Approved. The company has been told.' : 'Rejected. The company has been told.'), setOpen(false)), onError: (e) => toast.error((e as Error).message) },
    )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant={approve ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
        {approve ? <Check /> : <X />} {approve ? 'Approve' : 'Reject'}
      </Button>
      <DialogContent title={`${approve ? 'Approve' : 'Reject'}: ${r.company}`} description={r.course_title}>
        <div className="grid gap-4">
          {approve ? (
            <Field label="Start date">
              {(f) => <Input {...f} type="date" min={tomorrow} value={date} onChange={(e) => setDate(e.target.value)} required />}
            </Field>
          ) : null}
          <Field label={approve ? 'Message to the company (optional)' : 'Reason (optional)'}>
            {(f) => <Textarea {...f} rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant={approve ? 'primary' : 'danger'} disabled={approve && !date} loading={m.isPending} onClick={go}>
              {approve ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
