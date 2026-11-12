import { AlertTriangle, BadgeCheck, CalendarClock, Check, CircleDollarSign, Clock, CreditCard, History, Inbox, Landmark, MoreHorizontal, Play, Settings, ShieldCheck, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dateTime, day, SearchBox, toMajor, toMinor, Toolbar } from '@/features/console/money-ui'
import {
  METHOD_NAME,
  type PayoutHistoryRow,
  type PayoutRequestRow,
  REQUEST_STATUS,
  useApprovePayout,
  useFailPayout,
  usePayoutAccounts,
  usePayoutBalances,
  usePayoutHistory,
  usePayoutOverview,
  usePayoutRequest,
  usePayoutRequestAction,
  usePayoutRequests,
  useRunPayouts,
  useSavePayoutSettings,
  useVerifyAccount,
} from '@/features/console/payouts'
import { PersonCell } from '@/features/console/people-ui'
import { ConfirmDialog, DetailSheet, gbp, InfoRow, KpiCard, LoadMore, StatusPill, useParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { Link } from '@/lib/router'

const TABS = ['overview', 'requests', 'balances', 'schedule', 'methods', 'history', 'settings'] as const
type Tab = (typeof TABS)[number]
type Action = 'approve' | 'mark-paid' | 'reject' | 'dispute' | 'fail'

/** What staff can do next with a request in each state (mirrors apps/payouts/services.py). */
const NEXT: Record<string, Action[]> = {
  pending: ['approve', 'dispute', 'reject'],
  approved: ['mark-paid', 'dispute', 'fail', 'reject'],
  disputed: ['approve', 'reject'],
}

const ACTION: Record<Action, { label: string; title: string; body: string; tone: 'danger' | 'primary'; reason?: 'required'; reasonLabel?: string; done: string }> = {
  approve: { label: 'Approve', title: 'Approve this payout?', body: 'Stripe Connect requests are paid at once. PayPal, Wise and bank requests are then paid by hand and marked paid.', tone: 'primary', done: 'Payout approved. The instructor was told.' },
  'mark-paid': { label: 'Mark paid', title: 'Mark this payout as paid?', body: 'Enter the reference from the transfer you made, so the instructor can match it.', tone: 'primary', reason: 'required', reasonLabel: 'Payment reference', done: 'Marked paid. The instructor was told.' },
  reject: { label: 'Reject', title: 'Reject this payout request?', body: 'The money goes back to the instructor’s available balance. They see your reason.', tone: 'danger', reason: 'required', done: 'Request rejected. The instructor was told.' },
  dispute: { label: 'Mark disputed', title: 'Put this payout on hold?', body: 'The money stays reserved while you check. You can approve or reject it later. The instructor sees your reason.', tone: 'danger', reason: 'required', done: 'Marked disputed. The instructor was told.' },
  fail: { label: 'Mark failed', title: 'Mark this transfer as failed?', body: 'Use this when a manual transfer bounced. The money goes back to the instructor’s balance.', tone: 'danger', reason: 'required', done: 'Marked failed. The money is back in their balance.' },
}

/** Jump to a tab with its filters in one URL update (two setters in one tick would clobber each other). */
function useJump() {
  const [, setParams] = useSearchParams()
  return (tab: Tab, extra: Record<string, string> = {}) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['tab', 'status', 'request']) next.delete(k)
        if (tab !== 'overview') next.set('tab', tab)
        for (const [k, v] of Object.entries(extra)) if (v) next.set(k, v)
        return next
      },
      { replace: true },
    )
}

// ---------------------------------------------------------------- request actions (shared by the table and the sheet)
function useRequestActions() {
  const act = usePayoutRequestAction()
  const [pending, setPending] = useState<{ row: PayoutRequestRow; action: Action } | null>(null)
  const a = pending ? ACTION[pending.action] : null
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(o) => !o && setPending(null)}
      title={a?.title ?? ''}
      body={
        pending ? (
          <>
            <p>
              <strong className="text-text">{gbp(pending.row.amount_gbp_minor)}</strong> to {pending.row.instructor} by {pending.row.method_label}
              {pending.row.method_detail ? ` (${pending.row.method_detail})` : ''}.
            </p>
            <p className="mt-2">{a?.body}</p>
          </>
        ) : null
      }
      confirmLabel={a?.label ?? ''}
      tone={a?.tone}
      reason={a?.reason}
      reasonLabel={a?.reasonLabel}
      loading={act.isPending}
      onConfirm={(text) =>
        act.mutate(
          { id: pending!.row.id, action: pending!.action, reason: text, provider_ref: text },
          { onSuccess: () => (toast.success(a!.done), setPending(null)), onError: (e) => toast.error((e as Error).message) },
        )
      }
    />
  )
  return { ask: (row: PayoutRequestRow, action: Action) => setPending({ row, action }), dialog }
}

