import { ArrowLeft, BarChart3, Check, Clock, CreditCard, Headphones, Lock, Mail, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCourse } from '@/features/catalog/api'
import { useCheckout, useCheckoutIntent } from '@/features/commerce/api'
import { useMe } from '@/features/identity/auth'
import { useCurrency } from '@/lib/currency'
import { duration, money } from '@/lib/format'
import { useParams } from 'react-router-dom'

import { useNavigate } from '@/lib/router'
import { getStripe, preloadStripe, type StripeElement, type StripeElements, type StripeInstance } from '@/lib/stripe'

type Detail = NonNullable<ReturnType<typeof useCourse>['data']>

/** Stripe's Appearance API, tied to our theme tokens so the embedded fields match the page. */
function appearance() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const dark = document.documentElement.classList.contains('dark')
  return {
    theme: dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: v('--primary', '#ea802d'),
      colorBackground: v('--surface', dark ? '#181d24' : '#ffffff'),
      colorText: v('--text', dark ? '#edf0f2' : '#1b1f24'),
      colorDanger: v('--danger', '#dc2626'),
      borderRadius: '10px',
      fontFamily: 'inherit',
      spacingUnit: '4px',
    },
    rules: {
      '.Tab': { border: `1px solid ${v('--border', '#e8e4dd')}`, boxShadow: 'none' },
      '.Tab:hover': { color: v('--text', '#1f262e') },
      '.Tab--selected': {
        borderColor: v('--primary', '#ea802d'),
        boxShadow: `0 0 0 1px ${v('--primary', '#ea802d')}`,
      },
      '.Input': { border: `1px solid ${v('--border', '#e8e4dd')}`, boxShadow: 'none' },
      '.Input:focus': {
        borderColor: v('--primary', '#ea802d'),
        boxShadow: `0 0 0 3px ${v('--primary-soft', '#fbead9')}`,
      },
    },
  }
}

/** The payment side: creates the order + PaymentIntent, mounts the Stripe Payment Element, and
 * confirms. The card is entered in Stripe's own iframes and never reaches our server. */
