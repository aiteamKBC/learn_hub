import { ArrowLeft, Coins, Crown, Mail, MapPin, Package, Phone, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/misc'
import {
  usePackCheckout,
  usePackageCheckout,
  useSubscriptionCheckout,
  useTopUpCheckout,
} from '@/features/b2c/api'
import { useMe, useUpdateMe } from '@/features/identity/auth'
import { count, money } from '@/lib/format'
import { COUNTRIES } from '@/lib/countries'

// ------------------------------------------------------------------ types

export type ReviewItem =
  | { kind: 'pack'; packId: string; name: string; tokenAmount: number; amountMinor: number; currency: string; successPath: string; cancelPath: string }
  | { kind: 'topup'; amountMinor: number; currency: string; estTokens: number | null; successPath: string; cancelPath: string }
  | { kind: 'package'; packageId: string; name: string; courseCount: number; amountMinor: number; currency: string; successPath: string; cancelPath: string }
  | { kind: 'subscription'; planId: string; name: string; interval: string; amountMinor: number; currency: string; successPath: string; cancelPath: string }

// ------------------------------------------------------------------ page

export function CheckoutReviewPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const item = location.state as ReviewItem | null

  // If someone lands here without state (e.g. a direct link), send them back.
  useEffect(() => {
    if (!item) navigate('/plans', { replace: true })
  }, [item, navigate])

  if (!item) return null

  return (
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="ribbons" height={520} />
      <div className="relative mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <PageHeader
          title="Review your purchase"
          description="Check the details and confirm to proceed to payment."
          back={
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 size-4" /> Back
            </Button>
          }
        />
        <div className="mt-6 space-y-5">
          <ItemSummary item={item} />
          <BuyerForm item={item} />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ item summary card

function ItemSummary({ item }: { item: ReviewItem }) {
  const icon =
    item.kind === 'pack' || item.kind === 'topup' ? <Coins className="size-5" /> :
    item.kind === 'package' ? <Package className="size-5" /> :
    <Crown className="size-5" />

  const title =
    item.kind === 'pack' ? item.name :
    item.kind === 'topup' ? 'Custom top-up' :
    item.kind === 'package' ? item.name :
    item.name

  const subtitle =
    item.kind === 'pack' ? `${count(item.tokenAmount)} tokens` :
    item.kind === 'topup' ? (item.estTokens ? `≈ ${count(item.estTokens)} tokens` : 'Custom amount') :
    item.kind === 'package' ? `${item.courseCount} ${item.courseCount === 1 ? 'course' : 'courses'}` :
    `${item.interval === 'year' ? 'Yearly' : 'Monthly'} plan`

  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <p className="text-xl font-bold tabular-nums">{money(item.amountMinor, item.currency)}</p>
      </CardBody>
    </Card>
  )
}

// ------------------------------------------------------------------ buyer form + confirm

function BuyerForm({ item }: { item: ReviewItem }) {
  const { data: me } = useMe()
  const updateMe = useUpdateMe()

  const packCheckout = usePackCheckout()
  const topUpCheckout = useTopUpCheckout()
  const packageCheckout = usePackageCheckout()
  const subCheckout = useSubscriptionCheckout()

  // Pre-fill from profile; keyed on me.id so it only runs once per user load
  const [init, setInit] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (me && init !== me.id) {
    setInit(me.id)
    setEmail(me.email)
    setPhone(me.phone || '')
    setCountryCode(me.country || '')
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const phoneValid = phone.trim().length >= 6
  const countryValid = countryCode.length === 2
  const canSubmit = emailValid && phoneValid && countryValid && !submitting

  /** Remember pre-checkout balance so the result page can detect when tokens land. */
  const rememberBalance = () => {
    try {
      sessionStorage.setItem('b2c-token-baseline', '0')
    } catch { /* private mode */ }
  }

  const confirm = async () => {
    if (!canSubmit) return
    setSubmitting(true)

    try {
      // 1. Save phone + country to profile (fire and forget — these are for CRM, not gating)
      await updateMe.mutateAsync({ phone: phone.trim(), country: countryCode })
    } catch {
      // Profile save is best-effort; don't block checkout
    }

    // 2. Call the appropriate checkout endpoint
    const customerEmail = email !== me?.email ? email : undefined

    const onSuccess = (r: { url: string }) => window.location.assign(r.url)
    const onError = (e: unknown) => {
      setSubmitting(false)
      toast.error((e as Error).message)
    }

    try {
      if (item.kind === 'pack') {
        rememberBalance()
        const r = await packCheckout.mutateAsync({
          packId: item.packId,
          successPath: item.successPath,
          cancelPath: item.cancelPath,
          customerEmail,
        })
        onSuccess(r)
      } else if (item.kind === 'topup') {
        rememberBalance()
        const r = await topUpCheckout.mutateAsync({
          amountMinor: item.amountMinor,
          currency: item.currency,
          successPath: item.successPath,
          cancelPath: item.cancelPath,
          customerEmail,
        })
        onSuccess(r)
      } else if (item.kind === 'package') {
        const r = await packageCheckout.mutateAsync({
          packageId: item.packageId,
          successPath: item.successPath,
          cancelPath: item.cancelPath,
          customerEmail,
        })
        onSuccess(r)
      } else if (item.kind === 'subscription') {
        const r = await subCheckout.mutateAsync({
          planId: item.planId,
          successPath: item.successPath,
          cancelPath: item.cancelPath,
          customerEmail,
        })
        onSuccess(r)
      }
    } catch (e) {
      onError(e)
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" /> Your details
        </h3>

        <label className="block">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Mail className="size-3.5" /> Email
          </span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1"
            aria-label="Email address"
          />
          {email && !emailValid ? <p className="mt-1 text-xs text-danger">Enter a valid email address.</p> : null}
          <p className="mt-1 text-xs text-muted">Your payment receipt will be sent to this email.</p>
        </label>

        <label className="block">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Phone className="size-3.5" /> Phone number
          </span>
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+20 1xx xxx xxxx"
            className="mt-1"
            aria-label="Phone number"
          />
          {phone && !phoneValid ? <p className="mt-1 text-xs text-danger">Enter at least 6 digits.</p> : null}
        </label>

        <label className="block">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="size-3.5" /> Country
          </span>
          <NativeSelect
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="mt-1"
            aria-label="Country"
          >
            <option value="">Select your country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </NativeSelect>
        </label>

        <Button className="w-full" size="lg" disabled={!canSubmit} loading={submitting} onClick={confirm}>
          Confirm &amp; pay {money(item.amountMinor, item.currency)}
        </Button>

        <p className="text-center text-xs text-muted">
          You'll be redirected to our secure payment provider to complete the transaction.
        </p>
      </CardBody>
    </Card>
  )
}
