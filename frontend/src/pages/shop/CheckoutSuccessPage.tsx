import { AlertTriangle, CheckCircle2, Clock, PlayCircle, Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMySubscriptions, useOrder } from '@/features/commerce/api'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** Stripe sends the shopper back here; the order becomes "paid" only when Stripe's signed
 * webhook arrives (usually seconds) or the server finds the paid session when asked, so
 * the page checks until it does. */
export function CheckoutSuccessPage() {
  const [params] = useSearchParams()
  const orderId = params.get('order')
  const subId = params.get('subscription')
  return (
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="confetti" height={520} />
      <div className="relative mx-auto max-w-2xl px-4 py-14 sm:px-6">{orderId ? <OrderResult id={orderId} /> : subId ? <SubscriptionResult id={subId} /> : <Waiting />}</div>
    </div>
  )
}

/** While waiting for Stripe. After about a minute the page stops checking on its own and
 * says so, with a button to check again (instead of spinning for ever). */
function Waiting({ text = 'Confirming your payment…', slow, onRetry, retrying }: { text?: string; slow?: boolean; onRetry?: () => void; retrying?: boolean }) {
  return (
    <Card className="animate-reveal p-8 text-center" role="status">
      <span className={`mx-auto flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text ${slow ? '' : 'animate-pulse'}`}>
        <Clock className="size-7" />
      </span>
      <p className="mt-4 text-lg font-semibold">{slow ? 'This is taking longer than usual' : text}</p>
      <p className="mt-1 text-sm text-muted">
        {slow ? "If Stripe took your payment, it will show up here shortly. You won't be charged twice." : 'This usually takes a few seconds. You can keep this page open.'}
      </p>
      {slow ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={onRetry} disabled={retrying}>
            {retrying ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/account/orders">My purchases</Link>
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function Done({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="animate-reveal overflow-hidden p-8 text-center shadow-lg">
      <span className="mx-auto flex size-16 animate-pop items-center justify-center rounded-full bg-success-soft text-success">
        <CheckCircle2 className="size-9" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
      {children}
    </Card>
  )
}

/** True after a minute: about when the automatic checks (40 × 1.5 s) stop. */
function useSlow() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 60_000)
    return () => clearTimeout(t)
  }, [])
  return slow
}

/** Once the payment is confirmed, everything that depends on it is out of date. */
function useRefreshAfterPayment(done: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (done) void qc.invalidateQueries({ predicate: (q) => ['cart', 'cart-count', 'course', 'my-courses', 'orders', 'subscriptions', 'me'].includes(String(q.queryKey[0])) })
  }, [done, qc])
}

function OrderResult({ id }: { id: string }) {
  const { data: o, isLoading, error, refetch, isFetching } = useOrder(id)
  const slow = useSlow()
  useRefreshAfterPayment(!!o && o.status !== 'pending')
  if (isLoading) return <Skeleton className="h-72 rounded-lg" />
  if (error || !o) return <Problem text="We couldn't find this order." />
  if (o.status === 'pending') return <Waiting slow={slow} onRetry={() => void refetch()} retrying={isFetching} />
  if (['failed', 'expired'].includes(o.status)) return <Problem text="The payment didn't go through, so you weren't charged." />
  return (
    <Done title={o.total_minor ? 'Payment complete' : "You're enrolled"}>
      <p className="mt-2 text-sm text-muted">
        {o.total_minor ? `${money(o.total_minor, o.currency, o.exponent)} paid · ` : ''}
        {o.paid_at ? shortDate(o.paid_at) : ''} · a receipt is on its way to your inbox
      </p>
      <ul className="stagger mt-6 grid gap-2 text-left">
        {o.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-3">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="flex-1 text-sm font-medium">{i.course_title}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button size="lg" asChild>
          <Link to={o.items.length === 1 && o.items[0]!.course_slug ? `/learn/${o.items[0]!.course_slug}` : '/learn'}>
            <PlayCircle /> Start learning
          </Link>
        </Button>
        <Button size="lg" variant="secondary" asChild>
          <Link to="/account/orders">View receipt</Link>
        </Button>
      </div>
    </Done>
  )
}

function SubscriptionResult({ id }: { id: string }) {
  const { data, refetch, isFetching } = useMySubscriptions(true, true)
  const slow = useSlow()
  const sub = data?.find((s) => s.id === id)
  useRefreshAfterPayment(!!sub && ['active', 'trialing'].includes(sub.status))
  if (!sub || !['active', 'trialing'].includes(sub.status)) return <Waiting text="Starting your subscription…" slow={slow} onRetry={() => void refetch()} retrying={isFetching} />
  return (
    <Done title={sub.status === 'trialing' ? 'Your free trial has started' : 'Welcome to the Personal Plan'}>
      <p className="mt-2 text-sm text-muted">{sub.current_period_end ? `${sub.status === 'trialing' ? 'Trial ends' : 'Renews'} ${shortDate(sub.current_period_end)}.` : ''} Every course marked “included” is yours to learn.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button size="lg" asChild>
          <Link to="/courses">Browse included courses</Link>
        </Button>
      </div>
    </Done>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <Card className="animate-reveal p-8 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-7" />
      </span>
      <p className="mt-4 text-lg font-semibold">{text}</p>
      <Button className="mt-5" variant="secondary" asChild>
        <Link to="/cart">Back to cart</Link>
      </Button>
    </Card>
  )
}
