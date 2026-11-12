import { BookOpen, CalendarDays, Clock, EyeOff, Flag, MapPin, Video } from 'lucide-react'
import { useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/misc'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

import { ENTITLEMENT, type MyProgramme, PROGRAMME, useMyProgrammes } from './agreements'
import { MODE_LABEL, type MyLiveCohort, useMyLive } from './api'
import { fullDate } from './format'
import { QueryBlock, StatusBadge } from './ui'

function Dates({ start, end }: { start?: string | null; end?: string | null }) {
  if (!start) return <span>Starts at your first session</span>
  return (
    <span>
      {shortDate(start)}
      {end ? ` – ${shortDate(end)}` : ''}
    </span>
  )
}

function Session({ s, ended }: { s: MyLiveCohort['sessions'][number]; ended: boolean }) {
  const done = s.status === 'completed'
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-4">
      <div className="min-w-0">
        <p className="font-medium">{s.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
          <Clock className="size-3.5" /> {fullDate(s.scheduled_at)} · {s.duration_min} min
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
          {s.delivery_mode === 'in_person' ? <MapPin className="size-3.5" /> : <Video className="size-3.5" />}
          {MODE_LABEL[s.delivery_mode] ?? s.delivery_mode}
          {s.location ? ` · ${s.location}` : ''}
        </p>
      </div>
      {done ? (
        <Badge tone="success">Done</Badge>
      ) : s.join_url ? (
        <Button asChild size="sm">
          <a href={s.join_url} target="_blank" rel="noopener noreferrer">
            <Video /> Join now
          </a>
        </Button>
      ) : ended ? (
        <span className="text-xs text-muted">The programme has ended.</span>
      ) : s.delivery_mode !== 'in_person' ? (
        <span className="text-xs text-muted">The join link appears 15 minutes before the start.</span>
      ) : null}
    </li>
  )
}

function CohortCard({ c }: { c: MyLiveCohort }) {
  const ended = c.programme_status === 'ended'
  return (
    <Card className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{c.course_title}</h2>
          <p className="text-sm text-muted">Arranged by {c.company_name}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge map={PROGRAMME} status={c.programme_status} />
          <Badge tone="outline">{MODE_LABEL[c.delivery_mode] ?? c.delivery_mode}</Badge>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Flag className="size-3.5" /> Programme: <Dates start={c.programme_start} end={c.programme_end} />
      </p>
      {c.sessions.length ? (
        <ol className="stagger grid gap-2">
          {c.sessions.map((s) => (
            <Session key={s.sequence} s={s} ended={ended} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Dates will appear here soon.</p>
      )}
      {c.more_sessions_hidden ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <EyeOff className="size-3.5" /> The rest of the timetable appears after your first session.
        </p>
      ) : null}
    </Card>
  )
}

function ProgrammeCard({ p }: { p: MyProgramme }) {
  return (
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{p.course_title}</h3>
          <p className="text-sm text-muted">Paid for by {p.company_name}</p>
        </div>
        <StatusBadge map={PROGRAMME} status={p.programme_status} />
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted">Programme</dt>
          <dd>
            <Dates start={p.programme_start} end={p.programme_end} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-muted">Lessons</dt>
          <dd className="flex items-center gap-2">
            {p.access_open ? (p.access_expires_at ? `Open until ${shortDate(p.access_expires_at)}` : 'Open') : 'Closed'}
            <StatusBadge map={ENTITLEMENT} status={p.entitlement_status} />
          </dd>
        </div>
      </dl>
      {p.programme_status === 'ended' && p.access_open ? <p className="text-xs text-muted">Your programme has ended. You can still watch the lessons and recordings.</p> : null}
      {p.access_open ? (
        <Button asChild size="sm" variant="secondary" className="justify-self-start">
          <Link to={`/learn/${p.course_slug}`}>
            <BookOpen /> Open course
          </Link>
        </Button>
      ) : null}
    </Card>
  )
}

export function MyLiveTrainingPage() {
  const q = useMyLive()
  const programmes = useMyProgrammes()
  useEffect(() => {
    document.title = 'Company training · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Company training" description="Live sessions and courses your company has arranged for you." />
      <div className="grid gap-8">
        <section aria-labelledby="live-h" className="grid gap-4">
          <h2 id="live-h" className="text-lg font-semibold">
            Live training
          </h2>
          <QueryBlock
            query={q}
            rows={2}
            empty={{
              icon: <CalendarDays />,
              title: 'No live training yet',
              body: 'When your company books you onto a live course, your sessions will show here.',
            }}
          >
            {(rows) => (
              <div className="stagger grid gap-4 lg:grid-cols-2">
                {rows.map((c) => (
                  <CohortCard key={c.cohort_id} c={c} />
                ))}
              </div>
            )}
          </QueryBlock>
        </section>
        <section aria-labelledby="courses-h" className="grid gap-4">
          <h2 id="courses-h" className="text-lg font-semibold">
            Courses from your company
          </h2>
          <QueryBlock
            query={programmes}
            rows={2}
            empty={{
              icon: <BookOpen />,
              title: 'No company courses yet',
              body: 'Courses your company gives you a seat on will show here.',
              action: (
                <Button asChild variant="secondary">
                  <Link to="/learn">Go to my learning</Link>
                </Button>
              ),
            }}
          >
            {(rows) => (
              <div className="stagger grid gap-4 lg:grid-cols-2">
                {rows.map((p) => (
                  <ProgrammeCard key={p.enrollment_id} p={p} />
                ))}
              </div>
            )}
          </QueryBlock>
        </section>
      </div>
    </>
  )
}
