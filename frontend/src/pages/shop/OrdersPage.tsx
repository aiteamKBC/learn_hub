import { ReceiptText, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrders, useRefund } from '@/features/commerce/api'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partly refunded', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}

export function OrdersPage() {
  const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrders()
  const refund = useRefund()
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
  const [reason, setReason] = useState('')
  const orders = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <PageHeader title="Purchase history" description="Receipts for courses you bought. Refunds are possible within 30 days." />
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
                        {i.refunded_at ? (
                          <Badge>Refunded {shortDate(i.refunded_at)}</Badge>
                        ) : i.refundable ? (
                          <Button size="sm" variant="ghost" onClick={() => (setReason(''), setTarget({ id: i.id, title: i.course_title }))}>
                            <RotateCcw /> Refund
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

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent title={`Refund “${target?.title ?? ''}”?`} description="The money goes back to the card you paid with (usually 5–10 days) and the course is removed from your learning.">
          <Field label="Reason (optional)" hint="Helps the instructor improve the course.">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Keep the course</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={refund.isPending}
              onClick={() =>
                target &&
                refund.mutate(
                  { itemId: target.id, reason },
                  { onSuccess: () => (toast.success('Refund issued'), setTarget(null)), onError: (e) => toast.error((e as Error).message) },
                )
              }
            >
              Refund
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
