import { Award, BarChart3, Check, ChevronDown, Clock, FileText, Globe, Heart, HelpCircle, Infinity as InfinityIcon, ListChecks, PlayCircle, Radio, RefreshCw, ShoppingCart, Smartphone, Users, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { coverColors, CourseThumb } from '@/components/ui/course-thumb'
import { ErrorState, Rating } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategories, useCourse, usePreview, useReviews } from '@/features/catalog/api'
import { useAddToCart, useCheckout, usePlanEnroll, useToggleWishlist } from '@/features/commerce/api'
import { Price } from '@/features/catalog/CourseCard'
import { ReportButton } from '@/features/engagement/ReportButton'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { count, duration, relativeDate, shortDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

const kindIcon: Record<string, LucideIcon> = { video: PlayCircle, article: FileText, quiz: HelpCircle, assignment: ListChecks, live_session: Radio, external_link: Globe }

type Detail = NonNullable<ReturnType<typeof useCourse>['data']>

function Curriculum({ sections, onPreview }: { sections: Detail['sections']; onPreview: (l: { key: string; title: string }) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(sections.slice(0, 1).map((s) => s.id)))
  const lectures = sections.reduce((n, s) => n + s.lectures.length, 0)
  const total = sections.reduce((n, s) => n + s.lectures.reduce((m, l) => m + l.duration_sec, 0), 0)
  const allOpen = open.size === sections.length
  return (
    <section aria-labelledby="curriculum">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="curriculum" className="text-xl font-semibold tracking-tight">Course content</h2>
          <p className="mt-1 text-sm text-muted">
            {sections.length} sections · {lectures} lectures · {duration(total)} total
          </p>
        </div>
        <Button variant="link" onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.id)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        {sections.map((s, i) => {
          const isOpen = open.has(s.id)
          const secs = s.lectures.reduce((m, l) => m + l.duration_sec, 0)
          return (
            <div key={s.id} className={cn(i > 0 && 'border-t border-border')}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((prev) => {
                  const next = new Set(prev)
                  if (next.has(s.id)) next.delete(s.id)
                  else next.add(s.id)
                  return next
                })}
                className="flex w-full items-center gap-3 bg-surface-2/50 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
              >
                <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', isOpen && 'rotate-180')} />
                <span className="flex-1 text-[15px] font-medium">{s.title}</span>
                <span className="text-xs whitespace-nowrap text-muted">
                  {s.lectures.length} {s.lectures.length === 1 ? 'lecture' : 'lectures'}
                  {secs ? ` · ${duration(secs)}` : ''}
                </span>
              </button>
              {isOpen ? (
                <ul className="divide-y divide-border">
                  {s.lectures.map((l) => {
                    const Icon = kindIcon[l.kind] ?? FileText
                    return (
                      <li key={l.key} className="flex items-center gap-3 px-4 py-3 pl-11 text-sm">
                        <Icon className="size-4 shrink-0 text-subtle" />
                        {l.is_preview && l.kind === 'video' ? (
                          <button type="button" onClick={() => onPreview({ key: l.key, title: l.title })} className="flex-1 text-left font-medium text-primary hover:underline">
                            {l.title}
                          </button>
                        ) : (
                          <span className="flex-1">{l.title}</span>
                        )}
                        {l.is_preview ? <Badge tone="primary">Preview</Badge> : null}
                        {l.duration_sec ? <span className="w-12 text-right text-xs text-muted tabular">{duration(l.duration_sec)}</span> : <span className="w-12" />}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ReviewList({ courseId }: { courseId: string }) {
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } = useReviews(courseId)
  const items = data?.pages.flatMap((p) => p.items) ?? []
  if (isLoading) return <Skeleton className="mt-4 h-32 rounded-lg" />
  if (!items.length) return null
  return (
    <>
      <ul className="stagger mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <Avatar name={r.author.name || 'Learner'} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.author.name || 'LearnHub learner'}</p>
                <p className="text-xs text-muted">{relativeDate(r.created_at)}</p>
              </div>
              <span className="ml-auto">
                <Rating value={r.rating} />
              </span>
            </div>
            {r.body ? <p className="mt-3 text-sm leading-relaxed text-muted">{r.body}</p> : null}
            {r.instructor_reply ? (
              <div className="mt-3 rounded-md border-l-2 border-primary bg-primary-soft/50 px-3 py-2 text-sm">
                <p className="text-xs font-medium text-primary-soft-text">Instructor reply</p>
                <p className="mt-1 text-muted">{r.instructor_reply}</p>
              </div>
            ) : null}
            <div className="mt-2 flex justify-end">
              <ReportButton kind="review" id={r.id} authorId={r.author.id} />
            </div>
          </li>
        ))}
      </ul>
      {hasNextPage ? (
        <Button variant="secondary" className="mt-4" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Show more reviews
        </Button>
      ) : null}
    </>
  )
}

function Reviews({ course }: { course: Detail }) {
  const total = Object.values(course.rating_breakdown).reduce((a, b) => a + b, 0)
  return (
    <section aria-labelledby="reviews">
      <h2 id="reviews" className="text-xl font-semibold tracking-tight">Learner feedback</h2>
      {!course.rating_count ? (
        <p className="mt-3 rounded-lg border border-dashed border-border bg-surface p-5 text-sm text-muted">No ratings yet. Learners can rate the course once they have started it.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-8 rounded-lg border border-border bg-surface p-5">
            <div className="text-center">
              <p className="text-5xl font-bold tracking-tight text-warning tabular">{course.rating_avg.toFixed(1)}</p>
              <div className="mt-2">
                <Rating value={course.rating_avg} />
              </div>
              <p className="mt-1 text-xs text-muted">{course.rating_count} {course.rating_count === 1 ? 'rating' : 'ratings'}</p>
            </div>
            <div className="grid min-w-56 flex-1 gap-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = course.rating_breakdown[String(star)] ?? 0
                const p = total ? (n / total) * 100 : 0
                return (
                  <div key={star} className="flex items-center gap-3 text-xs">
                    <span className="w-10 text-muted">{star} star</span>
                    <Progress value={p} tone="warning" className="h-2" label={`${star} star ratings`} />
                    <span className="w-9 text-right text-muted tabular">{Math.round(p)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
          <ReviewList courseId={course.id} />
        </>
      )}
    </section>
  )
}

/** Free sample lectures play without enrolling (signed Bunny link from the server). */
function PreviewDialog({ slug, lecture, onClose }: { slug: string; lecture: { key: string; title: string } | null; onClose: () => void }) {
  const { data, isLoading, error } = usePreview(slug, lecture?.key ?? null)
  return (
    <Dialog open={!!lecture} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={lecture ? `Preview: ${lecture.title}` : 'Preview'} className="max-w-[860px]">
        <div className="relative aspect-video overflow-hidden rounded-lg bg-nav">
          {isLoading ? (
            <Skeleton className="size-full rounded-none" />
          ) : error ? (
            <div className="flex size-full items-center justify-center p-6 text-center text-sm text-white/80">This preview isn't available right now.</div>
          ) : data?.kind === 'bunny' && data.url ? (
            <iframe src={data.url} title={lecture?.title ?? 'Preview'} className="size-full" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <div className="relative flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <Backdrop variant="aurora" onDark height="100%" fade={false} />
              <PlayCircle className="relative size-12 text-white/90" strokeWidth={1.5} />
              <p className="relative max-w-sm text-sm text-white/80">This demo course has no recorded video yet. Real courses play here, straight from the video library.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BuyBox({ course, onPreview }: { course: Detail; onPreview?: () => void }) {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const { code } = useCurrency()
  const v = course.viewer
  const needLogin = () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
  const addToCart = useAddToCart()
  const wishlist = useToggleWishlist()
  const checkout = useCheckout()
  const planEnroll = usePlanEnroll()
  const free = !!course.price?.free

  const fail = (e: unknown) => toast.error((e as Error).message)
  const add = () => addToCart.mutate(course.id, { onSuccess: () => toast.success('Added to your cart', { action: { label: 'View cart', onClick: () => navigate('/cart') } }), onError: fail })
  // "Buy now" and free courses skip the cart: one course straight to checkout
  const buyNow = () =>
    checkout.mutate(
      { courseIds: [course.id], currency: course.price?.currency ?? code ?? 'GBP' },
      {
        // free courses need no payment: straight into the player
        onSuccess: (r) =>
          r.checkout_url
            ? window.location.assign(r.checkout_url)
            : r.status === 'paid' && !r.total_minor
              ? (toast.success("You're enrolled. Enjoy the course!"), navigate(`/learn/${course.slug}`))
              : navigate(`/checkout/success?order=${r.order_id}`),
        onError: fail,
      },
    )

  return (
    <Card className="overflow-hidden shadow-lg">
      <div className="relative" style={{ viewTransitionName: 'course-cover' }}>
        <CourseThumb src={course.thumbnail_url} title={course.title} category={course.category} className="rounded-none" />
        {onPreview ? (
          <button type="button" onClick={onPreview} className="group absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/10 text-white transition-colors hover:bg-black/25">
            <span className="flex size-14 items-center justify-center rounded-full bg-white text-primary shadow-lg transition-transform group-hover:scale-110">
              <PlayCircle className="size-7" />
            </span>
            <span className="text-sm font-semibold drop-shadow">Preview this course</span>
          </button>
        ) : null}
      </div>
      <div className="p-5">
        {v.enrollment_id ? (
          <>
            <p className="text-sm font-medium">You're enrolled</p>
            <Progress value={v.progress_pct ?? 0} className="mt-3" label="Course progress" />
            <p className="mt-2 text-xs text-muted">{Math.round(v.progress_pct ?? 0)}% complete</p>
            <Button size="lg" className="mt-4 w-full" asChild>
              <Link to={`/learn/${course.slug}`}>
                <PlayCircle /> {(v.progress_pct ?? 0) > 0 ? 'Continue learning' : 'Start learning'}
              </Link>
            </Button>
          </>
        ) : v.is_instructor ? (
          <p className="rounded-md bg-primary-soft px-3 py-2.5 text-sm text-primary-soft-text">You teach this course.</p>
        ) : v.plan_access ? (
          <>
            <Badge tone="primary">Included in your Personal Plan</Badge>
            <Button size="lg" className="mt-4 w-full" loading={planEnroll.isPending} onClick={() => planEnroll.mutate(course.id, { onSuccess: () => navigate(`/learn/${course.slug}`), onError: fail })}>
              <PlayCircle /> Start learning
            </Button>
          </>
        ) : free ? (
          <>
            <p className="text-3xl font-bold tracking-tight">Free</p>
            <Button size="lg" className="mt-4 w-full" loading={checkout.isPending} onClick={() => (me ? buyNow() : needLogin())}>
              <PlayCircle /> Enrol for free
            </Button>
          </>
        ) : course.price ? (
          <>
            <Price price={course.price} className="text-3xl [&>span:first-child]:text-3xl [&>span:first-child]:font-bold" />
            <div className="mt-4 flex gap-2">
              <Button size="lg" className="flex-1" loading={addToCart.isPending} onClick={() => (me ? (v.in_cart ? navigate('/cart') : add()) : needLogin())}>
                <ShoppingCart /> {v.in_cart ? 'Go to cart' : 'Add to cart'}
              </Button>
              <Button size="lg" variant="secondary" className="px-3.5" aria-label={v.in_wishlist ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={v.in_wishlist} onClick={() => (me ? wishlist.mutate(course.id, { onSuccess: (r) => toast.success(r.in_wishlist ? 'Saved to your wishlist' : 'Removed from your wishlist'), onError: fail }) : needLogin())}>
                <Heart key={String(v.in_wishlist)} className={cn(v.in_wishlist && 'animate-pop fill-danger text-danger')} />
              </Button>
            </div>
            <Button size="lg" variant="soft" className="mt-2 w-full" loading={checkout.isPending} onClick={() => (me ? buyNow() : needLogin())}>
              Buy now
            </Button>
            <p className="mt-3 text-center text-xs text-muted">30-day refund policy · secure checkout by Stripe</p>
          </>
        ) : (
          <p className="text-sm text-muted">This course is not sold on its own.</p>
        )}
        <ul className="mt-5 grid gap-2.5 border-t border-border pt-5 text-sm">
          {[
            [PlayCircle, `${duration(course.total_duration_sec)} of content`],
            [BarChart3, `${course.lecture_count} lectures`],
            [Smartphone, 'Learn on phone and desktop'],
            [InfinityIcon, 'Lifetime access'],
            ...(course.cpd_hours ? [[Award, `Certificate · ${course.cpd_hours} CPD hours`]] : [[Award, 'Certificate of completion']]),
          ].map(([Icon, text]) => {
            const I = Icon as LucideIcon
            return (
              <li key={text as string} className="flex items-center gap-2.5 text-muted">
                <I className="size-4 text-text" /> {text as string}
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}

function CourseSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-10 w-2/3" />
      <Skeleton className="mt-3 h-5 w-1/2" />
      <Skeleton className="mt-10 h-72 w-full lg:w-2/3" />
    </div>
  )
}

export function CoursePage() {
  const { slug = '' } = useParams()
  const { data: c, isLoading, error, refetch } = useCourse(slug)
  const { data: cats } = useCategories()
  const [preview, setPreview] = useState<{ key: string; title: string } | null>(null)
  if (isLoading) return <CourseSkeleton />
  if (error || !c) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
  const firstPreview = c.sections.flatMap((s) => s.lectures).find((l) => l.is_preview && l.kind === 'video')
  const catSlug = cats?.find((x) => x.name === c.category)?.slug

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-border bg-surface">
        <Backdrop variant="waves" height="100%" fade={false} {...coverColors(c.category)} />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_360px] lg:py-12">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-muted">
              <Link to="/courses" className="hover:text-primary">Courses</Link>
              <span aria-hidden>/</span>
              {c.category ? <Link to={catSlug ? `/courses?category=${catSlug}` : '/courses'} className="font-medium text-primary">{c.category}</Link> : null}
            </nav>
            <h1 className="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl" style={{ viewTransitionName: 'course-title' }}>{c.title}</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">{c.subtitle}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {c.student_count > 50 ? <Badge tone="warning">Bestseller</Badge> : null}
              <Rating value={c.rating_avg} count={c.rating_count} size="md" />
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Users className="size-4" /> {count(c.student_count)} learners
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Clock className="size-4" /> {duration(c.total_duration_sec)}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <span>
                Created by{' '}
                {c.instructor_profiles.map((i, n) => (
                  <span key={i.id} className="font-medium text-primary">
                    {n ? ', ' : ''}
                    {i.name}
                  </span>
                ))}
              </span>
              {c.updated_at ? (
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="size-3.5" /> Updated {shortDate(c.updated_at)}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Globe className="size-3.5" /> English
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl animate-reveal gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_360px]">
        <div className="order-2 grid min-w-0 gap-10 lg:order-1">
          {c.topics.length ? (
            <section className="rounded-lg border border-border bg-surface p-6">
              <h2 className="text-lg font-semibold tracking-tight">Topics covered</h2>
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {c.topics.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Curriculum sections={c.sections} onPreview={setPreview} />
          <section aria-labelledby="about">
            <h2 id="about" className="text-xl font-semibold tracking-tight">About this course</h2>
            {/* description is sanitised on the server (nh3) before it is stored */}
            <div className="mt-3 max-w-none text-[15px] leading-relaxed text-muted [&_a]:text-primary [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: c.description }} />
          </section>
          <section aria-labelledby="instructors">
            <h2 id="instructors" className="text-xl font-semibold tracking-tight">Instructor{c.instructor_profiles.length > 1 ? 's' : ''}</h2>
            <div className="mt-4 grid gap-4">
              {c.instructor_profiles.map((i) => (
                <div key={i.id} className="flex items-center gap-4">
                  <Avatar name={i.name} src={i.avatar_url} size="lg" />
                  <div>
                    <p className="font-semibold text-primary">{i.name}</p>
                    <p className="text-sm text-muted">{i.headline || 'LearnHub instructor'}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <Reviews course={c} />
        </div>
        <aside className="order-1 lg:order-2 lg:-mt-64">
          <div className="lg:sticky lg:top-24">
            <BuyBox course={c} onPreview={firstPreview ? () => setPreview({ key: firstPreview.key, title: firstPreview.title }) : undefined} />
          </div>
        </aside>
      </div>
      <PreviewDialog slug={c.slug} lecture={preview} onClose={() => setPreview(null)} />
    </>
  )
}
