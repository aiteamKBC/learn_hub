import { ArrowLeft, Coins, Gift, Info, Pencil, Plus, Search, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type PackBody,
  useAdminBonusCampaigns,
  useAdminPacks,
  useAdminRates,
  useAdminTokenAudit,
  useAdminTopUpPolicies,
  useCreateBonusCampaign,
  useCreatePack,
  useCreateRate,
  useDeletePack,
  useDistributeTokens,
  usePatchLecture,
  usePatchTokenCourse,
  usePriceTiers,
  useTokenCourse,
  useTokenCourses,
  useUpdatePack,
  useUpsertTopUpPolicy,
} from '@/features/b2c/console'
import { dateTime } from '@/features/console/money-ui'
import { count } from '@/lib/format'

/** Console > Token pricing. Packs, exchange rate, custom top-up policy, bonus campaigns and the
 * audit trail. Everything is server-authoritative; the bonus-campaign funding model is not yet
 * approved, so activation is blocked by the backend and shown here truthfully. */
export function TokenPricingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Token pricing" description="Set how learners buy and spend tokens. Every change needs a reason and is audited." />
      <Tabs defaultValue="packs">
        <TabsList>
          <TabsTrigger value="packs">Packs</TabsTrigger>
          <TabsTrigger value="courses">Course pricing</TabsTrigger>
          <TabsTrigger value="rate">Exchange rate</TabsTrigger>
          <TabsTrigger value="topup">Top-up limits</TabsTrigger>
          <TabsTrigger value="bonus">Bonus campaigns</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="packs">
          <PacksTab />
        </TabsContent>
        <TabsContent value="courses">
          <CoursesTab />
        </TabsContent>
        <TabsContent value="rate">
          <RatesTab />
        </TabsContent>
        <TabsContent value="topup">
          <TopUpTab />
        </TabsContent>
        <TabsContent value="bonus">
          <BonusTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ------------------------------------------------------------------ course / lecture token pricing
const MODE_LABEL: Record<string, string> = { manual: 'Manual per-lecture', auto_weighted: 'Auto-distributed' }

const CAP_MULTIPLE = 2 // hard block above 2× the fair (cash-equivalent) price
const SUGGEST_FACTOR = 0.8 // "Suggest" fills 20% cheaper than cash

type FairPricing = { gbp_minor: number; tokensPerPenny: number; fair: number; suggested: number; cap: number } | null

/** The fair token price for a course = its cash price × the live token rate. Everything (the
 * suggestion, the warning and the hard cap) is anchored to this so tokens track cash value. */
function computeFair(gbpMinor: number | undefined, tokensPerGbpMinor: number | undefined): FairPricing {
  if (!gbpMinor || !tokensPerGbpMinor) return null
  const fair = Math.round(gbpMinor * tokensPerGbpMinor)
  return { gbp_minor: gbpMinor, tokensPerPenny: tokensPerGbpMinor, fair, suggested: Math.round(fair * SUGGEST_FACTOR), cap: Math.round(fair * CAP_MULTIPLE) }
}

function CoursesTab() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const courses = useTokenCourses(search)

  if (selected) return <CourseEditor courseId={selected} onBack={() => setSelected(null)} />

  return (
    <Card>
      <CardHeader title="Course token pricing" description="Set a whole-course unlock price, or price individual lectures. Learners unlock with tokens." />
      <div className="p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses…" className="pl-9" aria-label="Search courses" />
        </div>
        {courses.isLoading ? (
          <Skeleton className="mt-4 h-48 rounded-lg" />
        ) : courses.error ? (
          <ErrorState message="We couldn't load courses." onRetry={() => void courses.refetch()} />
        ) : !courses.data?.items.length ? (
          <EmptyState className="mt-4" icon={<Coins />} title="No courses found" body="Try a different search." />
        ) : (
          <Table className="mt-4">
            <thead>
              <Tr>
                <Th>Course</Th>
                <Th>Mode</Th>
                <Th>Full-course price</Th>
                <Th>Lectures priced</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {courses.data.items.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.title}</Td>
                  <Td><Badge tone="neutral">{MODE_LABEL[c.token_pricing_mode] ?? c.token_pricing_mode}</Badge></Td>
                  <Td className="tabular-nums">{c.full_course_token_price != null ? `${count(c.full_course_token_price)} tokens` : <span className="text-muted">—</span>}</Td>
                  <Td className="tabular-nums">{c.lectures_priced_count}{c.materials_priced_count ? ` (+${c.materials_priced_count} materials)` : ''}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setSelected(c.id)}>Manage</Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  )
}

