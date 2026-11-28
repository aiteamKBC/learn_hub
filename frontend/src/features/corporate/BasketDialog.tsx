/**
 * Buying seats in several courses with ONE payment.
 *  - From a bundle: every seat costs the bundle's seat price; split the seats between its
 *    courses however you like (a course may get none).
 *  - Without a bundle: pick any recorded courses, each at its normal seat price.
 * Every seat needs an employee (typed or CSV) before payment; the server checks again.
 */
import { ArrowLeft, ArrowRight, Check, CreditCard, Layers, Pencil, Plus, ShoppingBasket, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

import { type Bundle, type Package, recordedOptions, type SeatEmployee, useBasketCheckout } from './api'
import { type EntryMode, useEmployeeEntry } from './EmployeeList'
import { gbp } from './format'

const MAX_SEATS = 500

type Option = { course_id: string; title: string; price_minor: number }
type Line = {
  key: number
  course_id: string
  quantity: number
  fixed: boolean
}
type Filled = { rows: SeatEmployee[]; mode: EntryMode; invalid: boolean }

/** One course: number of seats + who gets them. `fixed`: the course can't be changed. */
function CourseLine({
  line,
  options,
  fixed,
  taken,
  onChange,
  onFilled,
  className,
}: {
  line: Line
  options: Option[]
  fixed: boolean
  taken: Set<string>
  onChange: (l: Line) => void
  onFilled: (f: Filled) => void
  className?: string
}) {
  const entry = useEmployeeEntry(line.quantity)
  const opt = options.find((o) => o.course_id === line.course_id)
  const sig = entry.rows.map((r) => `${r.email}|${r.full_name}|${r.job_title}`).join(';') + entry.mode + entry.invalid
  // report the filled-in employees to the parent whenever they change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onFilled({ rows: entry.rows, mode: entry.mode, invalid: entry.invalid }), [sig])
  const count = entry.rows.length
  return (
    <section className={cn('grid gap-3 rounded-lg border border-border p-3', className)} aria-label={opt?.title ?? 'Course'}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          {fixed ? (
            <>
              <p className="truncate text-sm font-medium">{opt?.title}</p>
              {opt ? <p className="mt-0.5 text-xs text-muted">{gbp(opt.price_minor)} a seat</p> : null}
            </>
          ) : (
            <label className="grid gap-1 text-xs text-muted">
              Course
              <NativeSelect value={line.course_id} onChange={(e) => onChange({ ...line, course_id: e.target.value })}>
                <option value="">Choose a course</option>
                {options.map((o) => (
                  <option key={o.course_id} value={o.course_id} disabled={taken.has(o.course_id) && o.course_id !== line.course_id}>
                    {o.title} ({gbp(o.price_minor)} a seat)
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
        </div>
        <label className="grid gap-1 text-xs text-muted">
          Seats
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_SEATS}
            className="w-24"
            value={line.quantity}
            onChange={(e) =>
              onChange({
                ...line,
                quantity: Math.max(0, Math.min(MAX_SEATS, Math.floor(Number(e.target.value) || 0))),
              })
            }
          />
        </label>
      </div>
      {line.quantity > 0 && line.course_id ? (
        <div className="grid gap-2 animate-reveal">
          {entry.ui}
          <p className={count === line.quantity ? 'text-xs text-success' : 'text-xs text-muted'}>
            {count} of {line.quantity} added
          </p>
        </div>
      ) : null}
    </section>
  )
}

function Totals({ seats, total, note }: { seats: number; total: number; note?: string }) {
  return (
    <dl className="grid gap-1.5 rounded-lg bg-surface-2 p-4 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted">Seats</dt>
        <dd className="tabular">{seats}</dd>
      </div>
      <div className="flex justify-between font-semibold">
        <dt>Total</dt>
        <dd className="tabular">{gbp(total)}</dd>
      </div>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </dl>
  )
}

const cancelButton = (
  <DialogClose asChild>
    <Button type="button" variant="secondary">
      Cancel
    </Button>
  </DialogClose>
)

/**
 * Without a bundle the buyer goes step by step:
 *   1. seats + employees for the course they opened (or the first one they pick)
 *   2. a summary: "Add another course" (back to step 1 for that course) or pay for all.
 * With a bundle all its courses are on one screen, to split the seats between them.
 * `initial`: the course the buyer opened.
 */
export function BasketForm({ options, bundle, initial }: { options: Option[]; bundle?: Bundle; initial?: string }) {
  const stepped = !bundle
  const [lines, setLines] = useState<Line[]>(() =>
    bundle
      ? options.map((o, i) => ({
          key: i,
          course_id: o.course_id,
          quantity: 0,
          fixed: true,
        }))
      : [{ key: 0, course_id: initial ?? '', quantity: 1, fixed: !!initial }],
  )
  const [filled, setFilled] = useState<Record<number, Filled>>({})
  const [editing, setEditing] = useState<number | null>(stepped ? 0 : null)
  const [saved, setSaved] = useState<Set<number>>(() => new Set()) // lines already confirmed once
  const checkout = useBasketCheckout()
  const price = (cid: string) => (bundle ? bundle.seat_price_minor : (options.find((o) => o.course_id === cid)?.price_minor ?? 0))
  const title = (cid: string) => options.find((o) => o.course_id === cid)?.title ?? 'Course'
  const complete = (l: Line) => !!l.course_id && l.quantity > 0 && (filled[l.key]?.rows.length ?? 0) === l.quantity && !filled[l.key]?.invalid
  const active = lines.filter((l) => l.course_id && l.quantity > 0)
  const seats = active.reduce((n, l) => n + l.quantity, 0)
  const total = active.reduce((n, l) => n + l.quantity * price(l.course_id), 0)
  const taken = useMemo(() => new Set(lines.map((l) => l.course_id).filter(Boolean)), [lines])
  const ok = seats > 0 && seats <= MAX_SEATS && active.every(complete)

  const pay = () =>
    checkout.mutate(
      {
        bundleId: bundle?.id,
        source: active.some((l) => filled[l.key]?.mode === 'csv') ? 'csv' : 'manual',
        lines: active.map((l) => ({
          course_id: l.course_id,
          quantity: l.quantity,
          employees: filled[l.key]?.rows ?? [],
        })),
      },
      {
        onSuccess: (r) => window.location.assign(r.checkout_url),
        onError: (e) => toast.error((e as Error).message),
      },
    )
  const update = (n: Line) => setLines((all) => all.map((x) => (x.key === n.key ? n : x)))
  const remove = (key: number) => setLines((all) => all.filter((x) => x.key !== key))
  const addCourse = () => {
    const key = Math.max(...lines.map((x) => x.key)) + 1
    setLines((all) => [...all, { key, course_id: '', quantity: 1, fixed: false }])
    setEditing(key)
  }

  // every course stays mounted (hidden when not on screen) so typed employees are kept
  const courseLines = lines.map((l) => (
    <CourseLine
      key={l.key}
      line={l}
      options={options}
      fixed={l.fixed}
      taken={taken}
      onChange={update}
      onFilled={(f) => setFilled((m) => ({ ...m, [l.key]: f }))}
      className={stepped && editing !== l.key ? 'hidden' : undefined}
    />
  ))

  if (!stepped) {
    return (
      <div className="grid gap-4">
        <div className="grid max-h-[55vh] gap-3 overflow-y-auto pr-0.5">{courseLines}</div>
        <Totals seats={seats} total={total} note={ok ? 'One payment for all courses. Employees are emailed after payment.' : 'Add an employee for every seat to continue.'} />
        <div className="flex flex-wrap justify-end gap-2">
          {cancelButton}
          <Button onClick={pay} loading={checkout.isPending} disabled={!ok}>
            <CreditCard /> Continue to payment
          </Button>
        </div>
      </div>
    )
  }

  const current = lines.find((l) => l.key === editing)
  const back = saved.size > 0
  // one stable tree: the course forms keep their place (and their typed employees) while
  // the buyer moves between a course and the summary
  return (
    <div className="grid gap-4">
      {current && lines.length > 1 ? <p className="text-xs font-medium tracking-wide text-muted uppercase">Course {lines.findIndex((l) => l.key === current.key) + 1}</p> : null}
      <div className={current ? 'max-h-[60vh] overflow-y-auto pr-0.5' : 'hidden'}>{courseLines}</div>
      {current ? (
        <>
          {!complete(current) ? <p className="text-xs text-muted">Add a valid email for every seat to continue.</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {back ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (!saved.has(current.key)) remove(current.key) // a new course left half-done is dropped
                  setEditing(null)
                }}
              >
                <ArrowLeft /> Back
              </Button>
            ) : (
              cancelButton
            )}
            <Button
              disabled={!complete(current)}
              onClick={() => {
                setSaved((s) => new Set(s).add(current.key))
                setEditing(null)
              }}
            >
              Next <ArrowRight />
            </Button>
          </div>
        </>
      ) : (
        <>
          <ul className="grid gap-2 animate-reveal" aria-label="Your order">
            {active.map((l) => (
              <li key={l.key} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4">
                  <Check />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{title(l.course_id)}</p>
                  <p className="text-xs text-muted">
                    {l.quantity} {l.quantity === 1 ? 'seat' : 'seats'} × {gbp(price(l.course_id))} · {l.quantity === 1 ? '1 employee' : `${l.quantity} employees`} added
                  </p>
                </div>
                <span className="text-sm font-semibold tabular">{gbp(l.quantity * price(l.course_id))}</span>
                <Button variant="ghost" size="sm" aria-label={`Change ${title(l.course_id)}`} onClick={() => setEditing(l.key)}>
                  <Pencil />
                </Button>
                {active.length > 1 ? (
                  <Button variant="ghost" size="sm" aria-label={`Remove ${title(l.course_id)}`} onClick={() => remove(l.key)}>
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {lines.length < Math.min(20, options.length) ? (
            <button
              type="button"
              onClick={addCourse}
              className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong p-3 text-left transition-colors duration-200 hover:border-primary hover:bg-primary-soft/30"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary [&_svg]:size-4">
                <Plus />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">Add another course</span>
                <span className="block text-xs text-muted">Buy seats in another course too, and pay for everything at once.</span>
              </span>
            </button>
          ) : null}
          <Totals seats={seats} total={total} note="One payment for all courses. Employees are emailed after payment." />
          <div className="flex flex-wrap justify-end gap-2">
            {cancelButton}
            <Button onClick={pay} loading={checkout.isPending} disabled={!ok}>
              <CreditCard /> Continue to payment
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Buy a bundle: split its seats between its courses. */
export function BuyBundle({ bundle, label = 'Buy this bundle', className }: { bundle: Bundle; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const options = bundle.courses
    .filter((c) => c.seats_on_sale)
    .map((c) => ({
      course_id: c.course_id,
      title: c.title,
      price_minor: bundle.seat_price_minor,
    }))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} disabled={!options.length} className={className}>
        <Layers /> {label}
      </Button>
      <DialogContent title={`Buy: ${bundle.title}`} description={`Every seat costs ${gbp(bundle.seat_price_minor)}. Split the seats between the courses however you like.`} className="max-w-2xl">
        {open ? <BasketForm options={options} bundle={bundle} /> : null}
      </DialogContent>
    </Dialog>
  )
}

/** Buy seats in several recorded courses at their normal price, one payment. */
export function BuySeveral({ packages }: { packages: Package[] }) {
  const [open, setOpen] = useState(false)
  const options = recordedOptions(packages)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="soft" onClick={() => setOpen(true)} disabled={options.length < 2}>
        <ShoppingBasket /> Buy several courses
      </Button>
      <DialogContent title="Buy seats in several courses" description="Choose the courses and how many seats each. Pay once for all of them." className="max-w-2xl">
        {open ? <BasketForm options={options} /> : null}
      </DialogContent>
    </Dialog>
  )
}
