import { CalendarClock, CheckCircle2, Clock, Download, ExternalLink, FileText, Film, Loader2, Radio } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { emitPlayhead, embedUrl, loadPlayerJs, registerPlayer } from '@/features/learning/bunny'
import { type Lecture, sendHeartbeat, useCompleteLecture, useDownloadResource, useRefreshProgress } from '@/features/learning/api'
import { cn } from '@/lib/cn'

import { CompleteBar, Html, kindOf } from './shared'
import { VideoMarks } from './video-marks'

type StageProps = { lecture: Lecture; enrollmentId: string; slug: string }

const BEAT_MS = 30_000
const MAX_BEAT = 600 // the server caps one beat at 10 minutes of watching

/**
 * Bunny video with resume and watch-time tracking. Only seconds actually played count
 * (seeking forward does not), sent every 30 s and when the learner pauses or leaves.
 */
export function VideoStage({ lecture, enrollmentId, onEnded, startAt }: StageProps & { onEnded: (completed: boolean) => void; startAt?: number }) {
  const video = lecture.video
  const frame = useRef<HTMLIFrameElement>(null)
  const refresh = useRefreshProgress(enrollmentId)
  // a note's timestamp wins; otherwise resume (finished videos start again from the top)
  const [src] = useState(() => {
    // If an older save reached the end but fell just short of the watch threshold,
    // replay the final 30 seconds so the learner can finish it instead of landing at EOF.
    const savedAt = !lecture.completed && lecture.duration_sec > 0 && lecture.position_sec >= lecture.duration_sec - 5
      ? Math.max(0, lecture.duration_sec - 30)
      : lecture.completed ? 0 : lecture.position_sec
    return video?.url ? embedUrl(video.url, startAt ?? savedAt, startAt != null) : null
  })
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  useEffect(() => {
    const el = frame.current
    if (!el || !src) return
    let alive = true
    let unregister = () => {}
    const state = { pos: lecture.position_sec, last: -1, watched: 0, sentPos: lecture.position_sec }
    const flush = (keepalive = false, flushNow = false) => {
      const watched = Math.min(MAX_BEAT, Math.round(state.watched))
      if (!flushNow && !watched && Math.abs(state.pos - state.sentPos) < 1) return
      state.watched -= watched
      state.sentPos = state.pos
      void sendHeartbeat(enrollmentId, { lecture_key: lecture.key, position_sec: Math.floor(state.pos), watched_sec: watched, flush_now: flushNow }, keepalive).catch(() => undefined)
    }
    const timer = window.setInterval(() => flush(), BEAT_MS)
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true, true)
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)

    loadPlayerJs()
      .then(() => {
        if (!alive || !window.playerjs) return
        const p = new window.playerjs.Player(el)
        p.on('ready', () => {
          if (alive) unregister = registerPlayer(lecture.key, p)
        })
        p.on('timeupdate', (d) => {
          const s = d?.seconds ?? 0
          const step = s - state.last
          // Bunny's bridge can deliver timeupdates several seconds apart on a busy tab.
          // Count those forward-play intervals while still discarding seek-sized jumps.
          if (state.last >= 0 && step > 0 && step <= 8) state.watched += step
          state.last = s
          state.pos = s
          emitPlayhead(lecture.key, s)
        })
        p.on('pause', () => flush(false, true))
        p.on('ended', () => {
          // the end beat is written at once and says whether the lecture is now complete
          const watched = Math.min(MAX_BEAT, Math.round(state.watched))
          state.watched -= watched
          state.sentPos = state.pos
          sendHeartbeat(enrollmentId, { lecture_key: lecture.key, position_sec: Math.floor(state.pos), watched_sec: watched, ended: true, flush_now: true })
            .then((r) => {
              onEndedRef.current(!!r.data?.completed)
              return refresh()
            })
            .catch(() => undefined)
        })
      })
      .catch(() => undefined) // without player.js the video still plays; only tracking is lost

    return () => {
      alive = false
      unregister()
      window.clearInterval(timer)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      flush(true, true)
    }
    // one player per lecture; src is fixed for its lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, enrollmentId, lecture.key])

  if (!src) return <VideoPending lecture={lecture} enrollmentId={enrollmentId} />
  return (
    <>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <iframe
          ref={frame}
          src={src}
          title={lecture.title}
          className="absolute inset-0 size-full border-0"
          loading="eager"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <VideoMarks lecture={lecture} />
    </>
  )
}

