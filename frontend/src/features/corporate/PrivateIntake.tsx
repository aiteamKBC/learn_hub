/**
 * Live courses, option 2: an intake just for one company. The company sends a request
 * (no payment). LearnHub approves it with a start date or says no. Once approved the
 * company names its employees (no limit) and pays the deposit; instalments follow.
 */
import { Building2, CalendarDays, CreditCard, Send, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsOrgAdmin } from '@/features/org/api'
import { shortDate } from '@/lib/format'
import { toast } from '@/lib/toast'

import { useAskPrivateIntake, useBookPrivateIntake, useLiveOffer, usePrivateIntakes, useWithdrawPrivateIntake } from './api'
import { useEmployeeEntry } from './EmployeeList'
import { gbp } from './format'
import { QueryBlock } from './ui'

const STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'info' | 'neutral' | 'danger' }> = {
  submitted: { label: 'Waiting for LearnHub', tone: 'warning' },
  approved: { label: 'Approved: add employees', tone: 'info' },
  booked: { label: 'Booked', tone: 'success' },
  rejected: { label: 'Not possible', tone: 'neutral' },
}

/** The request form: shows the fixed private price and how it is paid. No money now. */
export function PrivateAskForm({ courseId, onSent, footer }: { courseId: string; onSent: () => void; footer?: ReactNode }) {
  const offer = useLiveOffer(courseId)
  const ask = useAskPrivateIntake()
  const [people, setPeople] = useState('')
  const [message, setMessage] = useState('')
  if (offer.isLoading) return <Skeleton className="h-40" />
  if (offer.error || !offer.data?.private_price_minor) return <ErrorState message="A private intake is not offered for this course yet." />
  const o = offer.data
  const price = o.private_price_minor ?? 0
  const deposit = Math.round((price * o.deposit_minor) / (o.seat_price_minor || 1))
  const send = () =>
    ask.mutate(
      { course_id: courseId, expected_people: people ? Number(people) : null, message },
      { onSuccess: () => (toast.success('Request sent. We will reply soon.'), onSent()), onError: (e) => toast.error((e as Error).message) },
    )
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5 rounded-lg border border-border p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Building2 className="size-4 text-primary" /> An intake just for your company: {gbp(price)}
        </p>
        <p className="text-muted">
          No limit on people. Nothing to pay now. If we approve, we set the start date. Then you add your employees and pay {gbp(deposit)} for the first {o.deposit_months} months. The rest is paid in instalments.
        </p>
      </div>
      <Field label="About how many people? (optional)">
        {(f) => <Input {...f} type="number" inputMode="numeric" min={1} max={5000} value={people} onChange={(e) => setPeople(e.target.value.replace(/[^0-9]/g, ''))} className="w-32" />}
      </Field>
      <Field label="Message (optional)">
        {(f) => <Textarea {...f} rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Preferred dates, location, anything we should know" />}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        {footer}
        <Button onClick={send} loading={ask.isPending}>
          <Send /> Send request
        </Button>
      </div>
    </div>
  )
}

/** Live training page: the company's private intake requests. */
export function PrivateIntakes() {
  const q = usePrivateIntakes()
  const admin = useIsOrgAdmin()
  const withdraw = useWithdrawPrivateIntake()
  if (!q.isLoading && !q.error && !q.data?.length) return null // nothing asked yet: no empty card
  return (
    <Card>
      <CardHeader title="Private intakes" description="Intakes just for your company. LearnHub approves them and sets the start date." />
      <div className="mt-3 p-5 pt-0">
        <QueryBlock query={q} rows={1} empty={{ icon: <Building2 />, title: 'No private intakes', body: 'Ask for one from a live course.' }}>
          {(rows) => (
            <ul className="stagger grid gap-3">
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
                const paying = r.status === 'approved' && r.booking_status && r.booking_status !== 'cancelled'
                return (
                  <li key={r.id} className="grid gap-2 rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{r.course_title}</p>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <span>{gbp(r.price_minor)} in total</span>
                      {r.expected_people ? (
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" /> about {r.expected_people} people
                        </span>
                      ) : null}
                      {r.starts_on ? (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="size-3.5" /> starts {shortDate(String(r.starts_on))}
                        </span>
                      ) : null}
                    </p>
                    {r.admin_reply ? <p className="rounded-md bg-surface-2 p-2.5 text-sm">LearnHub: {r.admin_reply}</p> : null}
                    {admin && r.status === 'submitted' ? (
                      <Button size="sm" variant="ghost" className="justify-self-start" loading={withdraw.isPending && withdraw.variables === r.id} onClick={() => withdraw.mutate(r.id, { onError: (e) => toast.error((e as Error).message) })}>
                        Withdraw request
                      </Button>
                    ) : null}
                    {admin && r.status === 'approved' ? paying ? <p className="text-sm text-muted">Payment in progress.</p> : <BookPrivate r={r} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

type Req = NonNullable<ReturnType<typeof usePrivateIntakes>['data']>[number]

function BookPrivate({ r }: { r: Req }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
        <CreditCard /> Add employees and pay deposit
      </Button>
      <DialogContent title={`Private intake: ${r.course_title}`} description="Add everyone who will attend, then pay the deposit.">
        {open ? <BookPrivateForm r={r} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function BookPrivateForm({ r }: { r: Req }) {
  const [count, setCount] = useState(r.expected_people ?? 1)
  const entry = useEmployeeEntry(count)
  const book = useBookPrivateIntake()
  const ok = entry.rows.length >= 1 && entry.rows.length === count && !entry.invalid
  return (
    <div className="grid gap-4">
      <ul className="grid gap-1 rounded-lg border border-border p-3 text-sm text-muted">
        <li>
          <span className="font-medium text-text">Now: {gbp(r.deposit_minor ?? 0)}</span> for the first {r.deposit_months} months
        </li>
        {r.instalments.map((p, i) => (
          <li key={i}>
            Then {gbp(p.amount_minor)} for the next {p.months} {p.months === 1 ? 'month' : 'months'}
          </li>
        ))}
        <li className="text-xs">One price for the whole company, however many people attend.</li>
      </ul>
      <Field label="Number of people">
        {(f) => <Input {...f} type="number" inputMode="numeric" min={1} max={5000} value={count} onChange={(e) => setCount(Math.max(1, Math.min(5000, Math.floor(Number(e.target.value) || 1))))} className="w-32" />}
      </Field>
      <section className="grid gap-2 rounded-lg border border-border p-3" aria-label="Employees">
        <p className="text-sm font-medium">Your employees</p>
        {entry.ui}
        <p className={ok ? 'text-xs text-success' : 'text-xs text-muted'}>
          {entry.rows.length} of {count} added
        </p>
      </section>
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button disabled={!ok} loading={book.isPending} onClick={() => book.mutate({ id: r.id, employees: entry.rows, employees_source: entry.mode }, { onError: (e) => toast.error((e as Error).message) })}>
          <CreditCard /> Pay {gbp(r.deposit_minor ?? 0)} deposit
        </Button>
      </div>
    </div>
  )
}