function RequestButtons({ row, ask }: { row: PayoutRequestRow; ask: (r: PayoutRequestRow, a: Action) => void }) {
  const next = NEXT[row.status] ?? []
  if (next.length === 0) return null
  const [first, ...rest] = next
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={first === 'reject' ? 'danger' : 'primary'} onClick={() => ask(row, first!)}>
        {first === 'approve' ? <Check /> : <BadgeCheck />} {ACTION[first!].label}
      </Button>
      {rest.map((x) => (
        <Button key={x} size="sm" variant={x === 'reject' || x === 'fail' ? 'danger' : 'secondary'} onClick={() => ask(row, x)}>
          {x === 'reject' ? <X /> : x === 'dispute' ? <AlertTriangle /> : <X />} {ACTION[x].label}
        </Button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- requests tab
function RequestSheet({ id, onClose, ask }: { id: string; onClose: () => void; ask: (r: PayoutRequestRow, a: Action) => void }) {
  const q = usePayoutRequest(id)
  const r = q.data
  return (
    <DetailSheet open={!!id} onOpenChange={(o) => !o && onClose()} title={r ? `Payout request ${r.reference}` : 'Payout request'} description={r ? r.instructor : undefined}>
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <div className="grid gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="animate-reveal grid gap-5">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-4">
            <div>
              <p className="text-xs text-muted">Amount</p>
              <p className="text-2xl font-semibold tabular">{gbp(r.amount_gbp_minor)}</p>
            </div>
            <StatusPill status={r.status} label={REQUEST_STATUS[r.status]} />
          </div>
          <dl className="grid gap-0.5">
            <InfoRow label="Instructor">
              <Link to={`/console/instructors?user=${r.user_id}`} className="font-medium hover:text-primary">
                {r.instructor}
              </Link>
            </InfoRow>
            <InfoRow label="Email">{r.email}</InfoRow>
            <InfoRow label="Method">
              {r.method_label}
              {r.method_detail ? <span className="text-muted"> · {r.method_detail}</span> : null}
            </InfoRow>
            <InfoRow label="Details checked">{r.account_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}</InfoRow>
            <InfoRow label="Available balance now">{gbp(r.available_gbp_minor)}</InfoRow>
            <InfoRow label="Requested">{dateTime(r.created_at)}</InfoRow>
            {r.decided_at ? (
              <InfoRow label="Decided">
                {dateTime(r.decided_at)}
                {r.decided_by ? ` by ${r.decided_by}` : ''}
              </InfoRow>
            ) : null}
            {r.paid_at ? <InfoRow label="Paid">{dateTime(r.paid_at)}</InfoRow> : null}
            {r.provider_ref ? <InfoRow label="Reference">{r.provider_ref}</InfoRow> : null}
            {r.note ? <InfoRow label="Instructor's note">{r.note}</InfoRow> : null}
            {r.reason ? <InfoRow label="Reason">{r.reason}</InfoRow> : null}
          </dl>
          {!r.account_verified && NEXT[r.status]?.includes('approve') ? (
            <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-text">Verify the instructor’s payout details (Payout methods tab) before approving.</p>
          ) : null}
          <RequestButtons row={r} ask={ask} />
        </div>
      )}
    </DetailSheet>
  )
}

function Requests() {
  const [status, setStatus] = useParam('status')
  const [requestId, setRequestId] = useParam('request')
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const list = usePayoutRequests(status, q)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const { ask, dialog } = useRequestActions()
  return (
    <Card>
      <Toolbar>
        <SearchBox value={qText} onChange={setQText} label="Search payout requests" placeholder="Name, email or PAY- reference" className="sm:max-w-xs" />
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          {Object.entries(REQUEST_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title={q || status ? 'No requests match' : 'No payout requests yet'} body={q || status ? undefined : 'Instructors request payouts from their studio. They show up here.'} />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setRequestId(r.id)} className="w-full rounded-lg border border-border p-3.5 text-left text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.instructor}</p>
                      <p className="text-xs text-muted">
                        {r.reference} · {r.method_label}
                      </p>
                    </div>
                    <span className="font-semibold tabular">{gbp(r.amount_gbp_minor)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <StatusPill status={r.status} label={REQUEST_STATUS[r.status]} />
                    <span className="text-xs text-muted">{day(r.created_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Instructor</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Method</Th>
                  <Th className="hidden lg:table-cell">Requested</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <button type="button" className="font-medium hover:text-primary" onClick={() => setRequestId(r.id)}>
                        {r.reference}
                      </button>
                    </Td>
                    <Td>
                      <PersonCell name={r.instructor} email={r.email} />
                    </Td>
                    <Td className="text-right font-medium tabular">{gbp(r.amount_gbp_minor)}</Td>
                    <Td>
                      {r.method_label}
                      {r.account_verified ? null : (
                        <span className="ml-1.5">
                          <Badge tone="warning">Unverified</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="hidden text-muted lg:table-cell">{day(r.created_at)}</Td>
                    <Td>
                      <StatusPill status={r.status} label={REQUEST_STATUS[r.status]} />
                    </Td>
                    <Td className="text-right">
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${r.reference}`}>
                            <MoreHorizontal />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => setRequestId(r.id)}>View details</MenuItem>
                          {(NEXT[r.status] ?? []).map((x) => (
                            <MenuItem key={x} onSelect={() => ask(r, x)}>
                              {ACTION[x].label}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <LoadMore shown={rows.length} noun={rows.length === 1 ? 'request' : 'requests'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </div>
      )}
      <RequestSheet id={requestId} onClose={() => setRequestId('')} ask={ask} />
      {dialog}
    </Card>
  )
}

// ---------------------------------------------------------------- balances tab
function Balances() {
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const b = usePayoutBalances(q)
  return (
    <Card>
      <CardHeader title="Instructor balances" description="Available can be paid now. Pending is inside the refund hold. In payout is waiting to be paid." />
      <Toolbar>
        <SearchBox value={qText} onChange={setQText} label="Search balances" placeholder="Search instructors" className="sm:max-w-xs" />
      </Toolbar>
      {b.error ? (
        <ErrorState message={(b.error as Error).message} onRetry={() => void b.refetch()} />
      ) : !b.data ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : b.data.length === 0 ? (
        <EmptyState icon={<Wallet />} title={q ? 'Nobody matches' : 'No balances yet'} body={q ? undefined : 'Balances appear once instructors make sales.'} />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-3 md:hidden">
            {b.data.map((r) => (
              <li key={r.user_id} className="rounded-lg border border-border p-3.5 text-sm">
                <PersonCell name={r.name} email={r.email} />
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">Available</dt>
                    <dd className="font-semibold tabular">{gbp(r.available)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Pending</dt>
                    <dd className="tabular">{gbp(r.pending)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Paid</dt>
                    <dd className="tabular">{gbp(r.paid)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Instructor</Th>
                  <Th className="text-right">Available</Th>
                  <Th className="text-right">Pending</Th>
                  <Th className="text-right">In payout</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Total earned</Th>
                  <Th>Method</Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {b.data.map((r) => (
                  <Tr key={r.user_id}>
                    <Td>
                      <Link to={`/console/instructors?user=${r.user_id}&tab=payouts`} className="hover:text-primary">
                        <PersonCell name={r.name} email={r.email} />
                      </Link>
                    </Td>
                    <Td className="text-right font-semibold tabular">{gbp(r.available)}</Td>
                    <Td className="text-right tabular">{gbp(r.pending)}</Td>
                    <Td className="text-right tabular">{gbp(r.in_payout)}</Td>
                    <Td className="text-right tabular">{gbp(r.paid)}</Td>
                    <Td className="text-right tabular">{gbp(r.total)}</Td>
                    <Td>
                      {r.method ? (
                        <span className="inline-flex items-center gap-1.5">
                          {METHOD_NAME[r.method] ?? r.method}
                          {r.verified ? <BadgeCheck className="size-4 text-success" aria-label="Verified" /> : <Badge tone="warning">Unverified</Badge>}
                        </span>
                      ) : (
                        <span className="text-muted">Not set</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- schedule + settings
function ScheduleForm() {
  const o = usePayoutOverview()
  const save = useSavePayoutSettings()
  const [form, setForm] = useState<{ schedule: 'weekly' | 'monthly'; day: string; minimum: string; hold: string; requests: boolean } | null>(null)
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  if (!o.data) return <Skeleton className="h-64" />
  const s = o.data.settings
  const f = form ?? { schedule: s.schedule as 'weekly' | 'monthly', day: String(s.day_of_month), minimum: toMajor(s.minimum_gbp_minor), hold: String(s.hold_days), requests: s.requests_enabled }
  const set = (k: keyof typeof f, v: string | boolean) => setForm({ ...f, [k]: v })
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        const minimum = toMinor(f.minimum)
        const dayN = Number(f.day)
        const hold = Number(f.hold)
        if (minimum === null || minimum < 0) return toast.error('Enter a minimum payout in pounds.')
        if (!(dayN >= 1 && dayN <= 28)) return toast.error('Pick a day between 1 and 28.')
        if (!(hold >= 0 && hold <= 180)) return toast.error('The hold must be between 0 and 180 days.')
        save.mutate(
          { schedule: f.schedule, day_of_month: dayN, minimum_gbp_minor: minimum, hold_days: hold, requests_enabled: f.requests },
          { onSuccess: () => (toast.success('Payout settings saved'), setForm(null)), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="payout-schedule">Schedule</Label>
          <NativeSelect id="payout-schedule" value={f.schedule} onChange={(e) => set('schedule', e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly (Mondays)</option>
          </NativeSelect>
        </div>
        <Field label="Day of the month" hint="For monthly payouts, 1 to 28.">{(p) => <Input {...p} inputMode="numeric" value={f.day} disabled={f.schedule === 'weekly'} onChange={(e) => set('day', e.target.value.replace(/\D/g, ''))} />}</Field>
        <Field label="Minimum payout (£)" hint="Smaller balances wait for the next run.">{(p) => <Input {...p} inputMode="decimal" value={f.minimum} onChange={(e) => set('minimum', e.target.value)} />}</Field>
        <Field label="Hold after a sale (days)" hint={`Covers refunds. Never shorter than the ${s.refund_window_days}-day refund window.`}>
          {(p) => <Input {...p} inputMode="numeric" value={f.hold} onChange={(e) => set('hold', e.target.value.replace(/\D/g, ''))} />}
        </Field>
      </div>
      {Number(f.hold) < s.refund_window_days ? <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-text">This is shorter than the {s.refund_window_days}-day refund window, so the refund window applies instead.</p> : null}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <div>
          <Label htmlFor="payout-requests">Instructors can request payouts</Label>
          <p className="mt-0.5 text-xs text-muted">Lets instructors ask for their available balance before the scheduled date.</p>
        </div>
        <Switch id="payout-requests" checked={f.requests} onCheckedChange={(v) => set('requests', v)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!form} onClick={() => setForm(null)}>
          Discard
        </Button>
        <Button type="submit" disabled={!form} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

function Schedule() {
  const o = usePayoutOverview()
  const run = useRunPayouts()
  const [confirm, setConfirm] = useState(false)
  const s = o.data?.settings
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card className="lg:col-span-7">
        <CardHeader title="Payout schedule" description="Balances at or above the minimum are bundled into payouts on the payout day." />
        <CardBody>
          <ScheduleForm />
        </CardBody>
      </Card>
      <div className="grid content-start gap-5 lg:col-span-5">
        <Card>
          <CardHeader title="Next payout" />
          <CardBody className="grid gap-4">
            {!s ? (
              <Skeleton className="h-20" />
            ) : (
              <div className="animate-reveal flex items-center gap-4">
                <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
                  <CalendarClock aria-hidden />
                </span>
                <div>
                  <p className="text-xl font-semibold">{day(s.next_payout_date)}</p>
                  <p className="text-sm text-muted">
                    {s.schedule === 'weekly' ? 'Every Monday' : `Monthly on day ${s.day_of_month}`} · minimum {gbp(s.minimum_gbp_minor)}
                  </p>
                </div>
              </div>
            )}
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              <Play /> Run payouts now
            </Button>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run payouts now?"
        body="Every available balance at or above the minimum is bundled into a payout, as on the payout day. Instructors with an open request are skipped. You then pay them from the Payout history tab."
        confirmLabel="Run payouts"
        tone="primary"
        loading={run.isPending}
        onConfirm={() =>
          run.mutate(undefined, {
            onSuccess: (r) => (toast.success(r.payouts === 0 ? 'Nothing to pay out right now.' : `${r.payouts} payout${r.payouts === 1 ? '' : 's'} created.`), setConfirm(false)),
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------- methods (verify accounts)
function Methods() {
  const [all, setAll] = useState(false)
  const a = usePayoutAccounts(!all)
  const verify = useVerifyAccount()
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  return (
    <Card>
      <CardHeader
        title="Payout methods"
        description="Check each instructor’s details before their first payout. Bank details are shown masked."
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor="show-all-accounts" className="text-sm">
              Show verified too
            </Label>
            <Switch id="show-all-accounts" checked={all} onCheckedChange={setAll} />
          </div>
        }
      />
      {a.error ? (
        <ErrorState message={(a.error as Error).message} onRetry={() => void a.refetch()} />
      ) : !a.data ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : a.data.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title={all ? 'No payout details yet' : 'All payout details are verified'} />
      ) : (
        <ul className="stagger animate-reveal divide-y divide-border">
          {a.data.map((r) => (
            <li key={r.user_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <PersonCell name={r.name} email={r.email} />
                <ul className="mt-2 flex flex-wrap gap-2">
                  {r.methods.map((m) => (
                    <li key={m.method} className="rounded-md border border-border px-2 py-1 text-xs">
                      <span className="font-medium">{m.label}</span>
                      {m.detail ? <span className="text-muted"> · {m.detail}</span> : null}
                      {m.is_default ? <span className="ml-1 text-primary">(default)</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
              {r.verified_at ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-success">
                  <BadgeCheck className="size-4" aria-hidden /> Verified {day(r.verified_at)}
                </span>
              ) : (
                <Button size="sm" className="shrink-0" onClick={() => setTarget({ id: r.user_id, name: r.name })}>
                  <ShieldCheck /> Mark verified
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Verify ${target?.name ?? ''}’s payout details?`}
        body="Confirm you have checked these details belong to the instructor. Payouts to unverified details are blocked."
        confirmLabel="Mark verified"
        tone="primary"
        loading={verify.isPending}
        onConfirm={() => verify.mutate(target!.id, { onSuccess: () => (toast.success('Verified. The instructor was told.'), setTarget(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- history (scheduled payouts)
function PayHistory() {
  const [status, setStatus] = useState('')
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const h = usePayoutHistory(status, q)
  const rows = h.data?.pages.flatMap((p) => p.items) ?? []
  const pay = useApprovePayout()
  const fail = useFailPayout()
  const [paying, setPaying] = useState<PayoutHistoryRow | null>(null)
  const [failing, setFailing] = useState<PayoutHistoryRow | null>(null)
  return (
    <Card>
      <Toolbar>
        <SearchBox value={qText} onChange={setQText} label="Search payouts" placeholder="Search instructors" className="sm:max-w-xs" />
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          <option value="pending">Waiting to be paid</option>
          <option value="paid">Paid</option>
          <option value="disputed">Disputed</option>
          <option value="failed">Failed</option>
        </NativeSelect>
      </Toolbar>
      {h.error ? (
        <ErrorState message={(h.error as Error).message} onRetry={() => void h.refetch()} />
      ) : h.isLoading ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<History />} title={q || status ? 'No payouts match' : 'No payouts yet'} />
      ) : (
        <div className="animate-reveal">
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Instructor</Th>
                  <Th className="hidden sm:table-cell">Period end</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="hidden md:table-cell">Method</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((p) => (
                  <Tr key={p.id}>
                    <Td className="max-w-[10rem] truncate font-medium">{p.instructor}</Td>
                    <Td className="hidden text-muted sm:table-cell">{day(p.period_end)}</Td>
                    <Td className="text-right font-medium tabular">{gbp(p.amount_gbp_minor)}</Td>
                    <Td className="hidden md:table-cell">
                      {METHOD_NAME[p.method] ?? p.method}
                      {p.provider_ref ? <span className="block text-xs text-muted">{p.provider_ref}</span> : null}
                    </Td>
                    <Td>
                      <StatusPill status={p.status} />
                      {p.failure_reason ? <span className="mt-0.5 block max-w-[12rem] truncate text-xs text-muted">{p.failure_reason}</span> : null}
                    </Td>
                    <Td className="text-right">
                      {p.status === 'pending' ? (
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for the payout to ${p.instructor}`}>
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => setPaying(p)}>Pay</MenuItem>
                            <MenuItem onSelect={() => setFailing(p)}>Mark failed</MenuItem>
                          </MenuContent>
                        </Menu>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <LoadMore shown={rows.length} noun={rows.length === 1 ? 'payout' : 'payouts'} hasMore={!!h.hasNextPage} loading={h.isFetchingNextPage} onMore={() => void h.fetchNextPage()} />
        </div>
      )}
      <ConfirmDialog
        open={!!paying}
        onOpenChange={(o) => !o && setPaying(null)}
        title={`Pay ${paying ? gbp(paying.amount_gbp_minor) : ''} to ${paying?.instructor ?? ''}?`}
        body={paying?.method === 'stripe' ? 'Stripe Connect sends it now.' : 'Pay it by hand first, then enter the reference from your transfer.'}
        confirmLabel="Pay"
        tone="primary"
        reason={paying?.method === 'stripe' ? undefined : 'required'}
        reasonLabel="Payment reference"
        loading={pay.isPending}
        onConfirm={(ref) => pay.mutate({ id: paying!.id, provider_ref: ref }, { onSuccess: () => (toast.success('Payout paid. The instructor was told.'), setPaying(null)), onError: (e) => toast.error((e as Error).message) })}
      />
      <ConfirmDialog
        open={!!failing}
        onOpenChange={(o) => !o && setFailing(null)}
        title="Mark this payout as failed?"
        body="Its earnings go back to the instructor’s balance for the next payout."
        confirmLabel="Mark failed"
        reason="required"
        loading={fail.isPending}
        onConfirm={(reason) => fail.mutate({ id: failing!.id, reason }, { onSuccess: () => (toast.success('Marked failed'), setFailing(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- overview
function Overview({ go }: { go: (t: Tab, status?: string) => void }) {
  const o = usePayoutOverview()
  const d = o.data
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  return (
    <div className="grid gap-5">
      <section aria-label="Payout figures" className={d ? 'stagger grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 xl:grid-cols-4'}>
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <StatCard label="Pending requests" value={d.pending_requests} icon={<Clock />} tone="warning" hint={gbp(d.pending_amount_gbp_minor)} />
            <KpiCard label="Approved this month" kpi={d.approved_month} icon={<Check />} format={gbp} tone="success" />
            <StatCard label="Total paid" value={gbp(d.total_paid_gbp_minor)} icon={<CircleDollarSign />} tone="primary" hint={`${gbp(d.paid_this_month_gbp_minor)} this month`} />
            <StatCard label="Unpaid balances" value={gbp(d.total_balance_gbp_minor)} icon={<Wallet />} tone="info" hint={`${d.instructors_with_balance} instructors can be paid`} />
          </>
        )}
      </section>
      {d ? (
        <section className="grid gap-4 md:grid-cols-2" aria-label="Marketplace revenue split">
          <Card className="border-primary/20 bg-primary-soft/30">
            <CardBody className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary"><CircleDollarSign className="size-5" /></span>
              <div>
                <p className="text-sm font-medium">Tutor earnings from marketplace sales</p>
                <p className="mt-1 text-2xl font-semibold tabular">{gbp(d.tutor_earned_gbp_minor)}</p>
                <p className="mt-1 text-xs text-muted">{d.tutor_keeps_pct === null ? 'No marketplace sale recorded yet.' : `Effective tutor share: ${d.tutor_keeps_pct}% after the commission rules active at each sale.`}</p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Wallet className="size-5" /></span>
              <div>
                <p className="text-sm font-medium">Platform retained from those sales</p>
                <p className="mt-1 text-2xl font-semibold tabular">{gbp(d.platform_retained_gbp_minor)}</p>
                <p className="mt-1 text-xs text-muted">This is only marketplace split revenue; it excludes platform-owned courses and payout timing.</p>
              </div>
            </CardBody>
          </Card>
        </section>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        {[
          { show: (d?.disputed_requests ?? 0) > 0, Icon: AlertTriangle, title: `${d?.disputed_requests} disputed request${d?.disputed_requests === 1 ? '' : 's'}`, body: 'On hold. Approve or reject once checked.', label: 'Review disputes', onClick: () => go('requests', 'disputed') },
          { show: (d?.unverified_accounts ?? 0) > 0, Icon: ShieldCheck, title: `${d?.unverified_accounts} unverified payout detail${d?.unverified_accounts === 1 ? '' : 's'}`, body: 'Payouts to these are blocked until checked.', label: 'Verify details', onClick: () => go('methods') },
          { show: true, Icon: CalendarClock, title: d ? `Next payout ${day(d.settings.next_payout_date)}` : 'Next payout', body: d ? `${d.settings.schedule === 'weekly' ? 'Weekly' : 'Monthly'}, minimum ${gbp(d.settings.minimum_gbp_minor)}, ${d.settings.hold_days}-day hold.` : '', label: 'Payout schedule', onClick: () => go('schedule') },
        ]
          .filter((x) => x.show)
          .map((x) => (
            <Card key={x.label}>
              <CardBody className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-5">
                  <x.Icon aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{x.title}</p>
                  <p className="text-sm text-muted">{x.body}</p>
                  <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={x.onClick}>
                    {x.label}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
      </div>
      <PendingPreview onAll={() => go('requests', 'pending')} />
    </div>
  )
}

function PendingPreview({ onAll }: { onAll: () => void }) {
  const list = usePayoutRequests('pending', '')
  const rows = (list.data?.pages[0]?.items ?? []).slice(0, 5)
  const jump = useJump()
  return (
    <Card>
      <CardHeader title="Waiting for a decision" action={<Button size="sm" variant="ghost" onClick={onAll}>View all</Button>} />
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title="No requests waiting" />
      ) : (
        <ul className="stagger animate-reveal divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => jump('requests', { request: r.id })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.instructor}</span>
                  <span className="block text-xs text-muted">
                    {r.reference} · {r.method_label} · {day(r.created_at)}
                  </span>
                </span>
                <span className="font-semibold tabular">{gbp(r.amount_gbp_minor)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- page
export function ConsolePayoutsPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const jump = useJump()
  const o = usePayoutOverview()
  const pending = o.data?.pending_requests ?? 0
  return (
    <>
      <PageHeader title="Payouts" description="Payout requests, balances, schedule and methods." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Payout sections" className="mb-5">
          <TabsTrigger value="overview">
            <Wallet /> Overview
          </TabsTrigger>
          <TabsTrigger value="requests">
            <Inbox /> Payout requests{pending ? <Badge tone="warning">{pending}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="balances">
            <CircleDollarSign /> Balances
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <CalendarClock /> Payout schedule
          </TabsTrigger>
          <TabsTrigger value="methods">
            <CreditCard /> Payout methods
          </TabsTrigger>
          <TabsTrigger value="history">
            <Landmark /> Payout history
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-0">
          <Overview go={(t, status) => jump(t, { status: status ?? '' })} />
        </TabsContent>
        <TabsContent value="requests" className="pt-0">
          <Requests />
        </TabsContent>
        <TabsContent value="balances" className="pt-0">
          <Balances />
        </TabsContent>
        <TabsContent value="schedule" className="pt-0">
          <Schedule />
        </TabsContent>
        <TabsContent value="methods" className="pt-0">
          <Methods />
        </TabsContent>
        <TabsContent value="history" className="pt-0">
          <PayHistory />
        </TabsContent>
        <TabsContent value="settings" className="pt-0">
          <Card className="max-w-2xl">
            <CardHeader title="Payout settings" description="Client decisions: change them here, never in code." />
            <CardBody>
              <ScheduleForm />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
