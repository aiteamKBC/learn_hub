import { Building2, PoundSterling, ShieldAlert, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/misc'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCompanies } from '@/features/console/companies'
import { useStudents } from '@/features/console/people'
import { Toolbar, day, toMinor } from '@/features/console/money-ui'
import { ConfirmDialog, useTabParam } from '@/features/console/ui'
import { CANCEL_STATUS, CANCEL_TYPE } from '@/features/corporate/api'
import {
  type CnCancellation,
  type CnDepartureResult,
  POLICY_LABEL,
  useCnRecordDeparture,
  useCnCancellations,
  useCnPolicies,
  useCnRefund,
  useCnReviewCancellation,
  useCnSetPolicy,
} from '@/features/corporate/console'
import { fullDate, gbp } from '@/features/corporate/format'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useDebounced } from '@/features/org/ui'

const TABS = ['requests', 'departures'] as const
type Tab = (typeof TABS)[number]
const err = (e: unknown) => toast.error((e as Error).message)

/** Refund amounts are decided case by case (policy gate G04): staff type the amount;
 * nothing here calculates one. */
function Refund({ c, onClose }: { c: CnCancellation; onClose: () => void }) {
  const refund = useCnRefund()
  const [amount, setAmount] = useState('')
  const minor = toMinor(amount)
  const ok = minor != null && minor > 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Refund ${c.org_name}`} description="Enter the amount you agreed. Stripe sends it back to the card that paid.">
        <div className="grid gap-4">
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> There is no automatic formula. Check legal minimums (for example cooling-off rights) before you refund.
          </p>
          <Field label="Amount in pounds">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />}</Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={!ok}
              loading={refund.isPending}
              onClick={() =>
                refund.mutate(
                  { id: c.id, amount_minor: minor!, currency: 'GBP' },
                  {
                    onSuccess: () => (toast.success('Refund sent'), onClose()),
                    onError: err,
                  },
                )
              }
            >
              Refund {ok ? gbp(minor!) : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Requests() {
  const [status, setStatus] = useState('')
  const q = useCnCancellations(status)
  const review = useCnReviewCancellation()
  const [deciding, setDeciding] = useState<{
    c: CnCancellation
    approve: boolean
  } | null>(null)
  const [refunding, setRefunding] = useState<CnCancellation | null>(null)
  return (
    <Card>
      <CardHeader title="Refund and change requests" description="Sent by company admins" />
      <Toolbar>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {Object.entries(CANCEL_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <Undo2 />, title: 'No requests' }}>
        {(rows) => (
          <ul className="stagger divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id} className="grid gap-2 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {c.org_name} · {CANCEL_TYPE[c.type] ?? c.type}
                  </span>
                  <StatusBadge map={CANCEL_STATUS} status={c.status} />
                </div>
                <p className="text-sm">{c.reason}</p>
                <p className="text-xs text-muted">
                  From {c.requester_email} · {day(c.created_at)}
                  {c.admin_notes ? ` · Note: ${c.admin_notes}` : ''}
                  {c.refund_amount_minor != null ? ` · Refunded ${gbp(c.refund_amount_minor)}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['submitted', 'under_review'].includes(c.status) ? (
                    <>
                      <Button size="sm" variant="soft" onClick={() => setDeciding({ c, approve: true })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeciding({ c, approve: false })}>
                        Decline
                      </Button>
                    </>
                  ) : null}
                  {c.status === 'approved' && c.type === 'recorded_refund' ? (
                    <Button size="sm" onClick={() => setRefunding(c)}>
                      <PoundSterling /> Refund
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryBlock>
      <ConfirmDialog
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.approve ? 'Approve this request?' : 'Decline this request?'}
        confirmLabel={deciding?.approve ? 'Approve' : 'Decline'}
        tone={deciding?.approve ? 'primary' : 'danger'}
        reason="optional"
        reasonLabel="Note to keep with the request"
        loading={review.isPending}
        onConfirm={(note) =>
          review.mutate(
            {
              id: deciding!.c.id,
              approve: deciding!.approve,
              admin_notes: note,
            },
            {
              onSuccess: () => (toast.success('Saved'), setDeciding(null)),
              onError: err,
            },
          )
        }
      />
      {refunding ? <Refund c={refunding} onClose={() => setRefunding(null)} /> : null}
    </Card>
  )
}

