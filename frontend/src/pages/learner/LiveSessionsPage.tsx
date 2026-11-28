import { CalendarClock, Clock, ExternalLink, PlayCircle, Radio, Video } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type MyLiveSession, useMyLiveSessions } from '@/features/learning/api'
import { Link } from '@/lib/router'

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const providerLabel: Record<string, string> = { teams: 'Microsoft Teams', manual: 'Live link' }

/** A friendly "Today" / "Tomorrow" / weekday label, with the time. */
function whenLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000)
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : dayFmt.format(d)
  return { day, time: timeFmt.format(d), soon: days === 0 }
}

function SessionRow({ s, featured = false }: { s: MyLiveSession; featured?: boolean }) {
  const { day, time, soon } = whenLabel(s.starts_at)
  const lecturePath = `/learn/${s.course_slug}/lecture/${s.lecture_key}`
  return (
    <article
      className={featured
        ? 'relative overflow-hidden rounded-2xl border border-primary/30 bg-primary-soft/50 p-5 shadow-sm'
        : 'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow'}
    >
      {featured ? (
        <>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Radio className="size-3.5" /> Next live session
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-tight">{s.title}</h2>
              <Link to={`/learn/${s.course_slug}`} className="mt-0.5 inline-block truncate text-sm text-muted hover:text-primary hover:underline">
                {s.course_title}
              </Link>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <CalendarClock className="size-4 text-primary" /> {day} · {time}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <Clock className="size-4" /> {s.duration_min ? `${s.duration_min} min` : 'Live'} · {providerLabel[s.provider] ?? 'Live link'}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2">
              {s.join_url ? (
                <Button asChild>
                  <a href={s.join_url} target="_blank" rel="noreferrer"><Radio /> Join now</a>
                </Button>
              ) : (
                <Button asChild variant="secondary">
                  <Link to={lecturePath}><PlayCircle /> Open in course</Link>
                </Button>
              )}
              {!s.join_url ? <span className="text-center text-[11px] text-muted">Join opens 15 min before</span> : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
            <span className="text-[10px] font-semibold tracking-wide uppercase">{soon ? 'Today' : day.split(' ')[0]}</span>
            <span className="text-sm font-bold tabular">{time}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{s.title}</p>
            <Link to={`/learn/${s.course_slug}`} className="truncate text-sm text-muted hover:text-primary hover:underline">
              {s.course_title}
            </Link>
          </div>
          <span className="hidden text-sm text-muted sm:block">
            {day} · {s.duration_min ? `${s.duration_min} min` : 'Live'}
          </span>
          {s.join_url ? (
            <Button asChild size="sm"><a href={s.join_url} target="_blank" rel="noreferrer"><Radio /> Join</a></Button>
          ) : (
            <Button asChild size="sm" variant="secondary"><Link to={lecturePath}>Open <ExternalLink /></Link></Button>
          )}
        </>
      )}
    </article>
  )
}

export function LiveSessionsPage() {
  const { data, isLoading, error, refetch } = useMyLiveSessions()
  const { upcoming, past } = useMemo(() => {
    const list = data ?? []
    return { upcoming: list.filter((s) => s.is_upcoming), past: [...list.filter((s) => !s.is_upcoming)].reverse() }
  }, [data])
  const [next, ...rest] = upcoming

  return (
    <>
      <PageHeader title="Live sessions" description="Join scheduled live classes from the courses you're enrolled in — soonest first." />

      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card className="rounded-2xl">
          <EmptyState
            icon={<Video />}
            title="No live sessions scheduled"
            body="When a course you're enrolled in schedules a live class, it will show up here with a join link."
            action={<Button asChild><Link to="/courses">Browse courses</Link></Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-8">
          <section className="grid gap-4">
            {next ? <SessionRow s={next} featured /> : (
              <Card className="rounded-2xl p-5">
                <p className="text-sm text-muted">No upcoming sessions right now. Past sessions are listed below.</p>
              </Card>
            )}
            {rest.length ? (
              <div className="stagger grid gap-3">
                {rest.map((s) => <SessionRow key={`${s.course_id}-${s.lecture_key}`} s={s} />)}
              </div>
            ) : null}
          </section>

          {past.length ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">Past sessions</h2>
              <div className="grid gap-3 opacity-80">
                {past.map((s) => <SessionRow key={`${s.course_id}-${s.lecture_key}`} s={s} />)}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  )
}
