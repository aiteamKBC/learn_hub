import { CreditCard, ExternalLink, FileText, Minus, Plus, Receipt, Settings2, ShieldAlert, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { usePlans } from '@/features/catalog/api'
import { useSubscribe } from '@/features/commerce/api'
import { useWorkspace } from '@/features/identity/workspace'
import { useCompany, useCompanyBillingPortal, useCompanyInvoices, useCompanySubscriptions, useIsOrgAdmin } from '@/features/org/api'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const MIN_SEATS = 5
const LIVE = ['active', 'trialing', 'past_due']
const SUB_STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  trialing: { label: 'Free trial', tone: 'info' },
  past_due: { label: 'Payment due', tone: 'warning' },
  canceled: { label: 'Cancelled', tone: 'neutral' },
  incomplete: { label: 'Not finished', tone: 'neutral' },
}
const fail = (e: unknown) => toast.error((e as Error).message)

function Seats() {
  const { data: c, isLoading } = useCompany()
  if (isLoading || !c) return <Skeleton className="h-36 rounded-lg" />
  const pct = c.seat_limit ? (c.seats_used / c.seat_limit) * 100 : 0
  return (
    <Card>
      <CardHeader title="Seats" description="Each active member uses one seat" />
      <CardBody>
        <p className="text-3xl font-semibold tracking-tight tabular">
          {c.seats_used}
          <span className="text-base font-normal text-muted"> / {c.seat_limit ?? 'no limit'}</span>
        </p>
        {c.seat_limit ? (
          <>
            <Progress value={pct} tone={pct >= 100 ? 'danger' : pct >= 85 ? 'warning' : 'primary'} className="mt-3 h-2" label={`${c.seats_used} of ${c.seat_limit} seats used`} />
            <p className="mt-2 text-xs text-muted">{c.seat_limit - c.seats_used > 0 ? `${c.seat_limit - c.seats_used} seats free` : 'All seats are in use. New invitations need more seats.'}</p>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Start the team plan through the same checkout as the plans page (no subscription yet). */
function BuySeats() {
  const { org } = useWorkspace()
  const { data: company } = useCompany()
  const { data: plans, isLoading } = usePlans()
  const subscribe = useSubscribe()
  const team = plans?.find((p) => p.audience === 'team')
  const [seats, setSeats] = useState<number | null>(null)
  const n = seats ?? Math.max(MIN_SEATS, company?.seats_used ?? MIN_SEATS)
  if (isLoading) return <Skeleton className="h-40 rounded-lg" />
  if (!team) return null
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Buy the Team Plan</p>
      <div className="flex items-center justify-between rounded-lg bg-surface-2/60 p-2">
        <Button variant="ghost" size="icon-sm" aria-label="Fewer seats" onClick={() => setSeats(Math.max(MIN_SEATS, n - 1))} disabled={n <= MIN_SEATS}>
          <Minus />
        </Button>
        <div className="text-center" aria-live="polite">
          <p className="text-lg font-semibold tabular">{n} seats</p>
          <p className="text-xs text-muted tabular">
            {money(team.amount_minor * n, team.currency, team.exponent)} / {team.interval}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="More seats" onClick={() => setSeats(Math.min(5000, n + 1))}>
          <Plus />
        </Button>
      </div>
      <Button
        loading={subscribe.isPending}
        onClick={() => org && subscribe.mutate({ planId: team.plan_id, currency: team.currency, seats: n, orgId: org.org_id }, { onSuccess: (r) => window.location.assign(r.checkout_url), onError: fail })}
      >
        <CreditCard /> Buy {n} seats
      </Button>
      <p className="text-xs text-muted">At least {MIN_SEATS} seats. You pay securely with Stripe.</p>
    </div>
  )
}

function Subscription() {
  const { data: subs, isLoading, error, refetch } = useCompanySubscriptions(true)
  const portal = useCompanyBillingPortal()
  const live = subs?.find((s) => LIVE.includes(s.status)) ?? null
  const openPortal = () => portal.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: fail })

  return (
    <Card>
      <CardHeader title="Subscription" description="Your company plan" />
      <CardBody>
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !subs ? (
          <div className="grid gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-10 w-40" />
          </div>
        ) : live ? (
          <div className="grid animate-reveal gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xl font-semibold tracking-tight">{live.plan}</p>
                <p className="mt-1 text-sm text-muted">
                  {live.seats} seats · {live.cancel_at_period_end ? 'ends' : 'renews'} {live.current_period_end ? shortDate(live.current_period_end) : 'soon'}
                </p>
              </div>
              <Badge tone={SUB_STATUS[live.status]?.tone ?? 'neutral'} dot>
                {SUB_STATUS[live.status]?.label ?? live.status}
              </Badge>
            </div>
            {live.cancel_at_period_end ? <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">This plan is set to end. Reopen it from the billing portal to keep your seats.</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button loading={portal.isPending} onClick={openPortal}>
                <Settings2 /> Manage billing
              </Button>
            </div>
            <p className="text-xs text-muted">Change the number of seats, your card or billing details in the billing portal.</p>
          </div>
        ) : (
          <div className="grid gap-5">
            <EmptyState
              className="py-6"
              icon={<CreditCard />}
              title="No active subscription"
              body="Buy seats for your team to give everyone the course library, compliance tracking and reports."
              action={
                <Button variant="link" asChild>
                  <Link to="/plans">Compare plans</Link>
                </Button>
              }
            />
            <BuySeats />
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Invoices() {
  const { data, isLoading, error, refetch } = useCompanyInvoices(true)
  return (
    <Card>
      <CardHeader title="Invoices" />
      <div className="mt-3">
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState className="py-8" icon={<Receipt />} title="No invoices yet" body="They appear here after each payment." />
        ) : (
          <div className="animate-reveal">
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th className="hidden sm:table-cell">Date</Th>
                  <Th>Amount</Th>
                  <Th className="text-right">
                    <span className="sr-only">Links</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {data.map((i) => (
                  <Tr key={i.id}>
                    <Td className="font-medium">{i.number || '–'}</Td>
                    <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{i.issued_at ? shortDate(i.issued_at) : '–'}</Td>
                    <Td className="whitespace-nowrap tabular">{money(i.amount_minor, i.currency)}</Td>
                    <Td className="text-right">
                      {i.hosted_url ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={i.hosted_url} target="_blank" rel="noreferrer">
                            <FileText /> View <ExternalLink className="text-subtle" />
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  )
}

export function BillingPage() {
  const admin = useIsOrgAdmin()
  return (
    <>
      <PageHeader title="Billing" description="Your plan, seats and invoices." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {admin ? (
            <>
              <Subscription />
              <Invoices />
            </>
          ) : (
            <Card>
              <EmptyState icon={<ShieldAlert />} title="Billing is managed by admins" body="Ask a company admin if you need more seats or a copy of an invoice." />
            </Card>
          )}
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Seats />
          <Card className="p-5">
            <p className="inline-flex items-center gap-2 text-sm font-medium">
              <Users className="size-4 text-muted" /> Need more people?
            </p>
            <p className="mt-1 text-sm text-muted">Removing someone frees their seat straight away.</p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/business/people">Manage people</Link>
            </Button>
          </Card>
        </div>
      </div>
    </>
  )
}
