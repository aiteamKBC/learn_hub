import { Banknote, CreditCard, Info, Receipt, ShieldCheck, Smartphone, Coins as TokenIcon, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { usePersonalPaymentConfiguration } from '@/features/commerce/api'
import { useConsoleSettings, useSaveSettings } from '@/features/console/settings'
import { Link } from '@/lib/router'

const STACKING = 'payments.allow_promotion_stacking'
const STEPS = [
  { label: 'Select a product', note: 'Course, cash package, token pack or personal plan.' },
  { label: 'Review the price', note: 'The server checks eligibility, currency and applicable offers.' },
  { label: 'Pay with Stripe', note: 'Stripe shows methods eligible for this checkout. Free orders skip payment.' },
  { label: 'Verify payment', note: 'Signed webhooks or server verification confirm payment. A browser return grants no paid access.' },
  { label: 'Apply entitlement', note: 'Courses grant access; packs credit tokens. Subscription access follows plan eligibility and expiry.' },
]

function Row({ label, note, status, Icon }: { label: string; note: string; status: string; Icon: typeof CreditCard }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text"><Icon className="size-[18px]" /></span>
    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text">{label}</p><p className="text-xs text-muted">{note}</p></div>
    <Badge tone="neutral">{status}</Badge>
  </div>
}

export function ConsoleCoursePaymentsPage() {
  const settings = useConsoleSettings()
  const configuration = usePersonalPaymentConfiguration()
  const save = useSaveSettings()
  const [draft, setDraft] = useState<boolean | null>(null)
  const defs = settings.data?.settings
  const stacking = defs?.find((d) => d.key === STACKING)
  const saved = stacking?.value === true
  const dirty = draft !== null && draft !== saved
  const error = settings.error ?? configuration.error
  const config = configuration.data
  const doSave = () => save.mutate({ [STACKING]: draft ?? saved }, {
    onSuccess: () => { setDraft(null); toast.success('Payment settings saved') },
    onError: (e) => toast.error(e.message),
  })

  return <div className="mx-auto max-w-4xl">
    <PageHeader title="Course payments" description="Payment configuration and access rules for personal learner purchases." actions={
      <Button onClick={doSave} disabled={!dirty || save.isPending || !!error || !stacking}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
    } />
    {error ? <ErrorState message={error.message} onRetry={() => { void settings.refetch(); void configuration.refetch() }} />
      : !defs || !config ? <Skeleton className="h-96" /> : <div className="animate-reveal">
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-info-soft/40 px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>These are the same settings used by <Link to="/console/settings?tab=payment" className="font-medium text-primary hover:underline">Settings → Payment</Link>. Card and wallet availability is managed by Stripe, not a separate LearnHub switch. Configuration presence does not verify the provider connection.</p>
        </div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text"><Receipt className="size-4 text-primary" /> Checkout process</h2>
        <Card className="mb-8 p-4 sm:p-5"><ol className="grid gap-4 sm:grid-cols-5">{STEPS.map((step, i) => <li key={step.label}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">{i + 1}</span>
          <p className="mt-2 text-sm font-medium text-text">{step.label}</p><p className="mt-0.5 text-xs text-muted">{step.note}</p>
        </li>)}</ol></Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text"><Banknote className="size-4 text-primary" /> Payment methods</h2>
        <div className="grid gap-2.5">
          <Row Icon={CreditCard} label="Card payments through Stripe" status={config.stripe_configured ? 'Configured · provider-managed' : 'Unavailable'} note={config.stripe_configured ? `Courses, cash packages, token packs and personal subscriptions use the existing Stripe integration. ${config.embedded_configured ? 'Embedded checkout is configured.' : 'Embedded checkout is unavailable; hosted checkout can be used.'}` : 'The server has no Stripe payment configuration. Paid checkout is unavailable.'} />
          <Row Icon={Smartphone} label="Apple Pay / Google Pay" status={config.stripe_configured ? 'Provider-managed' : 'Unavailable'} note="Shown by Stripe only when enabled and eligible for the account, currency, device, browser and checkout. Availability is not guaranteed." />
        </div>
        <h2 className="mt-8 mb-3 text-sm font-semibold text-text">Access entitlements</h2>
        <div className="grid gap-2.5">
          <Row Icon={TokenIcon} label="Token content unlocks" status={config.token_unlocks_enabled ? 'Deployment-enabled' : 'Unavailable · K02'} note="New unlocks follow the server's K02 restriction. Historical token access remains valid under its original terms. Buying a token pack credits a balance; it does not itself unlock a course." />
          <Row Icon={Wallet} label="Personal subscription access" status="Eligibility-managed" note="Access requires an eligible personal plan and course, a qualifying subscription status and valid access period. This is an entitlement, not an alternative payment method." />
        </div>
        <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold text-text"><ShieldCheck className="size-4 text-primary" /> Money rules</h2>
        <Card className="divide-y divide-border p-0">
          <label className="flex items-center gap-3 px-4 py-3.5"><div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">Allow promotions to stack with coupons</p><p className="text-xs text-muted">Applies to eligible individual-course baskets. The server recalculates discounts at checkout. Package prices and subscription offers keep their own rules.</p>
          </div><Switch checked={draft ?? saved} onCheckedChange={setDraft} disabled={save.isPending || !stacking} aria-label="Allow promotions to stack with coupons" /></label>
          <div className="px-4 py-3.5 text-sm"><p className="font-medium">Tax display: {defs.find((d) => d.key === 'payments.prices_include_tax')?.value === true ? 'Prices include tax' : 'Prices exclude tax'}</p><p className="text-xs text-muted">Read-only here. This setting does not calculate or collect VAT. No new tax rate or Stripe Tax policy is enabled by this page; tax policy remains pending approval.</p></div>
          <div className="px-4 py-3.5 text-sm"><p className="font-medium">Refund window: {String(defs.find((d) => d.key === 'payments.refund_window_days')?.value ?? 'Unavailable')} days</p><p className="text-xs text-muted">Existing refund eligibility and safeguards still apply. Manage this shared policy in Settings → Payment.</p></div>
          <div className="px-4 py-3.5 text-xs text-muted">Company bank transfers and invoicing are managed separately. Changes to purchase availability do not revoke previously granted access.</div>
        </Card>
        {dirty && <div className="mt-3 flex items-center gap-3 text-sm text-muted"><span>Unsaved changes</span><Button variant="secondary" disabled={save.isPending} onClick={() => setDraft(null)}>Discard</Button></div>}
        {save.error && <p role="alert" className="mt-3 text-sm text-danger">{save.error.message}</p>}
        {save.isSuccess && !dirty && <p role="status" className="mt-3 text-sm text-muted">Payment settings saved.</p>}
      </div>}
  </div>
}
