import { BookOpen, Crown, Info, ListFilter, MoreHorizontal, Pencil, Percent, PieChart, Plus, Power, Search, Settings, SlidersHorizontal, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleSearch } from '@/features/console/api'
import {
  type CommissionRule,
  type CommissionRuleIn,
  type InstructorCommission,
  SCOPE_LABEL,
  useCategoryOptions,
  useCommissionOverview,
  useCommissionPreview,
  useCommissionRules,
  useInstructorCommissions,
  useSaveCommissionSettings,
  useSaveRule,
  useSetInstructorKeeps,
} from '@/features/console/commissions'
import { day, SearchBox, toLocalInput, Toolbar } from '@/features/console/money-ui'
import { PersonCell, personStatus } from '@/features/console/people-ui'
import { ConfirmDialog, gbp, KpiCard, LoadMore, StatusPill, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { Link } from '@/lib/router'

const TABS = ['overview', 'instructors', 'courses', 'rules', 'pool', 'settings'] as const
type Tab = (typeof TABS)[number]

// ---------------------------------------------------------------- target picker (course / instructor search)
function TargetPicker({ kind, value, label, onChange }: { kind: 'courses' | 'instructors'; value: { id: string; title: string } | null; label: string; onChange: (v: { id: string; title: string } | null) => void }) {
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 200)
  const search = useConsoleSearch(term)
  const hits = search.data?.groups.find((g) => g.key === kind)?.hits ?? []
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="truncate font-medium">{value.title}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-1.5">
      <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind === 'courses' ? 'courses' : 'instructors'}`} aria-label={label} />
      {term.length >= 2 ? (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label={`${label} results`}>
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{search.isFetching ? 'Searching…' : 'Nothing matches.'}</li>
          ) : (
            hits.map((h) => (
              <li key={h.id} role="option" aria-selected={false}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => (onChange({ id: h.id, title: h.title }), setQ(''))}>
                  <span className="block truncate font-medium">{h.title}</span>
                  <span className="block truncate text-xs text-muted">{h.subtitle}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- rule dialog
type RuleDraft = { id?: string; scope: CommissionRuleIn['scope']; name: string; target: { id: string; title: string } | null; category: string; bandMin: string; bandMax: string; keeps: string; priority: string; starts: string; ends: string; active: boolean }

const emptyRule = (scope: CommissionRuleIn['scope'] = 'course'): RuleDraft => ({ scope, name: '', target: null, category: '', bandMin: '', bandMax: '', keeps: '', priority: '0', starts: '', ends: '', active: true })

const fromRule = (r: CommissionRule): RuleDraft => ({
  id: r.id,
  scope: r.scope as CommissionRuleIn['scope'],
  name: r.name,
  target: r.target_id && (r.scope === 'course' || r.scope === 'instructor') ? { id: r.target_id, title: r.target_label } : null,
  category: r.scope === 'category' ? (r.target_id ?? '') : '',
  bandMin: r.band_min_gbp_minor === null ? '' : (r.band_min_gbp_minor / 100).toString(),
  bandMax: r.band_max_gbp_minor === null ? '' : (r.band_max_gbp_minor / 100).toString(),
  keeps: String(r.keeps_pct),
  priority: String(r.priority),
  starts: r.starts_at ? toLocalInput(r.starts_at) : '',
  ends: r.ends_at ? toLocalInput(r.ends_at) : '',
  active: r.is_active,
})

function RuleDialog({ draft, onClose }: { draft: RuleDraft | null; onClose: () => void }) {
  const save = useSaveRule()
  const cats = useCategoryOptions()
  const [d, setD] = useState<RuleDraft>(emptyRule())
  const [key, setKey] = useState<string | null>(null)
  const draftKey = draft ? (draft.id ?? `new-${draft.scope}`) : null
  if (draft && key !== draftKey) {
    setKey(draftKey)
    setD(draft)
  }
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((s) => ({ ...s, [k]: v }))
  const pence = (s: string) => (s.trim() === '' ? null : Math.round(Number(s) * 100))

  function submit() {
    const keeps = Number(d.keeps)
    if (d.keeps.trim() === '' || !(keeps >= 0 && keeps <= 100)) return toast.error('Enter what the instructor keeps, between 0% and 100%.')
    const target = d.scope === 'category' ? d.category || null : d.scope === 'price_band' ? null : (d.target?.id ?? null)
    if (d.scope !== 'price_band' && !target) return toast.error(`Choose the ${SCOPE_LABEL[d.scope]!.toLowerCase()} this rule is for.`)
    const body: CommissionRuleIn = {
      name: d.name.trim(),
      scope: d.scope,
      target_id: target,
      band_min_gbp_minor: d.scope === 'price_band' ? pence(d.bandMin) : null,
      band_max_gbp_minor: d.scope === 'price_band' ? pence(d.bandMax) : null,
      keeps_pct: keeps,
      priority: Number(d.priority) || 0,
      is_active: d.active,
      starts_at: d.starts ? new Date(d.starts).toISOString() : null,
      ends_at: d.ends ? new Date(d.ends).toISOString() : null,
    }
    save.mutate(
      { id: d.id, body },
      { onSuccess: () => (toast.success(d.id ? 'Rule saved. It applies to sales from now on.' : 'Rule added. It applies to sales from now on.'), onClose(), setKey(null)), onError: (e) => toast.error((e as Error).message) },
    )
  }

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && (onClose(), setKey(null))}>
      <DialogContent title={d.id ? 'Edit commission rule' : 'Add commission rule'} description="The most specific rule wins: course, then instructor, then category, then price band. Past earnings never change." className="max-w-2xl">
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), submit())}>
          <Field label="Name" hint="Optional, for example “Launch offer”.">{(p) => <Input {...p} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}</Field>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-scope">Applies to</Label>
            <NativeSelect id="rule-scope" value={d.scope} onChange={(e) => setD((s) => ({ ...s, scope: e.target.value as RuleDraft['scope'], target: null, category: '' }))}>
              <option value="course">One course</option>
              <option value="instructor">One instructor</option>
              <option value="category">A category</option>
              <option value="price_band">A price band</option>
            </NativeSelect>
          </div>
          {d.scope === 'course' || d.scope === 'instructor' ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{d.scope === 'course' ? 'Course' : 'Instructor'}</span>
              <TargetPicker kind={d.scope === 'course' ? 'courses' : 'instructors'} label={d.scope === 'course' ? 'Course' : 'Instructor'} value={d.target} onChange={(v) => set('target', v)} />
            </div>
          ) : d.scope === 'category' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rule-cat">Category</Label>
              <NativeSelect id="rule-cat" value={d.category} onChange={(e) => set('category', e.target.value)} required>
                <option value="">Choose a category</option>
                {cats.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From (£)" hint="Included.">{(p) => <Input {...p} inputMode="decimal" value={d.bandMin} onChange={(e) => set('bandMin', e.target.value)} placeholder="0.00" />}</Field>
              <Field label="Up to (£)" hint="Not included; empty = no top.">{(p) => <Input {...p} inputMode="decimal" value={d.bandMax} onChange={(e) => set('bandMax', e.target.value)} placeholder="No limit" />}</Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Instructor keeps (%)">{(p) => <Input {...p} inputMode="decimal" value={d.keeps} onChange={(e) => set('keeps', e.target.value)} required placeholder="70" />}</Field>
            <Field label="Priority" hint="Higher wins within the same kind.">{(p) => <Input {...p} inputMode="numeric" value={d.priority} onChange={(e) => set('priority', e.target.value.replace(/[^0-9-]/g, ''))} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" hint="Empty = now.">{(p) => <Input {...p} type="datetime-local" value={d.starts} onChange={(e) => set('starts', e.target.value)} />}</Field>
            <Field label="Ends" hint="Empty = no end.">{(p) => <Input {...p} type="datetime-local" value={d.ends} onChange={(e) => set('ends', e.target.value)} />}</Field>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rule-active">Active</Label>
            <Switch id="rule-active" checked={d.active} onCheckedChange={(v) => set('active', v)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {d.id ? 'Save rule' : 'Add rule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- rules list
function RulesList({ scope, onEdit, onAdd }: { scope: string; onEdit: (r: CommissionRule) => void; onAdd: () => void }) {
  const q = useCommissionRules(scope)
  const save = useSaveRule()
  const [toggling, setToggling] = useState<CommissionRule | null>(null)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data)
    return (
      <div className="grid gap-3 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={<SlidersHorizontal />}
        title="No rules yet"
        body="Without rules, each instructor keeps their own rate or the platform default."
        action={
          <Button onClick={onAdd}>
            <Plus /> Add commission rule
          </Button>
        }
      />
    )
  const toggle = (r: CommissionRule) =>
    save.mutate(
      {
        id: r.id,
        body: { name: r.name, scope: r.scope as CommissionRuleIn['scope'], target_id: r.target_id, band_min_gbp_minor: r.band_min_gbp_minor, band_max_gbp_minor: r.band_max_gbp_minor, keeps_pct: r.keeps_pct, priority: r.priority, is_active: !r.is_active, starts_at: r.starts_at, ends_at: r.ends_at },
      },
      { onSuccess: () => (toast.success(r.is_active ? 'Rule switched off' : 'Rule switched on'), setToggling(null)), onError: (e) => toast.error((e as Error).message) },
    )
  return (
    <div className="animate-reveal">
      <ul className="stagger grid gap-3 p-3 md:hidden">
        {q.data.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-3.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name || r.target_label}</p>
                <p className="text-xs text-muted">
                  {SCOPE_LABEL[r.scope]} · {r.target_label}
                </p>
              </div>
              <span className="font-semibold tabular">{r.keeps_pct}%</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusPill status={r.is_live ? 'active' : r.is_active ? 'scheduled' : 'ended'} label={r.is_live ? 'Live' : r.is_active ? 'Not in dates' : 'Off'} />
              <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>
                <Pencil /> Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>Rule</Th>
              <Th>Applies to</Th>
              <Th className="text-right">Instructor keeps</Th>
              <Th className="text-right">Priority</Th>
              <Th className="hidden lg:table-cell">Dates</Th>
              <Th>Status</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {q.data.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <p className="font-medium">{r.name || '—'}</p>
                  <p className="text-xs text-muted">{SCOPE_LABEL[r.scope]}</p>
                </Td>
                <Td className="max-w-[16rem] truncate">{r.target_label}</Td>
                <Td className="text-right font-medium tabular">{r.keeps_pct}%</Td>
                <Td className="text-right tabular">{r.priority}</Td>
                <Td className="hidden text-xs text-muted lg:table-cell">
                  {r.starts_at ? day(r.starts_at) : 'Now'} – {r.ends_at ? day(r.ends_at) : 'no end'}
                </Td>
                <Td>
                  <StatusPill status={r.is_live ? 'active' : r.is_active ? 'scheduled' : 'ended'} label={r.is_live ? 'Live' : r.is_active ? 'Not in dates' : 'Off'} />
                </Td>
                <Td className="text-right">
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name || r.target_label}`}>
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => onEdit(r)}>
                        <Pencil /> Edit
                      </MenuItem>
                      <MenuItem onSelect={() => setToggling(r)}>
                        <Power /> {r.is_active ? 'Switch off' : 'Switch on'}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.is_active ? 'Switch this rule off?' : 'Switch this rule on?'}
        body="It changes the rate for sales from now on. Earnings already recorded keep their rate."
        confirmLabel={toggling?.is_active ? 'Switch off' : 'Switch on'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        loading={save.isPending}
        onConfirm={() => toggle(toggling!)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- instructor commissions
function RateDialog({ row, onClose }: { row: InstructorCommission | null; onClose: () => void }) {
  const save = useSetInstructorKeeps()
  const [value, setValue] = useState('')
  const [key, setKey] = useState('')
  if (row && key !== row.user_id) (setKey(row.user_id), setValue(String(row.keeps_pct)))
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && (onClose(), setKey(''))}>
      <DialogContent title={`Commission for ${row?.name ?? ''}`} description="What this instructor keeps of each marketplace sale. Course and instructor rules still take priority.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value)
            if (!(n >= 0 && n <= 100)) return toast.error('Enter a rate between 0% and 100%.')
            save.mutate({ id: row!.user_id, keeps_pct: n }, { onSuccess: () => (toast.success('Rate saved. The instructor was told.'), onClose(), setKey('')), onError: (err) => toast.error((err as Error).message) })
          }}
        >
          <Field label="Instructor keeps (%)">{(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            {row?.fee_is_custom ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => save.mutate({ id: row.user_id, keeps_pct: null }, { onSuccess: () => (toast.success('Back to the platform default'), onClose(), setKey('')) })}
              >
                Use the default
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save rate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InstructorCommissions({ compact }: { compact?: boolean }) {
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const [status, setStatus] = useState('')
  const list = useInstructorCommissions(q, status)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const [editing, setEditing] = useState<InstructorCommission | null>(null)
  return (
    <>
      <Toolbar>
        <SearchBox value={qText} onChange={setQText} label="Search instructors" placeholder="Search instructors" className="sm:max-w-xs" />
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          <option value="approved">Active</option>
          <option value="suspended">Suspended</option>
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
        <EmptyState icon={q || status ? <Search /> : <Users />} title={q || status ? 'Nobody matches' : 'No instructors yet'} />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-3 md:hidden">
            {rows.map((r) => (
              <li key={r.user_id}>
                <button type="button" onClick={() => setEditing(r)} className="w-full rounded-lg border border-border p-3.5 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <PersonCell name={r.name} email={r.email} />
                    <span className="font-semibold tabular">{r.rule_keeps_pct ?? r.keeps_pct}%</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {r.courses} courses · {gbp(r.earnings_gbp_minor)} earned{r.pool_share_pct !== null ? ` · ${r.pool_share_pct}% of the pool` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Instructor</Th>
                  <Th className="text-right">Courses</Th>
                  <Th className="text-right">Individual commission</Th>
                  <Th className="text-right">Subscription share</Th>
                  <Th className="text-right">Total earnings</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((r) => (
                  <Tr key={r.user_id}>
                    <Td>
                      <Link to={`/console/instructors?user=${r.user_id}`} className="hover:text-primary">
                        <PersonCell name={r.name} email={r.email} />
                      </Link>
                    </Td>
                    <Td className="text-right tabular">{r.courses}</Td>
                    <Td className="text-right tabular">
                      {r.rule_keeps_pct !== null ? (
                        <span title={`Rule: ${r.rule_name}`}>
                          {r.rule_keeps_pct}% <Badge tone="info">Rule</Badge>
                        </span>
                      ) : (
                        <>
                          {r.keeps_pct}% {r.fee_is_custom ? <Badge tone="info">Own</Badge> : null}
                        </>
                      )}
                    </Td>
                    <Td className="text-right tabular">{r.pool_share_pct === null ? '—' : `${r.pool_share_pct}%`}</Td>
                    <Td className="text-right tabular">{gbp(r.earnings_gbp_minor)}</Td>
                    <Td>
                      <StatusPill status={r.status} label={personStatus(r.status)} />
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Set commission for ${r.name}`}>
                        <Percent /> Set rate
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          {compact ? null : <LoadMore shown={rows.length} noun={rows.length === 1 ? 'instructor' : 'instructors'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />}
        </div>
      )}
      <RateDialog row={editing} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------- preview ("which rate applies?")
function RatePreview() {
  const [course, setCourse] = useState<{ id: string; title: string } | null>(null)
  const p = useCommissionPreview(course?.id ?? '')
  const source = { rule: 'a commission rule', instructor: "the instructor's own rate", default: 'the platform default' } as Record<string, string>
  return (
    <Card>
      <CardHeader title="Which rate applies?" description="Pick a course to see what a sale today would pay its instructor." />
      <CardBody className="grid gap-3">
        <TargetPicker kind="courses" label="Course to check" value={course} onChange={setCourse} />
        {course ? (
          p.error ? (
            <p className="text-sm text-danger">{(p.error as Error).message}</p>
          ) : !p.data ? (
            <Skeleton className="h-14" />
          ) : (
            <div className="animate-reveal rounded-lg bg-primary-soft p-3 text-sm text-primary-soft-text">
              <p>
                <strong className="text-lg tabular">{p.data.keeps_pct}%</strong> to {p.data.instructor ?? 'the instructor'} of {gbp(p.data.price_gbp_minor)}, from {source[p.data.source]}
                {p.data.rule_name ? ` (“${p.data.rule_name}”)` : ''}.
              </p>
            </div>
          )
        ) : null}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- settings forms
function SettingsForm({ only }: { only?: 'pool' }) {
  const o = useCommissionOverview()
  const save = useSaveCommissionSettings()
  const [form, setForm] = useState<{ keeps: string; pool: string; coupon: string; discount: boolean } | null>(null)
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  if (!o.data) return <Skeleton className="h-48" />
  const d = o.data
  const f = form ?? { keeps: String(d.default_keeps_pct), pool: String(d.pool_pct), coupon: String(d.coupon_keeps_pct), discount: d.discount_reduces_commission }
  const set = (k: keyof typeof f, v: string | boolean) => setForm({ ...f, [k]: v })
  const num = (s: string) => Number(s)
  const ok = (s: string) => s.trim() !== '' && num(s) >= 0 && num(s) <= 100
  const dirty = !!form
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (![f.keeps, f.pool, f.coupon].every(ok)) return toast.error('Rates must be between 0% and 100%.')
        save.mutate(
          only === 'pool' ? { pool_pct: num(f.pool) } : { default_keeps_pct: num(f.keeps), coupon_keeps_pct: num(f.coupon), discount_reduces_commission: f.discount },
          { onSuccess: () => (toast.success('Saved. It applies to sales from now on.'), setForm(null)), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      {only === 'pool' ? (
        <Field label="Instructors' share of subscription revenue (%)" hint="Split between instructors by the minutes learners watch their courses each month.">
          {(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.pool} onChange={(e) => set('pool', e.target.value)} />}
        </Field>
      ) : (
        <>
          <Field label="Default commission: instructor keeps (%)" hint="Given to instructors when they are approved. Instructors already approved keep their rate.">
            {(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.keeps} onChange={(e) => set('keeps', e.target.value)} />}
          </Field>
          <Field label="Sales through the instructor's own coupon: instructor keeps (%)">{(p) => <Input {...p} inputMode="decimal" className="w-32" value={f.coupon} onChange={(e) => set('coupon', e.target.value)} />}</Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <Label htmlFor="discount-impact">Discounts reduce the instructor's share</Label>
              <p className="mt-0.5 text-xs text-muted">On: the share is worked out on what the customer paid. Off: the platform absorbs its own discounts (never more than the customer paid).</p>
            </div>
            <Switch id="discount-impact" checked={f.discount} onCheckedChange={(v) => set('discount', v)} />
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty} onClick={() => setForm(null)}>
          Discard
        </Button>
        <Button type="submit" disabled={!dirty} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- overview
function Overview({ go }: { go: (t: Tab) => void }) {
  const o = useCommissionOverview()
  const d = o.data
  if (o.error) return <ErrorState message={(o.error as Error).message} onRetry={() => void o.refetch()} />
  return (
    <div className="grid gap-5">
      <section aria-label="Commission figures" className={d ? 'stagger grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 xl:grid-cols-4'}>
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <StatCard label="Default commission" value={`${d.default_keeps_pct}%`} icon={<Percent />} hint="to the instructor" />
            <KpiCard label="Platform commission (this month)" kpi={d.commissions_month} icon={<PieChart />} format={gbp} tone="success" />
            <KpiCard label="Subscription revenue pool" kpi={d.pool_month} icon={<Crown />} format={gbp} tone="info" />
            <StatCard label="Active instructors" value={d.active_instructors} icon={<Users />} tone="warning" hint={`${d.active_rules} active rules`} />
          </>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader title="Instructor commissions" action={<Button size="sm" variant="ghost" onClick={() => go('instructors')}>View all</Button>} />
          <InstructorCommissions compact />
        </Card>
        <div className="grid content-start gap-5 lg:col-span-4">
          <Card>
            <CardHeader title="Commission settings" />
            <CardBody className="grid gap-1 p-2">
              {[
                { t: 'settings' as Tab, Icon: Percent, label: 'Default commission rate', hint: "The platform's default for course sales", value: d ? `${d.default_keeps_pct}%` : '' },
                { t: 'pool' as Tab, Icon: Crown, label: 'Subscription revenue pool', hint: 'The share of subscription revenue', value: d ? `${d.pool_pct}%` : '' },
                { t: 'rules' as Tab, Icon: SlidersHorizontal, label: 'Commission rules', hint: 'By instructor, course, category or price', value: d ? String(d.active_rules) : '' },
                { t: 'settings' as Tab, Icon: ListFilter, label: 'Discount impact', hint: 'How discounts affect commissions', value: d ? (d.discount_reduces_commission ? 'Shared' : 'Platform') : '' },
              ].map((x) => (
                <button key={x.label} type="button" onClick={() => go(x.t)} className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4">
                    <x.Icon aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{x.label}</span>
                    <span className="block text-xs text-muted">{x.hint}</span>
                  </span>
                  <span className="text-sm font-semibold tabular">{x.value}</span>
                </button>
              ))}
            </CardBody>
          </Card>
          <Card className="bg-primary-soft/50">
            <CardBody className="flex gap-3 text-sm">
              <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="font-medium">About commissions</p>
                <p className="mt-1 text-muted">Set the default, customise per instructor or course, and share subscription revenue through the pool. Each sale stores its rate, so changes never rewrite past earnings.</p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export function ConsoleCommissionsPage() {
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const o = useCommissionOverview()
  return (
    <>
      <PageHeader
        title="Commission management"
        description="Commission rates, rules and subscription revenue sharing."
        actions={
          <Button onClick={() => setDraft(emptyRule(tab === 'courses' ? 'course' : 'course'))}>
            <Plus /> Add commission rule
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Commission sections" className="mb-5">
          <TabsTrigger value="overview">
            <PieChart /> Overview
          </TabsTrigger>
          <TabsTrigger value="instructors">
            <Users /> Instructor commissions
          </TabsTrigger>
          <TabsTrigger value="courses">
            <BookOpen /> Course commissions
          </TabsTrigger>
          <TabsTrigger value="rules">
            <SlidersHorizontal /> Commission rules
          </TabsTrigger>
          <TabsTrigger value="pool">
            <Crown /> Subscription revenue pool
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-0">
          <Overview go={setTab} />
        </TabsContent>
        <TabsContent value="instructors" className="pt-0">
          <Card>
            <InstructorCommissions />
          </Card>
        </TabsContent>
        <TabsContent value="courses" className="grid gap-5 pt-0 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader
              title="Course commissions"
              description="A course rule beats every other rate for that course."
              action={
                <Button size="sm" variant="secondary" onClick={() => setDraft(emptyRule('course'))}>
                  <Plus /> Add course rule
                </Button>
              }
            />
            <RulesList scope="course" onEdit={(r) => setDraft(fromRule(r))} onAdd={() => setDraft(emptyRule('course'))} />
          </Card>
          <div className="lg:col-span-4">
            <RatePreview />
          </div>
        </TabsContent>
        <TabsContent value="rules" className="grid gap-5 pt-0">
          <Card>
            <CardHeader title="Commission rules" description="Priority: course, then instructor, then category, then price band, then the instructor's own rate, then the default." />
            <RulesList scope="" onEdit={(r) => setDraft(fromRule(r))} onAdd={() => setDraft(emptyRule())} />
          </Card>
          <RatePreview />
        </TabsContent>
        <TabsContent value="pool" className="pt-0">
          <div className="grid gap-5 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader title="Subscription revenue pool" description="Personal subscriptions don't pay per course. Each month, this share of their revenue is split between instructors by the minutes learners spent on their courses." />
              <CardBody>
                <SettingsForm only="pool" />
              </CardBody>
            </Card>
            <div className="lg:col-span-5">{o.data ? <KpiCard label="Paid to instructors (last settled month)" kpi={o.data.pool_month} icon={<Crown />} format={gbp} tone="info" /> : <Skeleton className="h-[118px]" />}</div>
          </div>
        </TabsContent>
        <TabsContent value="settings" className="pt-0">
          <Card className="max-w-2xl">
            <CardHeader title="Commission settings" description="Client decisions: change them here, never in code." />
            <CardBody>
              <SettingsForm />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
      <RuleDialog draft={draft} onClose={() => setDraft(null)} />
    </>
  )
}
