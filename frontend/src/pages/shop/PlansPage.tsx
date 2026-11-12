import { ArrowRight, Check, CheckCircle2, Coins, Infinity as InfinityIcon, Package, Plus } from 'lucide-react'

import { Backdrop } from '@/components/art/backdrops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlans } from '@/features/catalog/api'
import { useMySubscriptions } from '@/features/commerce/api'
import { useMe } from '@/features/identity/auth'
import { money, shortDate } from '@/lib/format'
import { useNavigate } from '@/lib/router'

const SUB_FEATURES = [
  'Every course marked “included”, on any device',
  'New included courses added every month',
  'Cancel any time: access lasts to the end of the period',
]

/** Public pricing page: the three ways to pay for learning — the unlimited subscription,
 * one-off course bundles, and pay-as-you-go tokens. Each routes to the page that owns it. */
export function PlansPage() {
  const { data: me } = useMe()
  const { data: plans, isLoading } = usePlans()
  const navigate = useNavigate()
  const { data: subs } = useMySubscriptions(!!me)

  const monthly = plans?.find((p) => p.audience === 'personal' && p.interval === 'month')
  const yearly = plans?.find((p) => p.audience === 'personal' && p.interval === 'year')
  const live = subs?.find((s) => s.audience === 'personal' && ['active', 'trialing', 'past_due'].includes(s.status))
  const savePct = monthly && yearly ? Math.round((1 - yearly.amount_minor / (monthly.amount_minor * 12)) * 100) : 0

  const goAuthed = (path: string) => (me ? navigate(path) : navigate(`/login?next=${encodeURIComponent(path)}`))

  return (
    <div className="relative isolate">
      <Backdrop variant="ribbons" height={520} />
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="mx-auto max-w-2xl animate-reveal text-center">
          <Badge tone="primary">Pricing</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Choose how you want to learn.</h1>
          <p className="mt-4 text-lg text-muted">Subscribe for everything, grab a course bundle, or pay as you go with tokens — whatever suits you.</p>
        </div>

        <div className="stagger mt-12 grid items-stretch gap-6 lg:grid-cols-3">
          {/* 1) Subscription — the headline option */}
          <Card className="relative flex flex-col p-7 ring-2 ring-primary">
            <Badge tone="primary" className="absolute -top-3 right-6">Most popular</Badge>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
              <InfinityIcon className="size-6" />
            </span>
            <h2 className="mt-5 text-xl font-semibold">Unlimited subscription</h2>
            <p className="mt-1 text-sm text-muted">Every included course, one simple plan.</p>
            <p className="mt-5 text-4xl font-bold tracking-tight tabular">
              {monthly ? money(monthly.amount_minor, monthly.currency, monthly.exponent) : isLoading ? <Skeleton className="h-10 w-28" /> : '—'}
              <span className="ml-1 text-base font-normal text-muted">/ month</span>
            </p>
            {yearly ? (
              <p className="mt-1 text-sm text-muted">
                or <span className="font-semibold text-text">{money(yearly.amount_minor, yearly.currency, yearly.exponent)}</span> / year
                {savePct > 0 ? <Badge tone="success" className="ml-2">Save {savePct}%</Badge> : null}
              </p>
            ) : null}
            {monthly?.trial_days ? <p className="mt-2 text-sm font-medium text-success">{monthly.trial_days}-day free trial</p> : null}
            <ul className="mt-6 grid gap-2.5 text-sm">
              {SUB_FEATURES.map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-7">
              {live ? (
                <div className="rounded-lg bg-success-soft p-4 text-sm text-success">
                  <p className="inline-flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="size-4" /> You're subscribed{live.status === 'trialing' ? ' (free trial)' : ''}
                  </p>
                  <p className="mt-1 text-success/90">{live.cancel_at_period_end ? 'Ends' : 'Renews'} {live.current_period_end ? shortDate(live.current_period_end) : 'soon'}.</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate('/subscription')}>
                    Manage subscription
                  </Button>
                </div>
              ) : (
                <Button size="lg" className="w-full" disabled={!monthly} onClick={() => goAuthed('/subscription')}>
                  {monthly?.trial_days ? 'Start free trial' : 'Choose a plan'}
                </Button>
              )}
            </div>
          </Card>

          {/* 2) Course bundles */}
          <Card className="flex flex-col p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
              <Package className="size-6" />
            </span>
            <h2 className="mt-5 text-xl font-semibold">Packages</h2>
            <p className="mt-1 text-sm text-muted">Hand-picked sets of courses for one price.</p>
            <p className="mt-5 text-lg font-semibold text-text">Buy once, keep for life</p>
            <ul className="mt-6 grid gap-2.5 text-sm">
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> A themed group of courses together</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> Cheaper than buying each one</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> Yours forever, no renewal</li>
            </ul>
            <div className="mt-auto pt-7">
              <Button size="lg" variant="secondary" className="w-full" onClick={() => goAuthed('/packages')}>
                Browse packages <ArrowRight />
              </Button>
            </div>
          </Card>

          {/* 3) Tokens — pay as you go */}
          <Card className="flex flex-col p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
              <Coins className="size-6" />
            </span>
            <h2 className="mt-5 text-xl font-semibold">Tokens</h2>
            <p className="mt-1 text-sm text-muted">Pay as you go — unlock just what you want.</p>
            <p className="mt-5 text-lg font-semibold text-text">Top up, then unlock</p>
            <ul className="mt-6 grid gap-2.5 text-sm">
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> Buy a token pack or a custom amount</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> Unlock a whole course or a single lecture</li>
              <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> No subscription, no commitment</li>
            </ul>
            <div className="mt-auto pt-7">
              <Button size="lg" variant="secondary" className="w-full" onClick={() => goAuthed('/wallet/buy')}>
                Get tokens <ArrowRight />
              </Button>
            </div>
          </Card>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Running a company?{' '}
          <a className="font-medium text-primary hover:underline" href="mailto:business@learnhub.example.com?subject=LearnHub%20for%20teams">
            Talk to our team
          </a>{' '}
          about training for your whole team.
        </p>

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-6 grid gap-3">
            {[
              ['Can I mix these?', 'Yes. Subscribe for everyday learning, and still buy a bundle or unlock the odd course with tokens.'],
              ['Can I cancel the subscription?', 'Any time from Manage billing. You keep access until the end of the period you paid for.'],
              ['What happens to courses I bought or unlocked?', 'Bundles and token unlocks stay yours for life, with or without a subscription.'],
              ['Do certificates expire when my plan ends?', 'No. Certificates you earned stay valid and can always be verified.'],
            ].map(([q, a]) => (
              <details key={q} className="group rounded-lg border border-border bg-surface p-4 open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                  {q}
                  <Plus className="size-4 text-muted transition-transform group-open:rotate-45" />
                </summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
