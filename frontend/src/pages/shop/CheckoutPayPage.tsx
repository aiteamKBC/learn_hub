import { ArrowLeft, BarChart3, Check, Clock, CreditCard, Headphones, Lock, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'

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
import { getStripe, type StripeElement, type StripeElements, type StripeInstance } from '@/lib/stripe'

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
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (started.current) return // one order per visit, and guards React StrictMode's double mount
    started.current = true
    const created: StripeElement[] = []
    let cancelled = false
    const returnUrl = (id: string) => `${window.location.origin}/checkout/success?order=${id}`
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
          const { error: err } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl(res.order_id) } })
          if (err && !cancelled) setError(err.message || 'Your payment could not be completed.')
        })
        created.push(express)
        if (expressRef.current) express.mount(expressRef.current)

        // Card / Revolut Pay and the card fields, as a radio accordion (matches Stripe's own UI).
        const payment = elements.create('payment', {
          layout: { type: 'accordion', radios: true, spacedAccordionItems: true },
          defaultValues: { billingDetails: { email: me?.email } },
        })
        payment.on('ready', () => !cancelled && setReady(true))
        created.push(payment)
        if (mountRef.current) payment.mount(mountRef.current)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
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
      confirmParams: { return_url: `${window.location.origin}/checkout/success?order=${orderId}` },
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
      <h2 className="text-lg font-semibold tracking-tight">Choose a payment method</h2>

      {/* Wallet buttons (Apple Pay / Google Pay / Link), shown only when the browser offers one */}
      <div ref={expressRef} className={ready && hasWallets ? 'mt-4' : 'hidden'} />
      {ready && hasWallets ? (
        <div className="my-5 flex items-center gap-3 text-[11px] font-medium tracking-wide text-subtle" aria-hidden>
          <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="text-sm font-medium">Email</span>
        <Input type="email" value={me?.email ?? ''} readOnly aria-label="Email address" className="mt-1.5" />
        <span className="mt-1 block text-xs text-muted">Your receipt and access details go here.</span>
      </label>

      <p className="mt-5 text-sm font-medium">Payment method</p>
      <div className="relative mt-2 min-h-[160px]">
        {ready ? null : (
          <div className="absolute inset-0 grid content-start gap-3" aria-hidden>
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        )}
        <div ref={mountRef} className={ready ? 'animate-reveal' : 'opacity-0'} />
      </div>

      <Button size="lg" className="mt-5 w-full" loading={submitting} disabled={!ready} onClick={pay}>
        <Lock /> Pay {total != null ? money(total, currency, exponent) : ''}
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        Powered by Stripe · <a href="https://stripe.com/legal" className="hover:text-text">Terms</a> ·{' '}
        <a href="https://stripe.com/privacy" className="hover:text-text">Privacy</a>
      </p>
    </div>
  )
}

function Summary({ course }: { course: Detail }) {
  const price = course.price
  const amount = price ? (price.sale_minor ?? price.list_minor ?? 0) : 0
  const fmt = (n: number) => (price ? money(n, price.currency, price.exponent) : '')
  const chips: [typeof BarChart3, string][] = [
    [BarChart3, `${course.lecture_count} lectures`],
    [Clock, duration(course.total_duration_sec)],
  ]
  if (course.level) chips.push([PlayCircle, course.level[0].toUpperCase() + course.level.slice(1)])

  return (
    <div className="grid gap-6">
      {/* Course: our own course artwork, never a stock photo */}
      <Card className="flex gap-4 p-4">
        <div className="w-32 shrink-0 overflow-hidden rounded-lg sm:w-40">
          <CourseThumb src={course.thumbnail_url} title={course.title} category={course.category} className="rounded-none" />
        </div>
        <div className="min-w-0">
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
            <span className="tabular">{fmt(amount)}</span>
          </div>
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

      <div className="grid gap-3 border-t border-border pt-5 text-xs text-muted sm:grid-cols-3">
        {[
          [ShieldCheck, 'Secure payment', 'Powered by Stripe'],
          [RefreshCw, '30-day refund', 'No questions asked'],
          [Headphones, 'Need help?', 'Contact support'],
        ].map(([Icon, title, sub]) => {
          const I = Icon as typeof ShieldCheck
          return (
            <div key={title as string} className="flex items-start gap-2">
              <I className="mt-0.5 size-4 shrink-0 text-primary" />
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
      <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3 self-start text-muted" onClick={goBack}>
          <ArrowLeft className="mr-1 size-4" /> Back to course
        </Button>

        {isLoading ? (
          <div className="mt-2 grid animate-pulse gap-8 lg:grid-cols-[1fr_minmax(0,440px)]">
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
            <p className="mt-2 text-muted">Get full access to the course and start learning today.</p>
            <div className="mt-8 grid animate-reveal items-start gap-10 lg:grid-cols-[1fr_minmax(0,500px)]">
              <Summary course={course} />
              <Card className="p-6 shadow-lg sm:p-8 lg:sticky lg:top-24">
                <PaymentPanel course={course} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
