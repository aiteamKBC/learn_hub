/** Console > Company packages: seat inventory, the agreed programme length, instalment
 * plans and who each instalment covers, and purchase files. */
import { Armchair, CalendarClock, Plus, Send, Trash2, Users, Wallet } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useCompanies, useCompany } from '@/features/console/companies'
import { SearchBox, Toolbar, day, toMajor, toMinor } from '@/features/console/money-ui'
import {
  ENTITLEMENT,
  INSTALMENT,
  PLAN_LABEL,
  PROGRAMME,
  type CnInstalment,
  type CnPlan,
  cnDownload,
  useCnCover,
  useCnCreatePlan,
  useCnDeleteFile,
  useCnFiles,
  useCnInventory,
  useCnPlan,
  useCnSendInstalment,
  useCnSetProgramme,
  useCnUncover,
  useCnUpload,
} from '@/features/corporate/agreements'
import { DELIVERY_LABEL } from '@/features/corporate/api'
import { money } from '@/lib/format'
import { type CnPurchase, useCnOfferings } from '@/features/corporate/console'
import { FilesPanel } from '@/features/corporate/FilesPanel'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useDebounced } from '@/features/org/ui'

const err = (e: unknown) => toast.error((e as Error).message)
const months = (n: number | null | undefined) => (n ? `${n} month${n === 1 ? '' : 's'}` : 'Not set')

// ---------------------------------------------------------------- purchase: agreement
function ProgrammeLength({ p }: { p: CnPurchase }) {
  const save = useCnSetProgramme()
  const [value, setValue] = useState(p.agreement_months ? String(p.agreement_months) : '')
  const n = value.trim() ? Number(value) : null
  const ok = n == null || (Number.isInteger(n) && n >= 1 && n <= 120)
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarClock className="size-4" /> Programme length
      </p>
      <p className="text-xs text-muted">
        In force: {months(p.programme_months)}
        {p.agreement_months ? ' (agreed for this company)' : ' (package default)'}. Counts from each person&apos;s first session. Lessons stay open after it ends.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Agreed months for this company" error={ok ? undefined : 'Enter a whole number from 1 to 120.'}>
          {(f) => <Input {...f} inputMode="numeric" className="w-40" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Package default" />}
        </Field>
        <Button size="sm" variant="secondary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate({ purchaseId: p.id, months: n }, { onSuccess: () => toast.success('Programme length saved'), onError: err })}>
          Save
        </Button>
      </div>
    </div>
  )
}

