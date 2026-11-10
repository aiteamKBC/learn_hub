import { ArrowLeftRight, BarChart3, BookOpen, CalendarClock, ChevronRight, Copy, CreditCard, Crown, Globe, PauseCircle, Pencil, PlayCircle, Plus, Receipt, RefreshCw, Repeat, Settings2, Users } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AreaChart, BarList, Donut } from '@/features/console/charts'
import { day, SearchBox, toMinor, Toolbar } from '@/features/console/money-ui'
import {
  type ConsolePlan,
  EVENT_LABEL,
  type PlanInput,
  SUB_STATUSES,
  useCancelSubscriber,
  useCourseOptions,
  useCreatePlan,
  useDuplicatePlan,
  usePlanCourses,
  usePlans,
  usePlanStatus,
  useSetPlanCourses,
  useSetPlanPrice,
  useSubEvents,
  useSubscribers,
  useSubsOverview,
  useUpdatePlan,
} from '@/features/console/subscriptions'
import { ConfirmDialog, DateRangeSelect, DetailSheet, gbp, gbpShort, InfoRow, KpiCard, LoadMore, StatusPill, useParam, useRangeParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { InvoicesCard } from './SalesPage'

const TABS = ['overview', 'plans', 'subscribers', 'payments', 'changes', 'revenue'] as const
type Tab = (typeof TABS)[number]
const COLORS = ['var(--chart-1)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const cycle = (i: string) => (i === 'year' ? 'Yearly' : 'Monthly')
const gbpPrice = (p: ConsolePlan) => p.prices.find((x) => x.currency === 'GBP')
const included = (p: ConsolePlan) => (p.included_courses === null ? `All marked (${p.all_courses})` : `${p.included_courses} course${p.included_courses === 1 ? '' : 's'}`)

function RenewalBadge({ renewal }: { renewal: string }) {
  return renewal === 'manual' ? (
    <Badge tone="info"><CalendarClock aria-hidden /> Manual</Badge>
  ) : (
    <Badge tone="success"><RefreshCw aria-hidden /> Automatic</Badge>
  )
}

// ---------------------------------------------------------------- plans table
function PlansCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [currency, setCurrency] = useState('')
  const q = useDebounced(text, 250)
  const plans = usePlans({ q: q.trim(), status, currency })
  const codes = useMemo(() => [...new Set((plans.data ?? []).flatMap((p) => p.prices.map((x) => x.currency)))].sort(), [plans.data])
  return (
    <Card>
      <CardHeader title={`Subscription plans${plans.data ? ` (${plans.data.length})` : ''}`} />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search plans" placeholder="Search plans by name" className="sm:max-w-xs" />
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
        <NativeSelect aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full sm:w-40">
          <option value="">All currencies</option>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
      </Toolbar>
      {plans.error ? (
        <ErrorState message={(plans.error as Error).message} onRetry={() => void plans.refetch()} />
      ) : !plans.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : plans.data.length === 0 ? (
        <EmptyState icon={<Crown />} title="No plans" body="Create a plan to sell subscriptions." />
      ) : (
        <Table className="animate-reveal">
          <thead>
            <tr><Th>Plan</Th><Th className="text-right">Price</Th><Th>Billing cycle</Th><Th>Included courses</Th><Th className="text-right">Subscribers</Th><Th className="text-right">Revenue (all time)</Th><Th>Renewal</Th><Th>Status</Th></tr>
          </thead>
          <tbody className="stagger">
            {plans.data.map((p) => {
              const price = gbpPrice(p) ?? p.prices[0]
              return (
                <Tr key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                  <Td>
                    <button type="button" className="text-left focus-visible:underline focus-visible:outline-none" onClick={(e) => (e.stopPropagation(), onOpen(p.id))}>
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block max-w-56 truncate text-xs text-muted">{p.description || (p.audience === 'team' ? 'For companies (per seat)' : 'For one person')}</span>
                    </button>
                  </Td>
                  <Td className="text-right font-medium whitespace-nowrap tabular">{price ? money(price.amount_minor, price.currency, price.exponent) : '—'}</Td>
                  <Td>{cycle(p.interval)}</Td>
                  <Td className="whitespace-nowrap">{included(p)}</Td>
                  <Td className="text-right tabular">{p.subscribers.toLocaleString('en-GB')}</Td>
                  <Td className="text-right tabular">{gbp(p.revenue_gbp_minor)}</Td>
                  <Td><RenewalBadge renewal={p.renewal} /></Td>
                  <Td><StatusPill status={p.is_active ? 'active' : 'ended'} label={p.is_active ? 'Active' : 'Inactive'} /></Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- plan panel
function PlanSheet({ onEdit }: { onEdit: (p: ConsolePlan) => void }) {
  const [id, setId] = useParam('plan')
  const [, setTab] = useTabParam(TABS, 'overview')
  const plans = usePlans()
  const p = plans.data?.find((x) => x.id === id)
  const [panel, setPanel] = useState('overview')
  const [confirm, setConfirm] = useState(false)
  const status = usePlanStatus()
  const duplicate = useDuplicatePlan()
  useEffect(() => setPanel('overview'), [id])
  const go = (t: Tab) => (setId(''), setTab(t))
  return (
    <DetailSheet open={!!id} onOpenChange={(o) => !o && setId('')} title={p?.name ?? 'Plan'} description={p?.description || undefined}>
      {!p ? (
        plans.isPending ? <Skeleton className="h-64" /> : <EmptyState icon={<Crown />} title="Plan not found" />
      ) : (
        <div className="grid gap-5 animate-reveal">
          <div className="flex items-center justify-between gap-2">
            <RenewalBadge renewal={p.renewal} />
            <StatusPill status={p.is_active ? 'active' : 'ended'} label={p.is_active ? 'Active' : 'Inactive'} />
          </div>
          <Tabs value={panel} onValueChange={setPanel}>
            <TabsList aria-label="Plan details">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="courses">Included courses</TabsTrigger>
              <TabsTrigger value="pricing">Pricing</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <InfoRow label="Subscribers">{p.subscribers.toLocaleString('en-GB')}</InfoRow>
              <InfoRow label="Revenue (all time)">{gbp(p.revenue_gbp_minor)}</InfoRow>
              <InfoRow label="Renewal type">{p.renewal === 'manual' ? 'Manual' : 'Automatic'}</InfoRow>
              <InfoRow label="Billing cycle">{cycle(p.interval)}</InfoRow>
              <InfoRow label="Price (GBP)">{gbpPrice(p) ? gbp(gbpPrice(p)!.amount_minor) : '—'}</InfoRow>
              <InfoRow label="Available currencies">{p.prices.map((x) => x.currency).join(', ') || '—'}</InfoRow>
              <InfoRow label="Created on">{day(p.created_at)}</InfoRow>
            </TabsContent>
            <TabsContent value="courses"><PlanCourses plan={p} /></TabsContent>
            <TabsContent value="pricing"><PlanPrices plan={p} /></TabsContent>
            <TabsContent value="settings">
              <InfoRow label="Code">{p.code}</InfoRow>
              <InfoRow label="Audience">{p.audience === 'team' ? 'Companies (per seat)' : 'One person'}</InfoRow>
              <InfoRow label="Free trial">{p.trial_days ? `${p.trial_days} days` : 'None'}</InfoRow>
              <InfoRow label="Minimum seats">{p.min_seats}</InfoRow>
            </TabsContent>
          </Tabs>
          <section aria-label="Plan actions" className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" onClick={() => onEdit(p)}><Pencil /> Edit plan</Button>
            <Button variant="secondary" loading={duplicate.isPending} onClick={() => duplicate.mutate(p.id, { onSuccess: (r) => (toast.success('Copy created, switched off. Check its prices, then activate it.'), setId(r.id)), onError: (e) => toast.error((e as Error).message) })}>
              <Copy /> Duplicate
            </Button>
            {p.is_active ? (
              <Button variant="secondary" className="text-danger" onClick={() => setConfirm(true)}><PauseCircle /> Deactivate</Button>
            ) : (
              <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ id: p.id, is_active: true, reason: '' }, { onSuccess: () => toast.success('Plan is on sale again.'), onError: (e) => toast.error((e as Error).message) })}>
                <PlayCircle /> Activate
              </Button>
            )}
          </section>
          <section aria-labelledby="quick-links">
            <h3 id="quick-links" className="mb-1 text-sm font-semibold">Quick links</h3>
            <ul className="divide-y divide-border">
              {([['subscribers', <Users key="u" />, `View subscribers (${p.subscribers})`], ['changes', <ArrowLeftRight key="c" />, 'View plan changes'], ['payments', <Receipt key="p" />, 'View payments'], ['revenue', <BarChart3 key="r" />, 'View revenue']] as const).map(([t, icon, label]) => (
                <li key={t}>
                  <button type="button" onClick={() => go(t)} className="flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left text-sm hover:bg-surface-2 [&_svg]:size-4">
                    <span className="text-primary">{icon}</span>
                    <span className="flex-1">{label}</span>
                    <ChevronRight className="text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={`Deactivate ${p.name}?`}
            body="Nobody new can subscribe. Current subscribers keep the plan until they cancel."
            reason="required"
            confirmLabel="Deactivate"
            loading={status.isPending}
            onConfirm={(reason) => status.mutate({ id: p.id, is_active: false, reason }, { onSuccess: () => (toast.success('Plan deactivated.'), setConfirm(false)), onError: (e) => toast.error((e as Error).message) })}
          />
        </div>
      )}
    </DetailSheet>
  )
}

function CoursePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [text, setText] = useState('')
  const q = useDebounced(text, 250)
  const opts = useCourseOptions(q.trim())
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (opts.data) setNames((n) => ({ ...n, ...Object.fromEntries(opts.data.courses.map((c) => [c.id, c.label])) }))
  }, [opts.data])
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="grid gap-2">
      <SearchBox value={text} onChange={setText} label="Find courses" placeholder="Search courses" />
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen courses">
          {value.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => toggle(id)} className="rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary-soft-text hover:bg-primary-soft/70" aria-label={`Remove ${names[id] ?? 'course'}`}>
                {names[id] ?? 'Course'} ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">None chosen: the plan includes every course marked “in subscription”.</p>
      )}
      <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {(opts.data?.courses ?? []).map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
              <Checkbox checked={value.includes(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={c.label} />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </label>
          </li>
        ))}
        {opts.data && opts.data.courses.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">No courses match.</li> : null}
      </ul>
    </div>
  )
}

function PlanCourses({ plan }: { plan: ConsolePlan }) {
  const q = usePlanCourses(plan.id)
  const save = useSetPlanCourses(plan.id)
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState<string[]>([])
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-40" />
  if (editing)
    return (
      <div className="grid gap-3">
        <CoursePicker value={ids} onChange={setIds} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(ids, { onSuccess: () => (toast.success('Included courses saved.'), setEditing(false)), onError: (e) => toast.error((e as Error).message) })}>Save courses</Button>
        </div>
      </div>
    )
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted">{q.data.mode === 'listed' ? 'Subscribers get only these courses.' : 'No list yet: subscribers get every course marked “in subscription”.'}</p>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {q.data.courses.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm"><BookOpen className="size-4 text-muted" aria-hidden /> {c.title}</li>
        ))}
        {q.data.courses.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">No courses.</li> : null}
      </ul>
      <Button variant="secondary" onClick={() => (setIds(q.data.mode === 'listed' ? q.data.courses.map((c) => c.id) : []), setEditing(true))}>
        <Pencil /> Choose courses
      </Button>
    </div>
  )
}

