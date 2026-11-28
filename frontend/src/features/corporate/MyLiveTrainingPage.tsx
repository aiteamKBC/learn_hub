import { BookOpen, CalendarDays, Clock, EyeOff, Flag, History, MapPin, PlayCircle, Video } from 'lucide-react'
import { useEffect, useState } from 'react'

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

type LiveTab = 'upcoming' | 'past' | 'recordings'
type LiveSession = MyLiveCohort['sessions'][number] & { recording_url?: string | null }

function Dates({ start, end }: { start?: string | null; end?: string | null }) {
  if (!start) return <span>Starts at your first session</span>
  return (
    <span>
      {shortDate(start)}
      {end ? ` – ${shortDate(end)}` : ''}
    </span>
  )
}

function Session({ s, ended, recording = false }: { s: LiveSession; ended: boolean; recording?: boolean }) {
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
      {recording && s.recording_url ? (
        <Button asChild size="sm" variant="secondary">
          <a href={s.recording_url} target="_blank" rel="noopener noreferrer">
            <PlayCircle /> Watch recording
          </a>
        </Button>
      ) : done ? (
        <Badge tone="success">Done</Badge>
      ) : s.join_url ? (
        <Button asChild size="sm">
          <a href={s.join_url} target="_blank" rel="noopener noreferrer">
            <Video /> Join now
          </a>
        </Button>
      ) : ended ? (
        <span className="text-xs text-muted">The programme has ended.</span>
      ) : s.locked ? (
        <span className="text-xs text-muted">Your company needs to renew before this session.</span>
      ) : s.delivery_mode !== 'in_person' ? (
        <span className="text-xs text-muted">The join link appears 15 minutes before the start.</span>
      ) : null}
    </li>
  )
}

function CohortCard({ c, sessions = c.sessions, recordings = false }: { c: MyLiveCohort; sessions?: LiveSession[]; recordings?: boolean }) {
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
      {sessions.length ? (
        <ol className="stagger grid gap-2">
          {sessions.map((s) => (
            <Session key={s.sequence} s={s} ended={ended} recording={recordings} />
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

function sessionHasEnded(session: LiveSession) {
  if (session.status === 'completed' || session.status === 'cancelled') return true
  return new Date(session.scheduled_at).getTime() + session.duration_min * 60_000 < Date.now()
}

function sessionsForTab(cohort: MyLiveCohort, tab: LiveTab): LiveSession[] {
  const sessions = cohort.sessions as LiveSession[]
  if (tab === 'recordings') return sessions.filter((session) => !!session.recording_url)
  if (tab === 'past') return sessions.filter(sessionHasEnded)
  return sessions.filter((session) => !sessionHasEnded(session))
}

function EmptyLiveTab({ tab }: { tab: LiveTab }) {
  if (tab === 'recordings') {
    return (
      <Card className="rounded-2xl border-dashed p-5 sm:p-6">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary"><PlayCircle className="size-6" /></span>
          <h3 className="mt-3 font-bold">No recordings available yet</h3>
          <p className="mt-1 max-w-xl text-sm text-muted">When an organiser publishes a completed session recording, it will appear here with its date, duration and a Watch recording button.</p>
        </div>
        <div className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/55 p-4 opacity-75">
          <span className="flex size-10 items-center justify-center rounded-xl bg-surface text-primary shadow-sm"><Video className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Recorded session title</p><p className="text-xs text-muted">Recording preview · date and duration</p></div>
          <Badge tone="outline">Preview</Badge>
          <Button size="sm" variant="secondary" disabled><PlayCircle /> Watch recording</Button>
        </div>
      </Card>
    )
  }
  return (
    <Card className="rounded-2xl border-dashed p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">{tab === 'past' ? <History className="size-6" /> : <CalendarDays className="size-6" />}</span>
      <h3 className="mt-3 font-bold">{tab === 'past' ? 'No past sessions yet' : 'No upcoming sessions yet'}</h3>
      <p className="mt-1 text-sm text-muted">{tab === 'past' ? 'Completed live sessions will be kept here.' : 'When your company books your next live session, it will appear here.'}</p>
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
  const [liveTab, setLiveTab] = useState<LiveTab>('upcoming')
  const liveRows = q.data ?? []
  const liveCounts: Record<LiveTab, number> = {
    upcoming: liveRows.reduce((total, cohort) => total + sessionsForTab(cohort, 'upcoming').length, 0),
    past: liveRows.reduce((total, cohort) => total + sessionsForTab(cohort, 'past').length, 0),
    recordings: liveRows.reduce((total, cohort) => total + sessionsForTab(cohort, 'recordings').length, 0),
  }
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
          <div role="tablist" aria-label="Live training sessions" className="grid max-w-xl grid-cols-3 rounded-2xl border border-border bg-surface p-1 shadow-sm">
            {([
              ['upcoming', 'Upcoming'],
              ['past', 'Past'],
              ['recordings', 'Recordings'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={liveTab === value}
                onClick={() => setLiveTab(value)}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${liveTab === value ? 'bg-primary-soft text-primary-soft-text shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
              >
                {label}
                <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular ${liveTab === value ? 'bg-surface text-primary' : 'bg-surface-2 text-muted'}`}>{liveCounts[value]}</span>
              </button>
            ))}
          </div>
          <QueryBlock
            query={q}
            rows={2}
          >
            {(rows) => {
              const filtered = rows
                .map((cohort) => ({ cohort, sessions: sessionsForTab(cohort, liveTab) }))
                .filter((row) => row.sessions.length)
              return filtered.length ? (
                <div className="stagger grid gap-4 lg:grid-cols-2">
                  {filtered.map(({ cohort, sessions }) => <CohortCard key={cohort.cohort_id} c={cohort} sessions={sessions} recordings={liveTab === 'recordings'} />)}
                </div>
              ) : <EmptyLiveTab tab={liveTab} />
            }}
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
