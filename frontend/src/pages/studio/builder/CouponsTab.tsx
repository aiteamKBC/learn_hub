import { Plus, Power, TicketPercent } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type StudioCourse, useCoupons, useCreateCoupon, useDeactivateCoupon } from '@/features/studio/api'
import { shortDate } from '@/lib/format'

type Coupon = NonNullable<ReturnType<typeof useCoupons>['data']>[number]

function couponStatus(c: Coupon): { label: string; tone: 'success' | 'neutral' | 'warning' | 'info' } {
  if (!c.is_active) return { label: 'Off', tone: 'neutral' }
  if (c.ends_at && new Date(c.ends_at) < new Date()) return { label: 'Expired', tone: 'warning' }
  if (c.max_redemptions != null && c.redeemed_count >= c.max_redemptions) return { label: 'Used up', tone: 'info' }
  if (new Date(c.starts_at) > new Date()) return { label: 'Scheduled', tone: 'info' }
  return { label: 'Active', tone: 'success' }
}

const CODE = /^[A-Z0-9_-]{4,40}$/

function CreateCouponForm({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const create = useCreateCoupon(courseId)
  const [code, setCode] = useState('')
  const [percent, setPercent] = useState('20')
  const [maxUses, setMaxUses] = useState('')
  const [days, setDays] = useState('14')
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [openedAt] = useState(() => Date.now()) // the end date preview counts from when the form opened

  const pct = Number(percent)
  const d = Number(days)
  const max = maxUses === '' ? null : Number(maxUses)
  const errors = {
    code: !CODE.test(code) ? 'Use 4 to 40 letters, numbers, - or _.' : undefined,
    percent: !(Number.isInteger(pct) && pct >= 1 && pct <= 100) ? 'Enter a whole number from 1 to 100.' : undefined,
    days: !(Number.isInteger(d) && d >= 1 && d <= 31) ? 'Enter 1 to 31 days.' : undefined,
    max: max !== null && !(Number.isInteger(max) && max >= 1) ? 'Enter a whole number, or leave it empty.' : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)
  const ends = errors.days ? null : new Date(openedAt + d * 86_400_000)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    setError(null)
    create.mutate(
      { code, percent_off: pct, max_redemptions: max, days: d },
      {
        onSuccess: (r) => (toast.success(`Coupon ${r.code} created`), onDone()),
        onError: (err) => setError((err as Error).message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Code" hint="Learners type this at checkout." error={touched || code ? errors.code : undefined}>
        {(p) => <Input {...p} value={code} maxLength={40} autoComplete="off" className="font-mono uppercase" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Discount (%)" error={touched ? errors.percent : undefined}>
          {(p) => <Input {...p} type="number" min={1} max={100} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />}
        </Field>
        <Field label="Maximum uses" hint="Empty means no limit." error={touched ? errors.max : undefined}>
          {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />}
        </Field>
      </div>
      <Field label="Lasts (days)" hint={ends ? `Starts now and ends on ${shortDate(ends.toISOString())}.` : undefined} error={touched ? errors.days : undefined}>
        {(p) => <Input {...p} type="number" min={1} max={31} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={create.isPending}>
          Create coupon
        </Button>
      </div>
    </form>
  )
}

export function CouponsTab({ course }: { course: StudioCourse }) {
  const coupons = useCoupons(course.id)
  const turnOff = useDeactivateCoupon(course.id)
  const [creating, setCreating] = useState(false)
  const [stopping, setStopping] = useState<Coupon | null>(null)

  const header = (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Coupons</h2>
        <p className="mt-0.5 text-sm text-muted">Discount codes for this course.</p>
      </div>
      <Button onClick={() => setCreating(true)}>
        <Plus /> New coupon
      </Button>
    </div>
  )

  let body
  if (coupons.isPending) {
    body = (
      <Card className="grid gap-3 p-5" aria-busy="true" aria-label="Loading coupons">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </Card>
    )
  } else if (coupons.error) {
    body = (
      <Card>
        <ErrorState onRetry={() => void coupons.refetch()} />
      </Card>
    )
  } else if (!coupons.data.length) {
    body = (
      <Card className="animate-reveal">
        <EmptyState icon={<TicketPercent />} title="No coupons yet" body="Create a code to give learners a discount for a few days." />
      </Card>
    )
  } else {
    body = (
      <div className="animate-reveal">
        {/* phones: one card per coupon */}
        <ul className="grid gap-3 sm:hidden stagger">
          {coupons.data.map((c) => {
            const s = couponStatus(c)
            return (
              <li key={c.id}>
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-sm font-semibold text-primary-soft-text">{c.code}</span>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm">
                    <strong className="tabular">{c.percent_off}%</strong> off · {c.redeemed_count} / {c.max_redemptions ?? '∞'} used
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {shortDate(c.starts_at)} – {c.ends_at ? shortDate(c.ends_at) : 'no end'}
                  </p>
                  {c.is_active ? (
                    <Button variant="secondary" size="sm" className="mt-3" onClick={() => setStopping(c)}>
                      <Power /> Turn off
                    </Button>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
        <Card className="relative hidden overflow-x-auto sm:block">
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Uses</Th>
                <Th>Valid</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {coupons.data.map((c) => {
                const s = couponStatus(c)
                return (
                  <Tr key={c.id}>
                    <Td>
                      <span className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-[13px] font-semibold text-primary-soft-text">{c.code}</span>
                    </Td>
                    <Td className="font-semibold tabular">{c.percent_off}%</Td>
                    <Td className="tabular">
                      {c.redeemed_count} / {c.max_redemptions ?? '∞'}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {shortDate(c.starts_at)} – {c.ends_at ? shortDate(c.ends_at) : 'no end'}
                    </Td>
                    <Td>
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      {c.is_active ? (
                        <Button variant="ghost" size="sm" onClick={() => setStopping(c)} aria-label={`Turn off ${c.code}`}>
                          <Power /> Turn off
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {header}
      {body}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New coupon" description="The code works for this course only.">
          {creating ? <CreateCouponForm courseId={course.id} onDone={() => setCreating(false)} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!stopping} onOpenChange={(o) => !o && setStopping(null)}>
        <DialogContent title={`Turn off ${stopping?.code ?? ''}?`} description="Learners can no longer use this code. This can't be undone.">
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={turnOff.isPending}
              onClick={() =>
                stopping &&
                turnOff.mutate(stopping.id, {
                  onSuccess: () => (toast.success(`${stopping.code} turned off`), setStopping(null)),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              Turn off
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