function CoverDialog({ inst, plan, onClose }: { inst: CnInstalment; plan: CnPlan; onClose: () => void }) {
  const cover = useCnCover()
  const uncover = useCnUncover()
  const covered = new Set(inst.covered_allocation_ids)
  const [picked, setPicked] = useState<string[]>([])
  const choosable = plan.seats.filter((s) => !s.left_at && !covered.has(s.allocation_id))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Who instalment ${inst.sequence} covers`} description="Only the people you choose get this payment's paid period. Everyone else is unchanged.">
        <div className="grid gap-4">
          {plan.seats.length === 0 ? <p className="text-sm text-muted">No seats have been given on this purchase yet.</p> : null}
          {plan.seats.filter((s) => covered.has(s.allocation_id)).length ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted">Already covered</p>
              {plan.seats
                .filter((s) => covered.has(s.allocation_id))
                .map((s) => (
                  <div key={s.allocation_id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{s.user_name}</span>
                    {inst.status !== 'paid' ? (
                      <Button size="sm" variant="ghost" aria-label={`Take ${s.user_name} off this instalment`} loading={uncover.isPending} onClick={() => uncover.mutate({ id: inst.id, allocationId: s.allocation_id }, { onError: err })}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                ))}
            </div>
          ) : null}
          {choosable.length ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-xs font-medium text-muted">Add people</legend>
              {choosable.map((s) => (
                <label key={s.allocation_id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.includes(s.allocation_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.allocation_id] : picked.filter((x) => x !== s.allocation_id))} />
                  <span className="min-w-0 truncate">
                    {s.user_name} <span className="text-muted">· {s.user_email}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {plan.seats.some((s) => s.left_at) ? <p className="text-xs text-muted">People who have left the company cannot be added.</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              disabled={!picked.length}
              loading={cover.isPending}
              onClick={() =>
                cover.mutate(
                  { id: inst.id, allocationIds: picked },
                  { onSuccess: (r) => (toast.success(`${r.added} added${r.already_covered ? `, ${r.already_covered} already covered` : ''}`), setPicked([])), onError: err },
                )
              }
            >
              Add {picked.length || ''} {picked.length === 1 ? 'person' : 'people'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PlanPanel({ purchaseId }: { purchaseId: string }) {
  const q = useCnPlan(purchaseId)
  const send = useCnSendInstalment()
  const [choosing, setChoosing] = useState<string | null>(null)
  return (
    <QueryBlock query={q} rows={3}>
      {(plan) => (
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[
              ['Agreed total', plan.total_minor],
              ['Paid', plan.paid_minor],
              ['Still to pay', plan.outstanding_minor],
            ].map(([label, v]) => (
              <div key={label} className="rounded-lg bg-surface-2 p-2">
                <p className="text-xs text-muted">{label}</p>
                <p className="font-semibold tabular-nums">{money(v as number, plan.currency)}</p>
              </div>
            ))}
          </div>
          {plan.payment_plan === 'instalments' ? (
            <>
              <ul className="stagger grid gap-2">
                {plan.instalments.map((i) => (
                  <li key={i.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        Instalment {i.sequence} · {money(i.amount_minor, plan.currency)}
                      </span>
                      <StatusBadge map={INSTALMENT} status={i.status} />
                    </div>
                    <p className="text-xs text-muted">
                      Due {day(i.due_at)} · covers {months(i.covers_months)} from payment
                      {i.paid_at ? ` · paid ${day(i.paid_at)}, access to ${day(i.paid_through ?? i.paid_at)}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="outline">
                        <Users className="size-3" /> {i.covered_allocation_ids.length} covered
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => setChoosing(i.id)}>
                        Choose people
                      </Button>
                      {(i.status === 'pending' || i.status === 'overdue') && !i.stripe_invoice_id ? (
                        <Button size="sm" variant="ghost" loading={send.isPending && send.variables === i.id} onClick={() => send.mutate(i.id, { onSuccess: () => toast.success('Invoice sent through Stripe'), onError: err })}>
                          <Send /> Send invoice
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2">
                <p className="text-sm font-semibold">What each person has paid for</p>
                {plan.seats.length ? (
                  <ul className="grid gap-1 text-sm">
                    {plan.seats.map((s) => (
                      <li key={s.allocation_id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {s.user_name}
                          {s.left_at ? <span className="text-xs text-muted"> · left {day(s.left_at)}</span> : null}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted">
                          {s.entitlement_paid_through ? `to ${day(s.entitlement_paid_through)}` : null}
                          <StatusBadge map={ENTITLEMENT} status={s.entitlement_status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No seats given yet.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Paid in full: lessons have no end date.</p>
          )}
          {choosing ? <CoverDialog inst={plan.instalments.find((i) => i.id === choosing)!} plan={plan} onClose={() => setChoosing(null)} /> : null}
        </div>
      )}
    </QueryBlock>
  )
}

/** Everything about one company agreement, shown in the purchase sheet. */
export function AgreementSection({ p }: { p: CnPurchase }) {
  const files = useCnFiles(p.id)
  const upload = useCnUpload(p.id)
  const remove = useCnDeleteFile(p.id)
  return (
    <div className="grid gap-4">
      <p className="flex items-center gap-1.5 text-sm">
        <Wallet className="size-4" /> {PLAN_LABEL[p.payment_plan] ?? p.payment_plan}
      </p>
      <ProgrammeLength p={p} />
      <PlanPanel purchaseId={p.id} />
      <FilesPanel query={files} upload={upload} remove={remove} download={cnDownload} />
    </div>
  )
}

// ---------------------------------------------------------------- new instalment plan
type Row = { amount: string; due: string; months: string }

export function InstalmentPlanForm({ onClose }: { onClose: () => void }) {
  const [cq, setCq] = useState('')
  const companies = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const company = useCompany(orgId || undefined)
  const offerings = useCnOfferings()
  const create = useCnCreatePlan()
  const [buyerId, setBuyerId] = useState('')
  const [offeringId, setOfferingId] = useState('')
  const [quantity, setQuantity] = useState(10)
  const [price, setPrice] = useState('')
  const [length, setLength] = useState('')
  const [rows, setRows] = useState<Row[]>([
    { amount: '', due: '', months: '3' },
    { amount: '', due: '', months: '3' },
  ])
  const unit = toMinor(price)
  const total = unit != null ? unit * quantity : 0
  const amounts = rows.map((r) => toMinor(r.amount))
  const sum = amounts.reduce<number>((s, a) => s + (a ?? 0), 0)
  const lengthN = length.trim() ? Number(length) : null
  const rowsOk = rows.every((r, n) => amounts[n] != null && amounts[n]! > 0 && r.due && Number.isInteger(Number(r.months)) && Number(r.months) >= 1)
  const datesOk = rows.every((r, n) => n === 0 || !r.due || !rows[n - 1].due || r.due >= rows[n - 1].due)
  const valid = !!orgId && !!buyerId && !!offeringId && quantity >= 1 && unit != null && unit > 0 && rowsOk && datesOk && sum === total && (lengthN == null || (lengthN >= 1 && lengthN <= 120))

  const split = () => {
    if (!total) return
    const each = Math.floor(total / rows.length)
    setRows(rows.map((r, n) => ({ ...r, amount: toMajor(n === rows.length - 1 ? total - each * (rows.length - 1) : each) })))
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    create.mutate(
      {
        org_id: orgId,
        offering_id: offeringId,
        buyer_id: buyerId,
        quantity,
        unit_price_minor: unit!,
        currency: 'GBP',
        programme_months: lengthN,
        schedule: rows.map((r, n) => ({ amount_minor: amounts[n]!, due_at: new Date(`${r.due}T09:00:00Z`).toISOString(), covers_months: Number(r.months) })),
      },
      { onSuccess: () => (toast.success('Instalment plan created'), onClose()), onError: err },
    )
  }
  const set = (n: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New instalment plan" description="The company commits to the full price and pays it in parts. Each payment covers only the people you choose." className="sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Find a company">{(f) => <Input {...f} value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
            <Field label="Company">
              {(f) => (
                <NativeSelect {...f} value={orgId} onChange={(e) => (setOrgId(e.target.value), setBuyerId(''))} required>
                  <option value="">Choose…</option>
                  {companies.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoices go to (company admin)">
              {(f) => (
                <NativeSelect {...f} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} required disabled={!company.data}>
                  <option value="">Choose…</option>
                  {company.data?.admins.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.name || a.email}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Package">
              {(f) => (
                <NativeSelect {...f} value={offeringId} onChange={(e) => setOfferingId(e.target.value)} required>
                  <option value="">Choose…</option>
                  {offerings.data
                    ?.filter((o) => o.is_active && o.delivery_type === 'recorded')
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.course_title} ({DELIVERY_LABEL[o.delivery_type]})
                      </option>
                    ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Seats">{(f) => <Input {...f} type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)} />}</Field>
            <Field label="Price per seat (£)">{(f) => <Input {...f} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />}</Field>
            <Field label="Programme length (months)">{(f) => <Input {...f} inputMode="numeric" value={length} onChange={(e) => setLength(e.target.value)} placeholder="Package default" />}</Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
              Instalments
              <Button type="button" size="sm" variant="ghost" onClick={split} disabled={!total}>
                Split evenly
              </Button>
            </legend>
            {rows.map((r, n) => (
              <div key={n} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_110px_auto]">
                <Input aria-label={`Instalment ${n + 1} amount in pounds`} inputMode="decimal" placeholder="£ amount" value={r.amount} onChange={(e) => set(n, { amount: e.target.value })} />
                <Input aria-label={`Instalment ${n + 1} due date`} type="date" value={r.due} onChange={(e) => set(n, { due: e.target.value })} />
                <Input aria-label={`Instalment ${n + 1} months covered`} inputMode="numeric" value={r.months} onChange={(e) => set(n, { months: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove instalment ${n + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, i) => i !== n))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted">Months covered count from the day each payment succeeds. They are never backdated.</p>
            <Button type="button" variant="secondary" size="sm" className="justify-self-start" disabled={rows.length >= 24} onClick={() => setRows([...rows, { amount: '', due: '', months: '3' }])}>
              <Plus /> Add instalment
            </Button>
          </fieldset>
          <p className={`text-sm ${sum === total ? 'text-muted' : 'text-danger'}`} role="status">
            Instalments £{toMajor(sum)} of £{toMajor(total)}
            {sum !== total ? ' — they must add up exactly to the total.' : '.'}
            {!datesOk ? ' Due dates must be in order.' : ''}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!valid}>
              Create plan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- inventory
const FILTERS: Record<string, string> = { '': 'Everyone', current: 'Still in the company', left: 'Left the company', expired: 'No paid access', ended: 'Programme ended' }

export function InventoryTab() {
  const [cq, setCq] = useState('')
  const companies = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const inv = useCnInventory(orgId, useDebounced(q.trim()), status)
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="Seat inventory" description="Seats bought, given and free for each programme. Choose a company to see who holds each seat." />
        <Toolbar>
          <Input aria-label="Find a company" placeholder="Find a company" className="w-48" value={cq} onChange={(e) => setCq(e.target.value)} />
          <NativeSelect aria-label="Company" className="w-56" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">All companies</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Toolbar>
        <QueryBlock query={{ ...inv, data: inv.data?.groups }} empty={{ icon: <Armchair />, title: 'No seats bought yet', body: 'Paid company purchases will show here.' }}>
          {(groups) => (
            <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => (
                <div key={g.offering_id} className="grid gap-2 rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium">{g.course_title}</p>
                    <Badge tone="outline">{DELIVERY_LABEL[g.delivery_type] ?? g.delivery_type}</Badge>
                  </div>
                  <Progress value={g.purchased ? Math.round((g.allocated / g.purchased) * 100) : 0} label={`${g.allocated} of ${g.purchased} seats given`} />
                  <dl className="grid grid-cols-3 text-center text-xs">
                    {[
                      ['Bought', g.purchased],
                      ['Given', g.allocated],
                      ['Free', g.available],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <dt className="text-muted">{l}</dt>
                        <dd className="text-base font-semibold tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted">
                    {g.purchases} purchase{g.purchases === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </QueryBlock>
      </Card>
      {orgId ? (
        <Card>
          <CardHeader title="Seat holders" description="Employment, seat, programme and paid access are shown separately." />
          <Toolbar>
            <SearchBox value={q} onChange={setQ} label="Search by name or email" placeholder="Search by name or email" className="sm:w-64" />
            <NativeSelect aria-label="Show" className="w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(FILTERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Toolbar>
          <QueryBlock query={{ ...inv, data: inv.data?.seats }} empty={{ icon: <Users />, title: 'Nobody here', body: q || status ? 'Try another search or filter.' : 'No seats have been given yet.' }}>
            {(seats) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th className="hidden md:table-cell">Programme</Th>
                    <Th className="hidden lg:table-cell">Seat given</Th>
                    <Th>Paid access</Th>
                    <Th className="hidden sm:table-cell">Programme dates</Th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {seats.map((s) => (
                    <Tr key={s.id}>
                      <Td>
                        <span className="block max-w-[14rem] truncate font-medium">{s.user_name}</span>
                        <span className="block max-w-[14rem] truncate text-xs text-muted">{s.user_email}</span>
                        {s.left_at ? (
                          <Badge tone="warning" className="mt-1">
                            Left {day(s.left_at)}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="hidden max-w-[14rem] md:table-cell">
                        <span className="block truncate">{s.course_title}</span>
                        <span className="text-xs text-muted">
                          {DELIVERY_LABEL[s.kind] ?? s.kind} · {PLAN_LABEL[s.payment_plan] ?? s.payment_plan}
                        </span>
                      </Td>
                      <Td className="hidden text-muted lg:table-cell">{day(s.allocated_at)}</Td>
                      <Td>
                        <StatusBadge map={ENTITLEMENT} status={s.entitlement_status} />
                        {s.paid_through ? <span className="block text-xs text-muted">to {day(s.paid_through)}</span> : null}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <StatusBadge map={PROGRAMME} status={s.programme_status} />
                        {s.programme_start ? (
                          <span className="block text-xs text-muted">
                            {day(s.programme_start)}
                            {s.programme_end ? ` – ${day(s.programme_end)}` : ''}
                          </span>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBlock>
        </Card>
      ) : null}
    </div>
  )
}
