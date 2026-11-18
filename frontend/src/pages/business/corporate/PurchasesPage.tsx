import { Armchair, CheckCircle2, ExternalLink, FileText, Loader2, Package, Paperclip, Receipt, ShoppingBag, Undo2, UserPlus } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { companyDownload, useCompanyDeleteFile, useCompanyFiles, useCompanyUpload } from '@/features/corporate/agreements'
import { FilesPanel } from '@/features/corporate/FilesPanel'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { CANCEL_STATUS, DELIVERY_LABEL, PURCHASE_STATUS, QUOTE_STATUS, useCancellations, usePurchases, useQuotes, useStagePlan } from '@/features/corporate/api'
import { INSTALMENT } from '@/features/corporate/agreements'
import { gbp } from '@/features/corporate/format'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useIsOrgAdmin } from '@/features/org/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** Contracts and papers for one purchase. Owners and admins only (the server checks). */
function PurchaseFiles({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const files = useCompanyFiles(id)
  const upload = useCompanyUpload(id)
  const remove = useCompanyDeleteFile(id)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Files for ${title}`} description="Kept privately with this purchase. Only owners and admins can see them.">
        <FilesPanel query={files} upload={upload} remove={remove} download={companyDownload} />
      </DialogContent>
    </Dialog>
  )
}

/** Back from Stripe: the webhook confirms payment a moment later, so we wait for it
 * instead of claiming success. Seats only exist once the server has the paid purchase;
 * "Assign seats now" then opens the seat workflow on that course. */
export function PaymentNotice({ purchaseId, onAssign, onSeats }: { purchaseId: string | null; onAssign: (offeringId: string) => void; onSeats: () => void }) {
  const q = usePurchases(true, purchaseId)
  const purchase = q.data?.find((p) => p.id === purchaseId)
  const status = q.isLoading ? 'pending' : purchase?.status === 'pending' ? 'pending' : purchase?.status === 'paid' || purchase?.status === 'partial' ? 'confirmed' : 'unknown'
  return (
    <Card className="mb-6 flex items-start gap-3 p-4 animate-reveal" role="status" aria-live="polite">
      {status === 'pending' ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" /> : status === 'confirmed' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <Receipt className="mt-0.5 size-5 shrink-0 text-muted" />}
      <div className="text-sm">
        <p className="font-medium">{status === 'pending' ? 'Confirming your payment…' : status === 'confirmed' ? 'Payment confirmed' : 'Check payment status'}</p>
        <p className="text-muted">
          {status === 'pending' ? (
            'This usually takes a few seconds. You can leave this page; we will finish in the background.'
          ) : status === 'confirmed' ? (
            'Your seats are ready to give to your people.'
          ) : 'Check the purchase status below. If it is not paid, contact support.'}
        </p>
        {status === 'confirmed' ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {purchase?.delivery_type === 'recorded' ? (
              <Button size="sm" onClick={() => onAssign(purchase.offering_id)}>
                <UserPlus /> Assign seats now
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onSeats}>
              <Armchair /> View purchased seats
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/business/packages">
                <Package /> Back to course packages
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export type RefundTarget = { id: string; label: string }

/** Purchase history. Admins can ask for a refund on a paid recorded purchase, right on
 * its row; a purchase with a request already open shows that request instead. */
export function Purchases({ back = false, purchaseId, onRefund, onShowRequests }: { back?: boolean; purchaseId?: string | null; onRefund?: (t: RefundTarget) => void; onShowRequests?: () => void }) {
  const q = usePurchases(back, purchaseId)
  const isAdmin = useIsOrgAdmin()
  const requests = useCancellations(isAdmin)
  const openFor = new Map((requests.data ?? []).filter((r) => r.type === 'recorded_refund' && r.seat_purchase_id).map((r) => [r.seat_purchase_id!, r]))
  const [filesFor, setFilesFor] = useState<{ id: string; title: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <>
      <Card>
        <CardHeader title="Purchases" description="Seats your company has bought" />
        <div className="mt-3">
          <QueryBlock
            query={q}
            empty={{ icon: <ShoppingBag />, title: 'No purchases yet', body: 'Seats you buy will be listed here.', action: <Button asChild variant="secondary"><Link to="/business/packages">See course packages</Link></Button> }}
          >
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Course</Th>
                    <Th className="hidden md:table-cell">Type</Th>
                    <Th className="text-right">Seats</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Status</Th>
                    <Th className="hidden sm:table-cell">Date</Th>
                    <Th>Plan</Th>
                    {isAdmin ? <Th className="text-right">Actions</Th> : null}
                  </tr>
                </thead>
                <tbody className="stagger">
                  {rows.map((p) => (
                    <Fragment key={p.id}>
                    <Tr>
                      <Td className="max-w-[14rem] truncate font-medium">{p.course_title}</Td>
                      <Td className="hidden text-muted md:table-cell">{DELIVERY_LABEL[p.delivery_type] ?? p.delivery_type}</Td>
                      <Td className="text-right tabular-nums">{p.quantity}</Td>
                      <Td className="text-right tabular-nums">{gbp(p.total_minor)}</Td>
                      <Td>
                        <StatusBadge map={PURCHASE_STATUS} status={p.status} />
                      </Td>
                      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{shortDate(p.paid_at ?? p.created_at)}</Td>
                      <Td>{p.stage_access_enabled ? <Button size="sm" variant="ghost" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>{expanded === p.id ? 'Hide plan' : 'Payment plan'}</Button> : <span className="text-muted">—</span>}</Td>
                      {isAdmin ? (
                        <Td className="text-right">
                          <span className="inline-flex flex-wrap items-center justify-end gap-1">
                            {(() => {
                              const req = openFor.get(p.id)
                              if (req)
                                return (
                                  <button type="button" onClick={onShowRequests} className="rounded-sm text-left" aria-label={`Refund request for ${p.course_title}: ${CANCEL_STATUS[req.status]?.label ?? req.status}`}>
                                    <StatusBadge map={CANCEL_STATUS} status={req.status} />
                                  </button>
                                )
                              if (onRefund && p.status === 'paid' && p.delivery_type === 'recorded')
                                return (
                                  <Button size="sm" variant="ghost" onClick={() => onRefund({ id: p.id, label: `${p.course_title} · ${p.quantity} seats · ${gbp(p.total_minor)} · ${shortDate(p.paid_at ?? p.created_at)}` })}>
                                    <Undo2 /> Request refund
                                  </Button>
                                )
                              return null
                            })()}
                            <Button size="sm" variant="ghost" aria-label={`Files for ${p.course_title}`} onClick={() => setFilesFor({ id: p.id, title: p.course_title })}>
                              <Paperclip />
                            </Button>
                          </span>
                        </Td>
                      ) : null}
                    </Tr>
                    {p.stage_access_enabled && expanded === p.id ? <Tr><Td colSpan={isAdmin ? 8 : 7}><StagePlanDetails purchaseId={p.id} /></Td></Tr> : null}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBlock>
        </div>
      </Card>
      {filesFor ? <PurchaseFiles id={filesFor.id} title={filesFor.title} onClose={() => setFilesFor(null)} /> : null}
    </>
  )
}

function StagePlanDetails({ purchaseId }: { purchaseId: string }) {
  const q = useStagePlan(purchaseId)
  return (
    <QueryBlock query={q} rows={2}>
      {(plan) => (
        <div className="grid gap-5 py-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Card className="p-3"><p className="text-xs text-muted">Agreed total</p><p className="font-semibold">{gbp(plan.total_minor)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Paid</p><p className="font-semibold">{gbp(plan.paid_minor)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Outstanding</p><p className="font-semibold">{gbp(plan.outstanding_minor)}</p></Card>
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Instalments</h3>
            <p className="text-xs text-muted">Payment requests are recorded for the payment integration. A payment is confirmed here only after verified settlement.</p>
            {plan.instalments.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <span>Instalment {i.sequence} · {gbp(i.amount_minor)}</span>
                <span className="flex items-center gap-2"><span className="text-muted">Due {shortDate(i.due_at)}{i.payment_requested_at ? ` · request ${shortDate(i.payment_requested_at)}` : ''}</span><StatusBadge map={INSTALMENT} status={i.status} /></span>
              </div>
            ))}
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Employee progress by course stage</h3>
            {plan.employees.length ? plan.employees.map((employee) => (
              <div key={employee.user_id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(9rem,1fr)_3fr]">
                <p className="truncate text-sm font-medium">{employee.name}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {employee.stages.map((stage) => (
                    <div key={stage.stage_id} className="rounded-md bg-surface-2 p-2 text-xs">
                      <p className="font-medium">{stage.title}</p>
                      <p className="text-muted">{stage.completed_lessons} of {stage.total_lessons} lessons complete</p>
                    </div>
                  ))}
                </div>
              </div>
            )) : <p className="text-sm text-muted">Give seats to employees to see their stage progress.</p>}
          </div>
        </div>
      )}
    </QueryBlock>
  )
}

export function Quotes() {
  const q = useQuotes()
  return (
    <Card>
      <CardHeader title="Quotes" description="Custom prices we have sent you. Paying the invoice accepts the quote." />
      <div className="mt-3">
        <QueryBlock query={q} rows={2} empty={{ icon: <FileText />, title: 'No quotes', body: 'Ask us for a quote when you buy for a large team.' }}>
          {(rows) => (
            <ul className="stagger divide-y divide-border">
              {rows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{gbp(x.total_minor)}</span>
                      <StatusBadge map={QUOTE_STATUS} status={x.status} />
                    </div>
                    <ul className="mt-1 text-sm text-muted">
                      {x.items.map((i, n) => (
                        <li key={n}>
                          {i.quantity} × {i.course_title} <Badge tone="outline">{DELIVERY_LABEL[i.delivery_type] ?? i.delivery_type}</Badge>
                        </li>
                      ))}
                    </ul>
                    {x.notes ? <p className="mt-1 text-sm">{x.notes}</p> : null}
                    <p className="mt-1 text-xs text-muted">Valid until {shortDate(x.valid_until)}</p>
                  </div>
                  {x.status === 'sent' && x.stripe_invoice_url ? (
                    <Button asChild size="sm">
                      <a href={x.stripe_invoice_url} target="_blank" rel="noopener noreferrer">
                        Pay invoice <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

/** /business/purchases is now the "Purchase history" tab of Purchases & seats. Stripe
 * still returns here (?success=1), so that is passed along. */
export function PurchasesPage() {
  const [params] = useSearchParams()
  const back = params.get('success') === '1'
  const next = new URLSearchParams({ tab: 'history' })
  if (back) {
    next.set('success', '1')
    const purchaseId = params.get('purchase')
    if (purchaseId) next.set('purchase', purchaseId)
  }
  return <Navigate to={`/business/purchases-and-seats?${next}`} replace />
}
