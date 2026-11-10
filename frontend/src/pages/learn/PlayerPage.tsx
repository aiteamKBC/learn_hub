import { Award, ChevronLeft, ChevronRight, Info, ListTree, Lock, Megaphone, MessagesSquare, NotebookPen, PanelRightClose, PanelRightOpen, PartyPopper, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Logo } from '@/components/ui/logo'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { type Lecture, type Player, certificatePdfUrl, useEnrollmentId, useLecture, usePlayer } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { useCountUp, useFill } from '@/lib/motion'
import { Link, useNavigate } from '@/lib/router'

import { AssignmentStage } from './AssignmentStage'
import { Curriculum } from './Curriculum'
import { AnnouncementsPanel, NotesPanel, QAPanel, ReviewPanel } from './panels'
import { QuizStage } from './QuizStage'
import { kindOf, lectureUrl, minutes } from './shared'
import { ArticleStage, DownloadStage, LinkStage, LiveStage, Resources, VideoStage } from './stages'

/** /learn/:slug, /learn/:slug/lecture/:key, /learn/:slug/qa/:id, /learn/:slug/announcements/:id */
function useRoute() {
  const { slug = '', '*': rest = '' } = useParams()
  const [kind, id] = rest.split('/')
  return {
    slug,
    lectureKey: kind === 'lecture' ? id : undefined,
    questionId: kind === 'qa' ? id : undefined,
    announcementId: kind === 'announcements' ? id : undefined,
    tab: kind === 'qa' ? 'qa' : kind === 'announcements' ? 'announcements' : undefined,
  }
}

/** Where to pick up: the last lecture opened, else the first one not yet done. */
function resumeKey(p: Player) {
  const all = p.sections.flatMap((s) => s.lectures)
  if (p.last_lecture_key && all.some((l) => l.key === p.last_lecture_key)) return p.last_lecture_key
  return (all.find((l) => !l.completed && !l.locked) ?? all[0])?.key
}

