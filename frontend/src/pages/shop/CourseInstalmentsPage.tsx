import { CalendarClock, CreditCard } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCancelCourseInstalments, useCourseInstalmentPayoff, useMyCourseInstalments, usePayCourseInstalment } from '@/features/commerce/api'
import { money, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const PAYMENT_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  due: { label: 'Scheduled', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'warning' },
  retry: { label: 'Automatic retry scheduled', tone: 'warning' },
  manual: { label: 'Payment needed', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export function CourseInstalmentsPage() {
  const query = useMyCourseInstalments()
  const cancel = useCancelCourseInstalments()
  const payoff = useCourseInstalmentPayoff()
  const pay = usePayCourseInstalment()

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">Course instalments</h1>
      <p className="mt-1 text-sm text-muted">Your fixed course purchases, scheduled payments and stage access.</p>
      {query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.isLoading ? (
        <div className="mt-6 grid gap-3"><Skeleton className="h-40 rounded-lg" /><Skeleton className="h-40 rounded-lg" /></div>
      ) : !query.data?.length ? (
        <Card className="mt-6"><EmptyState icon={<CreditCard />} title="No instalment purchases" body="A course with fixed instalments will appear here after you start its payment plan." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} /></Card>
      ) : (
        <ul className="stagger mt-6 grid gap-4">
          {query.data.map((purchase) => {
            const isActive = purchase.status === 'active'
            const paidAll = purchase.status === 'complete'
            const activeStatus = purchase.cancelled ? 'cancelled' : purchase.status
            return (
              <li key={purchase.id}>
                <Card>
                  <CardHeader title={purchase.course_title} description={`Fixed total ${money(purchase.total_minor, purchase.currency, purchase.currency_exponent)} · paid ${money(purchase.paid_minor, purchase.currency, purchase.currency_exponent)} · remaining ${money(purchase.remaining_minor, purchase.currency, purchase.currency_exponent)}`} action={<Badge tone={paidAll ? 'success' : activeStatus === 'cancelled' ? 'neutral' : 'warning'} dot>{paidAll ? 'Complete' : activeStatus === 'cancelled' ? 'Cancelled' : 'Active'}</Badge>} />
                  <div className="grid gap-2 px-5 pb-4">
                    {purchase.instalments.map((instalment) => {
                      const status = PAYMENT_STATUS[instalment.status] ?? { label: instalment.status, tone: 'neutral' as const }
                      return (
                        <div key={instalment.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
                          <CalendarClock className="size-4 shrink-0 text-muted" />
                          <span className="min-w-32 flex-1">Payment {instalment.number} · {shortDate(instalment.due_at)}</span>
                          <span className="tabular">{money(instalment.amount_minor, purchase.currency, purchase.currency_exponent)}</span>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {instalment.retry_at ? <span className="w-full text-right text-xs text-muted">Next retry {shortDate(instalment.retry_at)}</span> : null}
                          {instalment.status === 'manual' && isActive ? <Button size="sm" loading={pay.isPending} onClick={() => pay.mutate({ purchaseId: purchase.id, instalmentId: instalment.id }, { onSuccess: () => toast.success('Manual payment request recorded. Payment integration is pending.'), onError: (e) => toast.error((e as Error).message) })}>Request manual payment</Button> : null}
                        </div>
                      )
                    })}
                  </div>
                  {isActive && purchase.remaining_minor > 0 ? (
                    <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
                      <Button variant="secondary" loading={payoff.isPending} onClick={() => payoff.mutate(purchase.id, { onSuccess: () => toast.success('Payoff request recorded. Payment integration is pending.'), onError: (e) => toast.error((e as Error).message) })}>Request early payoff</Button>
                      <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(purchase.id, { onSuccess: () => toast.success('Future charges cancelled. Paid stages stay available.'), onError: (e) => toast.error((e as Error).message) })}>Cancel future charges</Button>
                    </div>
                  ) : null}
                  <p className="px-5 pb-4 text-xs text-muted">Payments are not collected in this phase. Confirmed payments unlock mapped stages. Cancellation stops future payments and keeps stages already paid; refunds require manual review.</p>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
