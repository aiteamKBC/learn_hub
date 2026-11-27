import { ReceiptText, RotateCcw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrders } from '@/features/commerce/api'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partly refunded', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}

export function OrdersPage() {
  const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrders()
  const orders = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <PageHeader title="Purchase history" description="Receipts for courses you bought. Refunds are reviewed by our team before anything is returned." />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : !orders.length ? (
        <Card className="animate-reveal">
          <EmptyState icon={<ReceiptText />} title="No purchases yet" body="Courses you buy will show up here with their receipts." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} />
        </Card>
      ) : (
        <ul className="stagger grid gap-4">
          {orders.map((o) => {
            const s = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as const }
            return (
              <li key={o.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold">{o.paid_at ? shortDate(o.paid_at) : shortDate(o.created_at)}</p>
                      <p className="font-mono text-xs text-muted">Order {o.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                      <span className="text-lg font-semibold tabular">{money(o.total_minor, o.currency, o.exponent)}</span>
                    </div>
                  </div>
                  <ul className="divide-y divide-border">
                    {o.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                        <Link to={`/learn`} className="flex-1 font-medium hover:text-primary">
                          {i.course_title}
                        </Link>
                        <span className="text-muted tabular">{money(i.gross_minor, o.currency, o.exponent)}</span>
                        {/* Refunds need admin approval, so this page reports status only.
                            The self-service button used to move real money immediately —
                            see REFUND-1 in docs/NEEDS-USER.md. */}
                        {i.refunded_at ? (
                          <Badge>Refunded {shortDate(i.refunded_at)}</Badge>
                        ) : i.refundable ? (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/contact">
                              <RotateCcw /> Ask about a refund
                            </Link>
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {hasNextPage ? (
        <Button variant="secondary" className="mt-4" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Show older orders
        </Button>
      ) : null}

    </>
  )
}
