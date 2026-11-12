import { FileText, Package, Plus, Receipt, Send, ShoppingBag, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCompanies, useCompany } from '@/features/console/companies'
import { SearchBox, Toolbar, day, toMajor, toMinor } from '@/features/console/money-ui'
import { useStudents } from '@/features/console/people'
import { useCoursePrices, useTiers } from '@/features/console/pricing'
import { ConfirmDialog, DetailSheet, useParam, useTabParam } from '@/features/console/ui'
import { DELIVERY_LABEL, PURCHASE_STATUS, QUOTE_STATUS } from '@/features/corporate/api'
import {
  type CnOffering,
  type CnPurchase,
  useCnAllocations,
  useCnCreateOffering,
  useCnCreateQuote,
  useCnOfferings,
  useCnPurchases,
  useCnQuotes,
  useCnReassignSeat,
  useCnReleaseSeat,
  useCnSendQuote,
  useCnUpdateOffering,
  useCnVoidQuote,
} from '@/features/corporate/console'
import { gbp } from '@/features/corporate/format'
import { AgreementSection, InstalmentPlanForm, InventoryTab } from './AgreementPanels'
import { QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { useDebounced } from '@/features/org/ui'

const TABS = ['offerings', 'purchases', 'inventory', 'quotes'] as const
type Tab = (typeof TABS)[number]
const err = (e: unknown) => toast.error((e as Error).message)

// ---------------------------------------------------------------- offerings

function OfferingForm({ open, onOpenChange, offering }: { open: boolean; onOpenChange: (o: boolean) => void; offering: CnOffering | null }) {
  const tiers = useTiers('GBP')
  const [q, setQ] = useState('')
  const courses = useCoursePrices({ q: useDebounced(q), status: 'published' })
  const create = useCnCreateOffering()
  const update = useCnUpdateOffering()
  const [courseId, setCourseId] = useState('')
  const [delivery, setDelivery] = useState('recorded')
  const [tierId, setTierId] = useState(offering?.price_tier_id ?? '')
  const [desc, setDesc] = useState(offering?.description ?? '')
  const [quote, setQuote] = useState(offering?.custom_quote_enabled ?? false)
  const [months, setMonths] = useState(offering?.access_months ? String(offering.access_months) : '')
  const monthsNum = months.trim() ? Number(months) : null
  const monthsOk = monthsNum == null || (Number.isInteger(monthsNum) && monthsNum >= 1 && monthsNum <= 120)
  const courseList = courses.data?.pages.flatMap((p) => p.items) ?? []

  const save = (e: FormEvent) => {
    e.preventDefault()
    const done = { onSuccess: () => (toast.success(offering ? 'Package saved' : 'Package created'), onOpenChange(false)), onError: err }
    if (offering) update.mutate({ id: offering.id, price_tier_id: tierId, description: desc, custom_quote_enabled: quote, access_months: monthsNum ?? 0 }, done)
    else create.mutate({ course_id: courseId, delivery_type: delivery, price_tier_id: tierId, is_active: true, custom_quote_enabled: quote, description: desc, access_months: monthsNum }, done)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={offering ? `Edit package: ${offering.course_title}` : 'New company package'} description="The price is per seat (recorded) or per person (live), in pounds.">
        <form onSubmit={save} className="grid gap-4">
          {offering ? null : (
            <>
              <Field label="Find a course">{(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search published courses" />}</Field>
              <Field label="Course">
                {(p) => (
                  <NativeSelect {...p} value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
                    <option value="">Choose a course…</option>
                    {courseList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Type">
                {(p) => (
                  <NativeSelect {...p} value={delivery} onChange={(e) => setDelivery(e.target.value)}>
                    <option value="recorded">Recorded course</option>
                    <option value="live">Live training</option>
                  </NativeSelect>
                )}
              </Field>
            </>
          )}
          <Field label="Price">
            {(p) => (
              <NativeSelect {...p} value={tierId} onChange={(e) => setTierId(e.target.value)} required>
                <option value="">Choose a price tier…</option>
                {tiers.data?.filter((t) => t.is_active).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {gbp(t.gbp_minor)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Programme length in months (optional)" hint="Counts from each person's first session. Lessons stay open after it ends." error={monthsOk ? undefined : 'Enter a whole number from 1 to 120.'}>
            {(p) => <Input {...p} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="Not set" />}
          </Field>
          <Field label="Description (optional)">{(p) => <Textarea {...p} value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />}</Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            Offer custom quotes
            <Switch checked={quote} onCheckedChange={setQuote} aria-label="Offer custom quotes" />
          </label>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending || update.isPending} disabled={!tierId || (!offering && !courseId) || !monthsOk}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Offerings() {
  const q = useCnOfferings()
  const update = useCnUpdateOffering()
  const [form, setForm] = useState<{ o: CnOffering | null } | null>(null)
  return (
    <Card>
      <CardHeader title="Company packages" description="What companies can buy" action={<Button size="sm" onClick={() => setForm({ o: null })}><Plus /> New package</Button>} />
      <div className="mt-3">
        <QueryBlock query={q} empty={{ icon: <Package />, title: 'No packages yet', body: 'Create one to let companies buy seats.' }}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <Th>Course</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Price</Th>
                  <Th>On sale</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((o) => (
                  <Tr key={o.id}>
                    <Td className="max-w-[16rem] truncate font-medium">{o.course_title}</Td>
                    <Td>
                      <Badge tone={o.delivery_type === 'live' ? 'info' : 'primary'}>{DELIVERY_LABEL[o.delivery_type] ?? o.delivery_type}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{gbp(o.gbp_minor)}</Td>
                    <Td>
                      <Switch
                        checked={o.is_active}
                        aria-label={`${o.course_title} on sale`}
                        onCheckedChange={(v) => update.mutate({ id: o.id, is_active: v }, { onSuccess: () => toast.success(v ? 'Now on sale' : 'Taken off sale'), onError: err })}
                      />
                    </Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setForm({ o })}>
                        Edit
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryBlock>
      </div>
      {form ? <OfferingForm key={form.o?.id ?? 'new'} open onOpenChange={(o) => !o && setForm(null)} offering={form.o} /> : null}
    </Card>
  )
}

// ---------------------------------------------------------------- purchases and seat holders

function Reassign({ id, onDone }: { id: string; onDone: () => void }) {
  const [q, setQ] = useState('')
  const people = useStudents({ q: useDebounced(q) })
  const [reason, setReason] = useState('')
  const reassign = useCnReassignSeat()
  const list = people.data?.pages.flatMap((p) => p.items).slice(0, 6) ?? []
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <Field label="Reason (shown in the audit log)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Field label="Move the seat to">{(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email (must be in the same company)" />}</Field>
      <ul className="grid gap-1">
        {list.map((u) => (
          <li key={u.id}>
            <Button
              variant="ghost"
              className="w-full justify-start"
              disabled={reason.trim().length < 3 || reassign.isPending}
              onClick={() => reassign.mutate({ id, new_user_id: u.id, reason: reason.trim() }, { onSuccess: () => (toast.success(`Seat moved to ${u.name || u.email}`), onDone()), onError: err })}
            >
              {u.name || u.email} <span className="text-muted">{u.email}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PurchaseDetail({ p, onClose }: { p: CnPurchase; onClose: () => void }) {
  const q = useCnAllocations(p.id)
  const release = useCnReleaseSeat()
  const [ending, setEnding] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  return (
    <DetailSheet open onOpenChange={(o) => !o && onClose()} title={p.course_title} description={`${p.org_name} · ${p.quantity} seats · ${gbp(p.total_minor)}`}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge map={PURCHASE_STATUS} status={p.status} />
          <Badge tone="outline">{p.allocated} given</Badge>
          <Badge tone="outline">{p.available} free</Badge>
        </div>
        <p className="text-sm text-muted">Bought by {p.buyer_email} on {day(p.paid_at ?? p.created_at)}</p>
        <QueryBlock query={q} rows={3} empty={{ icon: <ShoppingBag />, title: 'No seats given yet' }}>
          {(rows) => (
            <ul className="stagger grid gap-2">
              {rows.map((a) => (
                <li key={a.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.user_name}</span>
                      <span className="block truncate text-xs text-muted">{a.user_email}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Badge tone={a.status === 'active' ? 'success' : 'neutral'}>{a.status}</Badge>
                      {['allocated', 'active'].includes(a.status) ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setMoving(moving === a.id ? null : a.id)}>
                            Move
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEnding(a.id)}>
                            End
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {moving === a.id ? <Reassign id={a.id} onDone={() => setMoving(null)} /> : null}
                </li>
              ))}
            </ul>
          )}
        </QueryBlock>
        <AgreementSection p={p} />
      </div>
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title="End this seat?"
        body="The person loses access to the course. Their progress is kept."
        confirmLabel="End seat"
        reason="required"
        loading={release.isPending}
        onConfirm={(reason) => release.mutate({ id: ending!, reason }, { onSuccess: () => (toast.success('Seat ended'), setEnding(null)), onError: err })}
      />
    </DetailSheet>
  )
}

function Purchases() {
  const [status, setStatus] = useState('')
  const q = useCnPurchases(status)
  const [openId, setOpenId] = useParam('purchase')
  const open = q.data?.find((p) => p.id === openId)
  const [planning, setPlanning] = useState(false)
  return (
    <Card>
      <CardHeader
        title="Seat purchases"
        description="Every company purchase, recorded and live"
        action={
          <Button size="sm" onClick={() => setPlanning(true)}>
            <Plus /> New instalment plan
          </Button>
        }
      />
      <Toolbar>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {Object.entries(PURCHASE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <Receipt />, title: 'No purchases', body: 'Company purchases will show here.' }}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th className="hidden md:table-cell">Course</Th>
                <Th className="text-right">Seats</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((p) => (
                <Tr key={p.id} className="cursor-pointer" onClick={() => setOpenId(p.id)}>
                  <Td>
                    <button type="button" className="max-w-[12rem] truncate text-left font-medium hover:underline" onClick={() => setOpenId(p.id)}>
                      {p.org_name}
                    </button>
                  </Td>
                  <Td className="hidden max-w-[16rem] truncate md:table-cell">{p.course_title}</Td>
                  <Td className="text-right tabular-nums">
                    {p.allocated}/{p.quantity}
                  </Td>
                  <Td className="text-right tabular-nums">{gbp(p.total_minor)}</Td>
                  <Td>
                    <StatusBadge map={PURCHASE_STATUS} status={p.status} />
                    {p.payment_plan === 'instalments' ? <span className="block text-xs text-muted">Instalments</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBlock>
      {open ? <PurchaseDetail p={open} onClose={() => setOpenId('')} /> : null}
      {planning ? <InstalmentPlanForm onClose={() => setPlanning(false)} /> : null}
    </Card>
  )
}

// ---------------------------------------------------------------- quotes

function QuoteForm({ onClose }: { onClose: () => void }) {
  const [cq, setCq] = useState('')
  const companies = useCompanies({ q: useDebounced(cq) })
  const [orgId, setOrgId] = useState('')
  const company = useCompany(orgId || undefined)
  const offerings = useCnOfferings()
  const create = useCnCreateQuote()
  const [buyerId, setBuyerId] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ offering_id: '', quantity: 10, price: '' }])
  const parsed = items.map((i) => ({ offering_id: i.offering_id, quantity: i.quantity, unit_price_minor: toMinor(i.price) }))
  const valid = !!orgId && !!buyerId && !!validUntil && parsed.every((i) => i.offering_id && i.quantity >= 1 && i.unit_price_minor != null && i.unit_price_minor > 0)
  const total = parsed.reduce((s, i) => s + (i.unit_price_minor ?? 0) * i.quantity, 0)

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    create.mutate(
      { org_id: orgId, buyer_id: buyerId, currency: 'GBP', valid_until: new Date(validUntil).toISOString(), notes, items: parsed.map((i) => ({ ...i, unit_price_minor: i.unit_price_minor! })) },
      { onSuccess: () => (toast.success('Quote saved as a draft'), onClose()), onError: err },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New quote" description="Saved as a draft. Sending it emails a Stripe invoice to the company." className="sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Find a company">{(p) => <Input {...p} value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
            <Field label="Company">
              {(p) => (
                <NativeSelect {...p} value={orgId} onChange={(e) => (setOrgId(e.target.value), setBuyerId(''))} required>
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
          <Field label="Send to (company admin)">
            {(p) => (
              <NativeSelect {...p} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} required disabled={!company.data}>
                <option value="">Choose…</option>
                {company.data?.admins.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.name || a.email} ({a.email})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Items</legend>
            {items.map((it, n) => (
              <div key={n} className="grid gap-2 sm:grid-cols-[1fr_90px_110px_auto]">
                <NativeSelect aria-label={`Item ${n + 1} package`} value={it.offering_id} onChange={(e) => setItems(items.map((x, i) => (i === n ? { ...x, offering_id: e.target.value } : x)))}>
                  <option value="">Package…</option>
                  {offerings.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.course_title} ({DELIVERY_LABEL[o.delivery_type]})
                    </option>
                  ))}
                </NativeSelect>
                <Input aria-label={`Item ${n + 1} quantity`} type="number" min={1} value={it.quantity} onChange={(e) => setItems(items.map((x, i) => (i === n ? { ...x, quantity: parseInt(e.target.value, 10) || 0 } : x)))} />
                <Input aria-label={`Item ${n + 1} price per seat in pounds`} inputMode="decimal" placeholder="£ each" value={it.price} onChange={(e) => setItems(items.map((x, i) => (i === n ? { ...x, price: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove item ${n + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== n))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => setItems([...items, { offering_id: '', quantity: 10, price: '' }])}>
              <Plus /> Add item
            </Button>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valid until">{(p) => <Input {...p} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required />}</Field>
            <p className="self-end text-sm">
              Total <strong className="tabular-nums">£{toMajor(total)}</strong>
            </p>
          </div>
          <Field label="Note to the company (optional)">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!valid}>
              Save draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Quotes() {
  const [status, setStatus] = useState('')
  const q = useCnQuotes(status)
  const send = useCnSendQuote()
  const voidQ = useCnVoidQuote()
  const [creating, setCreating] = useState(false)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  return (
    <Card>
      <CardHeader title="Quotes" description="Custom prices sent as Stripe invoices" action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New quote</Button>} />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} label="Search quotes" placeholder="Company or email" />
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      <QueryBlock query={q} empty={{ icon: <FileText />, title: 'No quotes' }}>
        {(all) => {
          const s = search.trim().toLowerCase()
          const rows = s ? all.filter((x) => `${x.org_name} ${x.buyer_email}`.toLowerCase().includes(s)) : all
          return (
            <ul className="stagger divide-y divide-border">
              {rows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {x.org_name} · <span className="tabular-nums">{gbp(x.total_minor)}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {x.items.length} {x.items.length === 1 ? 'item' : 'items'} · to {x.buyer_email} · valid until {day(x.valid_until)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {x.status === 'draft' ? <Badge>Draft</Badge> : <StatusBadge map={QUOTE_STATUS} status={x.status} />}
                    {x.status === 'draft' ? (
                      <Button size="sm" loading={send.isPending && send.variables === x.id} onClick={() => send.mutate(x.id, { onSuccess: () => toast.success('Quote sent'), onError: err })}>
                        <Send /> Send
                      </Button>
                    ) : null}
                    {['draft', 'sent'].includes(x.status) ? (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(x.id)}>
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        }}
      </QueryBlock>
      {creating ? <QuoteForm onClose={() => setCreating(false)} /> : null}
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Withdraw this quote?"
        body="A sent invoice is cancelled in Stripe and can no longer be paid."
        confirmLabel="Withdraw"
        loading={voidQ.isPending}
        onConfirm={() => voidQ.mutate(voiding!, { onSuccess: () => (toast.success('Quote withdrawn'), setVoiding(null)), onError: err })}
      />
    </Card>
  )
}

export function ConsoleCorporatePackagesPage() {
  const [tab, setTab] = useTabParam(TABS, 'offerings')
  useEffect(() => {
    document.title = 'Company packages · Console · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Company packages" description="Packages companies can buy, their purchases, seats and quotes." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Company package sections">
          <TabsTrigger value="offerings">Packages</TabsTrigger>
          <TabsTrigger value="purchases">Purchases and seats</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
        </TabsList>
        <TabsContent value="offerings" className="mt-5">
          <Offerings />
        </TabsContent>
        <TabsContent value="purchases" className="mt-5">
          <Purchases />
        </TabsContent>
        <TabsContent value="inventory" className="mt-5">
          <InventoryTab />
        </TabsContent>
        <TabsContent value="quotes" className="mt-5">
          <Quotes />
        </TabsContent>
      </Tabs>
    </>
  )
}
