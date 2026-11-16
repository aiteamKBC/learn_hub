import { Coins, Info, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrencies } from '@/features/commerce/api'
import { useTokenPacks, useTokenRate, useTopUpLimits, useWalletBalance } from '@/features/b2c/api'
import type { ReviewItem } from '@/pages/b2c/CheckoutReviewPage'
import { useCurrency } from '@/lib/currency'
import { count, money } from '@/lib/format'

const RESULT_PACK = '/wallet/result?kind=pack'
const RESULT_TOPUP = '/wallet/result?kind=topup'
const CANCEL = '/wallet/buy'

/** Buy tokens: fixed packs or a custom amount. Every price and token figure here is only
 * a preview of what the server will charge — the browser never computes the amount billed.
 * The server authoritatively prices and fulfils the Stripe session. */
export function TokenBuyPage() {
  const balance = useWalletBalance()
  const navigate = useNavigate()

  /** Navigate to the review page instead of going straight to Stripe checkout. */
  const goReview = (item: ReviewItem) => navigate('/checkout/review', { state: item })

  return (
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="coins" height={520} />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader
          title="Buy tokens"
          description="Top up your wallet, then spend tokens to unlock exactly what you want."
          back={
            <Button variant="ghost" size="sm" asChild>
              <a href="/wallet">← Wallet</a>
            </Button>
          }
          actions={
            balance.data ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary-soft-text">
                <Wallet className="size-4" /> {count(balance.data.balance)} tokens
              </span>
            ) : null
          }
        />
        <Packs onReview={goReview} />
        <CustomTopUp onReview={goReview} />
      </div>
    </div>
  )
}

function Packs({ onReview }: { onReview: (item: ReviewItem) => void }) {
  const { data, isLoading, error, refetch } = useTokenPacks()

  if (isLoading)
    return (
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    )
  if (error) return <ErrorState message="We couldn't load token packs." onRetry={() => void refetch()} />
  if (!data?.length)
    return <EmptyState className="mt-6" icon={<Coins />} title="No token packs available" body="Packs haven't been set up yet. You can still top up a custom amount below." />

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-muted">Token packs</h2>
      <div className="stagger mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((p) => (
          <Card key={p.id} className="flex flex-col p-5 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-primary">
              <Coins className="size-5" />
              <span className="text-lg font-bold tabular-nums">{count(p.token_amount)}</span>
              <span className="text-sm text-muted">tokens</span>
            </div>
            <p className="mt-1 text-sm font-medium">{p.name}</p>
            <p className="mt-4 text-2xl font-bold tracking-tight">{money(p.amount_minor, p.currency)}</p>
            <Button
              className="mt-4"
              onClick={() =>
                onReview({
                  kind: 'pack',
                  packId: p.id,
                  name: p.name,
                  tokenAmount: p.token_amount,
                  amountMinor: p.amount_minor,
                  currency: p.currency,
                  successPath: RESULT_PACK,
                  cancelPath: CANCEL,
                })
              }
            >
              Buy pack
            </Button>
          </Card>
        ))}
      </div>
    </section>
  )
}

function CustomTopUp({ onReview }: { onReview: (item: ReviewItem) => void }) {
  const { code } = useCurrency()
  const currency = code ?? 'GBP'
  const rate = useTokenRate()
  const limits = useTopUpLimits()
  const { data: currencies } = useCurrencies()
  const [amount, setAmount] = useState('')

  const exponent = currencies?.find((c) => c.code === currency)?.exponent ?? 2
  const factor = 10 ** exponent
  const amountMinor = Math.round((parseFloat(amount) || 0) * factor)

  // Preview only. tokens_per_gbp_minor is tokens per 1 minor unit of GBP; for non-GBP the
  // server converts via FX, so we only show an estimate when the currency is GBP.
  const rateVal = rate.data ? parseFloat(rate.data.tokens_per_gbp_minor) : 0
  const estTokens = currency === 'GBP' && rateVal > 0 ? Math.round(amountMinor * rateVal) : null

  const min = limits.data?.min_minor
  const max = limits.data?.max_minor
  const belowMin = min != null && amountMinor > 0 && amountMinor < min
  const aboveMax = max != null && amountMinor > max
  const canSubmit = amountMinor > 0 && !belowMin && !aboveMax && !!rate.data

  const submit = () => {
    if (!canSubmit) return
    onReview({
      kind: 'topup',
      amountMinor,
      currency,
      estTokens,
      successPath: RESULT_TOPUP,
      cancelPath: CANCEL,
    })
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-muted">Custom amount</h2>
      {rate.data ? <p className="mt-1 text-xs text-muted">Current value: 1 token ≈ £{Number(rate.data.token_price_gbp).toFixed(4)}. Choose a payment currency above; conversion uses the configured rates.</p> : null}
      <Card className="mt-3 max-w-xl">
        <CardBody className="space-y-4">
          {rate.isLoading ? (
            <Skeleton className="h-10 rounded-md" />
          ) : rate.data == null ? (
            // Truthful not-configured state: no token exchange rate set by an admin.
            <div className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm text-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>Custom top-ups aren't available right now — LearnHub hasn't set a token exchange rate yet. You can still buy a token pack above.</p>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium">Amount ({currency})</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                  aria-describedby="topup-help"
                />
              </label>
              <p id="topup-help" className="text-xs text-muted">
                {min != null || max != null ? (
                  <>
                    {min != null ? `Minimum ${money(min, currency, exponent)}` : ''}
                    {min != null && max != null ? ' · ' : ''}
                    {max != null ? `Maximum ${money(max, currency, exponent)}` : ''}
                  </>
                ) : (
                  'Enter any amount to top up.'
                )}
              </p>
              {belowMin ? <p className="text-sm text-danger">That's below the minimum of {money(min!, currency, exponent)}.</p> : null}
              {aboveMax ? <p className="text-sm text-danger">That's above the maximum of {money(max!, currency, exponent)}.</p> : null}
              {estTokens != null && amountMinor > 0 ? (
                <div className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary-soft-text">
                  <Coins className="size-4" /> About <strong>{count(estTokens)}</strong> tokens (the exact amount is confirmed by LearnHub at payment)
                </div>
              ) : null}
              <Button className="w-full" disabled={!canSubmit} onClick={submit}>
                Continue to payment
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </section>
  )
}
