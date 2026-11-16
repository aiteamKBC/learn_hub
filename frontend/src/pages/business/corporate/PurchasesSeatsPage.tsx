import { Armchair, FileText, Package, Receipt, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

import { RequestDialog, type RequestTarget, RequestsList } from './CancellationsPage'
import { PaymentNotice, Purchases, Quotes } from './PurchasesPage'
import { SeatsPanel } from './SeatsPage'

const TABS = ['seats', 'history', 'quotes', 'requests'] as const
type Tab = (typeof TABS)[number]

/** Purchases & seats: the seats the company owns and who holds them (default), what it
 * bought, its quotes, and its refund and change requests. Old pages (/business/seats,
 * /business/purchases, /business/cancellations) redirect to their tab here. */
export function PurchasesSeatsPage() {
  const admin = useIsOrgAdmin()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) && (admin || raw === 'seats' || raw === 'history') ? raw : 'seats'
  const back = params.get('success') === '1'
  const purchaseId = params.get('purchase')
  const [refund, setRefund] = useState<RequestTarget | null>(null)
  useEffect(() => {
    document.title = 'Purchases & seats · LearnHub'
  }, [])

  const go = (next: Tab, extra: Record<string, string> = {}) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams()
        if (next !== 'seats') p.set('tab', next)
        if (prev.get('success') === '1' && !extra.drop) {
          p.set('success', '1')
          const returningPurchase = prev.get('purchase')
          if (returningPurchase) p.set('purchase', returningPurchase)
        }
        for (const [k, v] of Object.entries(extra)) if (k !== 'drop') p.set(k, v)
        return p
      },
      { replace: true },
    )

  return (
    <>
      <PageHeader
        title="Purchases & seats"
        description="The seats your company owns and who has them, what you have bought, quotes and requests."
        actions={
          <Button asChild variant="secondary">
            <Link to="/business/packages">
              <Package /> Buy more seats
            </Link>
          </Button>
        }
      />
      {back ? <PaymentNotice purchaseId={purchaseId} onAssign={(offeringId) => go('seats', { offering: offeringId, give: '1', drop: '1' })} onSeats={() => go('seats', { drop: '1' })} /> : null}
      <Tabs value={tab} onValueChange={(v) => go(v as Tab)}>
        <TabsList>
          <TabsTrigger value="seats">
            <Armchair /> Seats
          </TabsTrigger>
          <TabsTrigger value="history">
            <Receipt /> Purchase history
          </TabsTrigger>
          {admin ? (
            <>
              <TabsTrigger value="quotes">
                <FileText /> Quotes
              </TabsTrigger>
              <TabsTrigger value="requests">
                <Undo2 /> Requests
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>
        <TabsContent value="seats">
          <SeatsPanel key={`${params.get('offering') ?? ''}:${params.get('give') ?? ''}`} offering={params.get('offering')} give={params.get('give') === '1'} />
        </TabsContent>
        <TabsContent value="history">
          <Purchases back={back} purchaseId={purchaseId} onRefund={admin ? (t) => setRefund({ type: 'recorded_refund', ...t }) : undefined} onShowRequests={() => go('requests')} />
        </TabsContent>
        {admin ? (
          <>
            <TabsContent value="quotes">
              <Quotes />
            </TabsContent>
            <TabsContent value="requests">
              <RequestsList />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
      <RequestDialog target={refund} onClose={() => setRefund(null)} onSent={() => go('requests')} />
    </>
  )
}
