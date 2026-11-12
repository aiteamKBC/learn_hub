import { CalendarDays, CheckCircle2, CreditCard, Loader2, MapPin, Send, Trash2, UserPlus, Users, Video, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import {
  BOOKING_STATUS,
  type LiveBooking,
  MODE_LABEL,
  REQUEST_STATUS,
  type TrainingRequest,
  useAddAttendee,
  useAttendees,
  useBookingSchedule,
  useCancelTrainingRequest,
  useLiveBookings,
  useLiveCheckout,
  useRemoveAttendee,
  useTrainingRequests,
} from '@/features/corporate/api'
import { fullDate, gbp } from '@/features/corporate/format'
import { PersonPicker, QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useIsOrgAdmin } from '@/features/org/api'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const PAYABLE = ['offered', 'pending_pay']
const NAMEABLE = ['paid', 'active']
const LOCKED_COHORT = ['in_progress', 'completed', 'cancelled']

// ---------------------------------------------------------------- requests

function CancelRequest({ r }: { r: TrainingRequest }) {
  const cancel = useCancelTrainingRequest()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <DialogContent title="Cancel this request?" description={`We will stop planning ${r.course_title} for your team.`}>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Keep it</Button>
          </DialogClose>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(r.id, { onSuccess: () => (toast.success('Request cancelled'), setOpen(false)), onError: (e) => toast.error((e as Error).message) })}>
            Cancel request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Requests() {
  const q = useTrainingRequests()
  return (
    <Card>
      <CardHeader
        title="Your requests"
        description="We plan a group, then send you dates and a price."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/business/packages">
              <Send /> New request
            </Link>
          </Button>
        }
      />
      <div className="mt-3">
        <QueryBlock query={q} rows={2} empty={{ icon: <Send />, title: 'No requests yet', body: 'Ask for live training from the course packages page.' }}>
          {(rows) => (
            <ul className="stagger divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.course_title}</p>
                    <p className="text-xs text-muted">
                      {r.requested_seats} {r.requested_seats === 1 ? 'person' : 'people'}
                      {r.preferred_intake ? ` · ${r.preferred_intake}` : ''}
                      {r.preferred_delivery_mode ? ` · ${MODE_LABEL[r.preferred_delivery_mode] ?? r.preferred_delivery_mode}` : ''} · sent {relativeDate(r.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge map={REQUEST_STATUS} status={r.status} />
                    {['submitted', 'under_review', 'scheduling'].includes(r.status) ? <CancelRequest r={r} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- booking detail

function Schedule({ b }: { b: LiveBooking }) {
  const q = useBookingSchedule(b.id)
  return (
    <section aria-labelledby="schedule-h">
      <h3 id="schedule-h" className="mb-2 text-sm font-semibold">
        Schedule
      </h3>
      <QueryBlock query={q} rows={2} empty={{ icon: <CalendarDays />, title: 'Dates not set yet', body: 'We will add the sessions before asking you to pay.' }}>
        {(sessions) => (
          <ol className="stagger grid gap-2">
            {sessions.map((s) => (
              <li key={s.sequence} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{s.title || `Session ${s.sequence}`}</p>
                <p className="text-muted">
                  {fullDate(s.scheduled_at)} · {s.duration_min} min
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  {s.delivery_mode === 'in_person' ? <MapPin className="size-3.5" /> : <Video className="size-3.5" />}
                  {MODE_LABEL[s.delivery_mode] ?? s.delivery_mode}
                  {s.location ? ` · ${s.location}` : ''}
                  {s.status === 'completed' ? (
                    <Badge tone="success" className="ml-1">
                      Done
                    </Badge>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </QueryBlock>
    </section>
  )
}

function Attendees({ b, admin }: { b: LiveBooking; admin: boolean }) {
  const q = useAttendees(b.id)
  const add = useAddAttendee(b.id)
  const remove = useRemoveAttendee(b.id)
  const [adding, setAdding] = useState(false)
  const canEdit = admin && NAMEABLE.includes(b.status) && !LOCKED_COHORT.includes(b.cohort_status)
  const taken = q.data?.length ?? 0
  const left = b.approved_seats - taken
  return (
    <section aria-labelledby="att-h" className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="att-h" className="text-sm font-semibold">
          Who is attending
        </h3>
        <span className="text-xs text-muted">
          {taken} of {b.approved_seats} places named
        </span>
      </div>
      <Progress value={b.approved_seats ? (taken / b.approved_seats) * 100 : 0} label={`${taken} of ${b.approved_seats} places named`} />
      {!NAMEABLE.includes(b.status) ? <p className="text-sm text-muted">You can name your people once the booking is paid.</p> : null}
      <QueryBlock query={q} rows={2}>
        {(rows) =>
          rows.length ? (
            <ul className="stagger grid gap-1">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={a.user_name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.user_name}</span>
                      <span className="block truncate text-xs text-muted">{a.user_email}</span>
                    </span>
                  </span>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${a.user_name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(a.id, { onSuccess: () => toast.success(`${a.user_name} removed`), onError: (e) => toast.error((e as Error).message) })}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : NAMEABLE.includes(b.status) ? (
            <p className="text-sm text-muted">Nobody named yet.</p>
          ) : null
        }
      </QueryBlock>
      {canEdit && left > 0 ? (
        adding ? (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setAdding(false)}>
                <X />
              </Button>
            </div>
            <PersonPicker
              label="Add a person"
              exclude={q.data?.map((a) => a.user_id)}
              disabled={add.isPending}
              onPick={(p) => add.mutate(p.user_id, { onSuccess: () => toast.success(`${p.name || p.email} added`), onError: (e) => toast.error((e as Error).message) })}
            />
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <UserPlus /> Add people ({left} left)
          </Button>
        )
      ) : null}
    </section>
  )
}

function PayButton({ b }: { b: LiveBooking }) {
  const pay = useLiveCheckout()
  return (
    <Button
      loading={pay.isPending}
      onClick={() => pay.mutate(b.id, { onSuccess: (r) => window.location.assign(r.checkout_url), onError: (e) => toast.error((e as Error).message) })}
    >
      <CreditCard /> Pay {b.total_minor != null ? gbp(b.total_minor) : ''}
    </Button>
  )
}

function BookingDetail({ b, admin, onClose }: { b: LiveBooking; admin: boolean; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={b.course_title} description={b.cohort_title || (b.intake ? `${b.intake} group` : 'Live training group')}>
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge map={BOOKING_STATUS} status={b.status} />
            <Badge tone="outline">{MODE_LABEL[b.delivery_mode] ?? b.delivery_mode}</Badge>
            <Badge tone="outline">
              {b.approved_seats} {b.approved_seats === 1 ? 'place' : 'places'}
            </Badge>
          </div>
          {admin && PAYABLE.includes(b.status) ? (
            <div className="grid gap-2 rounded-lg bg-surface-2 p-4 text-sm">
              <p>
                {b.approved_seats} × {b.unit_price_minor != null ? gbp(b.unit_price_minor) : 'n/a'} = <strong>{b.total_minor != null ? gbp(b.total_minor) : 'n/a'}</strong>
              </p>
              {b.payment_deadline ? <p className="text-muted">Please pay by {fullDate(b.payment_deadline)}.</p> : null}
              <PayButton b={b} />
            </div>
          ) : null}
          <Schedule b={b} />
          <Attendees b={b} admin={admin} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- bookings

function BookingCard({ b, onOpen }: { b: LiveBooking; onOpen: () => void }) {
  const due = b.payment_deadline && PAYABLE.includes(b.status)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-semibold">{b.course_title}</h3>
        <StatusBadge map={BOOKING_STATUS} status={b.status} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" /> {b.approved_seats} {b.approved_seats === 1 ? 'place' : 'places'}
        </span>
        <span className="inline-flex items-center gap-1">
          <Video className="size-3.5" /> {MODE_LABEL[b.delivery_mode] ?? b.delivery_mode}
        </span>
        {b.scheduled_start ? (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" /> {shortDate(b.scheduled_start)}
          </span>
        ) : null}
      </p>
      {due ? <p className="text-sm text-warning">Pay by {fullDate(b.payment_deadline!)}</p> : null}
      {NAMEABLE.includes(b.status) ? (
        <p className="text-sm text-muted">
          {b.attendee_count} of {b.approved_seats} people named
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant={PAYABLE.includes(b.status) ? 'primary' : 'secondary'} size="sm" onClick={onOpen}>
          {PAYABLE.includes(b.status) ? 'Review and pay' : NAMEABLE.includes(b.status) ? 'Manage people' : 'View details'}
        </Button>
      </div>
    </Card>
  )
}

function PaymentNotice({ pending }: { pending: boolean }) {
  return (
    <Card className="flex items-start gap-3 p-4 animate-reveal" role="status" aria-live="polite">
      {pending ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />}
      <div className="text-sm">
        <p className="font-medium">{pending ? 'Confirming your payment…' : 'Payment confirmed'}</p>
        <p className="text-muted">{pending ? 'This usually takes a few seconds.' : 'Now name the people who will attend.'}</p>
      </div>
    </Card>
  )
}

export function LiveTrainingPage() {
  const admin = useIsOrgAdmin()
  const [params, setParams] = useSearchParams()
  const back = params.get('success') === '1'
  const q = useLiveBookings(back)
  const openId = params.get('booking')
  const open = q.data?.find((b) => b.id === openId)
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set('booking', id)
        else p.delete('booking')
        return p
      },
      { replace: true },
    )
  useEffect(() => {
    document.title = 'Live training · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Live training" description="Group sessions led by a tutor. You pay once the dates are confirmed." />
      <div className="grid gap-6">
        {back ? <PaymentNotice pending={q.data?.some((b) => b.status === 'pending_pay') ?? true} /> : null}
        <Card>
          <CardHeader title="Bookings" description="Groups your company has a place in" />
          <div className="mt-3 p-5 pt-0">
            <QueryBlock query={q} rows={2} empty={{ icon: <CalendarDays />, title: 'No bookings yet', body: 'When we have planned a group for your request, it will appear here.' }}>
              {(rows) => (
                <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((b) => (
                    <BookingCard key={b.id} b={b} onOpen={() => setOpen(b.id)} />
                  ))}
                </div>
              )}
            </QueryBlock>
          </div>
        </Card>
        {admin ? <Requests /> : null}
      </div>
      {open ? <BookingDetail b={open} admin={admin} onClose={() => setOpen(null)} /> : null}
    </>
  )
}
