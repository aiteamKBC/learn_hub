import { ArrowLeft, LayoutGrid, List, Search, SearchX, SlidersHorizontal, Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type CourseFilters, type SearchIn, useCategories, useCourseFeed } from '@/features/catalog/api'
import { CourseCard, CourseCardSkeleton } from '@/features/catalog/CourseCard'
import { CourseRow } from '@/features/catalog/CourseRow'
import { useDebounced } from '@/features/org/ui'
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
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => onPick(name, value || undefined)}
        className="size-4 shrink-0 appearance-none rounded-full border-2 border-primary bg-surface transition-colors checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:outline-none"
      />
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
                <Star className="size-3.5 fill-none text-subtle" /> {r} & up
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

/** The page's own search: course names only. Results update as you type. */
function CourseSearch({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [v, setV] = useState(initial)
  const term = useDebounced(v.trim(), 400)
  const first = useRef(true)
  // follow a search started elsewhere (the header, a removed chip) without fighting the typing
  useEffect(() => {
    if (initial !== term) {
      setV(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the URL search changes
  }, [initial])
  useEffect(() => {
    if (first.current) return void (first.current = false)
    onSearch(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the debounced text changes
  }, [term])
  return (
    <form role="search" onSubmit={(e) => (e.preventDefault(), onSearch(v.trim()))} className="group relative mt-5 max-w-xl animate-reveal">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary" />
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Search course names"
        aria-label="Search course names"
        autoComplete="off"
        className="h-11 w-full rounded-full border border-border bg-surface pr-10 pl-11 text-sm text-text shadow-sm transition-[box-shadow,border-color] duration-200 outline-none placeholder:text-subtle focus:border-primary focus:ring-4 focus:ring-primary/15"
      />
      {v ? (
        <button type="button" aria-label="Clear search" onClick={() => (setV(''), onSearch(''))} className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text">
          <X className="size-3.5" />
        </button>
      ) : null}
    </form>
  )
}

export function CoursesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  // A page that linked here can ask Back to return to a specific spot (e.g. the home
  // "All courses" button sends you back to its category section). Otherwise step back in
  // history, falling back to the learner home when the page was opened directly.
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
  const goBack = () => (returnTo ? navigate(returnTo) : window.history.length > 1 ? navigate(-1) : navigate('/learn'))
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const filters: CourseFilters = {
    q: params.get('q') ?? undefined,
    // the page's own search box looks at course names; the header can also send ?in=instructors|topics
    search_in: (['instructors', 'topics'].includes(params.get('in') ?? '') ? params.get('in') : 'courses') as SearchIn,
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
    if (key === 'q') next.delete('in') // a new or cleared search here is a course-name search
    // Keep the location state (e.g. returnTo) so Back still works after filtering.
    setParams(next, { replace: true, state: location.state })
  }
  const chips = [
    filters.q && ['q', filters.search_in === 'courses' ? `“${filters.q}”` : `${filters.search_in === 'instructors' ? 'Instructor' : 'Topic'}: “${filters.q}”`],
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
      {/* Fixed to the viewport so the artwork also sits behind the frosted header. */}
      <DashboardBackdrop className="animate-fade-in fixed inset-0 -z-10" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-stretch gap-4 animate-reveal sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{filters.q ? `Results for “${filters.q}”` : 'Explore courses'}</h1>
            <p className="mt-1 text-sm text-muted" aria-live="polite">
              {total == null ? <Skeleton className="inline-block h-4 w-32 align-middle" /> : `${total.toLocaleString('en-GB')} ${total === 1 ? 'course' : 'courses'}`}
            </p>
          </div>
          <div className="flex w-full flex-nowrap items-center justify-between gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:ml-auto sm:w-auto sm:justify-end sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
            <label className="order-3 flex items-center gap-2 text-sm text-muted sm:order-1">
              <span className="hidden sm:inline">Sort by</span>
              <NativeSelect value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="h-9 w-[120px] gap-1 rounded-full px-2 text-xs [&>span]:truncate [&>span]:whitespace-nowrap min-[390px]:w-[128px] sm:h-8 sm:w-40 sm:px-3 sm:text-[13px]" aria-label="Sort by">
                {SORTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="order-4 flex rounded-full border border-border bg-surface p-0.5 shadow-sm sm:order-2" role="group" aria-label="Layout">
              {(
                [
                  ['grid', LayoutGrid],
                  ['list', List],
                ] as const
              ).map(([v, Icon]) => (
                <Button key={v} variant="ghost" size="icon-sm" aria-pressed={view === v} aria-label={`${v} view`} onClick={() => set('view', v === 'grid' ? undefined : v)} className={cn('size-[30px] min-[390px]:size-8', view === v && 'bg-primary-soft text-primary-soft-text')}>
                  <Icon />
                </Button>
              ))}
            </div>
            <Button variant="secondary" size="sm" className="order-1 h-9 gap-1 px-2 text-xs min-[390px]:px-2.5 sm:order-3" onClick={goBack}>
              <ArrowLeft /> Back
            </Button>
            <Button variant="secondary" size="sm" className="order-2 h-9 gap-1 px-2 text-xs min-[390px]:px-2.5 sm:order-4 lg:hidden" onClick={() => setDrawer(true)}>
              <SlidersHorizontal /> Filters {active ? <Badge tone="primary">{active}</Badge> : null}
            </Button>
          </div>
        </div>

        <CourseSearch initial={filters.search_in === 'courses' ? (filters.q ?? '') : ''} onSearch={(v) => set('q', v || undefined)} />

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
            {chips.length ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {chips.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => set(k)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft pr-2 pl-3 text-[13px] font-medium text-primary-soft-text transition-colors hover:bg-primary-soft/70" aria-label={`Remove filter ${label}`}>
                    {label} <X className="size-3.5" />
                  </button>
                ))}
              </div>
            ) : null}

            <div className={cn('transition-opacity duration-200', feed.isFetching && !feed.isFetchingNextPage && !feed.isLoading && 'opacity-60')}>
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
