import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Coins, FileText, Gift, GraduationCap, PlayCircle, Plus, ReceiptText, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWalletBalance, useWalletGrants, useWalletLedger } from '@/features/b2c/api'
import { count, relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** Personal token wallet: balance, what's expiring, and a full history of grants and
 * movements. Tokens are the person's own (sent with X-Org-Id: '') and never a company's. */
export function WalletPage() {
  const qc = useQueryClient()
  const balance = useWalletBalance()
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('b2c-wallet') })

  return (
    <>
      <PageHeader
        title="Your token wallet"
        description="View your token balance and history. New token unlocks for courses, lectures and materials are temporarily unavailable. Existing access rights are unchanged."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh wallet">
              <RefreshCw />
            </Button>
            <Button asChild>
              <Link to="/wallet/buy">
                <Plus /> Buy tokens
              </Link>
            </Button>
          </div>
        }
      />

        {balance.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        ) : balance.error ? (
          <ErrorState message="We couldn't load your wallet." onRetry={() => void balance.refetch()} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Available balance"
                value={<CountUp value={balance.data?.balance ?? 0} />}
                icon={<Coins />}
                tone="primary"
                hint="tokens in your wallet"
              />
              <StatCard
                label="Expiring within 7 days"
                value={<CountUp value={balance.data?.expiring_within_7_days ?? 0} />}
                icon={<AlertTriangle />}
                tone={balance.data?.expiring_within_7_days ? 'warning' : 'info'}
                hint={balance.data?.expiring_within_7_days ? 'check grant expiry dates below' : 'nothing expiring soon'}
              />
            </div>

            {balance.data?.expiring_within_7_days ? (
              <Card className="mt-4 border-warning/40 bg-warning-soft/40">
                <CardBody className="flex items-start gap-3 py-4 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>
                    <strong>{count(balance.data.expiring_within_7_days)}</strong> {balance.data.expiring_within_7_days === 1 ? 'token expires' : 'tokens expire'} within 7 days. Tokens are
                    subject to their existing expiry dates. New content unlocks with tokens are temporarily unavailable.
                  </p>
                </CardBody>
              </Card>
            ) : null}

            <TokenUseGuide />

            <Tabs defaultValue="grants" className="mt-8">
              <TabsList>
                <TabsTrigger value="grants">
                  <Gift className="mr-1.5 size-4" /> Grants
                </TabsTrigger>
                <TabsTrigger value="ledger">
                  <ReceiptText className="mr-1.5 size-4" /> History
                </TabsTrigger>
              </TabsList>
              <TabsContent value="grants">
                <GrantsTab />
              </TabsContent>
              <TabsContent value="ledger">
                <LedgerTab />
              </TabsContent>
            </Tabs>
          </>
        )}
    </>
  )
}

function TokenUseGuide() {
  const uses = [
    { Icon: PlayCircle, title: 'Unlock a lecture', body: 'Open an individual lesson when you only need one topic.' },
    { Icon: FileText, title: 'Get learning materials', body: 'Use tokens for eligible downloads, templates and resources.' },
    { Icon: GraduationCap, title: 'Unlock a full course', body: 'Pay the displayed token price once and start learning.' },
  ]
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold tracking-tight">How to use your tokens</h2><p className="mt-0.5 text-sm text-muted">Every unlock shows its token price before you confirm.</p></div><Badge tone="outline">Example uses</Badge></div>
      <div className="grid gap-3 sm:grid-cols-3">
        {uses.map(({ Icon, title, body }) => (
          <Card key={title} className="rounded-2xl p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></span>
            <h3 className="mt-3 text-sm font-bold">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
          </Card>
        ))}
      </div>
    </section>
  )
}

const GRANT_SOURCE_LABEL: Record<string, string> = {
  purchase: 'Purchased',
  topup: 'Top-up',
  bonus: 'Bonus',
  admin: 'Adjustment',
  refund: 'Refund',
}

function GrantsTab() {
  const { data, isLoading, error, refetch } = useWalletGrants()
  if (isLoading) return <Skeleton className="h-48 rounded-lg" />
  if (error) return <ErrorState message="We couldn't load your grants." onRetry={() => void refetch()} />
  if (!data?.length)
    return (
      <EmptyState
        icon={<Gift />}
        title="No token grants yet"
        body="Your token grants will appear here. Buying tokens does not currently enable new course, lecture or material unlocks."
        action={
          <Button asChild>
            <Link to="/wallet/buy">
              <Plus /> Buy tokens
            </Link>
          </Button>
        }
      />
    )
  return (
    <Card>
      <ul className="stagger divide-y divide-border">
        {data.map((g) => {
          const spent = g.amount - g.remaining
          return (
            <li key={g.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
                {g.source === 'bonus' ? <Gift className="size-4" /> : <Coins className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {GRANT_SOURCE_LABEL[g.source] ?? g.source} · {count(g.amount)} tokens
                </p>
                <p className="truncate text-xs text-muted">
                  {g.note || 'Token grant'} · {relativeDate(g.granted_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">{count(g.remaining)} left</p>
                {g.expires_at ? (
                  <Badge tone={isSoon(g.expires_at) ? 'warning' : 'neutral'}>Expires {shortDate(g.expires_at)}</Badge>
                ) : (
                  <Badge tone="neutral">No expiry</Badge>
                )}
                {spent > 0 ? <p className="mt-0.5 text-xs text-muted">{count(spent)} spent</p> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const LEDGER_TONE: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = {
  grant: 'success',
  topup: 'success',
  purchase: 'success',
  bonus: 'success',
  spend: 'danger',
  unlock: 'danger',
  expire: 'warning',
  adjust: 'neutral',
}

function LedgerTab() {
  const { data, isLoading, error, refetch } = useWalletLedger()
  if (isLoading) return <Skeleton className="h-48 rounded-lg" />
  if (error) return <ErrorState message="We couldn't load your history." onRetry={() => void refetch()} />
  if (!data?.length)
    return <EmptyState icon={<ReceiptText />} title="No activity yet" body="Every token you earn or spend will be listed here." />
  return (
    <Card>
      <ul className="stagger divide-y divide-border">
        {data.map((e) => (
          <li key={e.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium capitalize">{e.kind.replace(/_/g, ' ')}</p>
              <p className="truncate text-xs text-muted">
                {e.note || '—'} · {relativeDate(e.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-semibold tabular-nums ${e.amount < 0 ? 'text-danger' : 'text-success'}`}>
                {e.amount > 0 ? '+' : ''}
                {count(e.amount)}
              </p>
              <p className="text-xs text-muted tabular-nums">balance {count(e.balance_after)}</p>
            </div>
            <Badge tone={LEDGER_TONE[e.kind] ?? 'neutral'} className="hidden sm:inline-flex capitalize">
              {e.kind.replace(/_/g, ' ')}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function isSoon(iso: string): boolean {
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000
  return days <= 7
}
