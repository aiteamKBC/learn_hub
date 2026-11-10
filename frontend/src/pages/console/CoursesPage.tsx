import { Archive, ArrowDown, ArrowUp, BarChart3, BookOpen, Clock, Copy, ExternalLink, Eye, EyeOff, FileText, FolderTree, History, LayoutList, MoreHorizontal, Pencil, Plus, Send, Star, Tag, Trash2, Undo2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox, Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSetCourseTemplate, useCertTemplates } from '@/features/console/certificates'
import {
  type BulkAction,
  type ConsoleCategory,
  type ConsoleCourseDetail,
  type ConsoleCourseRow,
  type CourseTab,
  type StatusAction,
  useBulkCourses,
  useConsoleCategories,
  useConsoleCourse,
  useConsoleCourses,
  useCourseStatus,
  useCreateCategory,
  useCreateCompanyCourse,
  useDuplicateCourse,
  useReorderCategories,
  useSetCoursePrice,
  useUpdateCategory,
  useUpdateCourse,
} from '@/features/console/courses'
import { SearchBox, Toolbar } from '@/features/console/money-ui'
import { ConfirmDialog, DetailSheet, gbp, InfoRow, LoadMore, StatusPill, useParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { duration, shortDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

const TABS = ['all', 'company', 'instructor', 'categories', 'archived'] as const
type PageTab = (typeof TABS)[number]
const TAB_LABEL: Record<PageTab, string> = { all: 'All courses', company: 'Company courses', instructor: 'Instructor courses', categories: 'Categories', archived: 'Archived courses' }
const STATUS_LABEL: Record<string, string> = { published: 'Published', draft: 'Draft', unlisted: 'Unpublished', archived: 'Archived', pending: 'Pending approval' }
const OWNERSHIP: Record<string, string> = { platform: 'Company course', instructor: 'Instructor course', organization: 'Company private' }

function priceText(c: { is_free: boolean; price_gbp_minor?: number | null }) {
  return c.is_free ? 'Free' : c.price_gbp_minor ? gbp(c.price_gbp_minor) : '—'
}

function CourseStatusPill({ c }: { c: ConsoleCourseRow }) {
  if (c.deleted) return <StatusPill status="archived" label="Deleted" />
  if (c.in_review) return <StatusPill status="pending" label="Pending approval" />
  return <StatusPill status={c.status} label={STATUS_LABEL[c.status]} />
}

// ---------------------------------------------------------------- dialogs
function CompanyCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const cats = useConsoleCategories()
  const create = useCreateCompanyCourse()
  const navigate = useNavigate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create company course" description="A course owned by the platform. It opens in the course builder; company courses publish without review.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              { title: title.trim(), category_id: category || undefined },
              { onSuccess: (r) => (toast.success('Course created'), onOpenChange(false), navigate(`/studio/courses/${r.id}`)), onError: (err) => toast.error((err as Error).message) },
            )
          }}
        >
          <Field label="Course title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />}</Field>
          <Field label="Category">
            {(p) => (
              <NativeSelect {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">No category yet</option>
                {cats.data?.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending} disabled={title.trim().length < 3}>Create and open builder</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CategoryPicker({ open, onOpenChange, count, onPick, loading }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; onPick: (id: string) => void; loading: boolean }) {
  const cats = useConsoleCategories()
  const [value, setValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Change category" description={`For ${count} selected ${count === 1 ? 'course' : 'courses'}.`}>
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), value && onPick(value))}>
          <Field label="New category">
            {(p) => (
              <NativeSelect {...p} value={value} onChange={(e) => setValue(e.target.value)} required>
                <option value="">Choose a category</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}{c.is_active ? '' : ' (hidden)'}</option>)}
              </NativeSelect>
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={!value}>Change category</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- course detail panel
const LANG_FALLBACK: Record<string, string> = { en: 'English (UK)' }