function DepartureResult({ r }: { r: CnDepartureResult }) {
  return (
    <div className="animate-reveal grid gap-2 rounded-lg border border-border p-3 text-sm" role="status">
      <p className="font-medium">Departure recorded. Left on {day(r.left_at)}.</p>
      {r.courses.length ? (
        <ul className="stagger grid gap-1">
          {r.courses.map((c, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2">
              <span className="min-w-0">{c.course_title}</span>
              <span className="text-muted">{c.access_expires_at ? `Access until ${fullDate(c.access_expires_at)}` : 'No end date'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No company-paid courses.</p>
      )}
    </div>
  )
}

/** Staff record a leaver. The person must already be removed from the company. */
function RecordDeparture() {
  const record = useCnRecordDeparture()
  const [cq, setCq] = useState('')
  const orgs = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const [pq, setPq] = useState('')
  const people = useStudents({ q: useDebounced(pq) })
  const [userId, setUserId] = useState('')
  const rows = people.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="self-start p-5">
      <h2 className="mb-1 text-[15px] font-semibold">Record a departure</h2>
      <p className="mb-4 text-[13px] text-muted">Remove the person from the company first. Their paid courses stay open until each one ends, and no new seats renew.</p>
      <div className="grid gap-4">
        <Field label="Find company">{(p) => <Input {...p} value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
        <Field label="Company">
          {(p) => (
            <NativeSelect {...p} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">Choose…</option>
              {orgs.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Find person by name or email">{(p) => <Input {...p} value={pq} onChange={(e) => setPq(e.target.value)} />}</Field>
        <Field label="Person">
          {(p) => (
            <NativeSelect {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {rows.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button
          disabled={!orgId || !userId}
          loading={record.isPending}
          onClick={() =>
            record.mutate(
              { orgId, userId },
              {
                onSuccess: () => toast.success('Departure recorded'),
                onError: err,
              },
            )
          }
        >
          Record departure
        </Button>
        {record.data ? <DepartureResult r={record.data} /> : null}
      </div>
    </Card>
  )
}

function Departures() {
  const q = useCnPolicies()
  const set = useCnSetPolicy()
  const [cq, setCq] = useState('')
  const orgs = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const [action, setAction] = useState('admin_decides')
  const [notes, setNotes] = useState('')
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="grid gap-6 self-start">
        <RecordDeparture />
        <Card className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Set a policy</h2>
          <p className="mb-4 text-[13px] text-muted">For your records only. Paid courses always run until their end date, even after someone leaves. Progress and certificates are always kept.</p>
          <div className="grid gap-4">
            <Field label="Find company">{(p) => <Input {...p} value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
            <Field label="Company">
              {(p) => (
                <NativeSelect {...p} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  <option value="">Choose…</option>
                  {orgs.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="When someone leaves">
              {(p) => (
                <NativeSelect {...p} value={action} onChange={(e) => setAction(e.target.value)}>
                  {Object.entries(POLICY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Notes (optional)">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}</Field>
            <Button
              disabled={!orgId}
              loading={set.isPending}
              onClick={() =>
                set.mutate(
                  { orgId, action, notes },
                  {
                    onSuccess: () => toast.success('Policy saved'),
                    onError: err,
                  },
                )
              }
            >
              Save policy
            </Button>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Company policies" description="Companies without one: we decide each case." />
        <div className="mt-3">
          <QueryBlock query={q} empty={{ icon: <Building2 />, title: 'No policies set' }}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Company</Th>
                    <Th>Policy</Th>
                    <Th className="hidden sm:table-cell">Updated</Th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {rows.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium">{r.org_name}</Td>
                      <Td>{POLICY_LABEL[r.action] ?? r.action}</Td>
                      <Td className="hidden text-muted sm:table-cell">{day(r.updated_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBlock>
        </div>
      </Card>
    </div>
  )
}

export function ConsoleCorporateCasesPage() {
  const [tab, setTab] = useTabParam(TABS, 'requests')
  useEffect(() => {
    document.title = 'Refunds and departures · Console · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Refunds and departures" description="Company refund requests, and what happens when an employee leaves." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Sections">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="departures">Departures</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-5">
          <Requests />
        </TabsContent>
        <TabsContent value="departures" className="mt-5">
          <Departures />
        </TabsContent>
      </Tabs>
    </>
  )
}
