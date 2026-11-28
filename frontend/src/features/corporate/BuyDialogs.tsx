import { CreditCard, Minus, Plus, Send } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

import { type Package, MODE_LABEL, recordedOptions, usePackages, useSubmitTrainingRequest } from './api'
import { BasketForm } from './BasketDialog'
import { LiveBookForm } from './LiveBookForm'
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

/** Seats on a recorded course, then Stripe. Starts with this course; "Add another course"
 * adds more (each at its own seat price), all paid together. Every seat needs an employee
 * email before payment (checked again by the server); invites go out after payment. */
export function SeatsForm({ pkg }: { pkg: Package; footer?: ReactNode }) {
  const packages = usePackages()
  if (packages.isLoading) return <Skeleton className="h-40" />
  const options = recordedOptions(packages.data ?? [])
  // the opened course always comes first, even if the list has not caught up yet
  if (!options.some((o) => o.course_id === pkg.course_id)) options.unshift({ course_id: pkg.course_id, title: pkg.course_title, price_minor: pkg.price_gbp_minor })
  return <BasketForm options={options} initial={pkg.course_id} />
}

/** Live training: no payment now. We plan a group, then send dates and the price. */
export function LiveForm({ pkg, onSent, footer }: { pkg: Package; onSent: () => void; footer?: ReactNode }) {
  const [seats, setSeats] = useState(5)
  const [intake, setIntake] = useState('')
  const [mode, setMode] = useState('')
  const [message, setMessage] = useState('')
  const submit = useSubmitTrainingRequest()
  const valid = Number.isInteger(seats) && seats >= 1 && seats <= 200
  const send = (e: FormEvent) => {
    e.preventDefault()
    submit.mutate(
      { course_id: pkg.course_id, seats, preferred_intake: intake, preferred_delivery_mode: mode, company_message: message },
      {
        onSuccess: () => {
          toast.success('Request sent to LearnHub. The admin will contact you with the proposed schedule and price.')
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
      <Field label="Message to the LearnHub admin" hint="Tell us what your team needs, preferred timing, or any questions (optional).">
        {(p) => <Textarea {...p} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} maxLength={2000} rows={4} placeholder="We need live training for our support team. Ideally starting in January…" />}
      </Field>
      <p className="rounded-lg bg-surface-2 p-4 text-sm">
        <span className="font-medium">{gbp(pkg.price_gbp_minor)}</span> <span className="text-muted">per person. This request does not book or open the course yet. The admin will confirm the group, dates and price; you review and pay after that.</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {footer}
        <Button type="submit" loading={submit.isPending} disabled={!valid}>
          <Send /> Send to admin
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
      <DialogContent title={`Buy seats: ${pkg.course_title}`} description="Choose the seats and employees for this course. Need more courses? Add them below and pay once.">
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
        <Send /> Book seats
      </Button>
      <DialogContent title={`Live training: ${pkg.course_title}`} description="Book seats in the next intake. Pay a deposit now; the rest in instalments.">
        {open ? <LiveBookForm courseId={pkg.course_id} footer={cancel} /> : null}
      </DialogContent>
    </Dialog>
  )
}
