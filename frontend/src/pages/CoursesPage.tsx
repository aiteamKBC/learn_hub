import { LayoutGrid, List, SearchX, SlidersHorizontal, Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type CourseFilters, useCategories, useCourseFeed } from '@/features/catalog/api'
import { CourseCard, CourseCardSkeleton } from '@/features/catalog/CourseCard'
import { CourseRow } from '@/features/catalog/CourseRow'
import { cn } from '@/lib/cn'

const LEVELS = [
  ['', 'Any level'],
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
  ['all', 'All levels'],
] as const
const PRICES = [
  ['', 'Any price'],
  ['free', 'Free'],
  ['paid', 'Paid'],
] as const
const RATINGS = ['4.5', '4', '3.5', '3'] as const
const SORTS = [
  ['popular', 'Most popular'],
  ['rating', 'Highest rated'],
  ['newest', 'Newest'],
] as const

type Setter = (key: string, value?: string) => void

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-border py-5 first:pt-0 last:border-0">
      {/* float: a legend otherwise sits in the fieldset's border and leaves a gap */}
      <legend className="float-left mb-2 w-full text-sm font-semibold">{title}</legend>
      <div className="clear-both grid gap-1">{children}</div>
    </fieldset>
  )
}

function Choice({ name, value, current, label, onPick, extra }: { name: string; value: string; current: string; label: React.ReactNode; onPick: Setter; extra?: React.ReactNode }) {
  const checked = current === value
  return (
    <label className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2', checked && 'font-medium text-primary')}>
      <input type="radio" name={name} checked={checked} onChange={() => onPick(name, value || undefined)} className="size-4 accent-[var(--primary)]" />
      <span className="flex-1">{label}</span>
      {extra}
    </label>
  )
}

/** The filters: a sidebar on desktop, a drawer on phones (approved: Option A). */
function Filters({ params, set }: { params: URLSearchParams; set: Setter }) {
  const { data: cats } = useCategories()
  return (
    <div>
      <Group title="Category">
        <Choice name="category" value="" current={params.get('category') ?? ''} label="All categories" onPick={set} />
        {cats ? cats.map((c) => <Choice key={c.id} name="category" value={c.slug} current={params.get('category') ?? ''} label={c.name} onPick={set} />) : <Skeleton className="h-40" />}
      </Group>
      <Group title="Rating">
        <Choice name="rating" value="" current={params.get('rating') ?? ''} label="Any rating" onPick={set} />
        {RATINGS.map((r) => (
          <Choice
            key={r}
            name="rating"
            value={r}
            current={params.get('rating') ?? ''}
            onPick={set}
            label={
              <span className="inline-flex items-center gap-1.5">
                <Star className="size-3.5 fill-warning text-warning" /> {r} & up
              </span>
            }
          />
        ))}
      </Group>
      <Group title="Level">
        {LEVELS.map(([v, l]) => (
          <Choice key={v} name="level" value={v} current={params.get('level') ?? ''} label={l} onPick={set} />
        ))}
      </Group>
      <Group title="Price">
        {PRICES.map(([v, l]) => (
          <Choice key={v} name="price" value={v} current={params.get('price') ?? ''} label={l} onPick={set} />
        ))}
      </Group>
    </div>
  )
}