function CourseEditor({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const detail = useTokenCourse(courseId)
  const patch = usePatchTokenCourse()
  const tiers = usePriceTiers()
  const rates = useAdminRates()
  const [reason, setReason] = useState('')
  const [fullPrice, setFullPrice] = useState('')
  const [mode, setMode] = useState('')

  const d = detail.data
  const needReason = reason.trim().length < 3

  // Fair price anchor = course cash price (its tier's GBP pence) × live token rate (tokens/penny).
  const gbpMinor = tiers.data?.find((t) => t.id === d?.cash_price_tier_id)?.gbp_minor
  const ratePerPenny = Number(rates.data?.find((r) => r.is_current)?.tokens_per_gbp_minor ?? 0) || undefined
  const fair = computeFair(gbpMinor, ratePerPenny)

  const saveCourse = (body: Partial<{ full_course_token_price: number | null; token_pricing_mode: 'manual' | 'auto_weighted' }>) => {
    if (needReason) return toast.error('Add a reason first (it is audited).')
    // Hard cap: never let a whole-course token price exceed 2× its fair cash-equivalent.
    if ('full_course_token_price' in body && body.full_course_token_price != null && fair && body.full_course_token_price > fair.cap) {
      return toast.error(`Too high. Max ${count(fair.cap)} tokens (${CAP_MULTIPLE}× the fair price of ${count(fair.fair)}).`)
    }
    if ('full_course_token_price' in body && body.full_course_token_price != null && fair && body.full_course_token_price > fair.fair) {
      toast.warning('Heads up: this is dearer than paying cash for the course.')
    }
    patch.mutate(
      { courseId, body: { ...body, reason: reason.trim() } },
      { onSuccess: () => toast.success('Saved.'), onError: (e) => toast.error((e as Error).message) },
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft /> Back to courses</Button>
      </div>

      {detail.isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : detail.error || !d ? (
        <ErrorState message="We couldn't load this course." onRetry={() => void detail.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader title={d.title} description="Whole-course unlock and pricing mode." />
            <div className="grid gap-4 p-4">
              <Field label="Reason (required for every change)" hint="Recorded in the audit trail.">
                {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you changing this?" />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-end gap-2">
                    <Field label="Full-course unlock price (tokens)" hint="Blank = not sold whole for tokens.">
                      {(p) => <Input {...p} type="number" min="0" value={fullPrice} onChange={(e) => setFullPrice(e.target.value)} placeholder={d.full_course_token_price != null ? String(d.full_course_token_price) : 'e.g. 500'} />}
                    </Field>
                    <Button disabled={patch.isPending || needReason} onClick={() => saveCourse({ full_course_token_price: fullPrice.trim() === '' ? null : Math.max(0, parseInt(fullPrice, 10) || 0) })}>Save</Button>
                  </div>
                  {fair ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <Info className="size-3.5" />
                      Cash £{(fair.gbp_minor / 100).toFixed(2)} ≈ <strong className="text-text">{count(fair.fair)}</strong> tokens. Max {count(fair.cap)}.
                      <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFullPrice(String(fair.suggested))}>
                        Suggest {count(fair.suggested)}
                      </button>
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted">Set a cash price and token rate to get a fair-price suggestion.</p>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Field label="Per-lecture pricing mode">
                    {(p) => (
                      <NativeSelect {...p} value={mode || d.token_pricing_mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="manual">Manual per-lecture</option>
                        <option value="auto_weighted">Auto-distributed from a total</option>
                      </NativeSelect>
                    )}
                  </Field>
                  <Button variant="secondary" disabled={patch.isPending || needReason} onClick={() => saveCourse({ token_pricing_mode: (mode || d.token_pricing_mode) as 'manual' | 'auto_weighted' })}>Save</Button>
                </div>
              </div>
            </div>
          </Card>

          <DistributeCard courseId={courseId} reason={reason} needReason={needReason} fair={fair} />

          <LecturesCard courseId={courseId} detail={d} reason={reason} needReason={needReason} fullPrice={d.full_course_token_price} />
        </>
      )}
    </div>
  )
}

function DistributeCard({ courseId, reason, needReason, fair }: { courseId: string; reason: string; needReason: boolean; fair: FairPricing }) {
  const distribute = useDistributeTokens()
  const [total, setTotal] = useState('')
  const [useDuration, setUseDuration] = useState(true) // weight by length by default: fairer, structured
  const [preview, setPreview] = useState<{ lecture_id: string; title: string; current_price: number | null; allocated_price: number }[] | null>(null)

  const run = (dry: boolean) => {
    const n = parseInt(total, 10)
    if (!Number.isFinite(n) || n < 0) return toast.error('Enter a total number of tokens.')
    if (fair && n > fair.cap) return toast.error(`Too high. Max ${count(fair.cap)} tokens (${CAP_MULTIPLE}× the fair price of ${count(fair.fair)}).`)
    if (needReason) return toast.error('Add a reason first (it is audited).')
    distribute.mutate(
      { courseId, body: { total_tokens: n, dry_run: dry, reason: reason.trim(), weights_config: { lecture_types: {}, use_duration: useDuration } } as never },
      {
        onSuccess: (r: { allocation: typeof preview; applied: boolean }) => {
          setPreview(r.allocation)
          toast.success(r.applied ? 'Prices applied to lectures.' : 'Preview ready — review, then apply.')
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  return (
    <Card>
      <CardHeader title="Auto-distribute a total across lectures" description="Split a token budget over the course's lectures. Preview first, then apply." />
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Total tokens for the course">
            {(p) => <Input {...p} type="number" min="0" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={fair ? String(fair.suggested) : 'e.g. 1000'} className="max-w-[12rem]" />}
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={useDuration} onCheckedChange={(v) => setUseDuration(!!v)} /> Weight by lecture length
          </label>
          <Button variant="secondary" loading={distribute.isPending} disabled={needReason} onClick={() => run(true)}><Wand2 /> Preview</Button>
          <Button loading={distribute.isPending} disabled={needReason || !preview} onClick={() => run(false)}>Apply</Button>
        </div>
        {fair ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <Info className="size-3.5" /> Fair total ≈ {count(fair.fair)} tokens (max {count(fair.cap)}).
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTotal(String(fair.suggested))}>Use suggested {count(fair.suggested)}</button>
          </p>
        ) : null}
        {preview ? (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr><Th>Lecture</Th><Th>Current</Th><Th>New price</Th></Tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <Tr key={r.lecture_id}>
                    <Td>{r.title}</Td>
                    <Td className="tabular-nums text-muted">{r.current_price != null ? count(r.current_price) : '—'}</Td>
                    <Td className="tabular-nums font-medium">{count(r.allocated_price)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

type CourseDetailData = NonNullable<ReturnType<typeof useTokenCourse>['data']>

function LecturesCard({ courseId: _courseId, detail, reason, needReason, fullPrice }: { courseId: string; detail: CourseDetailData; reason: string; needReason: boolean; fullPrice: number | null }) {
  const patchLecture = usePatchLecture()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // Sum of the lectures' own prices — buying lectures one by one should cost at least the
  // whole-course price, otherwise the bundle is pointless.
  const lectureSum = detail.sections.reduce((sum, s) => sum + s.lectures.reduce((a, l) => a + (l.token_price ?? 0), 0), 0)
  const underfull = fullPrice != null && lectureSum > 0 && lectureSum < fullPrice

  const save = (lectureId: string, current: number | null) => {
    if (needReason) return toast.error('Add a reason first (it is audited).')
    const raw = drafts[lectureId]
    const value = raw === undefined ? current : raw.trim() === '' ? null : Math.max(0, parseInt(raw, 10) || 0)
    patchLecture.mutate(
      { lectureId, body: { token_price: value, reason: reason.trim() } },
      { onSuccess: () => toast.success('Lecture price saved.'), onError: (e) => toast.error((e as Error).message) },
    )
  }

  if (!detail.sections.length) return <Card><CardHeader title="Lectures" /><p className="p-4 text-sm text-muted">This course has no published lectures to price.</p></Card>

  return (
    <Card>
      <CardHeader title="Per-lecture prices" description="Set or clear a token price on individual lectures (used in Manual mode)." />
      <div className="space-y-4 p-4">
        {underfull ? (
          <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            <Info className="size-4 shrink-0" />
            The lectures add up to {count(lectureSum)} tokens — cheaper than the whole-course price ({count(fullPrice!)}). Learners could unlock everything lecture-by-lecture for less than the bundle.
          </p>
        ) : null}
        {detail.sections.map((s) => (
          <div key={s.id}>
            <p className="mb-2 text-sm font-semibold">{s.title}</p>
            <Table>
              <tbody>
                {s.lectures.map((l) => (
                  <Tr key={l.id}>
                    <Td className="font-medium">{l.title}{l.is_free_preview ? <Badge tone="info" className="ml-2">Free preview</Badge> : null}</Td>
                    <Td className="w-40">
                      <Input
                        type="number"
                        min="0"
                        aria-label={`Token price for ${l.title}`}
                        value={drafts[l.id] ?? (l.token_price != null ? String(l.token_price) : '')}
                        onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                        placeholder="—"
                      />
                    </Td>
                    <Td className="w-24 text-right">
                      <Button size="sm" variant="secondary" loading={patchLecture.isPending} disabled={needReason} onClick={() => save(l.id, l.token_price)}>Save</Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ packs
function PacksTab() {
  const packs = useAdminPacks()
  const del = useDeletePack()
  const [edit, setEdit] = useState<PackBody & { id?: string }>()

  if (packs.isLoading) return <Skeleton className="h-48 rounded-lg" />
  if (packs.error) return <ErrorState message="We couldn't load packs." onRetry={() => void packs.refetch()} />

  return (
    <Card>
      <CardHeader title="Token packs" action={<PackDialog initial={edit} onClose={() => setEdit(undefined)} trigger={<Button size="sm"><Plus /> New pack</Button>} />} />
      {!packs.data?.length ? (
        <EmptyState className="m-4" icon={<Coins />} title="No packs yet" body="Create a pack learners can buy." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <Tr>
                <Th>Name</Th>
                <Th>Tokens</Th>
                <Th>Active</Th>
                <Th>Order</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {packs.data.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="tabular-nums">{count(p.token_amount)}</Td>
                  <Td>
                    <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Hidden'}</Badge>
                  </Td>
                  <Td className="tabular-nums">{p.sort_order}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <PackDialog
                        initial={{ id: p.id, name: p.name, token_amount: p.token_amount, price_tier_id: p.price_tier_id, is_active: p.is_active, sort_order: p.sort_order, reason: '' }}
                        onClose={() => {}}
                        trigger={<Button size="icon-sm" variant="ghost" aria-label="Edit pack"><Pencil /></Button>}
                      />
                      <Button size="icon-sm" variant="ghost" aria-label="Delete pack" onClick={() => del.mutate(p.id, { onSuccess: () => toast.success('Pack removed'), onError: (e) => toast.error((e as Error).message) })}>
                        <Trash2 />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

function PackDialog({ initial, trigger, onClose }: { initial?: PackBody & { id?: string }; trigger: React.ReactNode; onClose: () => void }) {
  const tiers = usePriceTiers()
  const create = useCreatePack()
  const update = useUpdatePack()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [tokens, setTokens] = useState(String(initial?.token_amount ?? ''))
  const [tier, setTier] = useState(initial?.price_tier_id ?? '')
  const [active, setActive] = useState(initial?.is_active ?? true)
  const [order, setOrder] = useState(String(initial?.sort_order ?? 0))
  const [reason, setReason] = useState('')

  const tokensN = parseInt(tokens, 10)
  const valid = name.trim() && Number.isFinite(tokensN) && tokensN > 0 && tier && reason.trim().length >= 3

  const submit = () => {
    if (!valid) return
    const body: PackBody = { name: name.trim(), token_amount: tokensN, price_tier_id: tier, is_active: active, sort_order: parseInt(order, 10) || 0, reason: reason.trim() }
    const opts = {
      onSuccess: () => {
        toast.success(initial?.id ? 'Pack updated' : 'Pack created')
        setOpen(false)
        onClose()
      },
      onError: (e: unknown) => toast.error((e as Error).message),
    }
    if (initial?.id) update.mutate({ packId: initial.id, body }, opts)
    else create.mutate(body, opts)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={initial?.id ? 'Edit pack' : 'New token pack'}>
        <div className="space-y-4">
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Starter pack" />}</Field>
          <Field label="Tokens">{(p) => <Input {...p} type="number" min="1" value={tokens} onChange={(e) => setTokens(e.target.value)} />}</Field>
          <Field label="Price tier" hint="The cash price charged, from the pricing catalogue.">
            {(p) =>
              tiers.isLoading ? (
                <Skeleton className="h-10 rounded-md" />
              ) : (
                <NativeSelect {...p} value={tier} onChange={(e) => setTier(e.target.value)}>
                  <option value="">Choose a tier…</option>
                  {tiers.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              )
            }
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sort order">{(p) => <Input {...p} type="number" value={order} onChange={(e) => setOrder(e.target.value)} />}</Field>
            <label className="mt-7 flex items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} /> Active
            </label>
          </div>
          <Field label="Reason (required)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change?" />}</Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button disabled={!valid} loading={create.isPending || update.isPending} onClick={submit}>
              {initial?.id ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ rates
function RatesTab() {
  const rates = useAdminRates()
  const create = useCreateRate()
  const [tpg, setTpg] = useState('')
  const [from, setFrom] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const valid = parseFloat(tpg) > 0 && from && reason.trim().length >= 3

  const submit = () => {
    if (!valid) return
    create.mutate(
      { tokens_per_gbp_minor: tpg, effective_from: new Date(from).toISOString(), notes: notes.trim(), reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('New rate scheduled')
          setTpg('')
          setFrom('')
          setNotes('')
          setReason('')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'RATE_EFFECTIVE_FROM_PAST') toast.error('The effective-from time must be in the future.')
          else toast.error((e as Error).message)
        },
      },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Exchange rate" description="Tokens granted per 1 penny (GBP minor) spent." />
        {rates.isLoading ? (
          <Skeleton className="m-4 h-32 rounded-lg" />
        ) : rates.error ? (
          <ErrorState message="Couldn't load rates." onRetry={() => void rates.refetch()} />
        ) : !rates.data?.length ? (
          <EmptyState className="m-4" icon={<Coins />} title="No rate set" body="Custom top-ups are unavailable to learners until a rate exists." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Tokens / penny</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Status</Th>
                </Tr>
              </thead>
              <tbody>
                {rates.data.map((r) => (
                  <Tr key={r.id}>
                    <Td className="tabular-nums">{r.tokens_per_gbp_minor}</Td>
                    <Td className="whitespace-nowrap text-muted">{dateTime(r.effective_from)}</Td>
                    <Td className="whitespace-nowrap text-muted">{r.effective_to ? dateTime(r.effective_to) : '—'}</Td>
                    <Td>{r.is_current ? <Badge tone="success">Current</Badge> : <Badge tone="neutral">Scheduled/past</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Schedule a new rate" />
        <div className="space-y-4 p-4">
          <Field label="Tokens per penny (GBP minor)" hint="e.g. 1 means 1 token per £0.01.">{(p) => <Input {...p} type="number" step="0.01" min="0" value={tpg} onChange={(e) => setTpg(e.target.value)} />}</Field>
          <Field label="Effective from" hint="Must be in the future.">{(p) => <Input {...p} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Notes">{(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <Field label="Reason (required)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button disabled={!valid} loading={create.isPending} onClick={submit}>
            Schedule rate
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ top-up policies
function TopUpTab() {
  const policies = useAdminTopUpPolicies()
  const upsert = useUpsertTopUpPolicy()
  const [currency, setCurrency] = useState('GBP')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [active, setActive] = useState(true)
  const [reason, setReason] = useState('')
  const minN = parseInt(min, 10)
  const maxN = parseInt(max, 10)
  const valid = currency.length === 3 && minN > 0 && maxN >= minN && reason.trim().length >= 3

  const submit = () => {
    if (!valid) return
    upsert.mutate(
      { currency: currency.toUpperCase(), body: { min_minor: minN, max_minor: maxN, is_active: active, reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success('Top-up policy saved')
          setReason('')
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Top-up limits" description="Minimum and maximum custom top-up per currency (in minor units)." />
        {policies.isLoading ? (
          <Skeleton className="m-4 h-32 rounded-lg" />
        ) : !policies.data?.length ? (
          <EmptyState className="m-4" icon={<Info />} title="No policies configured" body="Without a policy, a currency has no custom-top-up limits." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Currency</Th>
                  <Th>Min (minor)</Th>
                  <Th>Max (minor)</Th>
                  <Th>Status</Th>
                </Tr>
              </thead>
              <tbody>
                {policies.data.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.currency}</Td>
                    <Td className="tabular-nums">{count(p.min_minor)}</Td>
                    <Td className="tabular-nums">{count(p.max_minor)}</Td>
                    <Td>{p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Off</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Set a policy" description="Saving replaces the policy for that currency." />
        <div className="space-y-4 p-4">
          <Field label="Currency (ISO code)">{(p) => <Input {...p} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />}</Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min (minor)">{(p) => <Input {...p} type="number" min="1" value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
            <Field label="Max (minor)">{(p) => <Input {...p} type="number" min="1" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} /> Active
          </label>
          <Field label="Reason (required)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button disabled={!valid} loading={upsert.isPending} onClick={submit}>
            Save policy
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ bonus campaigns (activation backend-gated)
function BonusTab() {
  const campaigns = useAdminBonusCampaigns()
  const create = useCreateBonusCampaign()
  const [name, setName] = useState('')
  const [tokens, setTokens] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [reason, setReason] = useState('')
  const valid = name.trim() && parseInt(tokens, 10) > 0 && starts && ends && reason.trim().length >= 3

  const submit = () => {
    if (!valid) return
    create.mutate(
      {
        name: name.trim(),
        condition_type: 'signup',
        condition_value: {},
        bonus_tokens: parseInt(tokens, 10),
        bonus_percent: null,
        bonus_expiry_days: null,
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
        is_active: false, // activation is blocked until the funding model is approved (F02)
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Campaign saved as a draft')
          setName('')
          setTokens('')
          setStarts('')
          setEnds('')
          setReason('')
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-warning/40 bg-warning-soft/30">
        <div className="flex items-start gap-3 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <strong>Activation is not available yet.</strong> The bonus-token funding model (F02) hasn't been approved, so the backend keeps every campaign inactive. You can draft
            campaigns here; they won't grant tokens until a funding model is set.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Campaigns" />
        {campaigns.isLoading ? (
          <Skeleton className="m-4 h-32 rounded-lg" />
        ) : !campaigns.data?.length ? (
          <EmptyState className="m-4" icon={<Gift />} title="No campaigns" body="Draft a bonus campaign below." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Trigger</Th>
                  <Th>Bonus</Th>
                  <Th>Window</Th>
                  <Th>Status</Th>
                </Tr>
              </thead>
              <tbody>
                {campaigns.data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td className="capitalize">{c.condition_type}</Td>
                    <Td className="tabular-nums">{c.bonus_tokens ? `${count(c.bonus_tokens)} tokens` : c.bonus_percent ? `${c.bonus_percent}%` : '—'}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {dateTime(c.starts_at)} → {dateTime(c.ends_at)}
                    </Td>
                    <Td>{c.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Draft a campaign" description="Saved inactive (activation blocked by F02)." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Bonus tokens">{(p) => <Input {...p} type="number" min="1" value={tokens} onChange={(e) => setTokens(e.target.value)} />}</Field>
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />}</Field>
          <Field label="Ends">{(p) => <Input {...p} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />}</Field>
          <div className="sm:col-span-2">
            <Field label="Reason (required)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </div>
          <div className="sm:col-span-2">
            <Button disabled={!valid} loading={create.isPending} onClick={submit}>
              Save draft campaign
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ audit
function AuditTab() {
  const [page, setPage] = useState(1)
  const audit = useAdminTokenAudit(page)
  if (audit.isLoading) return <Skeleton className="h-48 rounded-lg" />
  if (audit.error) return <ErrorState message="Couldn't load the audit trail." onRetry={() => void audit.refetch()} />
  const pages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.page_size)) : 1
  return (
    <Card>
      <CardHeader title="Audit trail" description="Every token-pricing change, newest first." />
      {!audit.data?.items.length ? (
        <EmptyState className="m-4" icon={<Info />} title="Nothing yet" body="Pricing changes will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <Tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Target</Th>
              </Tr>
            </thead>
            <tbody>
              {audit.data.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-muted">{dateTime(a.created_at)}</Td>
                  <Td className="font-medium">{a.action}</Td>
                  <Td className="text-muted">
                    {a.target_type} {a.target_id ? `· ${String(a.target_id).slice(0, 8)}` : ''}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between p-4 text-sm">
        <span className="text-muted">
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
            Next
          </Button>
        </div>
      </div>
    </Card>
  )
}