function PlanPrices({ plan }: { plan: ConsolePlan }) {
  const save = useSetPlanPrice(plan.id)
  const [currency, setCurrency] = useState('GBP')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string>()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const exp = plan.prices.find((x) => x.currency === currency.toUpperCase())?.exponent ?? 2
    const minor = toMinor(amount, exp)
    if (minor === null || !/^[A-Za-z]{3}$/.test(currency)) return setError('Enter a currency code and an amount, for example GBP and 19.99.')
    setError(undefined)
    save.mutate(
      { currency: currency.toUpperCase(), amount_minor: minor, stripe_price_id: '', create_stripe_price: true },
      { onSuccess: () => (toast.success('Price saved and a Stripe price created.'), setAmount('')), onError: (err) => setError((err as Error).message) },
    )
  }
  return (
    <div className="grid gap-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {plan.prices.map((x) => (
          <li key={x.currency} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2"><Globe className="size-4 text-muted" aria-hidden /> {x.currency}</span>
            <span className="font-semibold tabular">{money(x.amount_minor, x.currency, x.exponent)}</span>
            {x.stripe_price_id ? <Badge tone="success">In Stripe</Badge> : <Badge tone="warning">No Stripe price</Badge>}
          </li>
        ))}
        {plan.prices.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">No prices yet.</li> : null}
      </ul>
      <form onSubmit={submit} className="grid gap-3 rounded-lg bg-surface-2 p-3">
        <p className="text-sm font-medium">Set a price</p>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input aria-label="Currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          <Input aria-label={`Amount per ${plan.interval}`} inputMode="decimal" placeholder={plan.audience === 'team' ? 'Per seat, e.g. 12.00' : 'e.g. 19.99'} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <p className="text-[13px] text-muted">Saving creates a new Stripe test price. Current subscribers keep the price they signed up at.</p>
        <Button type="submit" loading={save.isPending}>Save price</Button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- create / edit
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function PlanForm({ plan, onDone }: { plan: ConsolePlan | null; onDone: (id?: string) => void }) {
  const create = useCreatePlan()
  const update = useUpdatePlan(plan?.id ?? '')
  const [v, setV] = useState({
    name: plan?.name ?? '', code: plan?.code ?? '', description: plan?.description ?? '', audience: plan?.audience ?? 'personal',
    interval: plan?.interval ?? 'month', trial_days: String(plan?.trial_days ?? 0), min_seats: String(plan?.min_seats ?? 1), renewal: plan?.renewal ?? 'automatic', price: '',
  })
  const [courses, setCourses] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value, ...(k === 'name' && !plan ? { code: slug(e.target.value) } : {}) }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    const trial = Number(v.trial_days)
    const seats = Number(v.min_seats)
    if (!Number.isInteger(trial) || trial < 0 || trial > 90) return setError('A free trial is 0 to 90 days.')
    if (!Number.isInteger(seats) || seats < 1) return setError('Minimum seats is at least 1.')
    const fail = (err: unknown) => setError((err as Error).message)
    if (plan) {
      update.mutate({ name: v.name.trim(), description: v.description.trim(), trial_days: trial, min_seats: seats, renewal: v.renewal }, { onSuccess: () => (toast.success('Plan saved.'), onDone()), onError: fail })
      return
    }
    const minor = toMinor(v.price)
    if (minor === null || minor < 1) return setError('Enter the price in pounds, for example 19.99.')
    const body: PlanInput = {
      name: v.name.trim(), code: v.code, description: v.description.trim(), audience: v.audience, interval: v.interval, trial_days: trial, min_seats: seats, renewal: v.renewal,
      prices: [{ currency: 'GBP', amount_minor: minor, stripe_price_id: '', create_stripe_price: true }], course_ids: courses,
    }
    create.mutate(body, { onSuccess: (r) => (toast.success('Plan created with a Stripe test price.'), onDone(r.id)), onError: fail })
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Plan name">{(p) => <Input {...p} required minLength={2} maxLength={80} value={v.name} onChange={set('name')} />}</Field>
      {!plan ? <Field label="Code" hint="Lower-case letters, numbers and dashes. Used in links and reports.">{(p) => <Input {...p} required pattern="[a-z0-9-]+" maxLength={40} value={v.code} onChange={set('code')} />}</Field> : null}
      <Field label="Short description">{(p) => <Textarea {...p} maxLength={300} value={v.description} onChange={set('description')} />}</Field>
      {!plan ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who buys it">{(p) => <NativeSelect {...p} value={v.audience} onChange={set('audience')}><option value="personal">One person</option><option value="team">Companies (per seat)</option></NativeSelect>}</Field>
          <Field label="Billing cycle">{(p) => <NativeSelect {...p} value={v.interval} onChange={set('interval')}><option value="month">Monthly</option><option value="year">Yearly</option></NativeSelect>}</Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Renewal">{(p) => <NativeSelect {...p} value={v.renewal} onChange={set('renewal')}><option value="automatic">Automatic</option><option value="manual">Manual</option></NativeSelect>}</Field>
        <Field label="Free trial (days)">{(p) => <Input {...p} inputMode="numeric" value={v.trial_days} onChange={set('trial_days')} />}</Field>
        <Field label="Minimum seats">{(p) => <Input {...p} inputMode="numeric" value={v.min_seats} onChange={set('min_seats')} />}</Field>
      </div>
      {!plan ? (
        <>
          <Field label={v.audience === 'team' ? 'Price per seat (GBP)' : 'Price (GBP)'} hint="A Stripe test price is created. Add other currencies after saving.">
            {(p) => <Input {...p} required inputMode="decimal" placeholder="19.99" value={v.price} onChange={set('price')} />}
          </Field>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Included courses</span>
            <CoursePicker value={courses} onChange={setCourses} />
          </div>
        </>
      ) : (
        <p className="text-[13px] text-muted">Change prices and included courses from the plan’s panel.</p>
      )}
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" loading={create.isPending || update.isPending}>{plan ? 'Save plan' : 'Create plan'}</Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- subscribers, payments, changes
function SubscribersCard() {
  const plans = usePlans()
  const [text, setText] = useState('')
  const [plan, setPlan] = useState('')
  const [status, setStatus] = useState('')
  const q = useDebounced(text, 300)
  const list = useSubscribers({ q: q.trim(), plan, status })
  const cancel = useCancelSubscriber()
  const [target, setTarget] = useState<{ id: string; name: string; end: string | null } | null>(null)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader title="Subscribers" description="People and companies with a subscription." />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search subscribers" placeholder="Name, email or company" className="sm:max-w-xs" />
        <NativeSelect aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full sm:w-44">
          <option value="">All plans</option>
          {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-40">
          <option value="">All statuses</option>
          {Object.entries(SUB_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No subscribers match" />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead><tr><Th>Subscriber</Th><Th>Plan</Th><Th>Seats</Th><Th>Status</Th><Th>Renews or ends</Th><Th>Started</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody className="stagger">
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="block max-w-52 truncate font-medium">{s.company || s.name || s.email}</span>
                    <span className="block max-w-52 truncate text-xs text-muted">{s.email}</span>
                  </Td>
                  <Td>{s.plan}</Td>
                  <Td className="tabular">{s.seats}</Td>
                  <Td><StatusPill status={s.status} label={SUB_STATUSES[s.status]} /></Td>
                  <Td className="whitespace-nowrap">{s.current_period_end ? `${s.cancel_at_period_end ? 'Ends' : 'Renews'} ${day(s.current_period_end)}` : '—'}</Td>
                  <Td className="whitespace-nowrap text-muted">{day(s.started_at)}</Td>
                  <Td className="text-right">
                    {['active', 'trialing', 'past_due'].includes(s.status) && !s.cancel_at_period_end ? (
                      <Button size="sm" variant="secondary" onClick={() => setTarget({ id: s.id, name: s.company || s.name || s.email, end: s.current_period_end })}>Cancel</Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="subscribers" hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Cancel at the end of the period?"
        body={target ? <>{target.name} keeps access until {target.end ? day(target.end) : 'the end of the paid period'}, then the subscription stops. They get a notification.</> : null}
        reason="required"
        confirmLabel="Cancel subscription"
        loading={cancel.isPending}
        onConfirm={(reason) => target && cancel.mutate({ id: target.id, reason }, { onSuccess: () => (toast.success('Subscription will end at the end of the period.'), setTarget(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </Card>
  )
}

function PaymentsCard() {
  return <InvoicesCard kind="subscription" title="Subscription payments" description="Every Stripe invoice for a subscription." />
}

function ChangesCard() {
  const [kind, setKind] = useState('')
  const list = useSubEvents(kind)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader title="Plan changes" description="Starts, upgrades, seat changes, renewals, cancellations and failed payments." />
      <Toolbar>
        <NativeSelect aria-label="Change type" value={kind} onChange={(e) => setKind(e.target.value)} className="w-full sm:w-48">
          <option value="">All changes</option>
          {Object.entries(EVENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight />} title="No changes yet" body="Stripe tells us about each change; they appear here." />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead><tr><Th>When</Th><Th>Subscriber</Th><Th>Plan</Th><Th>Change</Th><Th>Details</Th></tr></thead>
            <tbody className="stagger">
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{day(e.at)}</Td>
                  <Td className="max-w-52 truncate">{e.name || e.email}</Td>
                  <Td>{e.plan}</Td>
                  <Td><StatusPill status={e.kind === 'payment_failed' ? 'failed' : e.kind === 'cancelled' ? 'cancelled' : 'active'} label={EVENT_LABEL[e.kind] ?? e.kind} /></Td>
                  <Td className="text-muted">
                    {e.from_value || e.to_value ? `${e.from_value || '—'} → ${e.to_value || '—'}` : ''}
                    {e.amount_minor !== null ? ` ${money(e.amount_minor, e.currency)}` : ''}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="changes" hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- overview & revenue
function OverviewTiles() {
  const [range] = useRangeParam()
  const q = useSubsOverview(range)
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  const active = d ? d.by_plan.reduce((s, p) => s + p.active, 0) : 0
  return (
    <>
      <section aria-label="Subscription figures" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', d && 'stagger')}>
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <KpiCard label="Total subscribers" kpi={d.kpis.subscribers} icon={<Users />} />
            <KpiCard label="Active subscriptions" kpi={d.kpis.active} icon={<CreditCard />} tone="success" />
            <KpiCard label="Renewals" kpi={d.kpis.renewals} icon={<Repeat />} tone="info" />
            <KpiCard label="Subscription revenue" kpi={d.kpis.revenue} icon={<Receipt />} format={gbp} tone="warning" />
          </>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader title="Subscription revenue" description="Paid subscription invoices, in pounds per day." />
          <CardBody>{!d ? <Skeleton className="h-[220px]" /> : <AreaChart points={d.series} format={gbpShort} label="Subscription revenue per day" />}</CardBody>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader title="Subscribers by plan" />
          <CardBody>
            {!d ? (
              <Skeleton className="h-[220px]" />
            ) : active === 0 ? (
              <EmptyState icon={<Crown />} title="No active subscribers yet" className="py-6" />
            ) : (
              <Donut
                slices={d.by_plan.filter((p) => p.active).map((p, i) => ({ label: p.name, value: p.active, color: COLORS[i % COLORS.length]!, hint: `${Math.round((p.active * 100) / active)}%` }))}
                centre={active.toLocaleString('en-GB')}
                centreLabel="Active subscribers"
                format={(v) => v.toLocaleString('en-GB')}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function RevenueTab() {
  const [range] = useRangeParam()
  const q = useSubsOverview(range)
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-8">
        <CardHeader title="Revenue over time" />
        <CardBody>{!d ? <Skeleton className="h-[260px]" /> : <AreaChart points={d.series} format={gbpShort} label="Subscription revenue per day" height={260} />}</CardBody>
      </Card>
      <Card className="lg:col-span-4">
        <CardHeader title="Revenue by plan" description="In this period, in pounds." />
        <CardBody>{!d ? <Skeleton className="h-[200px]" /> : <BarList rows={d.by_plan.map((p) => ({ label: p.name, value: p.revenue_gbp_minor, hint: `${p.active} active` }))} format={gbp} />}</CardBody>
      </Card>
    </div>
  )
}

export function ConsoleSubscriptionsPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const [range, setRange] = useRangeParam()
  const [, setPlan] = useParam('plan')
  const [form, setForm] = useState<{ plan: ConsolePlan | null } | null>(null)
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Create and manage plans, included courses, prices, renewals and subscribers."
        actions={
          <>
            {tab === 'overview' || tab === 'revenue' ? <DateRangeSelect value={range} onChange={setRange} /> : null}
            <Button onClick={() => setForm({ plan: null })}><Plus /> Create subscription plan</Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Subscription sections">
          <TabsTrigger value="overview"><BarChart3 aria-hidden /> Overview</TabsTrigger>
          <TabsTrigger value="plans"><Crown aria-hidden /> Plans</TabsTrigger>
          <TabsTrigger value="subscribers"><Users aria-hidden /> Subscribers</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard aria-hidden /> Payments</TabsTrigger>
          <TabsTrigger value="changes"><ArrowLeftRight aria-hidden /> Plan changes</TabsTrigger>
          <TabsTrigger value="revenue"><Settings2 aria-hidden /> Revenue</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-5">
          <OverviewTiles />
          <PlansCard onOpen={setPlan} />
        </TabsContent>
        <TabsContent value="plans"><PlansCard onOpen={setPlan} /></TabsContent>
        <TabsContent value="subscribers"><SubscribersCard /></TabsContent>
        <TabsContent value="payments"><PaymentsCard /></TabsContent>
        <TabsContent value="changes"><ChangesCard /></TabsContent>
        <TabsContent value="revenue"><RevenueTab /></TabsContent>
      </Tabs>
      <PlanSheet onEdit={(p) => (setPlan(''), setForm({ plan: p }))} />
      <DetailSheet open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.plan ? `Edit ${form.plan.name}` : 'Create subscription plan'}>
        {form ? <PlanForm plan={form.plan} onDone={(id) => (setForm(null), id && setPlan(id))} /> : null}
      </DetailSheet>
    </>
  )
}