export function CoursesPage() {
  const [params, setParams] = useSearchParams()
  const [drawer, setDrawer] = useState(false)
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const filters: CourseFilters = {
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    level: params.get('level') ?? undefined,
    price: (params.get('price') as CourseFilters['price']) ?? undefined,
    rating: params.get('rating') ? Number(params.get('rating')) : undefined,
    sort: params.get('sort') ?? 'popular',
  }
  const feed = useCourseFeed(filters)
  const { data: cats } = useCategories()
  const items = feed.data?.pages.flatMap((p) => p.items) ?? []
  const total = feed.data?.pages[0]?.total

  const set: Setter = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const chips = [
    filters.q && ['q', `“${filters.q}”`],
    filters.category && ['category', cats?.find((c) => c.slug === filters.category)?.name ?? filters.category],
    filters.rating && ['rating', `${filters.rating}+ stars`],
    filters.level && ['level', LEVELS.find(([v]) => v === filters.level)?.[1] ?? filters.level],
    filters.price && ['price', filters.price === 'free' ? 'Free' : 'Paid'],
  ].filter(Boolean) as [string, string][]
  const active = chips.filter(([k]) => k !== 'q').length

  // load the next page when the end of the list comes into view
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !feed.hasNextPage) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && !feed.isFetchingNextPage && void feed.fetchNextPage(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feed])

  return (
    <div className="relative isolate">
      <Backdrop variant="mosaic" height={380} />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="animate-reveal">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{filters.q ? `Results for “${filters.q}”` : 'Explore courses'}</h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {total == null ? <Skeleton className="inline-block h-4 w-32 align-middle" /> : `${total.toLocaleString('en-GB')} ${total === 1 ? 'course' : 'courses'}`}
          </p>
        </div>

        <div className="mt-6 lg:grid lg:grid-cols-[248px_1fr] lg:gap-8">
          <aside className="hidden lg:block" aria-label="Filters">
            <div className="sticky top-24 rounded-lg border border-border bg-surface p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold">Filters</p>
                {active ? (
                  <Button variant="link" size="sm" onClick={() => setParams(filters.q ? { q: filters.q } : {}, { replace: true })}>
                    Clear all
                  </Button>
                ) : null}
              </div>
              <Filters params={params} set={set} />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" className="lg:hidden" onClick={() => setDrawer(true)}>
                <SlidersHorizontal /> Filters {active ? <Badge tone="primary">{active}</Badge> : null}
              </Button>
              <div className="flex flex-wrap gap-1.5">
                {chips.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => set(k)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft pr-2 pl-3 text-[13px] font-medium text-primary-soft-text transition-colors hover:bg-primary-soft/70" aria-label={`Remove filter ${label}`}>
                    {label} <X className="size-3.5" />
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="hidden sm:inline">Sort by</span>
                  <NativeSelect value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="h-9 w-40" aria-label="Sort by">
                    {SORTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <div className="hidden rounded-md border border-border bg-surface p-0.5 sm:flex" role="group" aria-label="Layout">
                  {(
                    [
                      ['grid', LayoutGrid],
                      ['list', List],
                    ] as const
                  ).map(([v, Icon]) => (
                    <Button key={v} variant="ghost" size="icon-sm" aria-pressed={view === v} aria-label={`${v} view`} onClick={() => set('view', v === 'grid' ? undefined : v)} className={cn(view === v && 'bg-primary-soft text-primary-soft-text')}>
                      <Icon />
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className={cn('mt-5 transition-opacity duration-200', feed.isFetching && !feed.isFetchingNextPage && !feed.isLoading && 'opacity-60')}>
              {feed.error ? (
                <ErrorState message={(feed.error as Error).message} onRetry={() => void feed.refetch()} />
              ) : feed.isLoading ? (
                <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3' : 'grid gap-3'}>
                  {Array.from({ length: 6 }, (_, i) => (view === 'grid' ? <CourseCardSkeleton key={i} /> : <Skeleton key={i} className="h-36 rounded-lg" />))}
                </div>
              ) : !items.length ? (
                <EmptyState icon={<SearchX />} title="No courses match" body="Try fewer filters or a different search." action={<Button variant="secondary" onClick={() => setParams({}, { replace: true })}>Clear search and filters</Button>} />
              ) : view === 'grid' ? (
                <div className="stagger grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
                  {items.map((c) => (
                    <CourseCard key={c.id} course={c} />
                  ))}
                </div>
              ) : (
                <div className="stagger grid gap-3">
                  {items.map((c) => (
                    <CourseRow key={c.id} course={c} showWishlist />
                  ))}
                </div>
              )}
              <div ref={sentinel} />
              {feed.isFetchingNextPage ? (
                <div className="mt-4 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <CourseCardSkeleton key={i} />
                  ))}
                </div>
              ) : feed.hasNextPage ? (
                <div className="mt-6 text-center">
                  <Button variant="secondary" onClick={() => void feed.fetchNextPage()}>
                    Show more courses
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent title="Filters" side="right">
          <div className="p-4">
            <Filters params={params} set={set} />
          </div>
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-surface p-4">
            <Button variant="secondary" className="flex-1" onClick={() => setParams(filters.q ? { q: filters.q } : {}, { replace: true })}>
              Clear
            </Button>
            <Button className="flex-1" onClick={() => setDrawer(false)}>
              Show {total ?? ''} courses
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
