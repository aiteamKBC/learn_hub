import { BookOpen, ChevronRight, Coins, Crown, Globe, Info, Layers, MapPin, Pencil, Plus, RefreshCw, Settings2, SlidersHorizontal, Tag, Wand2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox, Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dateTime, SearchBox, toMajor, toMinor, Toolbar } from '@/features/console/money-ui'
import {
  type CoursePriceRow,
  type CurrencyRow,
  type GridFilters,
  PRICING_TYPE,
  pricingCsvPath,
  type RegionalRow,
  type RuleRow,
  type TierRow,
  useApplyRule,
  useBulkPrice,
  useCategories,
  useCoursePrices,
  useCreateRegional,
  useCreateRule,
  useCurrencies,
  useManualRate,
  usePricingOverview,
  usePricingSettings,
  useRefreshRates,
  useRegional,
  useRuleOff,
  useRulePreview,
  useRules,
  useSaveSetting,
  useSetCoursePrice,
  useSetTierAmount,
  useTiers,
  useUpdateCurrency,
  useUpdateRegional,
  useUpdateTier,
} from '@/features/console/pricing'
import { usePromoOptions } from '@/features/console/promotions'
import { usePlans } from '@/features/console/subscriptions'
import { ConfirmDialog, DetailSheet, ExportButton, gbp, LoadMore, StatusPill, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

const TABS = ['courses', 'subscriptions', 'currencies', 'regional', 'settings'] as const
type Tab = (typeof TABS)[number]
const fail = (e: unknown) => toast.error((e as Error).message)
const TYPE_TONE: Record<string, 'primary' | 'warning' | 'success' | 'neutral'> = { standard: 'primary', custom: 'warning', free: 'success', unpriced: 'neutral' }

// ---------------------------------------------------------------- figures
function Figures() {
  const q = usePricingOverview()
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  return (
    <section aria-label="Pricing figures" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-5', d && 'stagger')}>
      {!d ? (
        Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
      ) : (
        <>
          <StatCard label="Courses with a price" value={d.courses_with_price.toLocaleString('en-GB')} icon={<BookOpen />} hint={`${d.free_courses} free`} />
          <StatCard label="Average course price" value={gbp(d.average_price_gbp_minor)} icon={<Coins />} tone="success" />
          <StatCard label="Active currencies" value={d.active_currencies.length} icon={<Globe />} tone="info" hint={d.active_currencies.join(', ')} />
          <StatCard label="Regional prices" value={d.regional_overrides} icon={<MapPin />} tone="warning" />
          <StatCard label="Price rules" value={d.active_rules} icon={<Tag />} />
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- tier picker
function TierSelect({ value, onChange, id, allowFree = true, ...aria }: { value: string; onChange: (v: string) => void; id?: string; allowFree?: boolean; 'aria-describedby'?: string }) {
  const tiers = useTiers('GBP')
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} {...aria}>
      <option value="">Choose a price</option>
      {allowFree ? <option value="free">Free</option> : null}
      {(tiers.data ?? []).filter((t) => t.is_active).map((t) => (
        <option key={t.id} value={t.id}>{t.name} · {gbp(t.gbp_minor)}</option>
      ))}
    </NativeSelect>
  )
}

function PriceForm({ title, count, initial, loading, onSave }: { title: string; count?: number; initial: string; loading: boolean; onSave: (tier: string) => void }) {
  const [tier, setTier] = useState(initial)
  return (
    <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), tier && onSave(tier))}>
      <p className="text-sm text-muted">{count ? `The new price applies to ${count} course${count === 1 ? '' : 's'} straight away, in every currency.` : 'The new price applies straight away, in every currency.'}</p>
      <Field label={title}>{(p) => <TierSelect {...p} value={tier} onChange={setTier} />}</Field>
      <div className="flex justify-end">
        <Button type="submit" loading={loading} disabled={!tier}>Save price</Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- course grid
function CoursesCard({ filters, setFilters }: { filters: GridFilters; setFilters: (f: GridFilters) => void }) {
  const [text, setText] = useState(filters.q ?? '')
  const q = useDebounced(text, 250)
  const f = useMemo(() => ({ ...filters, q: q.trim() }), [filters, q])
  const grid = useCoursePrices(f)
  const cats = useCategories()
  const [selected, setSelected] = useState<string[]>([])
  const [edit, setEdit] = useState<CoursePriceRow | null>(null)
  const [bulk, setBulk] = useState(false)
  const setPrice = useSetCoursePrice()
  const bulkPrice = useBulkPrice()
  const rows = grid.data?.pages.flatMap((p) => p.items) ?? []
  const codes = (grid.data?.pages[0]?.currencies ?? []).filter((c) => c !== 'GBP').slice(0, 2)
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
  const allOn = rows.length > 0 && rows.every((r) => selected.includes(r.id))
  const amount = (r: CoursePriceRow, code: string) => {
    const a = r.amounts.find((x) => x.currency === code)
    return a ? <span className={cn(a.regional && 'font-semibold text-warning')} title={a.regional ? 'Regional price' : undefined}>{money(a.amount_minor, a.currency, a.exponent)}</span> : '—'
  }
  return (
    <Card>
      <CardHeader title="Course prices" description="Prices come from tiers, so every currency stays in step." />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search courses" placeholder="Search courses by title or instructor" className="sm:max-w-xs" />
        <NativeSelect aria-label="Category" value={filters.category ?? ''} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="w-full sm:w-44">
          <option value="">All categories</option>
          {(cats.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="w-full sm:w-40">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="unlisted">Unlisted</option>
          <option value="archived">Archived</option>
        </NativeSelect>
        <NativeSelect aria-label="Pricing type" value={filters.kind ?? ''} onChange={(e) => setFilters({ ...filters, kind: e.target.value })} className="w-full sm:w-40">
          <option value="">All pricing types</option>
          {Object.entries(PRICING_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </Toolbar>
      {selected.length ? (
        <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary-soft-text animate-reveal">
          <span>{selected.length} selected</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            <Button size="sm" onClick={() => setBulk(true)}><Layers /> Change price</Button>
          </span>
        </div>
      ) : null}
      {grid.error ? (
        <ErrorState message={(grid.error as Error).message} onRetry={() => void grid.refetch()} />
      ) : !grid.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No courses match" body="Try another search or filter." />
      ) : (
        <>
          <Table className="animate-reveal">
            <thead>
              <tr>
                <Th className="w-10"><Checkbox aria-label="Select every course shown" checked={allOn} onCheckedChange={(v) => setSelected(v ? rows.map((r) => r.id) : [])} /></Th>
                <Th>Course</Th><Th>Instructor</Th><Th className="text-right">Base price (GBP)</Th>
                {codes.map((c) => <Th key={c} className="text-right">{c} price</Th>)}
                <Th>Pricing type</Th><Th>Regional prices</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><Checkbox aria-label={`Select ${r.title}`} checked={selected.includes(r.id)} onCheckedChange={(v) => toggle(r.id, !!v)} /></Td>
                  <Td>
                    <span className="block max-w-64 truncate font-medium">{r.title}</span>
                    <span className="text-xs text-muted">{r.category ?? 'No category'}{r.in_subscription ? ' · In subscriptions' : ''}</span>
                  </Td>
                  <Td className="max-w-40 truncate">{r.instructors.join(', ') || '—'}</Td>
                  <Td className="text-right font-medium whitespace-nowrap tabular">{r.is_free ? 'Free' : r.gbp_minor !== null ? gbp(r.gbp_minor) : '—'}</Td>
                  {codes.map((c) => <Td key={c} className="text-right whitespace-nowrap tabular">{amount(r, c)}</Td>)}
                  <Td><Badge tone={TYPE_TONE[r.pricing_type]}>{PRICING_TYPE[r.pricing_type] ?? r.pricing_type}</Badge></Td>
                  <Td>{r.regional_count ? <Badge tone="info">{r.regional_count} region{r.regional_count === 1 ? '' : 's'}</Badge> : <span className="text-muted">—</span>}</Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setEdit(r)} aria-label={`Edit the price of ${r.title}`}><Pencil /> Edit</Button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <LoadMore shown={rows.length} noun="courses" hasMore={!!grid.hasNextPage} loading={grid.isFetchingNextPage} onMore={() => void grid.fetchNextPage()} />
        </>
      )}
      <DetailSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit ? `Price of ${edit.title}` : 'Course price'}>
        {edit ? (
          <PriceForm
            key={edit.id}
            title="New price"
            initial={edit.is_free ? 'free' : (edit.tier_id ?? '')}
            loading={setPrice.isPending}
            onSave={(t) => setPrice.mutate({ id: edit.id, tier_id: t === 'free' ? null : t, is_free: t === 'free' }, { onSuccess: () => (toast.success('Price saved.'), setEdit(null)), onError: fail })}
          />
        ) : null}
      </DetailSheet>
      <DetailSheet open={bulk} onOpenChange={setBulk} title="Bulk price update">
        {bulk ? (
          <PriceForm
            title="New price for the selected courses"
            count={selected.length}
            initial=""
            loading={bulkPrice.isPending}
            onSave={(t) =>
              bulkPrice.mutate(
                { course_ids: selected, tier_id: t === 'free' ? null : t, is_free: t === 'free' },
                { onSuccess: (r) => (toast.success(`${(r as { updated: number }).updated} prices updated.`), setBulk(false), setSelected([])), onError: fail },
              )
            }
          />
        ) : null}
      </DetailSheet>
    </Card>
  )
}

// ---------------------------------------------------------------- price rules
function RuleForm({ onDone }: { onDone: (id: string) => void }) {
  const create = useCreateRule()
  const cats = useCategories()
  const [v, setV] = useState({ name: '', scope: 'all', target_id: '', action: 'percent', percent: '10', tier: '', rounding: 'nearest' })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      {
        name: v.name.trim(),
        scope: v.scope,
        target_id: v.scope === 'all' ? null : v.target_id || null,
        action: v.action,
        tier_id: v.action === 'set_tier' ? v.tier || null : null,
        percent: v.action === 'percent' ? Number(v.percent) : null,
        rounding: v.rounding,
      },
      { onSuccess: (r) => onDone((r as { id: string }).id), onError: fail },
    )
  }
  const ok = v.name.trim() && (v.scope === 'all' || v.target_id) && (v.action === 'percent' ? Number(v.percent) !== 0 && v.percent.trim() !== '' : v.tier)
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-sm text-muted">A rule changes many prices in one go. You see every change before anything is saved.</p>
      <Field label="Rule name">{(p) => <Input {...p} value={v.name} onChange={set('name')} maxLength={120} placeholder="Spring price review" />}</Field>
      <Field label="Which courses">
        {(p) => (
          <NativeSelect {...p} value={v.scope} onChange={set('scope')}>
            <option value="all">Every priced course</option>
            <option value="category">One category</option>
          </NativeSelect>
        )}
      </Field>
      {v.scope === 'category' ? (
        <Field label="Category">
          {(p) => (
            <NativeSelect {...p} value={v.target_id} onChange={set('target_id')}>
              <option value="">Choose a category</option>
              {(cats.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Change">
        {(p) => (
          <NativeSelect {...p} value={v.action} onChange={set('action')}>
            <option value="percent">Raise or lower by a percentage</option>
            <option value="set_tier">Set one price for all of them</option>
          </NativeSelect>
        )}
      </Field>
      {v.action === 'percent' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Percentage" hint="Use a minus sign to lower prices.">{(p) => <Input {...p} type="number" min={-90} max={300} value={v.percent} onChange={set('percent')} inputMode="numeric" />}</Field>
          <Field label="Round to the">
            {(p) => (
              <NativeSelect {...p} value={v.rounding} onChange={set('rounding')}>
                <option value="nearest">Nearest price tier</option>
                <option value="up">Tier above</option>
                <option value="down">Tier below</option>
              </NativeSelect>
            )}
          </Field>
        </div>
      ) : (
        <Field label="New price">{(p) => <TierSelect {...p} allowFree={false} value={v.tier} onChange={(t) => setV({ ...v, tier: t })} />}</Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!ok}><Wand2 /> Preview changes</Button>
      </div>
    </form>
  )
}

function RulePreview({ rule, onDone }: { rule: RuleRow; onDone: () => void }) {
  const preview = useRulePreview(rule.applied_at ? '' : rule.id)
  const apply = useApplyRule()
  const [confirm, setConfirm] = useState(false)
  if (rule.applied_at) return <p className="text-sm text-muted">Applied on {dateTime(rule.applied_at)} to {rule.applied_count} course{rule.applied_count === 1 ? '' : 's'}.</p>
  if (preview.error) return <ErrorState message={(preview.error as Error).message} onRetry={() => void preview.refetch()} />
  if (!preview.data) return <Skeleton className="h-48" />
  const n = preview.data.changes.length
  return (
    <div className="grid gap-4 animate-reveal">
      <p className="text-sm text-muted">{n ? `${n} course price${n === 1 ? '' : 's'} will change. ${preview.data.unchanged} stay the same.` : 'No price would change.'}</p>
      {n ? (
        <Table>
          <thead><tr><Th>Course</Th><Th className="text-right">Now</Th><Th className="text-right">New</Th></tr></thead>
          <tbody className="stagger">
            {preview.data.changes.slice(0, 100).map((c) => (
              <Tr key={c.course_id}>
                <Td className="max-w-52 truncate">{c.title}</Td>
                <Td className="text-right tabular text-muted">{c.from_gbp_minor !== null ? gbp(c.from_gbp_minor) : '—'}</Td>
                <Td className="text-right font-medium tabular">{gbp(c.to_gbp_minor)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={!n} onClick={() => setConfirm(true)}>Apply to {n} course{n === 1 ? '' : 's'}</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="primary"
        title="Apply this price rule?"
        body={`${n} course price${n === 1 ? '' : 's'} change straight away for every buyer. A rule can only be applied once.`}
        confirmLabel="Apply rule"
        loading={apply.isPending}
        onConfirm={() => apply.mutate(rule.id, { onSuccess: () => (toast.success('New prices are live.'), setConfirm(false), onDone()), onError: fail })}
      />
    </div>
  )
}

function RulesCard({ open, setOpen }: { open: string; setOpen: (id: string) => void }) {
  const rules = useRules()
  const off = useRuleOff()
  const rule = rules.data?.find((r) => r.id === open)
  const what = (r: RuleRow) => `${r.action === 'percent' ? `${r.percent! > 0 ? '+' : ''}${r.percent}%` : `Set to ${r.tier_name}`} · ${r.target_name ?? 'Every priced course'}`
  return (
    <Card id="price-rules">
      <CardHeader title="Price rules" description="Change many prices at once, with a preview first." />
      {rules.error ? (
        <ErrorState message={(rules.error as Error).message} onRetry={() => void rules.refetch()} />
      ) : !rules.data ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : rules.data.length === 0 ? (
        <EmptyState icon={<Wand2 />} title="No price rules yet" body="Use “Add price rule” to raise or lower many prices together." />
      ) : (
        <ul className="stagger divide-y divide-border">
          {rules.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-muted">{what(r)}</p>
              </div>
              <StatusPill status={r.applied_at ? 'actioned' : r.is_active ? 'pending' : 'ended'} label={r.applied_at ? `Applied to ${r.applied_count}` : r.is_active ? 'Not applied' : 'Off'} />
              <Button size="sm" variant="secondary" onClick={() => setOpen(r.id)}>{r.applied_at ? 'View' : 'Preview'}</Button>
              {!r.applied_at && r.is_active ? (
                <Button size="sm" variant="ghost" loading={off.isPending && off.variables === r.id} onClick={() => off.mutate(r.id, { onSuccess: () => toast.success('Rule switched off.'), onError: fail })}>Switch off</Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <DetailSheet open={!!rule} onOpenChange={(o) => !o && setOpen('')} title={rule?.name ?? 'Price rule'} description={rule ? what(rule) : undefined}>
        {rule ? <RulePreview rule={rule} onDone={() => setOpen('')} /> : null}
      </DetailSheet>
    </Card>
  )
}

function Tools({ go, onRule }: { go: (t: Tab) => void; onRule: () => void }) {
  const items: [string, string, React.ReactNode, () => void][] = [
    ['Currencies and rates', 'Manage currencies and exchange rates', <Coins key="c" />, () => go('currencies')],
    ['Regional prices', 'Set a price for one country', <MapPin key="m" />, () => go('regional')],
    ['Bulk price update', 'Tick courses in the table, then “Change price”', <Layers key="l" />, () => document.querySelector<HTMLInputElement>('[aria-label="Select every course shown"]')?.focus()],
    ['Price rules', 'Raise or lower many prices together', <SlidersHorizontal key="s" />, onRule],
  ]
  return (
    <div className="grid content-start gap-4">
      <Card>
        <CardHeader title="Pricing tools" />
        <ul className="divide-y divide-border px-2 pb-2">
          {items.map(([title, body, icon, act]) => (
            <li key={title}>
              <button type="button" onClick={act} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-surface-2 [&_svg]:size-5">
                <span className="text-primary">{icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{body}</span></span>
                <ChevronRight className="text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="bg-primary-soft p-4 text-primary-soft-text">
        <p className="flex items-center gap-2 font-semibold"><Info className="size-4" aria-hidden /> Hybrid pricing</p>
        <p className="mt-1 text-sm">Learners can buy single courses or subscribe to a plan. Regional prices apply to buyers in that country when switched on in Pricing settings.</p>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- subscription pricing
function SubscriptionPricing() {
  const plans = usePlans()
  return (
    <Card>
      <CardHeader title="Subscription prices" description="Each plan has one price per currency. Open a plan to change it." />
      {plans.error ? (
        <ErrorState message={(plans.error as Error).message} onRetry={() => void plans.refetch()} />
      ) : !plans.data ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : plans.data.length === 0 ? (
        <EmptyState icon={<Crown />} title="No plans yet" action={<Button asChild><Link to="/console/subscriptions?tab=plans">Go to subscriptions</Link></Button>} />
      ) : (
        <Table className="animate-reveal">
          <thead><tr><Th>Plan</Th><Th>Billing cycle</Th><Th>Prices</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="stagger">
            {plans.data.map((p) => (
              <Tr key={p.id}>
                <Td className="font-medium">{p.name}</Td>
                <Td>{p.interval === 'year' ? 'Yearly' : 'Monthly'}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1.5">
                    {p.prices.length ? p.prices.map((x) => <Badge key={x.currency} tone={x.stripe_price_id ? 'primary' : 'warning'} title={x.stripe_price_id ? undefined : 'Not on sale: no Stripe price yet'}>{money(x.amount_minor, x.currency, x.exponent)}</Badge>) : <span className="text-muted">No prices</span>}
                  </span>
                </Td>
                <Td><StatusPill status={p.is_active ? 'active' : 'ended'} label={p.is_active ? 'Active' : 'Inactive'} /></Td>
                <Td><Button asChild size="sm" variant="ghost"><Link to={`/console/subscriptions?tab=plans&plan=${p.id}`}>Edit prices</Link></Button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- currencies and tiers
function RateDialog({ cur, onClose }: { cur: CurrencyRow | null; onClose: () => void }) {
  const save = useManualRate()
  const [rate, setRate] = useState('')
  return (
    <DetailSheet open={!!cur} onOpenChange={(o) => !o && onClose()} title={cur ? `Exchange rate for ${cur.code}` : 'Exchange rate'}>
      {cur ? (
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), save.mutate({ code: cur.code, rate: rate.trim() }, { onSuccess: () => (toast.success('Rate saved. Unlocked prices were recalculated.'), setRate(''), onClose()), onError: fail }))}>
          <p className="text-sm text-muted">How many {cur.code} one pound buys. A manual rate stays until the next refresh. Current: {cur.latest ? `${cur.latest.rate} (${cur.latest.source}, ${cur.latest.date})` : 'none'}.</p>
          <Field label={`1 GBP in ${cur.code}`}>{(p) => <Input {...p} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder={cur.latest?.rate ?? '1.25'} />}</Field>
          <div className="flex justify-end"><Button type="submit" loading={save.isPending} disabled={!(Number(rate) > 0)}>Save rate</Button></div>
        </form>
      ) : null}
    </DetailSheet>
  )
}

function CurrenciesCard() {
  const cur = useCurrencies()
  const update = useUpdateCurrency()
  const refresh = useRefreshRates()
  const [rate, setRate] = useState<CurrencyRow | null>(null)
  const [show, setShow] = useState<'active' | 'all'>('active')
  const rows = (cur.data ?? []).filter((c) => show === 'all' || c.is_active)
  return (
    <Card>
      <CardHeader
        title="Currencies and exchange rates"
        description="Prices in other currencies come from the pound price and these rates."
        action={
          <Button size="sm" variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: (r) => toast.success(`${(r as { rates: number }).rates} rates updated.`), onError: fail })}>
            <RefreshCw /> Refresh rates
          </Button>
        }
      />
      <Toolbar>
        <NativeSelect aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'active' | 'all')} className="w-full sm:w-48">
          <option value="active">Active currencies</option>
          <option value="all">Every currency</option>
        </NativeSelect>
      </Toolbar>
      {cur.error ? (
        <ErrorState message={(cur.error as Error).message} onRetry={() => void cur.refetch()} />
      ) : !cur.data ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : (
        <Table className="animate-reveal">
          <thead><tr><Th>Currency</Th><Th className="text-right">Rate (1 GBP)</Th><Th>Updated</Th><Th>Card payments</Th><Th>On sale</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="stagger">
            {rows.map((c) => (
              <Tr key={c.code}>
                <Td><span className="font-medium">{c.code}</span> <span className="text-muted">{c.name}</span></Td>
                <Td className="text-right tabular">{c.code === 'GBP' ? '1' : (c.latest?.rate ?? '—')}</Td>
                <Td className="text-xs text-muted">{c.latest ? `${c.latest.date} · ${c.latest.source}` : '—'}</Td>
                <Td>{c.stripe_supported ? <Badge tone="success">Supported</Badge> : <Badge>Not supported</Badge>}</Td>
                <Td>
                  <Switch
                    aria-label={`${c.code} on sale`}
                    checked={c.is_active}
                    disabled={c.code === 'GBP' || (!c.is_active && !c.stripe_supported) || update.isPending}
                    onCheckedChange={(on) => update.mutate({ code: c.code, is_active: on }, { onSuccess: () => toast.success(on ? `${c.code} is on sale.` : `${c.code} switched off.`), onError: fail })}
                  />
                </Td>
                <Td>{c.code === 'GBP' ? null : <Button size="sm" variant="ghost" onClick={() => setRate(c)}>Set rate</Button>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <RateDialog cur={rate} onClose={() => setRate(null)} />
    </Card>
  )
}

function TierEdit({ tier, currency, exponent, onClose }: { tier: TierRow | null; currency: string; exponent: number; onClose: () => void }) {
  const patch = useUpdateTier()
  const setAmount = useSetTierAmount()
  const [g, setG] = useState('')
  const [a, setA] = useState('')
  const [lock, setLock] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const gMinor = toMinor(g)
  const aMinor = toMinor(a, exponent)
  return (
    <DetailSheet open={!!tier} onOpenChange={(o) => !o && (onClose(), setG(''), setA(''))} title={tier ? `Edit ${tier.name}` : 'Edit tier'} description={tier ? `${tier.courses} course${tier.courses === 1 ? '' : 's'} use this price.` : undefined}>
      {tier ? (
        <div className="grid gap-6">
          <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), gMinor && setConfirm(true))}>
            <Field label="Price in pounds" hint={`Now ${gbp(tier.gbp_minor)}. Other currencies follow unless they are locked.`}>{(p) => <Input {...p} value={g} onChange={(e) => setG(e.target.value)} inputMode="decimal" placeholder={toMajor(tier.gbp_minor)} />}</Field>
            <div className="flex justify-end"><Button type="submit" disabled={!gMinor}>Save pound price</Button></div>
          </form>
          {currency !== 'GBP' ? (
            <form className="grid gap-3 border-t border-border pt-5" onSubmit={(e) => (e.preventDefault(), aMinor !== null && setAmount.mutate({ id: tier.id, code: currency, amount_minor: aMinor, lock }, { onSuccess: () => (toast.success(`${currency} price saved.`), setA(''), onClose()), onError: fail }))}>
              <Field label={`Price in ${currency}`} hint={tier.amount_minor !== null ? `Now ${money(tier.amount_minor, currency, exponent)}${tier.locked ? ', locked' : ', from the rate'}.` : 'No price yet.'}>
                {(p) => <Input {...p} value={a} onChange={(e) => setA(e.target.value)} inputMode="decimal" />}
              </Field>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={lock} onCheckedChange={(v) => setLock(!!v)} /> Keep this price when rates change</label>
              <div className="flex justify-end"><Button type="submit" variant="secondary" loading={setAmount.isPending} disabled={aMinor === null}>Save {currency} price</Button></div>
            </form>
          ) : null}
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            tone="primary"
            title={`Change ${tier.name} to ${gMinor ? gbp(gMinor) : ''}?`}
            body={`${tier.courses} course${tier.courses === 1 ? '' : 's'} change price straight away, in every currency that is not locked.`}
            confirmLabel="Change price"
            loading={patch.isPending}
            onConfirm={() => patch.mutate({ id: tier.id, gbp_minor: gMinor! }, { onSuccess: () => (toast.success('Tier price saved.'), setConfirm(false), setG(''), onClose()), onError: fail })}
          />
        </div>
      ) : null}
    </DetailSheet>
  )
}

function TiersCard() {
  const cur = useCurrencies()
  const active = (cur.data ?? []).filter((c) => c.is_active)
  const [code, setCode] = useState('USD')
  const currency = active.find((c) => c.code === code) ?? active.find((c) => c.code !== 'GBP') ?? active[0]
  const tiers = useTiers(currency?.code ?? 'GBP')
  const [edit, setEdit] = useState<TierRow | null>(null)
  return (
    <Card>
      <CardHeader title="Price tiers" description="Instructors choose one of these prices for each course." />
      <Toolbar>
        <NativeSelect aria-label="Currency shown" value={currency?.code ?? ''} onChange={(e) => setCode(e.target.value)} className="w-full sm:w-40">
          {active.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </NativeSelect>
      </Toolbar>
      {tiers.error ? (
        <ErrorState message={(tiers.error as Error).message} onRetry={() => void tiers.refetch()} />
      ) : !tiers.data || !currency ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : (
        <Table className="animate-reveal">
          <thead><tr><Th>Tier</Th><Th className="text-right">GBP</Th><Th className="text-right">{currency.code}</Th><Th className="text-right">Courses</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="stagger">
            {tiers.data.map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td className="text-right tabular">{gbp(t.gbp_minor)}</Td>
                <Td className="text-right tabular">{t.amount_minor !== null ? money(t.amount_minor, currency.code, currency.exponent) : '—'}{t.locked ? <Badge className="ml-2" tone="warning">Locked</Badge> : null}</Td>
                <Td className="text-right tabular">{t.courses}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setEdit(t)} aria-label={`Edit ${t.name}`}><Pencil /> Edit</Button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <TierEdit key={edit?.id ?? ''} tier={edit} currency={currency?.code ?? 'GBP'} exponent={currency?.exponent ?? 2} onClose={() => setEdit(null)} />
    </Card>
  )
}

// ---------------------------------------------------------------- regional
function RegionalForm({ onDone }: { onDone: () => void }) {
  const cur = useCurrencies()
  const create = useCreateRegional()
  const [what, setWhat] = useState<'course' | 'tier'>('course')
  const [search, setSearch] = useState('')
  const opts = usePromoOptions(useDebounced(search, 250).trim())
  const [course, setCourse] = useState('')
  const [tier, setTier] = useState('')
  const [country, setCountry] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const active = (cur.data ?? []).filter((c) => c.is_active)
  const exp = active.find((c) => c.code === currency)?.exponent ?? 2
  const minor = toMinor(amount, exp)
  const ok = (what === 'course' ? course : tier) && /^[A-Za-z]{2}$/.test(country) && minor
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        create.mutate(
          { course_id: what === 'course' ? course : null, tier_id: what === 'tier' ? tier : null, country: country.toUpperCase(), currency, amount_minor: minor! },
          { onSuccess: () => (toast.success('Regional price saved.'), onDone()), onError: fail },
        )
      }}
    >
      <p className="text-sm text-muted">Buyers in this country pay this price instead of the standard one. A course price beats a tier price.</p>
      <Field label="Applies to">
        {(p) => (
          <NativeSelect {...p} value={what} onChange={(e) => setWhat(e.target.value as 'course' | 'tier')}>
            <option value="course">One course</option>
            <option value="tier">Every course in a price tier</option>
          </NativeSelect>
        )}
      </Field>
      {what === 'course' ? (
        <>
          <Field label="Find a course">{(p) => <Input {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a title" />}</Field>
          <Field label="Course">
            {(p) => (
              <NativeSelect {...p} value={course} onChange={(e) => setCourse(e.target.value)}>
                <option value="">Choose a course</option>
                {(opts.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </NativeSelect>
            )}
          </Field>
        </>
      ) : (
        <Field label="Price tier">{(p) => <TierSelect {...p} allowFree={false} value={tier} onChange={setTier} />}</Field>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Country code" hint="Two letters, like US.">{(p) => <Input {...p} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} autoComplete="off" />}</Field>
        <Field label="Currency">
          {(p) => (
            <NativeSelect {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {active.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Price">{(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />}</Field>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={create.isPending} disabled={!ok}>Save regional price</Button></div>
    </form>
  )
}

function RegionalCard() {
  const rows = useRegional()
  const update = useUpdateRegional()
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState<RegionalRow | null>(null)
  const [off, setOff] = useState<RegionalRow | null>(null)
  const [amount, setAmount] = useState('')
  const minor = edit ? toMinor(amount, edit.exponent) : null
  return (
    <Card>
      <CardHeader title="Regional prices" description="Prices for buyers in one country, picked from where they browse from." action={<Button size="sm" onClick={() => setAdding(true)}><Plus /> Add regional price</Button>} />
      {rows.error ? (
        <ErrorState message={(rows.error as Error).message} onRetry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : rows.data.length === 0 ? (
        <EmptyState icon={<MapPin />} title="No regional prices" body="Everyone pays the standard price in their currency." />
      ) : (
        <Table className="animate-reveal">
          <thead><tr><Th>Applies to</Th><Th>Country</Th><Th className="text-right">Standard</Th><Th className="text-right">Regional</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="stagger">
            {rows.data.map((r) => (
              <Tr key={r.id} className={cn(!r.is_active && 'opacity-60')}>
                <Td className="max-w-56 truncate">{r.course_title ?? `${r.tier_name} (tier)`}</Td>
                <Td className="font-medium">{r.country}</Td>
                <Td className="text-right tabular text-muted">{r.standard_minor !== null ? money(r.standard_minor, r.currency, r.exponent) : '—'}</Td>
                <Td className="text-right font-medium tabular">{money(r.amount_minor, r.currency, r.exponent)}</Td>
                <Td><StatusPill status={r.is_active ? 'active' : 'ended'} label={r.is_active ? 'On' : 'Off'} /></Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => (setEdit(r), setAmount(toMajor(r.amount_minor, r.exponent)))}>Edit</Button>
                  {r.is_active ? (
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOff(r)}>Switch off</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, is_active: true }, { onSuccess: () => toast.success('Regional price is on.'), onError: fail })}>Switch on</Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <DetailSheet open={adding} onOpenChange={setAdding} title="Add regional price">{adding ? <RegionalForm onDone={() => setAdding(false)} /> : null}</DetailSheet>
      <DetailSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit ? `${edit.course_title ?? edit.tier_name} in ${edit.country}` : 'Regional price'}>
        {edit ? (
          <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), minor && update.mutate({ id: edit.id, amount_minor: minor }, { onSuccess: () => (toast.success('Regional price saved.'), setEdit(null)), onError: fail }))}>
            <Field label={`Price in ${edit.currency}`}>{(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />}</Field>
            <div className="flex justify-end"><Button type="submit" loading={update.isPending} disabled={!minor}>Save price</Button></div>
          </form>
        ) : null}
      </DetailSheet>
      <ConfirmDialog
        open={!!off}
        onOpenChange={(o) => !o && setOff(null)}
        title="Switch off this regional price?"
        body={off ? `Buyers in ${off.country} pay the standard price again.` : undefined}
        confirmLabel="Switch off"
        loading={update.isPending}
        onConfirm={() => off && update.mutate({ id: off.id, is_active: false }, { onSuccess: () => (toast.success('Regional price switched off.'), setOff(null)), onError: fail })}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- settings
export function SettingRows({ only }: { only?: string[] }) {
  const q = usePricingSettings()
  const save = useSaveSetting()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const rows = (q.data ?? []).filter((s) => !only || only.includes(s.key))
  const put = (key: string, value: unknown, done?: () => void) => save.mutate({ key, value }, { onSuccess: () => (toast.success('Setting saved.'), done?.()), onError: fail })
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data) return <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
  return (
    <ul className="stagger divide-y divide-border">
      {rows.map((s) => {
        const id = `setting-${s.key}`
        return (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <label htmlFor={id} className="text-sm font-medium">{s.label}</label>
            {s.kind === 'bool' ? (
              <Switch id={id} checked={s.value === true} disabled={save.isPending} onCheckedChange={(on) => put(s.key, on)} />
            ) : s.kind === 'choice' ? (
              <NativeSelect id={id} value={String(s.value)} onChange={(e) => put(s.key, e.target.value)} className="w-40">
                {s.choices.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            ) : (
              <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), draft[s.key] !== undefined && put(s.key, s.kind === 'int' ? Number(draft[s.key]) : draft[s.key].trim(), () => setDraft({ ...draft, [s.key]: undefined as never })))}>
                <Input id={id} className="w-28" value={draft[s.key] ?? String(s.value)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} inputMode={s.kind === 'int' ? 'numeric' : undefined} maxLength={s.kind === 'int' ? 4 : 3} />
                <Button type="submit" size="sm" variant="secondary" disabled={draft[s.key] === undefined || draft[s.key] === String(s.value)}>Save</Button>
              </form>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- page
export function ConsolePricingPage() {
  const [tab, setTab] = useTabParam(TABS, 'courses')
  const [filters, setFilters] = useState<GridFilters>({})
  const [rule, setRule] = useState(false)
  const [openRule, setOpenRule] = useState('')
  return (
    <>
      <PageHeader
        title="Pricing"
        description="Manage course and subscription prices, currencies and regional prices."
        actions={
          <>
            <Button onClick={() => setRule(true)}><Plus /> Add price rule</Button>
            <ExportButton path={pricingCsvPath(filters)} filename="course-prices.csv" />
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Pricing sections">
          <TabsTrigger value="courses"><Tag aria-hidden /> Course pricing</TabsTrigger>
          <TabsTrigger value="subscriptions"><Crown aria-hidden /> Subscription pricing</TabsTrigger>
          <TabsTrigger value="currencies"><Coins aria-hidden /> Currencies and rates</TabsTrigger>
          <TabsTrigger value="regional"><Globe aria-hidden /> Regional pricing</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 aria-hidden /> Pricing settings</TabsTrigger>
        </TabsList>
        <div className="mt-5 grid gap-5">
          <Figures />
          <TabsContent value="courses" className="mt-0">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="grid min-w-0 gap-5">
                <CoursesCard filters={filters} setFilters={setFilters} />
                <RulesCard open={openRule} setOpen={setOpenRule} />
              </div>
              <Tools go={setTab} onRule={() => document.getElementById('price-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            </div>
          </TabsContent>
          <TabsContent value="subscriptions" className="mt-0"><SubscriptionPricing /></TabsContent>
          <TabsContent value="currencies" className="mt-0 grid gap-5"><CurrenciesCard /><TiersCard /></TabsContent>
          <TabsContent value="regional" className="mt-0"><RegionalCard /></TabsContent>
          <TabsContent value="settings" className="mt-0">
            <Card>
              <CardHeader title="Pricing settings" description="These apply at checkout straight away." />
              <SettingRows />
            </Card>
          </TabsContent>
        </div>
      </Tabs>
      <DetailSheet open={rule} onOpenChange={setRule} title="Add price rule">
        {rule ? <RuleForm onDone={(id) => (setRule(false), setTab('courses'), setOpenRule(id))} /> : null}
      </DetailSheet>
    </>
  )
}
