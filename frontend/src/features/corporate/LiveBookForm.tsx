/**
 * Live courses, option 1: book seats in the next intake. The company names one employee
 * per seat (typed or CSV) and pays only the deposit now, which covers the first months.
 * The rest is paid in instalments before each paid period runs out (we email a reminder).
 */
import { CalendarDays, CreditCard, Info } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/misc'
import { shortDate } from '@/lib/format'
import { toast } from '@/lib/toast'

import { useLiveBook, useLiveOffer } from './api'
import { useEmployeeEntry } from './EmployeeList'
import { gbp } from './format'

const MAX = 500

export function LiveBookForm({ courseId, footer, onRequestPrivate }: { courseId: string; footer?: ReactNode; onRequestPrivate?: () => void }) {
  const offer = useLiveOffer(courseId)
  const [qty, setQty] = useState(1)
  const entry = useEmployeeEntry(qty)
  const book = useLiveBook()

  if (offer.isLoading) return <Skeleton className="h-48" />
  if (offer.error || !offer.data)
    return (
      <div className="grid gap-3">
        <ErrorState message={(offer.error as Error | null)?.message ?? 'Live booking is not open for this course yet.'} />
        {onRequestPrivate ? (
          <Button variant="secondary" onClick={onRequestPrivate}>
            Send a request to LearnHub instead
          </Button>
        ) : null}
      </div>
    )
  const o = offer.data
  const ok = qty >= 1 && entry.rows.length === qty && !entry.invalid
  const pay = () =>
    book.mutate(
      { course_id: courseId, quantity: qty, employees: entry.rows, employees_source: entry.mode },
      { onSuccess: (r) => window.location.assign(r.checkout_url), onError: (e) => toast.error((e as Error).message) },
    )

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-lg border border-border p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <CalendarDays className="size-4 text-primary" />
          {o.next_intake_starts_on ? `Next intake starts ${shortDate(String(o.next_intake_starts_on))}` : 'Next intake: dates coming soon'}
        </p>
        <p className="text-muted">
          {o.programme_months} months. Your seats join the next intake. {o.next_intake_starts_on ? '' : 'We place you as soon as LearnHub sets its dates.'}
        </p>
        <ul className="grid gap-1 text-muted">
          <li>
            <span className="font-medium text-text">Now: {gbp(o.deposit_minor)}</span> a seat, covers the first {o.deposit_months} months
          </li>
          {o.instalments.map((p, i) => (
            <li key={i}>
              Then {gbp(p.amount_minor)} a seat for the next {p.months} {p.months === 1 ? 'month' : 'months'}
            </li>
          ))}
          <li className="text-xs">Full price {gbp(o.seat_price_minor)} a seat. We email you a week before each paid period ends.</li>
        </ul>
      </div>

      <label className="grid gap-1 text-sm font-medium">
        Number of seats
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(MAX, Math.floor(Number(e.target.value) || 1))))}
          className="h-10 w-28 rounded-lg border border-border bg-surface px-3 text-sm"
        />
      </label>

      <section className="grid gap-2 rounded-lg border border-border p-3" aria-label="Employees">
        <p className="text-sm font-medium">Your employees</p>
        {entry.ui}
        <p className={entry.rows.length === qty && !entry.invalid ? 'text-xs text-success' : 'text-xs text-muted'}>
          {entry.rows.length} of {qty} added
        </p>
      </section>

      <dl className="grid gap-1.5 rounded-lg bg-surface-2 p-4 text-sm">
        <div className="flex justify-between font-semibold">
          <dt>Deposit to pay now</dt>
          <dd className="tabular">{gbp(o.deposit_minor * qty)}</dd>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" /> Employees are emailed after payment. They join the intake when it starts.
        </p>
      </dl>

      {onRequestPrivate && o.private_price_minor ? (
        <button type="button" onClick={onRequestPrivate} className="justify-self-start text-sm font-medium text-primary hover:underline">
          Want an intake just for your company? {gbp(o.private_price_minor)}. Ask LearnHub
        </button>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {footer}
        <Button onClick={pay} loading={book.isPending} disabled={!ok}>
          <CreditCard /> Pay deposit
        </Button>
      </div>
    </div>
  )
}
