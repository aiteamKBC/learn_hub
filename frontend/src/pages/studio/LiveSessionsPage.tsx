import { CalendarClock, Radio, Video } from 'lucide-react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type StudioLiveSession, useStudioLiveSessions } from '@/features/studio/api'
import { Link } from '@/lib/router'

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const providerLabel: Record<string, string> = { teams: 'Microsoft Teams', manual: 'Live link' }

function SessionRow({ s }: { s: StudioLiveSession }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 first:pt-0 last:pb-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
        <Video className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{s.title}</p>
        <Link to={`/studio/courses/${s.course_id}/curriculum`} className="truncate text-sm text-muted hover:text-primary hover:underline">
          {s.course_title}
        </Link>
      </div>
      <div className="text-sm">
        <p className="font-medium tabular">{when.format(new Date(s.starts_at))}</p>
        <p className="text-muted">
          {s.duration_min ? `${s.duration_min} min · ` : ''}
          {providerLabel[s.provider] ?? 'Live link'}
        </p>
      </div>
      {s.is_upcoming && s.join_url ? (
        <Button asChild size="sm" variant="secondary">
          <a href={s.join_url} target="_blank" rel="noreferrer">
            <Radio /> Join
          </a>
        </Button>
      ) : null}
    </li>
  )
}

/** Live sessions: every scheduled live class across the instructor's published courses. */
export function LiveSessionsPage() {
  const { data, isLoading, error, refetch } = useStudioLiveSessions()
  const { upcoming, past } = useMemo(() => {
    const list = data ?? []
    return { upcoming: list.filter((s) => s.is_upcoming), past: [...list.filter((s) => !s.is_upcoming)].reverse() }
  }, [data])

  return (
    <div className="min-w-0">
      <PageHeader title="Live sessions" description="Scheduled live classes across your courses — soonest first." />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<CalendarClock />}
              title="No live sessions scheduled"
              body="Add a live session lecture to a course's curriculum and it will appear here."
              action={
                <Button asChild>
                  <Link to="/studio/courses">Go to my courses</Link>
                </Button>
              }
              className="py-8"
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-5">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
              Upcoming {upcoming.length ? <Badge tone="info">{upcoming.length}</Badge> : null}
            </h2>
            <Card>
              <CardBody>
                {upcoming.length ? (
                  <ul className="animate-reveal divide-y divide-border">
                    {upcoming.map((s) => (
                      <SessionRow key={`${s.course_id}-${s.lecture_key}`} s={s} />
                    ))}
                  </ul>
                ) : (
                  <p className="py-4 text-center text-sm text-muted">No upcoming sessions. New ones you schedule show up here.</p>
                )}
              </CardBody>
            </Card>
          </section>
          {past.length ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted">Past</h2>
              <Card>
                <CardBody>
                  <ul className="divide-y divide-border opacity-80">
                    {past.map((s) => (
                      <SessionRow key={`${s.course_id}-${s.lecture_key}`} s={s} />
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
