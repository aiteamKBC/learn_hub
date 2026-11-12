import { CreditCard, Minus, Plus, Send } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'

import { type Package, MODE_LABEL, useRecordedCheckout, useSubmitTrainingRequest } from './api'
import { gbp } from './format'

/** Buying for a company: seats on a recorded course, or a request for live training.
 * The forms are shared by the packages page and the "Buy for your team" window on
 * each course page (company admins only; the server checks again). */

export const MAX_SEATS = 500

function Count({ label, hint, value, onChange, max }: { label: string; hint: string; value: number; onChange: (n: number) => void; max: number }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="icon" aria-label="One fewer" onClick={() => onChange(Math.max(1, (value || 1) - 1))} disabled={value <= 1}>
            <Minus />
          </Button>
          <Input {...p} type="number" inputMode="numeric" min={1} max={max} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(parseInt(e.target.value, 10))} className="w-24 text-center" />
          <Button type="button" variant="secondary" size="icon" aria-label="One more" onClick={() => onChange(Math.min(max, (value || 0) + 1))} disabled={value >= max}>
            <Plus />
          </Button>
        </div>
      )}
    </Field>
  )
}

/** Seats on a recorded course, then Stripe. The server works out the price. */
export function SeatsForm({ pkg, footer }: { pkg: Package; footer?: ReactNode }) {
  const [qty, setQty] = useState(5)
  const checkout = useRecordedCheckout()
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= MAX_SEATS
  const pay = () =>
    checkout.mutate(
      { offeringId: pkg.id, quantity: qty },
      {
        onSuccess: (r) => window.location.assign(r.checkout_url),
        onError: (e) => toast.error((e as Error).message),
      },
    )
  return (
    <div className="grid gap-5">
      <Count label="Number of seats" hint={`From 1 to ${MAX_SEATS}. Each seat gives one employee this course.`} value={qty} onChange={setQty} max={MAX_SEATS} />
      <dl className="grid gap-1.5 rounded-lg bg-surface-2 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Price per seat</dt>
          <dd>{gbp(pkg.price_gbp_minor)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Estimated total</dt>
          <dd>{valid ? gbp(pkg.price_gbp_minor * qty) : 'n/a'}</dd>
        </div>
        <p className="mt-1 text-xs text-muted">You confirm the final amount on the secure payment page.</p>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        {footer}
        <Button onClick={pay} loading={checkout.isPending} disabled={!valid}>
          <CreditCard /> Continue to payment
        </Button>
      </div>
    </div>
  )
}

/** Live training: no payment now. We plan a group, then send dates and the price. */
export function LiveForm({ pkg, onSent, footer }: { pkg: Package; onSent: () => void; footer?: ReactNode }) {
  const [seats, setSeats] = useState(5)
  const [intake, setIntake] = useState('')
  const [mode, setMode] = useState('')
  const submit = useSubmitTrainingRequest()
  const valid = Number.isInteger(seats) && seats >= 1 && seats <= 200
  const send = (e: FormEvent) => {
    e.preventDefault()
    submit.mutate(
      { course_id: pkg.course_id, seats, preferred_intake: intake, preferred_delivery_mode: mode },
      {
        onSuccess: () => {
          toast.success('Request sent. We will be in touch with dates and a price.')
          onSent()
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }
  return (
    <form onSubmit={send} className="grid gap-4">
      <Count label="How many people?" hint="From 1 to 200" value={seats} onChange={setSeats} max={200} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Preferred start (optional)" hint="For example, a month or a term">
          {(p) => <Input {...p} value={intake} onChange={(e) => setIntake(e.target.value.slice(0, 50))} maxLength={50} placeholder="Any time" />}
        </Field>
        <Field label="Preferred format (optional)">
          {(p) => (
            <NativeSelect {...p} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">No preference</option>
              {Object.entries(MODE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <p className="rounded-lg bg-surface-2 p-4 text-sm">
        <span className="font-medium">{gbp(pkg.price_gbp_minor)}</span> <span className="text-muted">per person. No payment now: we plan a group, then send you the dates and the price to approve.</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {footer}
        <Button type="submit" loading={submit.isPending} disabled={!valid}>
          <Send /> Send request
        </Button>
      </div>
    </form>
  )
}

const cancel = (
  <DialogClose asChild>
    <Button type="button" variant="secondary">
      Cancel
    </Button>
  </DialogClose>
)

export function BuySeats({ pkg }: { pkg: Package }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <CreditCard /> Buy seats
      </Button>
      <DialogContent title={`Buy seats: ${pkg.course_title}`} description="Each seat gives one employee this course. Unused seats stay yours while the course is available.">
        {open ? <SeatsForm pkg={pkg} footer={cancel} /> : null}
      </DialogContent>
    </Dialog>
  )
}

export function RequestLive({ pkg }: { pkg: Package }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="soft" onClick={() => setOpen(true)}>
        <Send /> Request training
      </Button>
      <DialogContent title={`Request live training: ${pkg.course_title}`} description="No payment now. We plan a group, then send you the dates and the price to approve.">
        {open ? <LiveForm pkg={pkg} onSent={() => setOpen(false)} footer={cancel} /> : null}
      </DialogContent>
    </Dialog>
  )
}
