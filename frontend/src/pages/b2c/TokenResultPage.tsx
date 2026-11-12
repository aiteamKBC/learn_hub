import { CheckCircle2, Clock, Coins, PlayCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { useWalletBalance } from '@/features/b2c/api'
import { count } from '@/lib/format'
import { Link } from '@/lib/router'

/** Stripe returns here after a token pack or custom top-up. Payment is confirmed ONLY by the
 * server crediting the wallet (via Stripe's signed webhook) — we poll the balance until it
 * rises above what it was before checkout, and never grant anything from this URL alone. */
export function TokenResultPage() {
  const [params] = useSearchParams()
  const kind = params.get('kind') === 'pack' ? 'pack' : 'topup'

  const [baseline] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem('b2c-token-baseline')
      return raw == null ? null : Number(raw)
    } catch {
      return null
    }
  })

  const balance = useWalletBalance({ poll: true, baseline: baseline ?? undefined })
  const credited = baseline != null && balance.data != null && balance.data.balance > baseline
  const gained = credited ? balance.data!.balance - baseline! : 0

  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 60_000)
    return () => clearTimeout(t)
  }, [])

  // Clear the baseline once credited so a later visit doesn't mis-read an old value.
  useEffect(() => {
    if (credited) {
      try {
        sessionStorage.removeItem('b2c-token-baseline')
      } catch {
        /* ignore */
      }
    }
  }, [credited])

  return (
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="coins" height={520} />
      <div className="relative mx-auto max-w-2xl px-4 py-14 sm:px-6">
        {credited ? (
          <Card className="animate-reveal overflow-hidden p-8 text-center shadow-lg">
            <span className="mx-auto flex size-16 animate-pop items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 className="size-9" />
            </span>
            <h1 className="mt-5 text-2xl font-bold tracking-tight">Tokens added</h1>
            <p className="mt-2 text-sm text-muted">Your {kind === 'pack' ? 'token pack' : 'top-up'} is complete and a receipt is on its way to your inbox.</p>
            <div className="mt-6 flex items-center justify-center gap-2 text-primary">
              <Coins className="size-6" />
              <span className="text-3xl font-bold tabular-nums">
                +<CountUp value={gained} />
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">New balance {count(balance.data!.balance)} tokens</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button size="lg" asChild>
                <Link to="/courses">
                  <PlayCircle /> Find something to unlock
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link to="/wallet">Go to wallet</Link>
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="animate-reveal p-8 text-center" role="status">
            <span className={`mx-auto flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text ${slow ? '' : 'animate-pulse'}`}>
              <Clock className="size-7" />
            </span>
            <p className="mt-4 text-lg font-semibold">{slow ? 'This is taking longer than usual' : 'Confirming your payment…'}</p>
            <p className="mt-1 text-sm text-muted">
              {slow
                ? "If Stripe took your payment, your tokens will appear in your wallet shortly. You won't be charged twice."
                : 'This usually takes a few seconds. You can keep this page open.'}
            </p>
            {slow ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button onClick={() => void balance.refetch()} disabled={balance.isFetching}>
                  {balance.isFetching ? 'Checking…' : 'Check again'}
                </Button>
                <Button variant="secondary" asChild>
                  <Link to="/wallet">Go to wallet</Link>
                </Button>
              </div>
            ) : null}
            {baseline == null ? (
              <p className="mt-4 text-xs text-muted">Tip: open your wallet to see your current balance.</p>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  )
}