/** A video lecture whose file has not been uploaded (or finished encoding) yet. */
function VideoPending({ lecture, enrollmentId }: { lecture: Lecture; enrollmentId: string }) {
  const complete = useCompleteLecture(enrollmentId)
  return (
    <div className="relative isolate flex aspect-video w-full items-center justify-center overflow-hidden bg-nav text-white">
      <Backdrop variant="aurora" onDark height="100%" fade={false} />
      <div className="relative z-10 max-w-md animate-reveal px-6 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur">
          <Film className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-semibold sm:text-xl">This video is on its way</h2>
        <p className="mt-1.5 text-sm text-nav-text">The instructor hasn't published the recording yet. You can carry on and come back to it.</p>
        {lecture.completed ? (
          <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-green-300">
            <CheckCircle2 className="size-5" /> Completed
          </p>
        ) : (
          <Button className="mt-5" variant="secondary" loading={complete.isPending} onClick={() => complete.mutate(lecture.key, { onSuccess: () => toast.success('Marked as complete'), onError: (e) => toast.error(e.message) })}>
            <CheckCircle2 /> Mark as complete
          </Button>
        )}
      </div>
    </div>
  )
}

/** The artwork-topped page used for every lecture that is not a video. */
export function Sheet({ lecture, children, icon, meta }: { lecture: Lecture; children: React.ReactNode; icon?: React.ReactNode; meta?: React.ReactNode }) {
  const { Icon, label } = kindOf(lecture.kind)
  return (
    <div className="relative isolate">
      <Backdrop variant="notebook" height={280} />
      <article className="relative mx-auto max-w-3xl px-4 pt-8 pb-10 sm:px-8 sm:pt-12">
        <div className="animate-reveal">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            {icon ?? <Icon className="size-3.5 text-primary" />} {label}
            {meta ? <span className="text-subtle">· {meta}</span> : null}
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{lecture.title}</h1>
        </div>
        <div className="mt-6 animate-reveal [animation-delay:60ms]">{children}</div>
      </article>
    </div>
  )
}

function readingTime(html: string) {
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  return `${Math.max(1, Math.round(words / 220))} min read`
}

export function ArticleStage(props: StageProps) {
  const { lecture } = props
  return (
    <Sheet lecture={lecture} meta={lecture.body ? readingTime(lecture.body) : undefined}>
      {lecture.body ? <Html html={lecture.body} /> : <p className="text-muted">This reading has no text yet.</p>}
      {lecture.resources?.length ? <Resources {...props} className="mt-8" /> : null}
      <CompleteBar {...props} className="mt-10" />
    </Sheet>
  )
}