function MiniRing({ value }: { value: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  const fill = useFill(value)
  const n = useCountUp(value)
  return (
    <span className="relative inline-flex size-9 items-center justify-center" role="img" aria-label={`${Math.round(value)}% complete`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className="stroke-white/15" />
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round" stroke="var(--primary)" strokeDasharray={c} strokeDashoffset={c * (1 - fill / 100)} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <span className="text-[10px] font-bold tabular">{Math.round(n)}</span>
    </span>
  )
}

export function PlayerPage() {
  const route = useRoute()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const lookup = useEnrollmentId(route.slug)
  const player = usePlayer(lookup.enrollmentId)
  const p = player.data
  const key = route.lectureKey ?? (p ? resumeKey(p) : undefined)
  // a locked lesson (its prerequisite isn't done) is never fetched: the server would refuse it
  const locked = p?.sections.flatMap((s) => s.lectures).find((l) => l.key === key && l.locked)
  const lecture = useLecture(lookup.enrollmentId, locked ? undefined : key)
  const [sidebar, setSidebar] = useState(true)
  const [drawer, setDrawer] = useState(false)
  const [tab, setTab] = useState(route.tab ?? 'overview')
  const [celebrate, setCelebrate] = useState(false)
  const lastPct = useRef<number | null>(null)

  useEffect(() => {
    if (route.tab) setTab(route.tab)
  }, [route.tab, route.questionId, route.announcementId])

  // finishing the course during this visit earns a moment (once)
  useEffect(() => {
    if (!p) return
    if (lastPct.current !== null && lastPct.current < 100 && p.progress_pct >= 100) setCelebrate(true)
    lastPct.current = p.progress_pct
  }, [p])

  useEffect(() => {
    if (p) document.title = `${lecture.data?.title ? `${lecture.data.title} · ` : ''}${p.title} · LearnHub`
  }, [p, lecture.data?.title])

  if (lookup.notEnrolled) {
    return <Navigate to={`/courses/${route.slug}`} replace />
  }
  if (p && !route.lectureKey && !route.tab && key) {
    return <Navigate to={lectureUrl(route.slug, key) + (params.size ? `?${params}` : '')} replace />
  }

  const all = p?.sections.flatMap((s) => s.lectures) ?? []
  const doneCount = all.filter((l) => l.completed).length
  const error = lookup.error ?? player.error

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-nav px-2 text-white sm:gap-3 sm:px-4">
        <Button variant="ghost" size="icon-sm" asChild className="text-nav-text hover:bg-nav-hover hover:text-white">
          <Link to="/learn" aria-label="Back to my learning">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <Link to="/" aria-label="LearnHub home" className="hidden shrink-0 md:block">
          <Logo inverted />
        </Link>
        <span aria-hidden className="hidden h-6 w-px bg-white/15 md:block" />
        {p ? <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-[15px]">{p.title}</h1> : <Skeleton className="h-4 w-48 flex-1 bg-white/10 sm:flex-none" />}
        {p ? (
          <div className="flex items-center gap-2 text-xs text-nav-text">
            <MiniRing value={p.progress_pct} />
            <span className="hidden tabular sm:inline">
              {doneCount} of {all.length} done
            </span>
          </div>
        ) : null}
        {p?.certificate_id ? (
          <Button size="sm" variant="soft" asChild className="hidden sm:inline-flex">
            <Link to="/learn/certificates">
              <Award /> Certificate
            </Link>
          </Button>
        ) : null}
        <ThemeToggle onDark className="size-8" />
        <Button variant="ghost" size="icon-sm" className="hidden text-nav-text hover:bg-nav-hover hover:text-white lg:inline-flex" aria-label={sidebar ? 'Hide course content' : 'Show course content'} aria-pressed={sidebar} onClick={() => setSidebar((v) => !v)}>
          {sidebar ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-nav-text hover:bg-nav-hover hover:text-white lg:hidden" aria-label="Course content" onClick={() => setDrawer(true)}>
          <ListTree />
        </Button>
      </header>

      {error ? (
        <div className="flex-1 p-6">
          <ErrorState message={error.message} onRetry={() => void (lookup.refetch(), player.refetch())} />
        </div>
      ) : (
        <div className={cn('grid flex-1', sidebar && 'lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]')}>
          <main id="main" className="min-w-0">
            {locked && p ? (
              <LockedStage slug={route.slug} title={locked.title} prerequisiteKey={locked.prerequisite_key} prerequisiteTitle={locked.prerequisite_title} />
            ) : <Stage lecture={lecture.data} loading={lecture.isLoading || !p} error={lecture.error} enrollmentId={lookup.enrollmentId} slug={route.slug} startAt={params.get('t') ? Number(params.get('t')) : undefined} onRetry={() => void lecture.refetch()} />}

            {p && lecture.data ? (
              <>
                <LectureBar lecture={lecture.data} slug={route.slug} />
                <div className="relative isolate">
                  <Backdrop variant="orbit" height={320} className="opacity-60" />
                  <Tabs value={tab} onValueChange={(v) => setTab(v)} className="relative mx-auto max-w-4xl px-4 pt-2 pb-16 sm:px-6">
                    <TabsList>
                      <TabsTrigger value="content" className="lg:hidden">
                        <ListTree /> Content
                      </TabsTrigger>
                      <TabsTrigger value="overview">
                        <Info /> Overview
                      </TabsTrigger>
                      <TabsTrigger value="notes">
                        <NotebookPen /> Notes
                      </TabsTrigger>
                      <TabsTrigger value="qa">
                        <MessagesSquare /> Q&amp;A
                      </TabsTrigger>
                      <TabsTrigger value="announcements">
                        <Megaphone /> Announcements
                      </TabsTrigger>
                      <TabsTrigger value="review">
                        <Star /> Review
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="content" className="lg:hidden">
                      <div className="-mx-4 overflow-hidden border-y border-border bg-surface sm:mx-0 sm:rounded-xl sm:border">
                        <Curriculum player={p} current={key} />
                      </div>
                    </TabsContent>
                    <TabsContent value="overview">
                      <Overview player={p} lecture={lecture.data} />
                    </TabsContent>
                    <TabsContent value="notes">
                      <NotesPanel player={p} lecture={lecture.data} />
                    </TabsContent>
                    <TabsContent value="qa">
                      <QAPanel player={p} lecture={lecture.data} questionId={route.questionId} />
                    </TabsContent>
                    <TabsContent value="announcements">
                      <AnnouncementsPanel player={p} focus={route.announcementId} />
                    </TabsContent>
                    <TabsContent value="review">
                      <ReviewPanel player={p} />
                    </TabsContent>
                  </Tabs>
                </div>
              </>
            ) : null}
          </main>

          {sidebar ? (
            <aside className="hidden border-l border-border bg-surface lg:block">
              <div className="sticky top-14 flex h-[calc(100dvh-3.5rem)] flex-col">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">Course content</h2>
                  {p ? <span className="text-xs text-muted tabular">{Math.round(p.progress_pct)}% complete</span> : null}
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {p ? (
                    <Curriculum player={p} current={key} />
                  ) : (
                    <div className="grid gap-2 p-4">
                      {Array.from({ length: 8 }, (_, i) => (
                        <Skeleton key={i} className="h-11" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      )}

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent title="Course content" description={p ? `${doneCount} of ${all.length} lectures done` : undefined} side="right">
          {p ? <Curriculum player={p} current={key} onPick={() => setDrawer(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={celebrate} onOpenChange={setCelebrate}>
        <DialogContent title="You finished the course!" className="overflow-hidden">
          <div className="relative -mx-6 -mt-5 mb-4 h-36 overflow-hidden">
            <Backdrop variant="confetti" height="100%" fade={false} />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-16 animate-pop items-center justify-center rounded-full bg-primary text-on-primary shadow-lg">
                <PartyPopper className="size-8" />
              </span>
            </span>
          </div>
          <p className="text-sm text-muted">Every lecture of {p?.title} is complete. {p?.certificate_id ? 'Your certificate is ready.' : 'Your certificate will be ready in a moment.'}</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => (setCelebrate(false), setTab('review'))}>
              <Star /> Rate the course
            </Button>
            {p?.certificate_id ? (
              <Button asChild>
                <a href={certificatePdfUrl(p.certificate_id)}>
                  <Award /> Download certificate
                </a>
              </Button>
            ) : (
              <Button onClick={() => (setCelebrate(false), navigate('/learn/certificates'))}>
                <Award /> My certificates
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** A lesson whose prerequisite isn't complete: say which one, and link to it. */
function LockedStage({ slug, title, prerequisiteKey, prerequisiteTitle }: { slug: string; title: string; prerequisiteKey?: string | null; prerequisiteTitle?: string | null }) {
  return (
    <div className="animate-reveal border-b border-border">
      <EmptyState
        icon={<Lock />}
        title={`“${title}” is locked`}
        body={prerequisiteTitle ? `Finish “${prerequisiteTitle}” first, then come back here.` : 'Finish the earlier lesson first.'}
        action={prerequisiteKey ? (
          <Button asChild>
            <Link to={lectureUrl(slug, prerequisiteKey)}>Go to “{prerequisiteTitle}”</Link>
          </Button>
        ) : undefined}
      />
    </div>
  )
}

function Stage({ lecture, loading, error, enrollmentId, slug, startAt, onRetry }: { lecture?: Lecture; loading: boolean; error: Error | null; enrollmentId?: string; slug: string; startAt?: number; onRetry: () => void }) {
  if (error) {
    return (
      <div className="border-b border-border">
        <EmptyState icon={<Info />} title="This lecture isn't available" body={error.message} action={<Button variant="secondary" onClick={onRetry}>Try again</Button>} />
      </div>
    )
  }
  if (loading || !lecture || !enrollmentId) return <Skeleton className="aspect-video w-full rounded-none lg:max-h-[70dvh]" />
  const props = { lecture, enrollmentId, slug }
  // keyed by lecture (and note time) so each lecture starts fresh: new player, new state
  const k = `${lecture.key}:${startAt ?? ''}`
  return (
    <div key={k} className="animate-reveal">
      {lecture.kind === 'video' ? (
        <VideoStage
          {...props}
          startAt={startAt}
          onEnded={(completed) => {
            const next = lecture.next_key ? { action: { label: 'Next lecture', onClick: () => document.getElementById('next-lecture')?.click() } } : {}
            if (completed) toast.success('Lecture complete', next)
            else if (!lecture.completed) toast('Lecture finished', { description: 'Parts were skipped, so it isn’t marked complete yet. Watch the rest to complete it.', ...next })
            else if (lecture.next_key) toast('Lecture finished', next)
          }}
        />
      ) : lecture.kind === 'quiz' && lecture.quiz ? (
        <QuizStage {...props} />
      ) : lecture.kind === 'assignment' && lecture.assignment ? (
        <AssignmentStage {...props} />
      ) : lecture.kind === 'live_session' ? (
        <LiveStage {...props} />
      ) : lecture.kind === 'external_link' ? (
        <LinkStage {...props} />
      ) : lecture.kind === 'download' ? (
        <DownloadStage {...props} />
      ) : (
        <ArticleStage {...props} />
      )}
    </div>
  )
}

/** Under the stage: what this is, and previous / next. */
function LectureBar({ lecture, slug }: { lecture: Lecture; slug: string }) {
  const { Icon, label } = kindOf(lecture.kind)
  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          {lecture.kind === 'video' ? <p className="truncate text-[15px] font-semibold">{lecture.title}</p> : null}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Icon className="size-3.5" /> {label}
            {lecture.duration_sec ? ` · ${minutes(lecture.duration_sec)}` : ''}
            {lecture.completed ? <span className="ml-1 font-medium text-success">· Completed</span> : null}
          </p>
        </div>
        {lecture.prev_key ? (
          <Button variant="secondary" size="sm" asChild>
            <Link to={lectureUrl(slug, lecture.prev_key)} aria-label="Previous lecture">
              <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
            </Link>
          </Button>
        ) : null}
        {lecture.next_key ? (
          <Button size="sm" asChild>
            <Link id="next-lecture" to={lectureUrl(slug, lecture.next_key)} aria-label="Next lecture">
              <span className="hidden sm:inline">Next</span> <ChevronRight />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Overview({ player, lecture }: { player: Player; lecture: Lecture }) {
  const all = player.sections.flatMap((s) => s.lectures)
  const total = all.reduce((t, l) => t + l.duration_sec, 0)
  const left = all.filter((l) => !l.completed).reduce((t, l) => t + l.duration_sec, 0)
  const stats = [
    { label: 'Complete', value: `${Math.round(player.progress_pct)}%` },
    { label: 'Lectures', value: `${all.filter((l) => l.completed).length} / ${all.length}` },
    { label: 'Course length', value: minutes(total) || '—' },
    { label: 'Left to go', value: minutes(left) || 'Nothing' },
  ]
  return (
    <div className="grid gap-8">
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="mt-1 text-lg font-semibold tabular">{s.value}</p>
          </div>
        ))}
      </div>
      {lecture.resources?.length ? <Resources lecture={lecture} enrollmentId={player.enrollment_id} slug={player.slug} /> : null}
      <p className="text-sm text-muted">
        Want the full description, the instructor and reviews?{' '}
        <Link to={`/courses/${player.slug}`} className="font-medium text-primary hover:underline">
          Open the course page
        </Link>
      </p>
    </div>
  )
}
