import { Armchair, CreditCard, PlayCircle, Video } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { components } from '@/api/schema'
import { useIsOrgAdmin } from '@/features/org/api'

import { cn } from '@/lib/cn'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { useRecordedCheckout } from './api'
import { gbp } from './format'
import type { Delivery, useLiveOption } from './liveOption'

/** Recorded (start now) or live (a group with a tutor, planned and priced by us). */
export function DeliveryPicker({ value, onChange, live }: { value: Delivery; onChange: (d: Delivery) => void; live: ReturnType<typeof useLiveOption> }) {
  const options: { id: Delivery; label: string; body: string; icon: typeof Video; disabled: boolean; note?: string }[] = [
    { id: 'recorded', label: 'Recorded', body: 'They get the course now and learn at their own pace.', icon: PlayCircle, disabled: false },
    {
      id: 'live',
      label: 'Live training',
      body: 'Sessions with a tutor. We plan a group, then send you the dates and the price.',
      icon: Video,
      disabled: !live.pkg,
      note: live.loading ? 'Checking…' : live.pkg ? `${gbp(live.pkg.price_gbp_minor)} per person` : live.why,
    },
  ]
  const index = options.findIndex((o) => o.id === value)
  return (
    <div>
      <p id="delivery-label" className="mb-2 text-sm font-semibold">
        How will they take it?
      </p>
      <div role="radiogroup" aria-labelledby="delivery-label" className="grid gap-3 sm:grid-cols-2">
        {options.map((o, i) => {
          const selected = value === o.id
          const Icon = o.icon
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={o.disabled || undefined}
              tabIndex={radioTabIndex(i, index)}
              onClick={() => !o.disabled && onChange(o.id)}
              onKeyDown={(e) => radioKeyDown(e, i, options.length, (j) => !options[j]!.disabled && onChange(options[j]!.id))}
              className={cn(
                'grid gap-1 rounded-xl border p-4 text-left transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                selected ? 'border-primary shadow-md' : 'border-border',
                o.disabled ? 'cursor-not-allowed opacity-60' : 'hover:shadow-sm',
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Icon className="size-4 text-primary" /> {o.label}
              </span>
              <span className="text-sm text-muted">{o.body}</span>
              {o.note ? <span className="text-xs text-muted">{o.note}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type Seats = components['schemas']['AssignSeatsOut']

/** Recorded courses sold per seat: how many paid seats this uses, and a way to buy the
 * missing ones (company admins only; the price comes from the server). */
export function SeatNotice({ seats }: { seats: Seats }) {
  const admin = useIsOrgAdmin()
  const checkout = useRecordedCheckout()
  const buy = () =>
    checkout.mutate(
      { offeringId: seats.offering_id, quantity: seats.short },
      { onSuccess: (r) => window.location.assign(r.checkout_url), onError: (e) => toast.error((e as Error).message) },
    )
  if (!seats.short)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Armchair className="size-3.5" /> Uses {seats.needed} of your {seats.free} free {seats.free === 1 ? 'seat' : 'seats'} ({gbp(seats.price_minor)} per seat).
      </p>
    )
  return (
    <div className="grid gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning animate-reveal" role="status">
      <p>
        This course is sold per seat ({gbp(seats.price_minor)} each). You have <span className="font-semibold tabular">{seats.free}</span> free{' '}
        {seats.free === 1 ? 'seat' : 'seats'} and need <span className="font-semibold tabular">{seats.short}</span> more.
      </p>
      {admin ? (
        <Button size="sm" className="justify-self-start" loading={checkout.isPending} onClick={buy}>
          <CreditCard /> Buy {seats.short} {seats.short === 1 ? 'seat' : 'seats'} ({gbp(seats.price_minor * seats.short)})
        </Button>
      ) : (
        <p>Ask a company admin to buy the missing seats.</p>
      )}
    </div>
  )
}