function PaymentPanel({ course }: { course: Detail }) {
  const { data: me } = useMe()
  const { code } = useCurrency()
  const navigate = useNavigate()
  const currency = course.price?.currency ?? code ?? 'GBP'
  const exponent = course.price?.exponent ?? 2

  const intentMut = useCheckoutIntent()
  const hostedCheckout = useCheckout()
  const started = useRef(false)
  const stripeRef = useRef<StripeInstance | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const expressRef = useRef<HTMLDivElement | null>(null)

  const [orderId, setOrderId] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [hasWallets, setHasWallets] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (started.current) return // one order per visit, and guards React StrictMode's double mount
    started.current = true
    const created: StripeElement[] = []
    let cancelled = false
    // If the embedded element never loads (Stripe.js blocked by an extension/network, or a slow
    // response), stop waiting on a blank skeleton and offer the hosted-checkout fallback instead.
    const slowTimer = setTimeout(() => !cancelled && setTimedOut(true), 12000)
    const returnUrl = (id: string) => `${window.location.origin}/checkout/success?order=${id}`
    // Stripe.js and the intent request can load in parallel.
    void preloadStripe().catch(() => {})
    void (async () => {
      try {
        const res = await intentMut.mutateAsync({ courseIds: [course.id], currency })
        if (cancelled) return
        setOrderId(res.order_id)
        setTotal(res.total_minor)
        if (res.status === 'paid' || !res.client_secret) {
          // free / 100% coupon: already enrolled, straight into the course
          toast.success("You're enrolled. Enjoy the course!")
          navigate(`/learn/${course.slug}`)
          return
        }
        if (!res.publishable_key) {
          clearTimeout(slowTimer)
          setUnconfigured(true)
          return
        }
        const stripe = await getStripe(res.publishable_key)
        if (cancelled) return
        stripeRef.current = stripe
        const elements = stripe.elements({ clientSecret: res.client_secret, appearance: appearance() })
        elementsRef.current = elements

        // Wallet buttons (Apple Pay / Google Pay / Link): only shown when the browser offers one.
        const express = elements.create('expressCheckout', { buttonHeight: 44 })
        express.on('ready', (e) => !cancelled && setHasWallets(!!e.availablePaymentMethods))
        express.on('confirm', async () => {
          const { error: err } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: returnUrl(res.order_id),
              payment_method_data: { billing_details: { email: me?.email ?? '' } },
            },
          })
          if (err && !cancelled) setError(err.message || 'Your payment could not be completed.')
        })
        created.push(express)
        if (expressRef.current) express.mount(expressRef.current)

        // Stripe continues to own and validate every sensitive payment field.
        const payment = elements.create('payment', {
          layout: { type: 'tabs', defaultCollapsed: false },
          fields: { billingDetails: { email: 'never' } },
          defaultValues: { billingDetails: { email: me?.email } },
        })
        payment.on('ready', () => {
          if (cancelled) return
          clearTimeout(slowTimer)
          setTimedOut(false)
          setReady(true)
        })
        // Stripe fires this (instead of 'ready') when the element can't render — e.g. a
        // key/secret account mismatch or a test/live mix-up. Surface it instead of sitting
        // on the skeleton forever, and offer the hosted-checkout fallback below.
        payment.on('loaderror', (e) => {
          if (cancelled) return
          clearTimeout(slowTimer)
          setError(e?.error?.message || 'The payment form could not load. Please try again.')
        })
        created.push(payment)
        if (mountRef.current) payment.mount(mountRef.current)
      } catch (e) {
        if (!cancelled) {
          clearTimeout(slowTimer)
          setError((e as Error).message)
        }
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(slowTimer)
      for (const el of created) {
        try {
          el.destroy()
        } catch {
          /* already gone */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pay = async () => {
    if (!stripeRef.current || !elementsRef.current || !orderId) return
    setSubmitting(true)
    setError(null)
    const { error: err } = await stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success?order=${orderId}`,
        payment_method_data: { billing_details: { email: me?.email ?? '' } },
      },
    })
    // We only get here if confirmation failed; on success Stripe redirects to return_url.
    setError(err?.message || 'Your payment could not be completed. Please try again.')
    setSubmitting(false)
  }

  // Fall back to Stripe's hosted page when the browser key isn't set up (keeps checkout working).
  const continueHosted = () =>
    hostedCheckout.mutate(
      { courseIds: [course.id], currency },
      {
        onSuccess: (r) => (r.checkout_url ? window.location.assign(r.checkout_url) : navigate(`/checkout/success?order=${r.order_id}`)),
        onError: (e) => toast.error((e as Error).message),
      },
    )

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />

  if (unconfigured) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
          <CreditCard className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">Continue to secure checkout</h2>
        <p className="mt-2 text-sm text-muted">You'll complete your payment on our secure payment provider.</p>
        <Button size="lg" className="mt-5 w-full" loading={hostedCheckout.isPending} onClick={continueHosted}>
          <Lock /> Continue to payment
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Choose a payment method</h2>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-surface-2 px-3 py-2 text-xs text-muted">
          <Lock className="size-3.5" /> Secured by Stripe
        </span>
      </div>

      <label className="mt-4 block">
        <span className="text-sm font-medium">Email</span>
        <Input icon={<Mail />} type="email" value={me?.email ?? ''} readOnly aria-label="Email address" className="mt-1.5 h-12 rounded-lg" />
        <span className="mt-1 block text-xs text-muted">Your receipt and access details go here.</span>
      </label>

      <p className="mt-5 text-sm font-medium">Payment method</p>
      {/* Wallet buttons are rendered by Stripe only when this browser supports them. */}
      <div ref={expressRef} className={ready && hasWallets ? 'mt-3' : 'hidden'} />
      {ready && hasWallets ? (
        <div className="my-4 flex items-center gap-3 text-[11px] font-medium tracking-wide text-subtle" aria-hidden>
          <span className="h-px flex-1 bg-border" /> OR PAY BY CARD <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      <div className="relative mt-2 min-h-[220px]">
        {ready ? null : timedOut ? (
          <div className="rounded-xl border border-border bg-surface-2/40 p-4 text-sm">
            <p className="text-muted">The card form is taking too long to load — it may be blocked by a browser extension or your network. You can still pay on our secure payment page.</p>
            <Button size="lg" className="mt-3 w-full" loading={hostedCheckout.isPending} onClick={continueHosted}>
              <Lock /> Continue to secure checkout
            </Button>
          </div>
        ) : (
          <div className="absolute inset-0 grid content-start gap-3" aria-hidden>
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        )}
        <div ref={mountRef} className={ready ? 'animate-reveal' : 'opacity-0'} />
      </div>

      {timedOut && !ready ? null : (
        <Button size="lg" className="mt-6 h-14 w-full bg-[linear-gradient(90deg,var(--primary-hover),var(--primary),var(--primary-hover))] text-base shadow-md hover:brightness-105" loading={submitting} disabled={!ready} onClick={pay}>
          <Lock /> Pay {total != null ? money(total, currency, exponent) : ''}
        </Button>
      )}
      <p className="mt-4 text-center text-xs leading-relaxed text-muted">
        By completing your purchase, you agree to our{' '}
        <a href="https://stripe.com/legal" className="text-primary underline underline-offset-2 hover:text-primary-hover">Terms of service</a>{' '}
        and{' '}
        <a href="https://stripe.com/privacy" className="text-primary underline underline-offset-2 hover:text-primary-hover">Privacy policy</a>.
      </p>
    </div>
  )
}

function Summary({ course }: { course: Detail }) {
  const price = course.price
  const listAmount = price?.list_minor ?? 0
  const amount = price ? (price.sale_minor ?? price.list_minor ?? 0) : 0
  const discount = Math.max(0, listAmount - amount)
  const fmt = (n: number) => (price ? money(n, price.currency, price.exponent) : '')
  const chips: [typeof BarChart3, string][] = [
    [BarChart3, `${course.lecture_count} lectures`],
    [Clock, duration(course.total_duration_sec)],
  ]
  if (course.level) chips.push([PlayCircle, course.level[0].toUpperCase() + course.level.slice(1)])

  return (
    <div className="grid gap-6">
      {/* Course: our own course artwork, never a stock photo */}
      <Card className="flex gap-4 p-4 sm:p-5">
        <div className="w-32 shrink-0 overflow-hidden rounded-xl sm:w-44">
          <CourseThumb src={course.thumbnail_url} title={course.title} category={course.category} className="rounded-none" />
        </div>
        <div className="min-w-0 py-1">
          <h2 className="font-semibold tracking-tight">{course.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{course.subtitle}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
            {chips.map(([Icon, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <Icon className="size-3.5 text-primary" /> {label}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <section aria-labelledby="order-summary">
        <h3 id="order-summary" className="text-sm font-semibold tracking-tight">Order summary</h3>
        <Card className="mt-3 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="min-w-0 truncate pr-3">{course.title}</span>
            <span className="tabular">{fmt(listAmount || amount)}</span>
          </div>
          {discount ? (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-success">
              <span>Discount</span>
              <span className="tabular">−{fmt(discount)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-border bg-primary-soft/40 px-4 py-3.5">
            <span className="font-semibold">Total</span>
            <span className="text-xl font-bold text-primary tabular">{fmt(amount)}</span>
          </div>
        </Card>
      </section>

      <section aria-labelledby="included">
        <h3 id="included" className="text-sm font-semibold tracking-tight">What's included</h3>
        <ul className="mt-3 grid gap-2.5 text-sm">
          {[
            'Full lifetime access to the course',
            course.cpd_hours ? `Certificate · ${course.cpd_hours} CPD hours` : 'Certificate of completion',
            'Learn on web and mobile',
            'Future course updates (when available)',
          ].map((label) => (
            <li key={label} className="flex items-center gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                <Check className="size-3.5" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 border-t border-border pt-5 text-xs text-muted sm:grid-cols-3 sm:divide-x sm:divide-border">
        {[
          [ShieldCheck, 'Secure payment', 'Powered by Stripe'],
          [RefreshCw, '30-day refund', 'No questions asked'],
          [Headphones, 'Need help?', 'Contact support'],
        ].map(([Icon, title, sub]) => {
          const I = Icon as typeof ShieldCheck
          return (
            <div key={title as string} className="flex items-start gap-2 sm:px-3 first:sm:pl-0 last:sm:pr-0">
              <I className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                <span className="block font-medium text-text">{title as string}</span>
                {sub as string}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Our own checkout page (Stripe Payment Element): course and order on the left, payment on
 * the right. Reached from "Buy now" on a paid course. */
export function CheckoutPayPage() {
  const { slug = '' } = useParams()
  const { data: course, isLoading, error, refetch } = useCourse(slug)
  const navigate = useNavigate()
  const goBack = () => (window.history.length > 1 ? window.history.back() : navigate(`/courses/${slug}`))

  return (
    <div className="relative isolate min-h-dvh">
      {/* the shared learner/dashboard artwork, fixed behind the whole page */}
      <DashboardBackdrop className="animate-fade-in fixed inset-0 -z-10" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <Button variant="ghost" size="sm" className="-ml-2 mb-4 self-start text-muted" onClick={goBack}>
          <ArrowLeft className="mr-1 size-4" /> Back to course
        </Button>

        {isLoading ? (
          <div className="mt-2 grid animate-pulse gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(520px,1.08fr)]">
            <Skeleton className="h-96 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : error || !course ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
        ) : !course.price ? (
          <ErrorState message="This course isn't sold on its own." onRetry={() => navigate(`/courses/${slug}`)} />
        ) : (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Complete your <span className="text-primary">purchase</span>
            </h1>
            <p className="mt-2 text-base text-muted sm:text-lg">Get full access to the course and start learning today.</p>
            <div className="mt-8 grid animate-reveal items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(520px,1.08fr)] lg:gap-10">
              <Summary course={course} />
              <Card className="rounded-3xl p-6 shadow-lg sm:p-8 lg:sticky lg:top-24 lg:p-9">
                <PaymentPanel course={course} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
