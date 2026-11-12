import { CalendarClock, Check, Crown, Infinity as InfinityIcon, Info, Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useBillingPortal } from '@/features/commerce/api'
import { useMySubscription, useSubscriptionPlans } from '@/features/b2c/api'
import type { ReviewItem } from '@/pages/b2c/CheckoutReviewPage'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const SUCCESS = '/subscription?checkout=1'
const CANCEL = '/subscription'

/** The unlimited personal plan: learn any included course for a monthly or yearly fee.
 * Status, renewal and cancellation come from the server; cancellation is handled in Stripe's
 * billing portal (the authoritative place to change or stop a subscription). */
export function SubscriptionPage() {
  const [params] = useSearchParams()
  const justCheckedOut = params.get('checkout') === '1'
  const sub = useMySubscription(justCheckedOut)
  const active = sub.data && ['active', 'trialing', 'past_due'].includes(sub.data.status)

  return (
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="aurora" height={520} />
      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <PageHeader
          title="Unlimited personal plan"
          description="One subscription, every included course. Cancel whenever you like."
        />
        {sub.isLoading ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : sub.error ? (
          <ErrorState message="We couldn't load your subscription." onRetry={() => void sub.refetch()} />
        ) : active ? (
          <ActiveCard sub={sub.data!} justCheckedOut={justCheckedOut} />
        ) : (
          <Plans justCheckedOut={justCheckedOut} />
        )}
      </div>
    </div>
  )
}

function ActiveCard({ sub, justCheckedOut }: { sub: NonNullable<ReturnType<typeof useMySubscription>['data']>; justCheckedOut: boolean }) {
  const portal = useBillingPortal()
  useEffect(() => {
    if (justCheckedOut) toast.success('Your subscription is active. Enjoy every included course!')
  }, [justCheckedOut])

  const statusTone = sub.status === 'past_due' ? 'danger' : sub.status === 'trialing' ? 'info' : 'success'
  return (
    <Card className="overflow-hidden shadow-lg">
      <div className="flex items-center gap-3 border-b border-border bg-primary-soft/40 px-6 py-5">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-on-primary">
          <Crown className="size-5" />
        </span>
        <div className="flex-1">
          <p className="text-lg font-bold">{sub.plan_name}</p>
          <p className="text-sm text-muted capitalize">{sub.interval} plan</p>
        </div>
        <Badge tone={statusTone} className="capitalize">
          {sub.status === 'past_due' ? 'Payment due' : sub.status}
        </Badge>
      </div>
      <CardBody className="space-y-4">
        {sub.status === 'past_due' ? (
          <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            <Info className="mt-0.5 size-4 shrink-0" />
            Your last payment didn&apos;t go through. Update your card in the billing portal to keep your access.
          </p>
        ) : null}
        {sub.current_period_end ? (
          <p className="flex items-center gap-2 text-sm">
            <CalendarClock className="size-4 text-muted" />
            {sub.cancel_at_period_end ? (
              <>Access ends on <strong>{shortDate(sub.current_period_end)}</strong> &mdash; your plan won&apos;t renew.</>
            ) : (
              <>{sub.status === 'trialing' ? 'Trial ends' : 'Renews'} on <strong>{shortDate(sub.current_period_end)}</strong>.</>
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/courses">Browse included courses</Link>
          </Button>
          <Button variant="secondary" loading={portal.isPending} onClick={() => portal.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast.error((e as Error).message) })}>
            <Settings2 /> {sub.cancel_at_period_end ? 'Manage / resume' : 'Manage or cancel'}
          </Button>
        </div>
        <p className="text-xs text-muted">Cancelling keeps your access until the end of the period you&apos;ve paid for.</p>
      </CardBody>
    </Card>
  )
}

function Plans({ justCheckedOut }: { justCheckedOut: boolean }) {
  const plans = useSubscriptionPlans()
  const navigate = useNavigate()

  // Returned from Stripe but the subscription isn't active yet: the webhook is still in flight.
  if (justCheckedOut) {
    return (
      <Card className="animate-reveal p-8 text-center" role="status">
        <p className="text-lg font-semibold">Starting your subscription&hellip;</p>
        <p className="mt-1 text-sm text-muted">This can take a few seconds after payment. This page updates itself &mdash; no need to pay again.</p>
      </Card>
    )
  }

  if (plans.isLoading)
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  if (plans.error) return <ErrorState message="We couldn't load the plans." onRetry={() => void plans.refetch()} />
  if (!plans.data?.length)
    return <EmptyState icon={<Crown />} title="No plans available yet" body="The unlimited personal plan hasn't been set up. Please check back soon." />

  const subscribe = (plan: { id: string; name: string; interval: string; amount_minor: number; currency: string }) => {
    const item: ReviewItem = {
      kind: 'subscription',
      planId: plan.id,
      name: plan.name,
      interval: plan.interval,
      amountMinor: plan.amount_minor,
      currency: plan.currency,
      successPath: SUCCESS,
      cancelPath: CANCEL,
    }
    navigate('/checkout/review', { state: item })
  }

  // Yearly saving vs twelve monthly payments, for the "Save X%" badge.
  const monthAmt = plans.data.find((p) => p.interval === 'month')?.amount_minor
  const yearAmt = plans.data.find((p) => p.interval === 'year')?.amount_minor
  const savePct = monthAmt && yearAmt ? Math.round((1 - yearAmt / (monthAmt * 12)) * 100) : 0

  return (
    <div className="stagger grid gap-4 sm:grid-cols-2">
      {plans.data.map((p) => (
        <Card key={p.id} className="flex flex-col p-6 transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary">
              <InfinityIcon className="size-5" />
              <span className="text-sm font-semibold capitalize">{p.interval === 'year' ? 'Yearly' : 'Monthly'}</span>
            </div>
            {p.interval === 'year' && savePct > 0 ? <Badge tone="success">Save {savePct}%</Badge> : null}
          </div>
          <p className="mt-2 text-xl font-bold">{p.name}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            {money(p.amount_minor, p.currency)}
            <span className="text-sm font-normal text-muted"> / {p.interval === 'year' ? 'year' : 'month'}</span>
          </p>
          {p.description ? <p className="mt-3 text-sm text-muted">{p.description}</p> : null}
          <ul className="mt-4 space-y-1.5 text-sm">
            <Feature>Every course marked &ldquo;included&rdquo;</Feature>
            <Feature>New included courses as they&apos;re added</Feature>
            <Feature>Cancel anytime in the billing portal</Feature>
          </ul>
          {p.trial_days > 0 ? <p className="mt-3 text-xs text-muted">Includes a {p.trial_days}-day trial.</p> : null}
          <Button className="mt-5" onClick={() => subscribe(p)}>
            Choose {p.interval === 'year' ? 'yearly' : 'monthly'}
          </Button>
        </Card>
      ))}
    </div>
  )
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-success" />
      <span>{children}</span>
    </li>
  )
}
