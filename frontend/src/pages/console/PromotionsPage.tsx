import { BadgePercent, CalendarClock, Copy, Gift, Megaphone, Pencil, PauseCircle, Percent, Plus, Receipt, Settings2, Tag, Users } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dateTime, day, SearchBox, toLocalInput, toMajor, toMinor, Toolbar } from '@/features/console/money-ui'
import {
  type ConsolePromotion,
  KIND_LABEL,
  type PromoFilters,
  type PromotionInput,
  type PromoTargetInput,
  promotionsCsvPath,
  SEGMENT_LABEL,
  STATUS_LABEL,
  TARGET_LABEL,
  useCreatePromotion,
  useDeactivatePromotion,
  useDuplicatePromotion,
  usePromoOptions,
  usePromoOverview,
  usePromotion,
  usePromotions,
  useUpdatePromotion,
} from '@/features/console/promotions'
import { ConfirmDialog, DetailSheet, ExportButton, gbp, InfoRow, StatusPill, useParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'
import { SettingRows } from './PricingPage'

const TABS = ['codes', 'campaigns', 'rules', 'first', 'eligibility', 'settings'] as const
type Tab = (typeof TABS)[number]
const fail = (e: unknown) => toast.error((e as Error).message)
const period = (p: ConsolePromotion) => `${day(p.starts_at)} – ${day(p.ends_at)}`
const usage = (p: ConsolePromotion) => `${p.redeemed_count.toLocaleString('en-GB')} / ${p.max_redemptions === null ? '∞' : p.max_redemptions.toLocaleString('en-GB')}`

// ---------------------------------------------------------------- figures
function Figures() {
  const q = usePromoOverview()
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  return (
    <section aria-label="Promotion figures" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-5', d && 'stagger')}>
      {!d ? (
        Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
      ) : (
        <>
          <StatCard label="Active promotions" value={d.active} icon={<BadgePercent />} />
          <StatCard label="Total redemptions" value={d.redemptions.toLocaleString('en-GB')} icon={<Users />} tone="info" />
          <StatCard label="Revenue from promotions" value={gbp(d.revenue_gbp_minor)} icon={<Receipt />} tone="success" hint={`${gbp(d.discount_gbp_minor)} given in discounts`} />
          <StatCard label="Average discount" value={`${d.average_discount_pct}%`} icon={<Percent />} tone="warning" />
          <StatCard label="Scheduled" value={d.scheduled} icon={<CalendarClock />} />
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- table
function PromotionsCard({ title, kind, onOpen }: { title: string; kind?: string; onOpen: (id: string) => void }) {
  const [text, setText] = useState('')
  const [f, setF] = useState<PromoFilters>({ kind })
  const q = useDebounced(text, 250)
  const filters = useMemo(() => ({ ...f, kind: kind ?? f.kind, q: q.trim() }), [f, kind, q])
  const list = usePromotions(filters)
  return (
    <Card>
      <CardHeader title={`${title}${list.data ? ` (${list.data.length})` : ''}`} action={<ExportButton path={promotionsCsvPath(filters)} filename="promotions.csv" />} />
      <Toolbar>
        <SearchBox value={text} onChange={setText} label="Search promotions" placeholder="Search by code, name or description" className="sm:max-w-xs" />
        {kind === undefined ? (
          <NativeSelect aria-label="Type" value={f.kind ?? ''} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-full sm:w-40">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        ) : null}
        <NativeSelect aria-label="Status" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-full sm:w-40">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Target" value={f.target ?? ''} onChange={(e) => setF({ ...f, target: e.target.value })} className="w-full sm:w-44">
          <option value="">All targets</option>
          {Object.entries(TARGET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BadgePercent />} title="No promotions here" body="Use “Create promotion” to start one." />
      ) : (
        <Table className="animate-reveal">
          <thead>
            <tr><Th>Promotion / code</Th><Th>Type</Th><Th className="text-right">Discount</Th><Th>Target</Th><Th className="text-right">Usage</Th><Th>Valid period</Th><Th>Status</Th></tr>
          </thead>
          <tbody className="stagger">
            {list.data.map((p) => (
              <Tr key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                <Td>
                  <button type="button" className="text-left focus-visible:underline focus-visible:outline-none" onClick={(e) => (e.stopPropagation(), onOpen(p.id))}>
                    {p.code ? <Badge tone="primary" className="font-mono">{p.code}</Badge> : null}
                    <span className={cn('block max-w-56 truncate text-sm', p.code ? 'mt-1 text-xs text-muted' : 'font-medium')}>{p.name}</span>
                  </button>
                </Td>
                <Td>{KIND_LABEL[p.kind] ?? p.kind}</Td>
                <Td className="text-right font-semibold tabular">{p.percent_off}%</Td>
                <Td className="max-w-48 truncate">{p.target_summary}</Td>
                <Td className="text-right whitespace-nowrap tabular">{usage(p)}</Td>
                <Td className="whitespace-nowrap text-muted">{period(p)}</Td>
                <Td><StatusPill status={p.status} label={STATUS_LABEL[p.status]} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- form
type Pick = { id: string; label: string }

function PickList({ legend, options, value, onChange, search }: { legend: string; options: Pick[]; value: Pick[]; onChange: (v: Pick[]) => void; search?: { text: string; set: (v: string) => void } }) {
  const ids = new Set(value.map((v) => v.id))
  const shown = [...value, ...options.filter((o) => !ids.has(o.id))]
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {search ? <SearchBox value={search.text} onChange={search.set} label={`Search ${legend.toLowerCase()}`} placeholder="Type to search" /> : null}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
        {shown.length === 0 ? <li className="px-2 py-3 text-sm text-muted">Nothing found.</li> : null}
        {shown.map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
              <Checkbox checked={ids.has(o.id)} onCheckedChange={(on) => onChange(on ? [...value, o] : value.filter((x) => x.id !== o.id))} />
              <span className="truncate">{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{value.length} chosen</p>
    </fieldset>
  )
}

function PromotionForm({ promo, onDone }: { promo: ConsolePromotion | null; onDone: (id: string) => void }) {
  const create = useCreatePromotion()
  const update = useUpdatePromotion()
  const now = new Date()
  const [v, setV] = useState(() => ({
    name: promo?.name ?? '',
    kind: promo?.kind ?? 'promo_code',
    code: promo?.code ?? '',
    description: promo?.description ?? '',
    percent: String(promo?.percent_off ?? 20),
    starts: toLocalInput(promo?.starts_at ?? now.toISOString()),
    ends: toLocalInput(promo?.ends_at ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()),
    max: promo?.max_redemptions != null ? String(promo.max_redemptions) : '',
    perUser: promo?.per_user_limit != null ? String(promo.per_user_limit) : '1',
    minOrder: promo?.min_order_minor ? toMajor(promo.min_order_minor) : '',
    draft: promo ? promo.status === 'draft' : false,
  }))
  const firstType = promo?.targets.find((t) => t.target_type !== 'user_segment')?.target_type ?? 'all'
  const [scope, setScope] = useState(firstType)
  const [picks, setPicks] = useState<Pick[]>(() => (promo?.targets ?? []).filter((t) => t.target_id && t.target_type === firstType).map((t) => ({ id: t.target_id!, label: t.label })))
  const [segments, setSegments] = useState<string[]>(() => (promo?.targets ?? []).filter((t) => t.target_type === 'user_segment').map((t) => t.segment))
  const [search, setSearch] = useState('')
  const opts = usePromoOptions(useDebounced(search, 250).trim())
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  const scopes = v.kind === 'subscription' ? ['all', 'plan'] : ['all', 'course', 'category']
  useEffect(() => {
    if (!scopes.includes(scope)) (setScope('all'), setPicks([]))
  }, [v.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const options: Pick[] = scope === 'course' ? (opts.data?.courses ?? []) : scope === 'category' ? (opts.data?.categories ?? []) : scope === 'plan' ? (opts.data?.plans ?? []) : []
  const pct = Number(v.percent)
  const minOrder = v.minOrder.trim() ? toMinor(v.minOrder) : 0
  const errors = {
    code: v.kind === 'promo_code' && !v.code.trim() ? 'A promo code needs a code buyers can type.' : undefined,
    percent: !(pct >= 1 && pct <= 95 && Number.isInteger(pct)) ? 'Between 1 and 95.' : undefined,
    ends: v.starts && v.ends && v.ends <= v.starts ? 'The end must be after the start.' : undefined,
    targets: scope !== 'all' && picks.length === 0 ? 'Choose at least one.' : undefined,
    minOrder: minOrder === null ? 'Enter an amount, like 50.' : undefined,
  }
  const ok = v.name.trim() && v.starts && v.ends && !Object.values(errors).some(Boolean)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    const targets: PromoTargetInput[] = [
      ...(scope === 'all' ? [] : picks.map((p) => ({ target_type: scope, target_id: p.id, segment: '' }))),
      ...segments.map((s) => ({ target_type: 'user_segment', target_id: null, segment: s })),
    ]
    const body: PromotionInput = {
      name: v.name.trim(),
      kind: v.kind,
      code: v.code.trim(),
      description: v.description.trim(),
      percent_off: pct,
      starts_at: new Date(v.starts).toISOString(),
      ends_at: new Date(v.ends).toISOString(),
      max_redemptions: v.max.trim() ? Number(v.max) : null,
      per_user_limit: v.perUser.trim() ? Number(v.perUser) : null,
      min_order_minor: minOrder ?? 0,
      draft: v.draft,
      targets,
    }
    if (promo) update.mutate({ id: promo.id, body }, { onSuccess: () => (toast.success('Promotion saved.'), onDone(promo.id)), onError: fail })
    else create.mutate(body, { onSuccess: (r) => (toast.success(v.draft ? 'Saved as a draft.' : 'Promotion created.'), onDone((r as { id: string }).id)), onError: fail })
  }
  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} value={v.name} onChange={set('name')} maxLength={120} placeholder="Summer learning campaign" />}</Field>
        <Field label="Type">
          {(p) => (
            <NativeSelect {...p} value={v.kind} onChange={set('kind')} disabled={!!promo}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label={v.kind === 'promo_code' ? 'Code' : 'Code (optional)'} hint={v.kind === 'promo_code' ? 'Buyers type this at checkout.' : 'Leave empty to apply it without a code.'} error={errors.code}>
          {(p) => <Input {...p} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().replace(/\s/g, '') })} maxLength={40} className="font-mono" autoComplete="off" />}
        </Field>
        <Field label="Discount (%)" error={errors.percent}>{(p) => <Input {...p} type="number" min={1} max={95} value={v.percent} onChange={set('percent')} inputMode="numeric" />}</Field>
      </div>
      <Field label="Description (optional)">{(p) => <Textarea {...p} value={v.description} onChange={set('description')} maxLength={500} rows={2} />}</Field>

      <section aria-labelledby="promo-target" className="grid gap-3">
        <h3 id="promo-target" className="text-sm font-semibold">What it applies to</h3>
        <Field label="Applies to">
          {(p) => (
            <NativeSelect {...p} value={scope} onChange={(e) => (setScope(e.target.value), setPicks([]))}>
              {scopes.map((s) => <option key={s} value={s}>{s === 'all' ? (v.kind === 'subscription' ? 'Every subscription plan' : 'Every course') : TARGET_LABEL[s]}</option>)}
            </NativeSelect>
          )}
        </Field>
        {scope !== 'all' ? (
          <>
            <PickList legend={TARGET_LABEL[scope]} options={options} value={picks} onChange={setPicks} search={scope === 'course' ? { text: search, set: setSearch } : undefined} />
            {errors.targets ? <p className="text-[13px] text-danger">{errors.targets}</p> : null}
          </>
        ) : null}
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">Who can use it <span className="font-normal text-muted">(none ticked: everyone)</span></legend>
          {Object.entries(SEGMENT_LABEL).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox checked={segments.includes(k)} onCheckedChange={(on) => setSegments(on ? [...segments, k] : segments.filter((s) => s !== k))} /> {l}
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="promo-limits" className="grid gap-3">
        <h3 id="promo-limits" className="text-sm font-semibold">Schedule and limits</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={v.starts} onChange={set('starts')} />}</Field>
          <Field label="Ends" error={errors.ends}>{(p) => <Input {...p} type="datetime-local" value={v.ends} onChange={set('ends')} />}</Field>
          <Field label="Total uses (optional)" hint="Empty means no limit.">{(p) => <Input {...p} type="number" min={1} value={v.max} onChange={set('max')} inputMode="numeric" />}</Field>
          <Field label="Uses per person (optional)" hint="Empty means no limit.">{(p) => <Input {...p} type="number" min={1} value={v.perUser} onChange={set('perUser')} inputMode="numeric" />}</Field>
          {v.kind !== 'subscription' ? (
            <Field label="Minimum order in pounds (optional)" error={errors.minOrder}>{(p) => <Input {...p} value={v.minOrder} onChange={set('minOrder')} inputMode="decimal" placeholder="0.00" />}</Field>
          ) : null}
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={v.draft} onCheckedChange={(on) => setV({ ...v, draft: !!on })} /> Save as a draft (not live yet)
      </label>
      <div className="flex justify-end">
        <Button type="submit" loading={create.isPending || update.isPending} disabled={!ok}>{promo ? 'Save promotion' : 'Create promotion'}</Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- detail panel
function PromotionSheet({ onEdit }: { onEdit: (p: ConsolePromotion) => void }) {
  const [id, setId] = useParam('promo')
  const q = usePromotion(id)
  const duplicate = useDuplicatePromotion()
  const deactivate = useDeactivatePromotion()
  const [panel, setPanel] = useState('overview')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => setPanel('overview'), [id])
  const d = q.data
  const p = d?.promotion
  return (
    <DetailSheet open={!!id} onOpenChange={(o) => !o && setId('')} title={p ? p.code || p.name : 'Promotion'} description={p?.code ? p.name : undefined}>
      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : !d || !p ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-5 animate-reveal">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="primary">{KIND_LABEL[p.kind] ?? p.kind}</Badge>
            <StatusPill status={p.status} label={STATUS_LABEL[p.status]} />
          </div>
          <Tabs value={panel} onValueChange={setPanel}>
            <TabsList aria-label="Promotion details">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="conditions">Conditions</TabsTrigger>
              <TabsTrigger value="usage">Usage</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <InfoRow label="Discount">{p.percent_off}%</InfoRow>
              <InfoRow label="Target">{p.target_summary}</InfoRow>
              <InfoRow label="Valid period">{period(p)}</InfoRow>
              <InfoRow label="Usage">{usage(p)}{p.max_redemptions ? ` (${Math.round((p.redeemed_count / p.max_redemptions) * 100)}%)` : ''}</InfoRow>
              <InfoRow label="Revenue generated">{gbp(p.revenue_gbp_minor)}</InfoRow>
              <InfoRow label="Discount given">{gbp(d.discount_gbp_minor)}</InfoRow>
              {p.description ? <p className="mt-3 text-sm text-muted">{p.description}</p> : null}
            </TabsContent>
            <TabsContent value="conditions">
              <InfoRow label="Code">{p.code ? <span className="font-mono">{p.code}</span> : 'Applies without a code'}</InfoRow>
              <InfoRow label="Applies to">{p.targets.filter((t) => t.target_type !== 'user_segment').map((t) => t.label).join(', ') || (p.kind === 'subscription' ? 'Every subscription plan' : 'Every course')}</InfoRow>
              <InfoRow label="Who can use it">{p.targets.filter((t) => t.target_type === 'user_segment').map((t) => t.label).join(', ') || (p.kind === 'first_purchase' ? 'People buying for the first time' : 'Everyone')}</InfoRow>
              <InfoRow label="Uses per person">{p.per_user_limit ?? 'No limit'}</InfoRow>
              <InfoRow label="Total uses">{p.max_redemptions ?? 'No limit'}</InfoRow>
              <InfoRow label="Minimum order">{p.min_order_minor ? gbp(p.min_order_minor) : 'None'}</InfoRow>
            </TabsContent>
            <TabsContent value="usage">
              {d.uses.length === 0 ? (
                <EmptyState icon={<Receipt />} title="Not used yet" />
              ) : (
                <ul className="stagger divide-y divide-border">
                  {d.uses.map((u) => (
                    <li key={u.order_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <Link to={`/console/sales?tab=orders&order=${u.order_id}`} className="font-medium text-primary hover:underline">{u.order_number}</Link>
                        <span className="block truncate text-xs text-muted">{u.email} · {dateTime(u.at)}</span>
                      </span>
                      <span className="text-right tabular">
                        <span className="block">{money(u.total_minor, u.currency, u.exponent)}</span>
                        <span className="block text-xs text-success">−{money(u.discount_minor, u.currency, u.exponent)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="activity">
              {d.activity.length === 0 ? (
                <EmptyState icon={<CalendarClock />} title="No activity yet" />
              ) : (
                <ol className="stagger grid gap-3">
                  {d.activity.map((a, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{ACTIVITY[a.action] ?? a.action}</span>
                      <span className="block text-xs text-muted">{dateTime(a.at)}{typeof a.data.reason === 'string' && a.data.reason ? ` · ${a.data.reason}` : ''}</span>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
          <section aria-label="Promotion actions" className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" onClick={() => onEdit(p)}><Pencil /> Edit</Button>
            <Button variant="secondary" loading={duplicate.isPending} onClick={() => duplicate.mutate(p.id, { onSuccess: (r) => (toast.success('Copy saved as a draft. Give it a code and switch it on.'), setId((r as { id: string }).id)), onError: fail })}>
              <Copy /> Duplicate
            </Button>
            <Button variant="secondary" className="text-danger" disabled={p.status === 'ended'} onClick={() => setConfirm(true)}><PauseCircle /> Deactivate</Button>
          </section>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={`Deactivate ${p.code || p.name}?`}
            body="It stops applying at checkout straight away. Past orders keep their discount."
            reason="required"
            confirmLabel="Deactivate"
            loading={deactivate.isPending}
            onConfirm={(reason) => deactivate.mutate({ id: p.id, reason }, { onSuccess: () => (toast.success('Promotion deactivated.'), setConfirm(false)), onError: fail })}
          />
        </div>
      )}
    </DetailSheet>
  )
}

const ACTIVITY: Record<string, string> = {
  'promotion.create': 'Created',
  'promotion.update': 'Edited',
  'promotion.duplicate': 'Copied',
  'promotion.deactivate': 'Deactivated',
}

// ---------------------------------------------------------------- rules and limits
function HowItWorks() {
  return (
    <Card>
      <CardHeader title="How discounts combine" />
      <CardBody className="grid gap-2 text-sm text-muted">
        <p>Each order gets one promotion: the one that saves the buyer the most.</p>
        <p>An instructor’s coupon and a promotion don’t add up unless “Promotions can stack with coupons” is on in Settings. Then the promotion applies to the price after the coupon.</p>
        <p>Subscription promotions take money off the first payment of a plan.</p>
      </CardBody>
    </Card>
  )
}

function EligibilityCard({ onOpen }: { onOpen: (id: string) => void }) {
  const list = usePromotions({})
  const live = (list.data ?? []).filter((p) => p.status === 'active' || p.status === 'scheduled')
  return (
    <Card>
      <CardHeader title="Eligibility and limits" description="Who can use each live or scheduled promotion, and how often." />
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : live.length === 0 ? (
        <EmptyState icon={<Users />} title="Nothing live or scheduled" />
      ) : (
        <Table className="animate-reveal">
          <thead><tr><Th>Promotion</Th><Th>Who</Th><Th className="text-right">Per person</Th><Th className="text-right">Total uses</Th><Th className="text-right">Minimum order</Th></tr></thead>
          <tbody className="stagger">
            {live.map((p) => (
              <Tr key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                <Td><button type="button" className="text-left font-medium focus-visible:underline focus-visible:outline-none" onClick={(e) => (e.stopPropagation(), onOpen(p.id))}>{p.code || p.name}</button></Td>
                <Td className="max-w-56 truncate">{p.targets.filter((t) => t.target_type === 'user_segment').map((t) => t.label).join(', ') || (p.kind === 'first_purchase' ? 'First-time buyers' : 'Everyone')}</Td>
                <Td className="text-right tabular">{p.per_user_limit ?? '∞'}</Td>
                <Td className="text-right tabular">{usage(p)}</Td>
                <Td className="text-right tabular">{p.min_order_minor ? gbp(p.min_order_minor) : '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- page
export function ConsolePromotionsPage() {
  const [tab, setTab] = useTabParam(TABS, 'codes')
  const [, setPromo] = useParam('promo')
  const [form, setForm] = useState<{ promo: ConsolePromotion | null } | null>(null)
  return (
    <>
      <PageHeader
        title="Promotions"
        description="Create and manage discounts, promo codes and marketing campaigns."
        actions={
          <>
            <Button onClick={() => setForm({ promo: null })}><Plus /> Create promotion</Button>
            <ExportButton path={promotionsCsvPath({})} filename="promotions.csv" />
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Promotion sections">
          <TabsTrigger value="codes"><Tag aria-hidden /> Promo codes</TabsTrigger>
          <TabsTrigger value="campaigns"><Megaphone aria-hidden /> Campaigns</TabsTrigger>
          <TabsTrigger value="rules"><Percent aria-hidden /> Discount rules</TabsTrigger>
          <TabsTrigger value="first"><Gift aria-hidden /> First purchase offers</TabsTrigger>
          <TabsTrigger value="eligibility"><Users aria-hidden /> Eligibility and limits</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 aria-hidden /> Settings</TabsTrigger>
        </TabsList>
        <div className="mt-5 grid gap-5">
          <Figures />
          <TabsContent value="codes" className="mt-0"><PromotionsCard title="All promotions" onOpen={setPromo} /></TabsContent>
          <TabsContent value="campaigns" className="mt-0"><PromotionsCard title="Campaigns" kind="campaign" onOpen={setPromo} /></TabsContent>
          <TabsContent value="rules" className="mt-0 grid gap-5"><HowItWorks /><PromotionsCard title="Subscription discounts" kind="subscription" onOpen={setPromo} /></TabsContent>
          <TabsContent value="first" className="mt-0"><PromotionsCard title="First purchase offers" kind="first_purchase" onOpen={setPromo} /></TabsContent>
          <TabsContent value="eligibility" className="mt-0"><EligibilityCard onOpen={setPromo} /></TabsContent>
          <TabsContent value="settings" className="mt-0 grid gap-5">
            <Card>
              <CardHeader title="Promotion settings" description="These apply at checkout straight away." />
              <SettingRows only={['payments.allow_promotion_stacking']} />
            </Card>
            <HowItWorks />
          </TabsContent>
        </div>
      </Tabs>
      <PromotionSheet onEdit={(p) => (setPromo(''), setForm({ promo: p }))} />
      <DetailSheet open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.promo ? `Edit ${form.promo.code || form.promo.name}` : 'Create promotion'}>
        {form ? <PromotionForm key={form.promo?.id ?? 'new'} promo={form.promo} onDone={(id) => (setForm(null), setPromo(id))} /> : null}
      </DetailSheet>
    </>
  )
}
