import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Navigate, useLocation, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/identity/auth'
import { type StudioCourse, useStudioCourse } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { Link, NavLink } from '@/lib/router'

import { CertificateTab } from './builder/CertificateTab'
import { CouponsTab } from './builder/CouponsTab'
import { CurriculumTab } from './builder/CurriculumTab'
import { DetailsTab } from './builder/DetailsTab'
import { PricingTab } from './builder/PricingTab'
import { PublishTab } from './builder/PublishTab'
import { VERSION_STATUS } from './builder/status'

type Tab = 'details' | 'curriculum' | 'pricing' | 'coupons' | 'certificate' | 'publish'

const COURSE_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'info' | 'warning' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  unlisted: { label: 'Unlisted', tone: 'info' },
  archived: { label: 'Archived', tone: 'warning' },
}

/** Which tabs this course has: company courses aren't sold; coupons are for marketplace courses. */
function tabsFor(course: StudioCourse) {
  const tabs: { id: Tab; label: string; to: string }[] = [
    { id: 'details', label: 'Details', to: '' },
    { id: 'curriculum', label: 'Curriculum', to: 'curriculum' },
  ]
  if (course.ownership !== 'organization') tabs.push({ id: 'pricing', label: 'Pricing', to: 'pricing' })
  if (course.ownership === 'instructor') tabs.push({ id: 'coupons', label: 'Coupons', to: 'coupons' })
  tabs.push({ id: 'certificate', label: 'Certificate', to: 'certificate' })
  tabs.push({ id: 'publish', label: 'Publish', to: 'publish' })
  return tabs
}

function BuilderSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading course">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-6 h-10 w-full max-w-xl" />
      <Skeleton className="mt-6 h-72 w-full rounded-xl" />
    </div>
  )
}

export function CourseBuilderPage() {
  const { courseId, tab: tabParam } = useParams()
  const { pathname } = useLocation()
  const { data: course, isPending, error, refetch } = useStudioCourse(courseId)
  const { data: me } = useMe()
  const base = `/studio/courses/${courseId}`

  if (isPending) return <BuilderSkeleton />
  if (error || !course) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <Card className="mx-auto max-w-lg">
        {missing ? (
          <EmptyState
            icon={<ArrowLeft />}
            title="Course not found"
            body="It may have been deleted, or it isn't one of your courses."
            action={
              <Button asChild variant="secondary">
                <Link to="/studio/courses">Back to my courses</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState onRetry={() => void refetch()} />
        )}
      </Card>
    )
  }

  const tabs = tabsFor(course)
  const tab: Tab | null = pathname.endsWith('/curriculum') ? 'curriculum' : !tabParam ? 'details' : (tabs.find((t) => t.id === tabParam)?.id ?? null)
  if (!tab) return <Navigate to={base} replace />

  const v = course.working_version
  const problems = v?.checklist.length ?? 0
  const status = COURSE_STATUS[course.status] ?? { label: course.status, tone: 'neutral' as const }
  const vStatus = v ? (VERSION_STATUS[v.status] ?? { label: v.status, tone: 'neutral' as const }) : null
  const live = course.status === 'published' || course.status === 'unlisted'
  // Staff mode: a platform-owned course (console > Courses > Create company course) is
  // built here by staff; it belongs to the platform, not to an instructor.
  const staffMode = course.ownership === 'platform' && !!me?.is_staff

  return (
    <div className="min-w-0 animate-reveal">
      {staffMode ? (
        <Link to="/console/courses?tab=company" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> Console courses
        </Link>
      ) : (
        <Link to="/studio/courses" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> My courses
        </Link>
      )}
      <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-[26px]">{course.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {v && vStatus ? (
              <span className="inline-flex items-center gap-1.5">
                Version {v.number}
                <Badge tone={vStatus.tone}>{vStatus.label}</Badge>
              </span>
            ) : null}
            {course.ownership === 'organization' ? <Badge tone="outline">Company course</Badge> : null}
            {staffMode ? <Badge tone="primary">Platform course · staff mode</Badge> : null}
          </div>
        </div>
        {live ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`/courses/${course.slug}`}>
              <ExternalLink /> View on site
            </Link>
          </Button>
        ) : null}
      </div>

      <nav aria-label="Course builder" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 scrollbar-none sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {tabs.map((t) => (
            <li key={t.id}>
              <NavLink
                to={t.to ? `${base}/${t.to}` : base}
                end
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200',
                  tab === t.id ? 'text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary' : 'text-muted hover:text-text',
                )}
              >
                {t.label}
                {t.id === 'publish' && v && v.editable ? (
                  problems ? (
                    <Badge tone="warning" aria-label={`${problems} ${problems === 1 ? 'problem' : 'problems'} to fix`}>
                      {problems}
                    </Badge>
                  ) : (
                    <Badge tone="success">Ready</Badge>
                  )
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div key={tab} className="animate-reveal">
        {tab === 'details' ? <DetailsTab course={course} /> : null}
        {tab === 'curriculum' ? <CurriculumTab course={course} /> : null}
        {tab === 'pricing' ? <PricingTab course={course} /> : null}
        {tab === 'coupons' ? <CouponsTab course={course} /> : null}
        {tab === 'certificate' ? <CertificateTab course={course} /> : null}
        {tab === 'publish' ? <PublishTab course={course} /> : null}
      </div>
    </div>
  )
}
