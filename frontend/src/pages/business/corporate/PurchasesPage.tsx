import { CheckCircle2, ExternalLink, FileText, Loader2, Paperclip, Receipt, ShoppingBag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { companyDownload, useCompanyDeleteFile, useCompanyFiles, useCompanyUpload } from '@/features/corporate/agreements'
import { FilesPanel } from '@/features/corporate/FilesPanel'
import { PageHeader } from '@/components/ui/misc'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { DELIVERY_LABEL, PURCHASE_STATUS, QUOTE_STATUS, usePurchases, useQuotes } from '@/features/corporate/api'
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
 * instead of claiming success. */
function PaymentNotice({ pending }: { pending: boolean }) {
  return (
    <Card className="mb-6 flex items-start gap-3 p-4 animate-reveal" role="status" aria-live="polite">
      {pending ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />}
      <div className="text-sm">
        <p className="font-medium">{pending ? 'Confirming your payment…' : 'Payment confirmed'}</p>
        <p className="text-muted">
          {pending ? (
            'This usually takes a few seconds. You can leave this page; we will finish in the background.'
          ) : (
            <>
              Your seats are ready. <Link to="/business/seats" className="font-medium text-primary hover:underline">Give them to your people</Link>.
            </>
          )}
        </p>
      </div>
    </Card>
  )
}

function Purchases({ back }: { back: boolean }) {
  const q = usePurchases(back)
  const isAdmin = useIsOrgAdmin()
  const [filesFor, setFilesFor] = useState<{ id: string; title: string } | null>(null)
  const pending = q.data?.some((p) => p.status === 'pending') ?? true
  return (
    <>
      {back ? <PaymentNotice pending={pending} /> : null}
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
                    {isAdmin ? <Th className="text-right">Files</Th> : null}
                  </tr>
                </thead>
                <tbody className="stagger">
                  {rows.map((p) => (
                    <Tr key={p.id}>
                      <Td className="max-w-[14rem] truncate font-medium">{p.course_title}</Td>
                      <Td className="hidden text-muted md:table-cell">{DELIVERY_LABEL[p.delivery_type] ?? p.delivery_type}</Td>
                      <Td className="text-right tabular-nums">{p.quantity}</Td>
                      <Td className="text-right tabular-nums">{gbp(p.total_minor)}</Td>
                      <Td>
                        <StatusBadge map={PURCHASE_STATUS} status={p.status} />
                      </Td>
                      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{shortDate(p.paid_at ?? p.created_at)}</Td>
                      {isAdmin ? (
                        <Td className="text-right">
                          <Button size="sm" variant="ghost" aria-label={`Files for ${p.course_title}`} onClick={() => setFilesFor({ id: p.id, title: p.course_title })}>
                            <Paperclip />
                          </Button>
                        </Td>
                      ) : null}
                    </Tr>
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

function Quotes() {
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

export function PurchasesPage() {
  const admin = useIsOrgAdmin()
  const [params] = useSearchParams()
  const back = params.get('success') === '1'
  useEffect(() => {
    document.title = 'Purchases · LearnHub'
  }, [])
  return (
    <>
      <PageHeader
        title="Purchases"
        description="What your company has bought, and quotes waiting for you."
        actions={
          <Button asChild variant="secondary">
            <Link to="/business/packages">
              <Receipt /> Buy more seats
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        <Purchases back={back} />
        {admin ? <Quotes /> : null}
      </div>
    </>
  )
}
