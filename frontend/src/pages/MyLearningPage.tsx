import { BookOpen, Building2, CalendarClock, LayoutGrid, List, PlayCircle } from 'lucide-react'
import { useState } from 'react'

import { LearnerHeader } from '@/components/layout/learner-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/identity/auth'
import { useMyCourses } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** The replay window. The server already enforces `access_expires_at` and refuses the
 * player once it passes, so the learner needs to see it coming rather than find the
 * course silently stop working. No date set means access does not expire. */
function AccessNote({ expiresAt }: { expiresAt: string | null | undefined }) {
  if (!expiresAt) return null
  const ends = new Date(expiresAt)
  const days = Math.ceil((ends.getTime() - Date.now()) / 86_400_000)
  if (days <= 0) {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-danger">
        <CalendarClock className="size-3.5" /> Access ended {shortDate(expiresAt)}
      </p>
    )
  }
  return (
    <p className={cn('mt-2 inline-flex items-center gap-1 text-xs', days <= 14 ? 'font-medium text-warning' : 'text-muted')}>
      <CalendarClock className="size-3.5" /> Access until {shortDate(expiresAt)}
      {days <= 14 ? ` · ${days} ${days === 1 ? 'day' : 'days'} left` : ''}
    </p>
  )
}

export function MyLearningPage() {
  const { data: me } = useMe()
  const { data, isLoading, error, refetch } = useMyCourses()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const items = data?.items ?? []
  const current = items.find((i) => i.progress_pct > 0 && i.progress_pct < 100) ?? items[0]

  return (
    <>
      <LearnerHeader>
        <div className="mb-6">
          <p className="text-sm text-muted">
            {greeting()}, {me?.full_name?.split(' ')[0] || 'there'}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-4xl">
            Continue your <span className="text-primary">learning</span>
          </h1>
        </div>
      </LearnerHeader>

      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-40 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-64 rounded-lg" />
            ))}
          </div>
        </div>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<BookOpen />} title="No courses yet" body="Courses you buy, and training your company assigns, appear here." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} />
        </Card>
      ) : (
        <>
          {current ? (
            <Card className="flex animate-reveal flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-center sm:p-6">
              <CourseThumb src={current.thumbnail_url} title={current.title} className="sm:w-56" />
              <div className="min-w-0 flex-1">
                <Badge tone="primary">{current.progress_pct > 0 ? 'In progress' : 'Up next'}</Badge>
                <h2 className="mt-2 text-lg font-semibold tracking-tight">{current.title}</h2>
                <p className="text-sm text-muted">{current.instructors.join(', ')}</p>
                <div className="mt-4 flex items-center gap-3">
                  <Progress value={current.progress_pct} label="Progress" />
                  <span className="text-xs text-muted tabular">{Math.round(current.progress_pct)}%</span>
                </div>
              </div>
              <Button size="lg" asChild>
                <Link to={`/learn/${current.slug}`}>
                  <PlayCircle /> {current.progress_pct > 0 ? 'Continue' : 'Start'}
                </Link>
              </Button>
            </Card>
          ) : null}
          <div className="mt-10 mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">My courses</h2>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setView('grid')}
                aria-pressed={view === 'grid'}
                aria-label="Grid view"
                className={cn('flex size-8 items-center justify-center rounded-lg transition-colors', view === 'grid' ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
              >
                <LayoutGrid className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                aria-label="List view"
                className={cn('flex size-8 items-center justify-center rounded-lg transition-colors', view === 'list' ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
              >
                <List className="size-[18px]" />
              </button>
            </div>
          </div>
          {view === 'grid' ? (
            <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((c) => (
                <Link key={c.enrollment_id} to={`/learn/${c.slug}`} className="group rounded-2xl border border-border bg-surface p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow">
                  <CourseThumb src={c.thumbnail_url} title={c.title} />
                  <div className="px-1 pt-3 pb-1">
                    <h3 className="line-clamp-2 text-[15px] font-semibold group-hover:text-primary">{c.title}</h3>
                    {c.org_name ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                        <Building2 className="size-3.5" /> Assigned by {c.org_name}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted">{c.instructors.join(', ')}</p>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={c.progress_pct} tone={c.progress_pct >= 100 ? 'success' : 'primary'} label="Progress" />
                      <span className="text-xs text-muted tabular">{Math.round(c.progress_pct)}%</span>
                    </div>
                    <AccessNote expiresAt={c.access_expires_at} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="stagger grid gap-3">
              {items.map((c) => (
                <Link key={c.enrollment_id} to={`/learn/${c.slug}`} className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow">
                  <CourseThumb src={c.thumbnail_url} title={c.title} className="w-40 shrink-0 sm:w-48" />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-[15px] font-semibold group-hover:text-primary">{c.title}</h3>
                    {c.org_name ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                        <Building2 className="size-3.5" /> Assigned by {c.org_name}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted">{c.instructors.join(', ')}</p>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={c.progress_pct} tone={c.progress_pct >= 100 ? 'success' : 'primary'} label="Progress" />
                      <span className="text-xs text-muted tabular">{Math.round(c.progress_pct)}%</span>
                    </div>
                    <AccessNote expiresAt={c.access_expires_at} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
