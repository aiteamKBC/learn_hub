/**
 * Admin "Course payments" — a view of the course checkout / payment process: which methods
 * are offered, the steps a learner goes through, and the money rules that apply.
 *
 * NOTE (docs/NEEDS-USER.md, UI-3): this screen is VISUAL ONLY. Toggles are not persisted and
 * no real payment configuration is changed here — the live payment settings live in
 * Settings → Payment and are driven by the backend/Stripe. Built at the user's explicit
 * request as a placeholder, to be wired when a payment-config API is exposed.
 */
import { Banknote, CreditCard, Info, Landmark, Receipt, ShieldCheck, Smartphone, Coins as TokenIcon, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { Link } from '@/lib/router'

type Method = { id: string; label: string; note: string; Icon: typeof CreditCard; on: boolean }

const INITIAL_METHODS: Method[] = [
  { id: 'card', label: 'Card payment', note: 'Visa, Mastercard, Amex via Stripe', Icon: CreditCard, on: true },
  { id: 'wallet', label: 'Apple Pay / Google Pay', note: 'One-tap wallet checkout', Icon: Smartphone, on: true },
  { id: 'tokens', label: 'Tokens', note: 'Pay with a token balance', Icon: TokenIcon, on: true },
  { id: 'subscription', label: 'Subscription', note: 'Included with an active plan', Icon: Wallet, on: true },
  { id: 'bank', label: 'Bank transfer', note: 'For company / invoiced orders', Icon: Landmark, on: false },
]

const STEPS = [
  { n: 1, label: 'Add to cart', note: 'Learner picks a course, bundle or plan.' },
  { n: 2, label: 'Review order', note: 'Price, currency, any coupon and VAT shown.' },
  { n: 3, label: 'Choose payment', note: 'One of the enabled methods below.' },
  { n: 4, label: 'Secure payment', note: 'Stripe handles the charge (test mode).' },
  { n: 5, label: 'Access granted', note: 'Enrolment created, receipt emailed.' },
]

function Row({ m, onToggle }: { m: Method; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
        <m.Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{m.label}</p>
        <p className="truncate text-xs text-muted">{m.note}</p>
      </div>
      <Badge tone={m.on ? 'success' : 'neutral'}>{m.on ? 'On' : 'Off'}</Badge>
      <Switch checked={m.on} onCheckedChange={onToggle} aria-label={`Toggle ${m.label}`} />
    </div>
  )
}

export function ConsoleCoursePaymentsPage() {
  const [methods, setMethods] = useState<Method[]>(INITIAL_METHODS)
  const [vat, setVat] = useState(true)
  const [invoices, setInvoices] = useState(true)
  const dirty = JSON.stringify(methods) !== JSON.stringify(INITIAL_METHODS) || !vat || !invoices

  const toggle = (id: string) => setMethods((ms) => ms.map((m) => (m.id === id ? { ...m, on: !m.on } : m)))

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Course payments"
        description="The payment methods and checkout process learners go through when they buy a course."
        actions={
          <Button onClick={() => toast.success('Payment preview updated (not saved — preview only)')} disabled={!dirty}>
            Save changes
          </Button>
        }
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-info-soft/40 px-4 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        <p>
          Preview only — these toggles aren't saved. The live payment configuration is handled in{' '}
          <Link to="/console/settings" className="font-medium text-primary hover:underline">
            Settings → Payment
          </Link>{' '}
          and by Stripe. This screen is ready to be wired when a payment-config API is exposed.
        </p>
      </div>

      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-text">
        <Receipt className="size-4 text-primary" /> Checkout process
      </h2>
      <Card className="mb-8 p-4 sm:p-5">
        <ol className="grid gap-4 sm:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">{s.n}</span>
              <p className="mt-2 text-sm font-medium text-text">{s.label}</p>
              <p className="mt-0.5 text-xs text-muted">{s.note}</p>
            </li>
          ))}
        </ol>
      </Card>

      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-text">
        <Banknote className="size-4 text-primary" /> Payment methods
      </h2>
      <div className="grid gap-2.5">
        {methods.map((m) => (
          <Row key={m.id} m={m} onToggle={() => toggle(m.id)} />
        ))}
      </div>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-text">
        <ShieldCheck className="size-4 text-primary" /> Money rules
      </h2>
      <Card className="divide-y divide-border p-0">
        <label className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">Charge VAT / tax where it applies</p>
            <p className="text-xs text-muted">Shown on the review step and the receipt.</p>
          </div>
          <Switch checked={vat} onCheckedChange={setVat} aria-label="Charge VAT" />
        </label>
        <label className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">Allow invoiced company orders</p>
            <p className="text-xs text-muted">Companies can pay by bank transfer against an invoice.</p>
          </div>
          <Switch checked={invoices} onCheckedChange={setInvoices} aria-label="Allow invoiced orders" />
        </label>
      </Card>
    </div>
  )
}