function PricingAccess({ d, languages }: { d: ConsoleCourseDetail; languages: { value: string; label: string }[] }) {
  const update = useUpdateCourse(d.id)
  const price = useSetCoursePrice(d.id)
  const cats = useConsoleCategories()
  const templates = useCertTemplates()
  const setTemplate = useSetCourseTemplate()
  const [days, setDays] = useState(d.access_days ? String(d.access_days) : '')
  useEffect(() => setDays(d.access_days ? String(d.access_days) : ''), [d.access_days])
  const save = (body: Parameters<typeof update.mutate>[0], msg = 'Saved') => update.mutate(body, { onSuccess: () => toast.success(msg), onError: (e) => toast.error((e as Error).message) })
  const sold = d.ownership !== 'organization'
  return (
    <div className="grid gap-4">
      {sold ? (
        <Field label="Price" hint="Prices in other currencies follow the tier (Pricing).">
          {(p) => (
            <NativeSelect
              {...p}
              value={d.is_free ? 'free' : (d.price_tier_id ?? '')}
              disabled={price.isPending}
              onChange={(e) => price.mutate(e.target.value === 'free' ? { free: true } : { free: false, tier_id: e.target.value }, { onSuccess: () => toast.success('Price changed'), onError: (err) => toast.error((err as Error).message) })}
            >
              {!d.price_tier_id && !d.is_free ? <option value="">No price set</option> : null}
              <option value="free">Free</option>
              {d.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} · {gbp(t.gbp_minor)}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Category">
        {(p) => (
          <NativeSelect {...p} value={d.category_id ?? ''} onChange={(e) => save({ category_id: e.target.value || null }, 'Category changed')}>
            <option value="">No category</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Language">
        {(p) => (
          <NativeSelect {...p} value={d.language} onChange={(e) => save({ language: e.target.value }, 'Language changed')}>
            {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </NativeSelect>
        )}
      </Field>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Access duration</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={d.access_days ? 'secondary' : 'soft'} onClick={() => save({ lifetime_access: true }, 'Lifetime access')}>Lifetime access</Button>
          <form className="flex items-center gap-2" onSubmit={(e) => (e.preventDefault(), Number(days) >= 1 && save({ access_days: Number(days) }, 'Access duration saved'))}>
            <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-24" aria-label="Access in days" placeholder="Days" />
            <Button size="sm" type="submit" variant="secondary" disabled={!days}>Set days</Button>
          </form>
        </div>
        <p className="text-[12.5px] text-muted">New buyers get {d.access_days ? `${d.access_days} days` : 'lifetime'} access. People who already have it keep what they had.</p>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Included in personal subscriptions<span className="block text-[12.5px] text-muted">{d.plans.length ? `Plans: ${d.plans.map((p) => p.name).join(', ')}` : 'In no plan at the moment.'}</span></span>
        <Switch checked={d.in_subscription} onCheckedChange={(v) => save({ in_subscription: v }, v ? 'Included in subscriptions' : 'Removed from subscriptions')} aria-label="Included in personal subscriptions" />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Included in business plans</span>
        <Switch checked={d.in_business} onCheckedChange={(v) => save({ in_business: v }, 'Saved')} aria-label="Included in business plans" />
      </label>
      <Field label="Certificate template" hint={`Now drawn with: ${d.certificate_template ?? 'no template'}`}>
        {(p) => (
          <NativeSelect {...p} defaultValue="" onChange={(e) => e.target.value && setTemplate.mutate({ courseId: d.id, templateId: e.target.value === 'default' ? null : e.target.value }, { onSuccess: () => toast.success('Certificate template changed'), onError: (err) => toast.error((err as Error).message) })}>
            <option value="">Choose to change…</option>
            <option value="default">Platform default</option>
            {templates.data?.filter((t) => t.status === 'active').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        )}
      </Field>
    </div>
  )
}

function CourseDetail({ id, languages, onClose }: { id: string; languages: { value: string; label: string }[]; onClose: () => void }) {
  const { data: d, error, refetch } = useConsoleCourse(id)
  const status = useCourseStatus(id)
  const dup = useDuplicateCourse()
  const [tab, setTab] = useState('overview')
  const [ask, setAsk] = useState<StatusAction | null>(null)
  const [, setOpenId] = useParam('course')
  useEffect(() => setTab('overview'), [id])
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (!d) return <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
  const run = (action: StatusAction, reason = '') =>
    status.mutate({ action, reason }, { onSuccess: () => (toast.success(action === 'unpublish' ? 'Course unpublished. The instructor has been told.' : action === 'archive' ? 'Course archived' : 'Course published'), setAsk(null)), onError: (e) => toast.error((e as Error).message) })
  const statusValue = d.deleted ? 'deleted' : d.status
  const langLabel = languages.find((l) => l.value === d.language)?.label ?? LANG_FALLBACK[d.language] ?? d.language
  const editable = d.ownership === 'platform'
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <CourseThumb src={d.thumbnail_url} title={d.title} category={d.category} className="h-16 w-24 shrink-0 rounded-md" />
        <div className="min-w-0">
          <p className="font-semibold break-words">{d.title}</p>
          <p className="text-[13px] text-muted">By {d.owner_name}</p>
          <div className="mt-1"><CourseStatusPill c={d} /></div>
        </div>
        {d.status === 'published' ? (
          <Button asChild size="sm" variant="secondary" className="ml-auto"><Link to={`/courses/${d.slug}`}><ExternalLink /> View on site</Link></Button>
        ) : null}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Course details">
          <TabsTrigger value="overview"><Eye /> Overview</TabsTrigger>
          <TabsTrigger value="content"><LayoutList /> Content</TabsTrigger>
          <TabsTrigger value="pricing"><Tag /> Pricing &amp; access</TabsTrigger>
          <TabsTrigger value="performance"><BarChart3 /> Performance</TabsTrigger>
          <TabsTrigger value="versions"><History /> Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          {d.subtitle ? <p className="text-sm text-muted">{d.subtitle}</p> : null}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border p-3"><p className="text-lg font-semibold tabular">{d.performance.enrolments.toLocaleString('en-GB')}</p><p className="text-[12px] text-muted">Enrolments</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-lg font-semibold tabular">{d.rating_avg.toFixed(1)}</p><p className="text-[12px] text-muted">({d.rating_count} reviews)</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-lg font-semibold tabular">{gbp(d.performance.revenue_gbp_minor)}</p><p className="text-[12px] text-muted">Total sales</p></div>
          </div>
          <div>
            <InfoRow label="Ownership">{OWNERSHIP[d.ownership]} ({d.instructors.join(', ') || d.owner_name})</InfoRow>
            <InfoRow label="Category">{d.category ?? 'None'}</InfoRow>
            <InfoRow label="Price">{priceText(d)}</InfoRow>
            <InfoRow label="Subscription inclusion">{d.in_subscription ? 'Included in subscriptions' : 'Not included'}</InfoRow>
            <InfoRow label="Access duration">{d.access_days ? `${d.access_days} days` : 'Lifetime access'}</InfoRow>
            <InfoRow label="Language">{langLabel}</InfoRow>
            <InfoRow label="Status">
              <NativeSelect
                aria-label="Course status"
                className="h-8 w-40 text-[13px]"
                value={statusValue}
                disabled={d.deleted || status.isPending}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'unlisted') setAsk('unpublish')
                  else if (v === 'archived') setAsk('archive')
                  else if (v === 'published') run(d.status === 'draft' ? 'publish' : 'relist')
                }}
              >
                <option value="published">Published</option>
                <option value="unlisted">Unpublished</option>
                <option value="archived">Archived</option>
                {d.status === 'draft' ? <option value="draft">Draft</option> : null}
                {d.deleted ? <option value="deleted">Deleted</option> : null}
              </NativeSelect>
            </InfoRow>
          </div>
        </TabsContent>
        <TabsContent value="content">
          {d.sections.length ? (
            <ol className="grid gap-2">
              {d.sections.map((s, i) => (
                <li key={`${s.title}-${i}`} className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate"><span className="text-muted">Section {i + 1}: </span>{s.title}</span>
                  <span className="shrink-0 text-muted tabular">{s.lessons} lessons · {duration(s.duration_sec)}</span>
                </li>
              ))}
            </ol>
          ) : <EmptyState icon={<FileText />} title="No content yet" />}
        </TabsContent>
        <TabsContent value="pricing"><PricingAccess d={d} languages={languages} /></TabsContent>
        <TabsContent value="performance">
          <InfoRow label="Enrolments">{d.performance.enrolments.toLocaleString('en-GB')}</InfoRow>
          <InfoRow label="New in the last 30 days">{d.performance.enrolments_30d.toLocaleString('en-GB')}</InfoRow>
          <InfoRow label="Learning now">{d.performance.active.toLocaleString('en-GB')}</InfoRow>
          <InfoRow label="Completed">{d.performance.completed.toLocaleString('en-GB')} ({d.performance.completion_pct}%)</InfoRow>
          <InfoRow label="Rating"><Rating value={d.performance.rating_avg} count={d.performance.rating_count} /></InfoRow>
          <InfoRow label="Sales">{d.performance.sales.toLocaleString('en-GB')}</InfoRow>
          <InfoRow label="Revenue (after refunds)">{gbp(d.performance.revenue_gbp_minor)}</InfoRow>
          <InfoRow label="Refunds">{d.performance.refunds}</InfoRow>
          <Button asChild variant="secondary" size="sm" className="mt-3"><Link to="/console/reports?tab=courses"><BarChart3 /> Course reports</Link></Button>
        </TabsContent>
        <TabsContent value="versions">
          <ol className="grid gap-2">
            {d.versions.map((v) => (
              <li key={v.id} className="rounded-md border border-border px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Version {v.number}</span><StatusPill status={v.status} />{v.is_major_change ? <Badge tone="warning">Major</Badge> : null}</div>
                <p className="mt-0.5 text-muted">{v.published_at ? `Live from ${shortDate(v.published_at)}` : v.submitted_at ? `Submitted ${shortDate(v.submitted_at)}` : 'Not submitted'}</p>
                {v.review_notes ? <p className="mt-1">Reviewer: {v.review_notes}</p> : null}
              </li>
            ))}
          </ol>
          {d.versions.some((v) => v.status === 'in_review') ? <Button asChild size="sm" className="mt-3"><Link to={`/console/approvals?item=${d.versions.find((v) => v.status === 'in_review')!.id}`}><Send /> Open the review</Link></Button> : null}
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {editable ? (
          <Button asChild variant="secondary" size="sm"><Link to={`/studio/courses/${d.id}`}><Pencil /> Edit course</Link></Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setTab('pricing')}><Pencil /> Edit course</Button>
        )}
        <Button variant="secondary" size="sm" loading={dup.isPending} onClick={() => dup.mutate(d.id, { onSuccess: (r) => (toast.success('Copy created as a draft'), setOpenId(r.id)), onError: (e) => toast.error((e as Error).message) })}><Copy /> Duplicate</Button>
        <Button variant="secondary" size="sm" onClick={() => setTab('versions')}><History /> Version history</Button>
        {d.status !== 'archived' && !d.deleted ? <Button variant="secondary" size="sm" onClick={() => setAsk('archive')}><Archive /> Archive</Button> : null}
        {(d.status === 'unlisted' || d.status === 'archived') && d.has_live_version && !d.deleted ? <Button size="sm" loading={status.isPending} onClick={() => run('relist')}><Undo2 /> Relist</Button> : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      <ConfirmDialog open={ask === 'unpublish'} onOpenChange={(o) => !o && setAsk(null)} title={`Unpublish "${d.title}"?`} body="It leaves the marketplace. Learners who have it keep access. The instructor sees your reason." confirmLabel="Unpublish" reason="required" loading={status.isPending} onConfirm={(r) => run('unpublish', r)} />
      <ConfirmDialog open={ask === 'archive'} onOpenChange={(o) => !o && setAsk(null)} title={`Archive "${d.title}"?`} body="It is hidden everywhere except for learners who already have it. You can relist it later." confirmLabel="Archive" loading={status.isPending} onConfirm={() => run('archive')} />
    </div>
  )
}

// ---------------------------------------------------------------- list
function CourseList({ tab }: { tab: CourseTab }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const term = useDebounced(q, 300)
  const list = useConsoleCourses({ tab, status, category, q: term })
  const cats = useConsoleCategories()
  const bulk = useBulkCourses()
  const [openId, setOpenId] = useParam('course')
  const [selected, setSelected] = useState<string[]>([])
  const [ask, setAsk] = useState<BulkAction | null>(null)
  useEffect(() => setSelected([]), [tab, status, category, term])
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const first = list.data?.pages[0]
  const k = first?.kpis
  const languages = first?.languages ?? []
  const allOn = rows.length > 0 && rows.every((r) => selected.includes(r.id))
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const runBulk = (action: BulkAction, extra: { reason?: string; category_id?: string } = {}, ids = selected) =>
    bulk.mutate(
      { ids, action, ...extra },
      {
        onSuccess: (r) => {
          if (r.done) toast.success(`${r.done} ${r.done === 1 ? 'course' : 'courses'} updated`)
          r.failed.forEach((f) => toast.error(`${f.title}: ${f.message}`))
          setAsk(null)
          setSelected([])
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )

  return (
    <div className="grid gap-4">
      <section aria-label="Course figures" className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5', k && 'stagger')}>
        {!k ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[110px]" />)
        ) : (
          <>
            <StatCard label="Total courses" value={k.total} icon={<BookOpen />} />
            <StatCard label="Published" value={k.published} icon={<Eye />} tone="success" />
            <StatCard label="Pending approval" value={k.pending} icon={<Clock />} tone="warning" hint={k.pending ? <Link to="/console/approvals" className="text-primary hover:underline">Review now</Link> : undefined} />
            <StatCard label="Drafts" value={k.drafts} icon={<FileText />} tone="info" />
            <StatCard label="Archived" value={k.archived} icon={<Archive />} tone="danger" />
          </>
        )}
      </section>
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} label="Search courses" placeholder="Search by title, instructor or category" className="sm:max-w-sm" />
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full sm:w-48">
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
          </NativeSelect>
        </Toolbar>
        {selected.length ? (
          <div className="flex animate-reveal flex-wrap items-center gap-2 border-y border-border bg-primary-soft/40 px-5 py-2.5" role="toolbar" aria-label="Bulk actions">
            <span className="mr-1 text-[13px] font-medium tabular">{selected.length} selected</span>
            <Button size="sm" variant="secondary" loading={bulk.isPending && bulk.variables?.action === 'publish'} onClick={() => runBulk('publish')}><Send /> Publish</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsk('unpublish')}><EyeOff /> Unpublish</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsk('archive')}><Archive /> Archive</Button>
            <Button size="sm" variant="secondary" loading={bulk.isPending && bulk.variables?.action === 'duplicate'} onClick={() => runBulk('duplicate')}><Copy /> Duplicate</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsk('category')}><Tag /> Change category</Button>
            <Button size="sm" variant="secondary" className="border-danger/40 text-danger hover:bg-danger-soft" onClick={() => setAsk('delete')}><Trash2 /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </div>
        ) : null}
        {list.error ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<BookOpen />} title="No courses match" body="Try another filter or search." />
        ) : (
          <>
            {/* phone: cards */}
            <ul className="stagger grid gap-2 p-3 md:hidden">
              {rows.map((c) => (
                <li key={c.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} className="mt-1" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(c.id)}>
                    <p className="font-medium break-words">{c.title}</p>
                    <p className="text-[12.5px] text-muted">{c.owner_name} · {c.category ?? 'No category'}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]"><CourseStatusPill c={c} /><span className="tabular">{priceText(c)}</span><span className="text-muted">{c.enrolments} enrolled</span></div>
                  </button>
                </li>
              ))}
            </ul>
            {/* desktop: table */}
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-10"><Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? rows.map((r) => r.id) : [])} aria-label="Select every course shown" /></Th>
                    <Th>Course</Th>
                    <Th className="hidden lg:table-cell">Owner</Th>
                    <Th className="hidden xl:table-cell">Category</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="hidden lg:table-cell">Subscription</Th>
                    <Th className="text-right">Enrolments</Th>
                    <Th className="hidden xl:table-cell">Rating</Th>
                    <Th>Status</Th>
                    <Th className="w-12"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {rows.map((c) => (
                    <Tr key={c.id} className={cn(selected.includes(c.id) && 'bg-primary-soft/30')}>
                      <Td><Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} /></Td>
                      <Td>
                        <button type="button" onClick={() => setOpenId(c.id)} className="flex items-center gap-3 text-left hover:text-primary focus-visible:outline-none focus-visible:underline">
                          <CourseThumb src={c.thumbnail_url} title={c.title} category={c.category} className="h-9 w-14 shrink-0 rounded" />
                          <span className="line-clamp-2 max-w-[16rem] font-medium">{c.title}</span>
                        </button>
                      </Td>
                      <Td className="hidden text-[13px] lg:table-cell">{c.owner_name}</Td>
                      <Td className="hidden text-[13px] xl:table-cell">{c.category ?? '—'}</Td>
                      <Td className="text-right tabular">{priceText(c)}</Td>
                      <Td className="hidden lg:table-cell">{c.in_subscription ? <Badge tone="success">Included</Badge> : <Badge>Not included</Badge>}</Td>
                      <Td className="text-right tabular">{c.enrolments.toLocaleString('en-GB')}</Td>
                      <Td className="hidden xl:table-cell"><Rating value={c.rating_avg} /></Td>
                      <Td><CourseStatusPill c={c} /></Td>
                      <Td>
                        <Menu>
                          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.title}`}><MoreHorizontal /></Button></MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => setOpenId(c.id)}><Eye /> Open details</MenuItem>
                            {c.ownership === 'platform' ? <MenuItem asChild><Link to={`/studio/courses/${c.id}`}><Pencil /> Edit in builder</Link></MenuItem> : null}
                            <MenuItem onSelect={() => runBulk('duplicate', {}, [c.id])}><Copy /> Duplicate</MenuItem>
                            <MenuSeparator />
                            <MenuItem onSelect={() => (setSelected([c.id]), setAsk('archive'))}><Archive /> Archive</MenuItem>
                            <MenuItem onSelect={() => (setSelected([c.id]), setAsk('delete'))} className="text-danger"><Trash2 /> Delete</MenuItem>
                          </MenuContent>
                        </Menu>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <LoadMore shown={rows.length} noun="courses" hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </Card>
      <ConfirmDialog open={ask === 'unpublish'} onOpenChange={(o) => !o && setAsk(null)} title={`Unpublish ${selected.length} ${selected.length === 1 ? 'course' : 'courses'}?`} body="They leave the marketplace. Learners keep access. Instructors see your reason." confirmLabel="Unpublish" reason="required" loading={bulk.isPending} onConfirm={(r) => runBulk('unpublish', { reason: r })} />
      <ConfirmDialog open={ask === 'archive'} onOpenChange={(o) => !o && setAsk(null)} title={`Archive ${selected.length} ${selected.length === 1 ? 'course' : 'courses'}?`} body="Hidden everywhere except for learners who already have them. You can relist them later." confirmLabel="Archive" loading={bulk.isPending} onConfirm={() => runBulk('archive')} />
      <ConfirmDialog open={ask === 'delete'} onOpenChange={(o) => !o && setAsk(null)} title={`Delete ${selected.length} ${selected.length === 1 ? 'course' : 'courses'}?`} body="Deleted courses disappear from every list but are kept on record (Archived tab). Courses with learners can't be deleted: archive them instead." confirmLabel="Delete" phrase="DELETE" loading={bulk.isPending} onConfirm={() => runBulk('delete')} />
      <CategoryPicker open={ask === 'category'} onOpenChange={(o) => !o && setAsk(null)} count={selected.length} loading={bulk.isPending} onPick={(id) => runBulk('category', { category_id: id })} />
      <DetailSheet open={!!openId} onOpenChange={(o) => !o && setOpenId('')} title="Course details">
        {openId ? <CourseDetail id={openId} languages={languages} onClose={() => setOpenId('')} /> : null}
      </DetailSheet>
    </div>
  )
}

// ---------------------------------------------------------------- categories
function CategoryDialog({ cat, open, onOpenChange, parents }: { cat?: ConsoleCategory; open: boolean; onOpenChange: (o: boolean) => void; parents: ConsoleCategory[] }) {
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const [name, setName] = useState(cat?.name ?? '')
  const [icon, setIcon] = useState(cat?.icon ?? '')
  const [parent, setParent] = useState('')
  useEffect(() => (setName(cat?.name ?? ''), setIcon(cat?.icon ?? ''), setParent('')), [cat, open])
  const done = (msg: string) => ({ onSuccess: () => (toast.success(msg), onOpenChange(false)), onError: (e: Error) => toast.error(e.message) })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={cat ? 'Edit category' : 'Add category'}>
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), cat ? update.mutate({ id: cat.id, name: name.trim(), icon: icon.trim() }, done('Category saved')) : create.mutate({ name: name.trim(), icon: icon.trim(), parent_id: parent || null }, done('Category added')))}>
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />}</Field>
          <Field label="Icon (optional)" hint="An icon name, for example code or briefcase.">{(p) => <Input {...p} value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={48} pattern="[A-Za-z0-9-]*" />}</Field>
          {!cat ? (
            <Field label="Inside">
              {(p) => (
                <NativeSelect {...p} value={parent} onChange={(e) => setParent(e.target.value)}>
                  <option value="">Top level</option>
                  {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending || update.isPending}>{cat ? 'Save' : 'Add category'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Categories() {
  const { data, error, refetch } = useConsoleCategories()
  const update = useUpdateCategory()
  const reorder = useReorderCategories()
  const [edit, setEdit] = useState<ConsoleCategory | null>(null)
  const [adding, setAdding] = useState(false)
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (!data) return <Skeleton className="h-80" />
  const top = data.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order)
  const children = (id: string) => data.filter((c) => c.parent_id === id).sort((a, b) => a.sort_order - b.sort_order)
  const move = (level: ConsoleCategory[], i: number, dir: -1 | 1) => {
    const ids = level.map((c) => c.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!]
    reorder.mutate(ids, { onError: (e) => toast.error((e as Error).message) })
  }
  const row = (c: ConsoleCategory, level: ConsoleCategory[], i: number, nested = false) => (
    <li key={c.id} className={cn('flex flex-wrap items-center gap-2 px-4 py-2.5', nested && 'pl-10')}>
      <span className="min-w-0 flex-1">
        <span className={cn('font-medium', !c.is_active && 'text-muted line-through')}>{c.name}</span>
        <span className="ml-2 text-[12.5px] text-muted tabular">{c.course_count} courses</span>
        {!c.is_active ? <Badge className="ml-2">Hidden</Badge> : null}
      </span>
      <Button size="icon-sm" variant="ghost" aria-label={`Move ${c.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(level, i, -1)}><ArrowUp /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Move ${c.name} down`} disabled={i === level.length - 1 || reorder.isPending} onClick={() => move(level, i, 1)}><ArrowDown /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEdit(c)}><Pencil /></Button>
      <Switch checked={c.is_active} aria-label={`${c.name} shown in the catalogue`} onCheckedChange={(v) => update.mutate({ id: c.id, is_active: v }, { onSuccess: () => toast.success(v ? 'Category shown' : 'Category hidden'), onError: (e) => toast.error((e as Error).message) })} />
    </li>
  )
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><FolderTree className="size-4 text-primary" aria-hidden /> Categories</span>} description="The order here is the order in the catalogue. Hidden categories keep their courses." action={<Button size="sm" onClick={() => setAdding(true)}><Plus /> Add category</Button>} />
      {top.length === 0 ? (
        <EmptyState icon={<FolderTree />} title="No categories yet" />
      ) : (
        <ul className="stagger mt-3 divide-y divide-border border-t border-border">
          {top.map((c, i) => [row(c, top, i), ...children(c.id).map((ch, j, arr) => row(ch, arr, j, true))])}
        </ul>
      )}
      <CategoryDialog open={adding} onOpenChange={setAdding} parents={top} />
      <CategoryDialog cat={edit ?? undefined} open={!!edit} onOpenChange={(o) => !o && setEdit(null)} parents={top} />
    </Card>
  )
}

// ---------------------------------------------------------------- page
export function ConsoleCoursesPage() {
  const [tab, setTab] = useTabParam(TABS, 'all')
  const [creating, setCreating] = useState(false)
  return (
    <>
      <PageHeader
        title="Course management"
        description="Every course on the platform: details, pricing and access, and bulk operations."
        actions={
          <>
            <Button onClick={() => setCreating(true)}><Plus /> Create company course</Button>
            <Button asChild variant="secondary"><Link to="/console/reports?tab=courses"><BarChart3 /> Course reports</Link></Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as PageTab)}>
        <TabsList aria-label="Course lists" className="mb-1">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t === 'categories' ? <FolderTree /> : t === 'archived' ? <Archive /> : t === 'company' ? <Star /> : t === 'instructor' ? <Users /> : <BookOpen />} {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t} value={t}>{t === 'categories' ? <Categories /> : <CourseList tab={t as CourseTab} />}</TabsContent>
        ))}
      </Tabs>
      <CompanyCourseDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
