import { Award, BarChart3, BookOpen, Check, ChevronRight, CircleHelp, Clock, Coins, FileText, Folder, Globe, GraduationCap, HelpCircle, Home, Languages, Laptop, Layers3, ListChecks, Medal, PlayCircle, Radio, ShieldCheck, ShoppingCart, Target, Users, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Backdrop } from '@/components/art/backdrops'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CourseThumb } from '@/components/ui/course-thumb'
import { ErrorState, Rating } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategories, useCourse, useCourses, usePreview, useRelatedCourses } from '@/features/catalog/api'
import { CourseCard, CourseCardSkeleton } from '@/features/catalog/CourseCard'
import { useAddToCart, useCheckout, useCourseInstalmentOffer, usePlanEnroll, useStartCourseInstalments } from '@/features/commerce/api'
import { WishlistHeart } from '@/features/commerce/WishlistHeart'
import { useAccess } from '@/features/b2c/api'
import { UnlockButton } from '@/features/b2c/UnlockButton'
import { Price } from '@/features/catalog/CourseCard'
import { TeamBuy } from '@/features/corporate/TeamBuy'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { count, duration, money, shortDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'
import { authAlert } from '@/lib/auth-alert'

const kindIcon: Record<string, LucideIcon> = { video: PlayCircle, article: FileText, quiz: HelpCircle, assignment: ListChecks, live_session: Radio, external_link: Globe }

const ACCESS_SOURCE_LABEL: Record<string, string> = {
  legacy: 'You already own this',
  package: 'Included in a package you bought',
  token: 'Unlocked with tokens',
  subscription: 'Included in your subscription',
  admin: 'Granted by LearnHub',
}

type Detail = NonNullable<ReturnType<typeof useCourse>['data']>

function Curriculum({ sections, onPreview }: { sections: Detail['sections']; onPreview: (l: { key: string; title: string }) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(sections.slice(0, 1).map((s) => s.id)))
  const activities = sections.flatMap((section) => section.lectures)
  const lessons = activities.filter((activity) => activity.kind !== 'quiz' && activity.kind !== 'assignment').length
  const quizzes = activities.filter((activity) => activity.kind === 'quiz').length
  const assignments = activities.filter((activity) => activity.kind === 'assignment').length
  return (
    <section aria-labelledby="curriculum" className="scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="curriculum" className="text-2xl font-bold tracking-tight">Course curriculum</h2>
        <p className="text-sm text-muted">
          {sections.length} modules <span aria-hidden>•</span> {lessons} lessons <span aria-hidden>•</span> {quizzes} quizzes <span aria-hidden>•</span> {assignments} assignments
        </p>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-border">
        {sections.map((s, i) => {
          const isOpen = open.has(s.id)
          const secs = s.lectures.reduce((m, l) => m + l.duration_sec, 0)
          const sectionLessons = s.lectures.filter((lecture) => lecture.kind !== 'quiz' && lecture.kind !== 'assignment').length
          const sectionQuizzes = s.lectures.filter((lecture) => lecture.kind === 'quiz').length
          const sectionAssignments = s.lectures.filter((lecture) => lecture.kind === 'assignment').length
          const isAssessment = i === sections.length - 1 && (sectionQuizzes > 0 || sectionAssignments > 0)
          const summary = [sectionLessons ? `${sectionLessons} lesson${sectionLessons === 1 ? '' : 's'}` : '', sectionQuizzes ? `${sectionQuizzes} quiz${sectionQuizzes === 1 ? '' : 'zes'}` : '', sectionAssignments ? `${sectionAssignments} assignment${sectionAssignments === 1 ? '' : 's'}` : ''].filter(Boolean).join(' • ')
          const panelId = `module-${s.id}`
          return (
            <div key={s.id} className={cn('overflow-hidden bg-surface', i > 0 && 'border-t border-border')}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen((prev) => {
                  const next = new Set(prev)
                  if (next.has(s.id)) next.delete(s.id)
                  else next.add(s.id)
                  return next
                })}
                className={cn('flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 hover:bg-primary-soft/35 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary', i === 0 && 'bg-primary-soft/55', isAssessment && 'bg-[#f6f1ff] dark:bg-[#211936]')}
              >
                <ChevronRight className={cn('size-4 shrink-0 text-text transition-transform', isOpen && 'rotate-90')} />
                {isAssessment ? <GraduationCap className="size-6 shrink-0 text-[#7c3aed]" /> : <Folder className="size-6 shrink-0 text-primary" strokeWidth={1.8} />}
                <span className="min-w-0 flex-1 text-base font-semibold sm:text-[17px]">Module {i + 1}: {s.title}</span>
                {summary ? <Badge tone={isAssessment ? 'info' : 'primary'} className="hidden px-3 py-1 sm:inline-flex">{summary}</Badge> : null}
                {secs ? <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted"><Clock className="size-4" /> {duration(secs)}</span> : null}
              </button>
              {isOpen ? (
                <ul id={panelId} className="divide-y divide-border">
                  {s.lectures.map((l) => {
                    const Icon = kindIcon[l.kind] ?? FileText
                    return (
                      <li key={l.key} className="flex items-center gap-3 px-4 py-3 pl-12 text-[15px] sm:px-5 sm:py-3.5 sm:pl-[4.5rem]">
                        <Icon className="size-[18px] shrink-0 text-muted" />
                        {l.is_preview && l.kind === 'video' ? (
                          <button type="button" onClick={() => onPreview({ key: l.key, title: l.title })} className="flex-1 text-left font-medium text-primary hover:underline">
                            {l.title}
                          </button>
                        ) : (
                          <span className="flex-1">{l.title}</span>
                        )}
                        {l.is_preview ? <Badge tone="primary">Preview</Badge> : null}
                        {/* The price is shown, not sold, here. unlock_lecture grants a
                            LECTURE-scoped entitlement and creates no enrolment, and the
                            player still requires one — so a buy button would take tokens
                            and leave the learner with nothing to open. Re-enable once the
                            "start learning from an entitlement" endpoint exists (K02). */}
                        {!l.is_preview && l.token_price ? (
                          <Badge tone="neutral" title="Unlock this lecture with tokens">
                            <Coins /> {count(l.token_price)}
                          </Badge>
                        ) : null}
                        <span className="text-right text-sm whitespace-nowrap text-muted">
                          <span className="hidden capitalize sm:inline">{l.kind === 'video' ? 'Video' : l.kind === 'article' ? 'Reading' : l.kind.replace('_', ' ')} · </span>
                          {l.duration_sec ? duration(l.duration_sec) : '—'}
                        </span>
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

function Reviews({ course }: { course: Detail }) {
  const total = Object.values(course.rating_breakdown).reduce((a, b) => a + b, 0)
  return (
    <section aria-labelledby="reviews" className="scroll-mt-36 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-primary"><Award className="size-5" /></span><h2 id="reviews" className="text-lg font-bold tracking-tight">Learner reviews</h2></div>
      {!course.rating_count ? (
        <p className="mt-4 text-sm text-muted">No ratings yet. Learners can rate the course once they have started it.</p>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-end gap-2">
            <p className="text-4xl font-bold tracking-tight tabular">{course.rating_avg.toFixed(1)}</p>
            <p className="pb-1 text-sm text-muted">out of 5</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><Rating value={course.rating_avg} /><span className="text-xs text-muted">({course.rating_count} reviews)</span></div>
          <div className="mt-5 grid gap-2.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = course.rating_breakdown[String(star)] ?? 0
              const p = total ? (n / total) * 100 : 0
              return <div key={star} className="flex items-center gap-2 text-xs"><span className="w-4 font-medium">{star}</span><span className="text-warning">★</span><Progress value={p} tone="warning" className="h-2 flex-1" label={`${star} star ratings`} /><span className="w-9 text-right text-muted tabular">{Math.round(p)}%</span></div>
            })}
          </div>
        </div>
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

function levelLabel(level: string) {
  if (!level || level === 'all') return 'All levels'
  return level.replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function CourseStats({ course }: { course: Detail }) {
  const activities = course.sections.flatMap((section) => section.lectures)
  const lessons = activities.filter((activity) => activity.kind !== 'quiz' && activity.kind !== 'assignment').length
  const quizzes = activities.filter((activity) => activity.kind === 'quiz').length
  const assignments = activities.filter((activity) => activity.kind === 'assignment').length
  const hasAssessment = quizzes + assignments > 0
  const hasCertificate = !!course.cpd_hours
  const stats = [
    [Layers3, course.sections.length, 'Modules'],
    [PlayCircle, lessons, 'Lessons'],
    [HelpCircle, quizzes, 'Quizzes'],
    [ListChecks, assignments, 'Assignments'],
    [GraduationCap, hasAssessment ? 'Included' : 'None', 'Assessment'],
    [Medal, hasCertificate ? 'Included' : 'Not listed', 'Certificate'],
    [Clock, duration(course.total_duration_sec), 'Total duration'],
  ] as const

  return (
    <section aria-label="Course summary" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface shadow-sm sm:grid-cols-4 xl:grid-cols-7">
      {stats.map(([Icon, value, label], index) => <div key={label} className={cn('flex min-h-[76px] items-center justify-center gap-2.5 border-border px-2.5 py-3', index > 0 && 'border-l', index > 1 && 'max-sm:border-t', index > 3 && 'max-xl:border-t')}><Icon className="size-6 shrink-0 text-primary" /><div className="min-w-0"><p className="truncate text-[15px] font-bold">{value}</p><p className="text-xs leading-tight text-muted">{label}</p></div></div>)}
    </section>
  )
}

function BuyBox({ course }: { course: Detail }) {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const { code } = useCurrency()
  const v = course.viewer
  const needLogin = () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
  const addToCart = useAddToCart()
  const checkout = useCheckout()
  const planEnroll = usePlanEnroll()
  const instalmentOffer = useCourseInstalmentOffer(course.id, !!me)
  const startInstalments = useStartCourseInstalments()
  const free = !!course.price?.free
  // Resolver is the authority: if the person already has access (token unlock, package,
  // subscription, legacy purchase) we must not show a purchase prompt. Only ask the server
  // when they aren't already known to own it through an enrolment or by teaching it.
  const b2cEligible = !!me && !v.enrollment_id && !v.is_instructor && !v.plan_access
  const access = useAccess('course', course.id, b2cEligible)
  const alreadyHasAccess = b2cEligible && access.data?.allowed === true
  const tokenCoursePrice = course.full_course_token_price ?? null
  const highlights: Array<[LucideIcon, string, string]> = [
    [Clock, 'Duration', duration(course.total_duration_sec)],
    [BarChart3, 'Level', levelLabel(course.level)],
    [Laptop, 'Delivery', 'Online (self-paced)'],
    [Globe, 'Access', course.access_days ? `${course.access_days} days` : 'No expiry'],
    [Languages, 'Language', 'English'],
  ]
  if (course.cpd_hours) highlights.push([Award, 'Certificate', `${course.cpd_hours} CPD hours`])

  // Buying with cash unlocks the whole course, and replay is free for as long as access
  // lasts. `access_days` is admin-configured; none set means no expiry.
  const accessLine = course.access_days
    ? `Full course · rewatch for ${course.access_days} days`
    : 'Full course · rewatch any time, no expiry'

  const fail = (e: unknown) => toast.error((e as Error).message)
  const add = () => addToCart.mutate(course.id, { onSuccess: () => authAlert({ kind: 'cart', title: 'Added to your cart', text: course.title, autoClose: 3500, action: { label: 'View cart', onClick: () => navigate('/cart') } }), onError: fail })
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
  const beginInstalments = () => {
    if (!me) return needLogin()
    startInstalments.mutate(course.id, {
      onSuccess: () => navigate('/account/instalments'),
      onError: fail,
    })
  }

  return (
    <Card className="overflow-hidden rounded-2xl shadow-[0_10px_35px_rgba(31,38,46,0.09)]">
      <div className="p-5 sm:p-6">
        {v.enrollment_id ? (
          <>
            <p className="text-lg font-bold">You're enrolled</p>
            <Progress value={v.progress_pct ?? 0} className="mt-3" label="Course progress" />
            <p className="mt-2 text-sm text-muted">{Math.round(v.progress_pct ?? 0)}% complete</p>
            <Button size="lg" className="mt-4 h-12 w-full text-base" asChild>
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
            <Button size="lg" className="mt-4 h-12 w-full text-base" loading={planEnroll.isPending} onClick={() => planEnroll.mutate(course.id, { onSuccess: () => navigate(`/learn/${course.slug}`), onError: fail })}>
              <PlayCircle /> Start learning
            </Button>
          </>
        ) : alreadyHasAccess ? (
          <>
            <Badge tone="success">
              <Check /> {ACCESS_SOURCE_LABEL[access.data!.source] ?? 'You have access'}
            </Badge>
            <Button size="lg" className="mt-4 h-12 w-full text-base" asChild>
              <Link to={`/learn/${course.slug}`}>
                <PlayCircle /> Start learning
              </Link>
            </Button>
          </>
        ) : free ? (
          <>
            <p className="text-[28px] font-bold tracking-tight">Free</p>
            <Button size="lg" className="mt-4 h-12 w-full text-base" loading={checkout.isPending} onClick={() => (me ? buyNow() : needLogin())}>
              <PlayCircle /> Enrol for free
            </Button>
          </>
        ) : course.price ? (
          <>
            <Price price={course.price} className="text-[28px] [&>span:first-child]:text-[28px] [&>span:first-child]:font-bold" />
            <div className="mt-4">
              <Button size="lg" className="h-12 w-full bg-primary text-base text-on-primary hover:bg-primary/90" loading={addToCart.isPending} onClick={() => (me ? (v.in_cart ? navigate('/cart') : add()) : needLogin())}>
                <ShoppingCart /> {v.in_cart ? 'Go to cart' : 'Add to cart'}
              </Button>
            </div>
            <Button size="lg" variant="secondary" className="mt-3 h-12 w-full border-primary text-base text-primary hover:bg-primary-soft" onClick={() => (me ? navigate(`/checkout/pay/${course.slug}`) : needLogin())}>
              <Zap /> Buy now
            </Button>
            <p className="mt-3 text-center text-xs text-muted">{accessLine} · refunds reviewed by our team</p>
            {tokenCoursePrice ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium text-muted">Or unlock the whole course with tokens</p>
                <UnlockButton scope="course" targetId={course.id} tokenPrice={tokenCoursePrice} title={course.title} size="lg" className="w-full" onUnlocked={() => navigate(`/learn/${course.slug}`)} />
              </div>
            ) : null}
          </>
        ) : tokenCoursePrice ? (
          <>
            <p className="text-sm text-muted">Unlock this course with tokens.</p>
            <div className="mt-3">
              <UnlockButton scope="course" targetId={course.id} tokenPrice={tokenCoursePrice} title={course.title} size="lg" className="w-full" onUnlocked={() => navigate(`/learn/${course.slug}`)} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">This course is not sold on its own.</p>
        )}
        {!v.enrollment_id && !v.is_instructor ? <WishlistHeart courseId={course.id} slug={course.slug} title={course.title} initialSaved={v.in_wishlist} label="Save to wishlist" className="mt-3 !h-12 !w-full px-5" /> : null}
        {instalmentOffer.data?.enabled && (!alreadyHasAccess || instalmentOffer.data.existing_learner_allowed) && (!v.enrollment_id || instalmentOffer.data.existing_learner_allowed) ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-2/60 p-4">
            <p className="font-semibold">Pay in fixed monthly instalments</p>
            <p className="mt-1 text-sm text-muted">{instalmentOffer.data.instalment_count} payments totalling {money(instalmentOffer.data.total_minor, instalmentOffer.data.currency, instalmentOffer.data.exponent)}. This is a fixed course purchase, not a subscription.</p>
            <ol className="mt-3 grid gap-1 text-xs text-muted">
              {instalmentOffer.data.payments.map((payment) => (
                <li key={payment.number} className="flex justify-between gap-3"><span>Payment {payment.number} · {shortDate(payment.due_at)}</span><span className="tabular">{money(payment.amount_minor, instalmentOffer.data.currency, instalmentOffer.data.exponent)}</span></li>
              ))}
            </ol>
            <Button size="lg" variant="secondary" className="mt-3 w-full" loading={startInstalments.isPending} onClick={beginInstalments}>
              Start fixed instalment plan
            </Button>
            <p className="mt-2 text-xs text-muted">Payments are not collected here yet. Paid stages become available after payment is confirmed.</p>
          </div>
        ) : null}
        <h3 className="mt-6 border-t border-border pt-5 text-lg font-bold">Course highlights</h3>
        <ul className="mt-2 divide-y divide-border text-[15px]">
          {highlights.map(([Icon, label, value]) => {
            const I = Icon
            return (
              <li key={label} className="flex items-center gap-3 py-3.5">
                <I className="size-5 shrink-0 text-text" />
                <span className="font-medium">{label}</span>
                <span className="ml-auto text-right text-muted">{value}</span>
              </li>
            )
          })}
        </ul>
        {course.cpd_hours ? <div className="mt-4 flex gap-3 rounded-xl bg-primary-soft/55 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary"><Medal className="size-5" /></span>
          <div><p className="text-sm font-bold">Certificate included</p><p className="mt-1 text-xs leading-relaxed text-muted">Earn a course certificate ({course.cpd_hours} CPD hours) after successful completion.</p></div>
        </div> : null}
      </div>
    </Card>
  )
}

function CourseSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-72" />
      <div className="mt-7 grid gap-8 lg:grid-cols-[410px_minmax(0,1fr)]">
        <Skeleton className="aspect-[1.84/1] w-full rounded-2xl" />
        <div className="py-4"><Skeleton className="h-8 w-36" /><Skeleton className="mt-4 h-12 w-2/3" /><Skeleton className="mt-4 h-6 w-4/5" /></div>
      </div>
      <Skeleton className="mt-8 h-16 w-full" />
    </div>
  )
}

export function CoursePage() {
  const { slug = '' } = useParams()
  const { data: c, isLoading, error, refetch } = useCourse(slug)
  const related = useRelatedCourses(slug)
  const relatedFallback = useCourses({ sort: 'popular', limit: 6 }, (related.data?.length ?? 0) < 3)
  const { data: cats } = useCategories()
  const [preview, setPreview] = useState<{ key: string; title: string } | null>(null)
  const [activeSection, setActiveSection] = useState('#curriculum')
  const [aboutExpanded, setAboutExpanded] = useState(false)
  const companyAccount = !!useMe().data?.memberships.length
  // Return to the previous page (e.g. the courses list); fall back to the catalogue.
  if (isLoading) return <CourseSkeleton />
  if (error || !c) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
  const firstPreview = c.sections.flatMap((s) => s.lectures).find((l) => l.is_preview && l.kind === 'video')
  const catSlug = cats?.find((x) => x.name === c.category)?.slug
  const relatedCourses = [...(related.data ?? []), ...(relatedFallback.data?.items ?? [])]
    .filter((course, index, courses) => course.slug !== c.slug && courses.findIndex((candidate) => candidate.id === course.id) === index)
    .slice(0, 3)
  const relatedLoading = related.isLoading || (relatedCourses.length < 3 && relatedFallback.isLoading)
  const tabs = [
    ['#curriculum', 'Curriculum', BookOpen],
    ['#overview', 'Overview', CircleHelp],
    ['#learning-outcomes', 'What you’ll learn', Target],
    ['#instructors', 'Instructor', Users],
    ['#reviews', `Reviews${c.rating_count ? ` (${c.rating_count})` : ''}`, Medal],
    ['#faqs', 'FAQs', CircleHelp],
  ] as const

  return (
    <div className="bg-[#fcfaf8] py-5 sm:py-6 dark:bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 overflow-hidden text-sm text-muted">
          <Link to="/" aria-label="Home" className="shrink-0 transition-colors hover:text-primary"><Home className="size-4" /></Link>
          <ChevronRight className="size-3.5 shrink-0 text-subtle" />
          <Link to="/courses" className="shrink-0 transition-colors hover:text-primary">Courses</Link>
          {c.category ? <><ChevronRight className="size-3.5 shrink-0 text-subtle" /><Link to={catSlug ? `/courses?category=${catSlug}` : '/courses'} className="shrink-0 transition-colors hover:text-primary">{c.category}</Link></> : null}
          <ChevronRight className="size-3.5 shrink-0 text-subtle" />
          <span className="truncate font-semibold text-text">{c.title}</span>
        </nav>

        <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] lg:items-start xl:grid-cols-[minmax(0,7fr)_minmax(360px,3fr)] xl:gap-7">
          <section aria-labelledby="course-title" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[400px_minmax(0,1fr)] xl:items-center xl:gap-7">
            <div className="relative isolate aspect-[1.84/1] overflow-hidden rounded-2xl bg-nav shadow-sm" style={{ viewTransitionName: 'course-cover' }}>
              <CourseThumb src={c.thumbnail_url} title={c.title} category={c.category} className="absolute inset-0 size-full rounded-none" />
              {firstPreview ? (
                <button type="button" onClick={() => setPreview({ key: firstPreview.key, title: firstPreview.title })} className="group absolute inset-0 flex items-center justify-center bg-black/5 text-white transition-colors hover:bg-black/20 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white" aria-label={`Preview ${firstPreview.title}`}>
                  <span className="flex size-16 items-center justify-center rounded-full bg-white text-primary shadow-lg transition-transform group-hover:scale-110"><PlayCircle className="size-8" /></span>
                  <span className="absolute bottom-4 left-4 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">Preview course · {firstPreview.duration_sec ? duration(firstPreview.duration_sec) : 'Watch now'}</span>
                </button>
              ) : null}
            </div>
            <div className="min-w-0 py-1">
              <div className="flex flex-wrap items-center gap-2">
                {c.category ? <Badge tone="primary" className="px-3 py-1.5"><ShieldCheck /> {c.category}</Badge> : null}
                {c.student_count > 50 ? <Badge tone="warning">Bestseller</Badge> : null}
              </div>
              <h1 id="course-title" className="mt-3 text-3xl leading-tight font-bold tracking-[-0.035em] sm:text-[38px] lg:text-[42px]" style={{ viewTransitionName: 'course-title' }}>{c.title}</h1>
              {c.subtitle ? <p className="mt-3 max-w-3xl text-base leading-relaxed text-text sm:text-lg">{c.subtitle}</p> : null}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-[15px]">
                <Rating value={c.rating_avg} count={c.rating_count} size="md" />
                <span className="hidden h-7 w-px bg-border sm:block" />
                <span className="inline-flex items-center gap-2 text-muted"><Users className="size-5 text-text" /> <strong className="font-semibold text-text">{count(c.student_count)}</strong> learners</span>
                <span className="hidden h-7 w-px bg-border sm:block" />
                <span className="inline-flex items-center gap-2 text-muted"><BarChart3 className="size-5 text-text" /> {levelLabel(c.level)}</span>
              </div>
              {c.instructor_profiles.length ? <div className="mt-4 flex min-w-0 items-center gap-3"><Avatar name={c.instructor_profiles[0].name} src={c.instructor_profiles[0].avatar_url} size="sm" /><div className="min-w-0"><p className="text-[15px] font-semibold text-primary">{c.instructor_profiles[0].name}</p><p className="line-clamp-2 text-[13px] text-muted">{c.instructor_profiles[0].headline || 'Course Instructor'}</p></div></div> : null}
            </div>
          </section>

          <aside aria-label="Purchase course" className="min-w-0 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:self-start">
            {companyAccount ? (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">This is a company account. To buy this course for yourself, sign up with a personal email.</p>
            ) : <BuyBox course={c} />}
            <TeamBuy courseId={c.id} title={c.title} />
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2"><CourseStats course={c} /></div>

          <nav aria-label="Course sections" className="min-w-0 overflow-x-auto border-b border-border scrollbar-none lg:col-start-1 lg:row-start-3">
            <div className="flex min-w-max">
              {tabs.map(([href, label, Icon]) => <a key={href} href={href} aria-current={activeSection === href ? 'page' : undefined} onClick={() => setActiveSection(href)} className={cn('flex items-center gap-2 border-b-2 px-4 py-3.5 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary', activeSection === href ? 'border-primary bg-primary-soft/60 text-primary' : 'border-transparent text-text hover:border-primary/40 hover:text-primary')}><Icon className="size-5" />{label}</a>)}
            </div>
          </nav>

          <div className="min-w-0 lg:col-start-1 lg:row-start-4">
            <Curriculum sections={c.sections} onPreview={setPreview} />
          </div>

          <div id="overview" className="grid min-w-0 scroll-mt-24 gap-4 md:grid-cols-3 lg:col-span-2">
            <section aria-labelledby="about" className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-primary"><FileText className="size-5" /></span><h2 id="about" className="text-lg font-bold tracking-tight">About this course</h2></div>
              <div className={cn('mt-3 max-w-none overflow-hidden text-[15px] leading-relaxed text-muted [&_a]:text-primary [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3', !aboutExpanded && 'max-h-32')} dangerouslySetInnerHTML={{ __html: c.description }} />
              {c.description.length > 420 ? <button type="button" onClick={() => setAboutExpanded((value) => !value)} className="mt-1 text-[15px] font-semibold text-primary hover:underline">{aboutExpanded ? 'Show less' : 'Read more →'}</button> : null}
            </section>
            <section id="learning-outcomes" className="scroll-mt-24 overflow-hidden rounded-2xl border border-primary/15 bg-surface shadow-sm">
              <div className="flex items-center gap-3 bg-primary-soft/55 px-5 py-4"><Target className="size-6 text-primary" /><h2 className="text-lg font-bold tracking-tight">What you’ll learn</h2></div>
              {c.topics.length ? <ul className="grid gap-3 p-5">{c.topics.map((topic) => <li key={topic} className="flex items-start gap-3 text-[15px] leading-relaxed"><Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={3} /> <span>{topic}</span></li>)}</ul> : <p className="p-5 text-[15px] text-muted">Learning outcomes have not been added yet.</p>}
            </section>
            <section id="instructors" aria-labelledby="instructors-title" className="scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-primary"><Users className="size-5" /></span><h2 id="instructors-title" className="text-lg font-bold tracking-tight">Instructor{c.instructor_profiles.length > 1 ? 's' : ''}</h2></div>
              {c.instructor_profiles.length ? <div className="mt-4 grid gap-4">{c.instructor_profiles.map((instructor) => <div key={instructor.id} className="flex items-center gap-3"><Avatar name={instructor.name} src={instructor.avatar_url} size="md" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-primary">{instructor.name}</p><p className="text-xs text-muted">{instructor.headline || 'Course instructor'}</p></div></div>)}</div> : <p className="mt-4 text-sm text-muted">Instructor information is not available yet.</p>}
            </section>
          </div>

          <div className="min-w-0 lg:col-span-2"><Reviews course={c} /></div>

          <section id="faqs" aria-labelledby="faqs-title" className="min-w-0 scroll-mt-24 rounded-2xl border border-border bg-surface p-6 shadow-sm lg:col-span-2">
            <h2 id="faqs-title" className="text-xl font-bold tracking-tight">FAQs</h2>
            <p className="mt-3 text-[15px] text-muted">No FAQs have been added for this course yet.</p>
          </section>

          {relatedLoading || relatedCourses.length > 0 ? <section aria-labelledby="related-courses" className="min-w-0 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-4"><h2 id="related-courses" className="text-2xl font-bold tracking-tight">Related courses</h2><Link to="/courses" className="text-sm font-semibold text-primary hover:underline">View all courses →</Link></div>
            <div className="grid grid-cols-1 items-stretch gap-5 min-[560px]:grid-cols-2 lg:grid-cols-3 [&>div]:min-h-full">
              {relatedLoading ? Array.from({ length: 3 }, (_, index) => <CourseCardSkeleton key={index} />) : relatedCourses.map((course) => <CourseCard key={course.id} course={course} />)}
            </div>
          </section> : null}
        </div>
      </div>
      <PreviewDialog slug={c.slug} lecture={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