export function LinkStage(props: StageProps) {
  const { lecture } = props
  let host = ''
  try {
    host = new URL(lecture.external_url ?? '').hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  return (
    <Sheet lecture={lecture}>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
          <ExternalLink className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Read this on {host || 'another site'}</p>
          <p className="truncate text-sm text-muted">{lecture.external_url}</p>
        </div>
        {lecture.external_url ? (
          <Button asChild>
            <a href={lecture.external_url} target="_blank" rel="noopener noreferrer">
              Open link <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
      <p className="mt-4 text-sm text-muted">It opens in a new tab. Come back here and mark it complete when you've finished.</p>
      {lecture.resources?.length ? <Resources {...props} className="mt-8" /> : null}
      <CompleteBar {...props} className="mt-10" />
    </Sheet>
  )
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

function until(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min`
  return `${Math.round(h / 24)} days`
}

export function LiveStage(props: StageProps) {
  const { lecture } = props
  const live = lecture.live
  const now = useNow(30_000)
  const refresh = useRefreshProgress(props.enrollmentId)
  const starts = live?.starts_at ? new Date(live.starts_at).getTime() : null
  const ends = starts && live?.duration_min ? starts + live.duration_min * 60_000 : null
  const state = !starts ? 'unscheduled' : now < starts ? 'upcoming' : ends && now > ends ? 'ended' : 'live'
  const joinOpensIn = starts ? starts - 15 * 60_000 - now : 0
  const providerName = live?.provider === 'teams' ? 'Microsoft Teams' : 'the live classroom'

  // the join link is only sent from 15 minutes before; fetch it when that moment comes
  useEffect(() => {
    if (!live?.join_url && starts && joinOpensIn > 0 && joinOpensIn < 2 ** 31) {
      const id = window.setTimeout(() => void refresh(), joinOpensIn + 1000)
      return () => window.clearTimeout(id)
    }
  }, [live?.join_url, starts, joinOpensIn, refresh])

  return (
    <Sheet lecture={lecture} icon={<Radio className={cn('size-3.5', state === 'live' ? 'text-danger' : 'text-primary')} />}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <span className="flex size-12 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0">
            {starts ? (
              <>
                <p className="font-medium">
                  {new Date(starts).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-sm text-muted">
                  {live?.duration_min ? `${live.duration_min} minutes · ` : ''}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')} time
                </p>
              </>
            ) : (
              <p className="font-medium">The date hasn't been set yet</p>
            )}
          </div>
          <div>
            {state === 'live' ? (
              <Badge tone="danger" dot className="animate-pulse">Live now</Badge>
            ) : state === 'upcoming' ? (
              <Badge tone="primary">Starts in {until(starts! - now)}</Badge>
            ) : state === 'ended' ? (
              <Badge>Ended</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2/50 px-5 py-4">
          {live?.join_url ? (
            <Button asChild>
              <a href={live.join_url} target="_blank" rel="noopener noreferrer">
                Join in {providerName} <ExternalLink />
              </a>
            </Button>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <Clock className="size-4" /> {state === 'ended' ? 'This session has finished.' : `The ${providerName} link appears here 15 minutes before the start.`}
            </p>
          )}
        </div>
      </div>
      {lecture.resources?.length ? <Resources {...props} className="mt-8" /> : null}
      <CompleteBar {...props} className="mt-10" />
    </Sheet>
  )
}

export function DownloadStage(props: StageProps) {
  return (
    <Sheet lecture={props.lecture}>
      {props.lecture.resources?.length ? <Resources {...props} /> : <p className="text-muted">No files have been attached yet.</p>}
      <CompleteBar {...props} className="mt-10" />
    </Sheet>
  )
}

function size(bytes?: number | null) {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`
}

/** Lecture files: a short-lived signed link is fetched only when one is clicked. */
export function Resources({ lecture, enrollmentId, className, compact }: StageProps & { className?: string; compact?: boolean }) {
  const download = useDownloadResource(enrollmentId, lecture.key)
  const [busy, setBusy] = useState<string | null>(null)
  const items = lecture.resources ?? []
  if (!items.length) return null
  const open = (id: string) => {
    setBusy(id)
    download.mutate(id, {
      onSuccess: (r) => {
        window.location.assign(r.url)
      },
      onError: (e) => toast.error(e.message),
      onSettled: () => setBusy(null),
    })
  }
  return (
    <section className={className} aria-label="Lecture files">
      {compact ? null : <h2 className="mb-3 text-sm font-semibold">Files for this lecture</h2>}
      <ul className="stagger grid gap-2">
        {items.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => open(r.id)} disabled={busy === r.id} className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text">
                <FileText className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-primary">{r.title || r.filename}</span>
                <span className="block truncate text-xs text-muted">
                  {r.filename}
                  {r.size_bytes ? ` · ${size(r.size_bytes)}` : ''}
                </span>
              </span>
              {busy === r.id ? <Loader2 className="size-4 animate-spin text-muted" /> : <Download className="size-4 text-muted group-hover:text-primary" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

