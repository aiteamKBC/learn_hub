import { ArrowLeft, Award, BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Info, ListTree, Lock, Megaphone, MessagesSquare, NotebookPen, PartyPopper, Star, Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Backdrop } from '@/components/art/backdrops'
import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LogoMark } from '@/components/ui/logo'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Lecture, type Player, certificatePdfUrl, useEnrollmentId, useLecture, usePlayer } from '@/features/learning/api'
import { cn } from '@/lib/cn'
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

function PlayerTopNav({ player, doneCount, total, onOpenContents }: { player?: Player; doneCount: number; total: number; onOpenContents: () => void }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-surface/95 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center gap-3 px-4 py-2 sm:px-6 lg:gap-4 lg:px-14">
        <Link to="/" aria-label="EvidRise home" className="flex shrink-0 items-center gap-2">
          <LogoMark className="h-9" />
          <span className="hidden text-[27px] font-extrabold tracking-[-0.04em] text-[#0b1632] sm:inline">Evid<span className="text-primary">Rise</span></span>
        </Link>
        <span aria-hidden className="hidden h-8 w-px bg-border sm:block" />
        <Button variant="secondary" size="icon" asChild className="shrink-0 rounded-full">
          <Link to="/learn" aria-label="Back to my learning"><ArrowLeft /></Link>
        </Button>
        {player ? <h1 className="min-w-0 truncate text-base font-bold sm:text-lg lg:text-xl">{player.title}</h1> : <Skeleton className="h-6 w-40" />}
        <span aria-hidden className="hidden h-7 w-px bg-border xl:block" />
        <p className="hidden min-w-0 flex-1 truncate text-sm font-medium xl:block">
          {player?.title.toLowerCase().includes('manual handling') ? 'Learn safe and effective manual handling practices in the workplace.' : `Build practical knowledge and confidence throughout ${player?.title ?? 'this course'}.`}
        </p>
        {player ? (
          <div className="ml-auto hidden shrink-0 items-center gap-4 md:flex">
            <span className="whitespace-nowrap text-sm font-semibold tabular">{Math.round(player.progress_pct)}% complete</span>
            <Progress value={player.progress_pct} label="Course progress" className="h-2.5 w-32 lg:w-44" />
            <span className="whitespace-nowrap text-sm font-medium tabular">{doneCount} of {total} lessons</span>
          </div>
        ) : null}
        <Button variant="ghost" size="icon" className="ml-auto shrink-0 rounded-full md:hidden" aria-label="Course content" onClick={onOpenContents}>
          <ListTree />
        </Button>
      </div>
    </header>
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
  const secondaryTabs = [
    { value: 'overview', label: 'Overview', Icon: BookOpenText },
    { value: 'notes', label: 'Notes', Icon: NotebookPen },
    { value: 'qa', label: 'Q&A', Icon: MessagesSquare },
    { value: 'announcements', label: 'Announcements', Icon: Megaphone },
    { value: 'review', label: 'Review', Icon: Star },
  ] as const
  const activeSecondary = secondaryTabs.find((item) => item.value === tab)

  return (
    <div className="relative min-h-dvh">
      <DashboardBackdrop className="fixed inset-0 -z-10" />
      <PlayerTopNav player={p} doneCount={doneCount} total={all.length} onOpenContents={() => setDrawer(true)} />

      {error ? (
        <div className="mx-auto max-w-[1600px] p-6 lg:px-14">
          <ErrorState message={error.message} onRetry={() => void (lookup.refetch(), player.refetch())} />
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-0 py-5 sm:px-6 lg:grid-cols-[minmax(0,2.05fr)_minmax(360px,0.95fr)] lg:px-14">
          <main id="main" className="min-w-0">
            <div className="w-full overflow-hidden sm:rounded-2xl">
              {locked && p ? (
                <LockedStage slug={route.slug} title={locked.title} prerequisiteKey={locked.prerequisite_key} prerequisiteTitle={locked.prerequisite_title} reason={locked.locked_reason} />
              ) : <Stage lecture={lecture.data} loading={lecture.isLoading || !p} error={lecture.error} enrollmentId={lookup.enrollmentId} slug={route.slug} startAt={params.get('t') ? Number(params.get('t')) : undefined} onRetry={() => void lecture.refetch()} />}
            </div>

            {p && lecture.data ? (
              <>
                <LectureBar lecture={lecture.data} slug={route.slug} />
                <div className="relative">
                  <Tabs value={tab} onValueChange={(v) => setTab(v)} className="relative mt-2 overflow-hidden rounded-2xl border border-border bg-surface px-5 pb-4 shadow-sm">
                    <nav aria-label="Lesson sections" className="flex items-stretch border-b border-border lg:hidden">
                      <Menu>
                        <MenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Choose another lesson section"
                            className={cn('inline-flex min-w-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors', activeSecondary ? 'border-primary text-primary' : 'border-transparent text-muted')}
                          >
                            <span className="inline-flex min-w-0 items-center gap-2">
                              {activeSecondary ? <activeSecondary.Icon className="size-4 shrink-0" /> : <Info className="size-4 shrink-0" />}
                              <span className="truncate">{activeSecondary?.label ?? 'Overview & more'}</span>
                            </span>
                            <ChevronDown className="size-4 shrink-0" />
                          </button>
                        </MenuTrigger>
                        <MenuContent align="start" className="min-w-56">
                          {secondaryTabs.map(({ value, label, Icon }) => (
                            <MenuItem key={value} onSelect={() => setTab(value)} className={cn(tab === value && 'font-medium text-primary')}>
                              <Icon /> {label}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    </nav>
                    <TabsList className="hidden lg:flex [&_[role=tab]]:h-14 [&_[role=tab]]:px-5 [&_[role=tab]]:font-semibold">
                      <TabsTrigger value="overview">
                        <BookOpenText /> Overview
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

          <aside className="hidden lg:block">
            <div className="sticky top-[146px] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <div className="flex items-center justify-between px-6 py-5">
                <h2 className="text-xl font-bold tracking-tight">Course content</h2>
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={sidebar ? 'Collapse course content' : 'Expand course content'} aria-expanded={sidebar} onClick={() => setSidebar((value) => !value)}>
                  <ChevronDown className={cn('transition-transform', sidebar && 'rotate-180')} />
                </Button>
              </div>
              {sidebar ? (
                <>
                  {p ? (
                    <div className="px-6 pb-4">
                      <div className="mb-2 flex items-center justify-between text-sm font-medium">
                        <span>{doneCount} of {all.length} lessons completed</span>
                        <span className="font-bold tabular">{Math.round(p.progress_pct)}%</span>
                      </div>
                      <Progress value={p.progress_pct} label="Course progress" className="h-2.5" />
                    </div>
                  ) : null}
                  <div className="max-h-[calc(100dvh-260px)] overflow-y-auto overscroll-contain border-t border-border pt-2" data-lenis-prevent>
                    {p ? (
                      <Curriculum player={p} current={key} appearance="card" />
                    ) : (
                      <div className="grid gap-2 p-4">
                        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14" />)}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </aside>
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
function LockedStage({ slug, title, prerequisiteKey, prerequisiteTitle, reason }: { slug: string; title: string; prerequisiteKey?: string | null; prerequisiteTitle?: string | null; reason?: string | null }) {
  return (
    <div className="animate-reveal border-b border-border">
      <EmptyState
        icon={<Lock />}
        title={`“${title}” is locked`}
        body={reason === 'payment' ? 'Your company agreement unlocks this stage when its mapped instalment is paid.' : prerequisiteTitle ? `Finish “${prerequisiteTitle}” first, then come back here.` : 'Finish the earlier lesson first.'}
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
  if (loading || !lecture || !enrollmentId) return <Skeleton className="aspect-video w-full rounded-none lg:aspect-[16/7] lg:rounded-xl" />
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
    <div className="flex items-center gap-3 px-1 py-3.5 sm:py-4">
        <div className="min-w-0 flex-1">
          {lecture.kind === 'video' ? <h2 className="truncate text-xl font-bold tracking-tight sm:text-[27px]">{lecture.title}</h2> : null}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Icon className="size-4" /> {label}
            {lecture.duration_sec ? ` · ${minutes(lecture.duration_sec)}` : ''}
            {lecture.completed ? <span className="ml-1 font-medium text-success">· Completed</span> : null}
          </p>
        </div>
        {lecture.prev_key ? (
          <Button variant="secondary" asChild className="rounded-full px-6">
            <Link to={lectureUrl(slug, lecture.prev_key)} aria-label="Previous lecture">
              <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
            </Link>
          </Button>
        ) : null}
        {lecture.next_key ? (
          <Button asChild className="rounded-full px-7">
            <Link id="next-lecture" to={lectureUrl(slug, lecture.next_key)} aria-label="Next lecture">
              <span className="hidden sm:inline">Next</span> <ChevronRight />
            </Link>
          </Button>
        ) : null}
    </div>
  )
}

function Overview({ player, lecture }: { player: Player; lecture: Lecture }) {
  const manualHandling = player.title.toLowerCase().includes('manual handling') || lecture.title.toLowerCase().includes('lifting')
  const description = manualHandling
    ? 'Learn how to position your feet, bend your knees and lift safely while protecting your back.'
    : `Build practical knowledge and confidence in ${lecture.title.toLowerCase()}.`
  const objective = manualHandling
    ? 'Apply the key steps of a safe lifting technique to reduce the risk of injury.'
    : `Apply the main ideas from ${lecture.title} confidently in a practical setting.`
  return (
    <div className="grid gap-5 pb-1">
      <div>
        <h2 className="text-lg font-bold tracking-tight">About this lesson</h2>
        <p className="mt-1 text-sm leading-relaxed text-text">{description}</p>
      </div>
      <div className="flex items-center gap-4 rounded-2xl bg-primary-soft/75 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary shadow-sm"><Target className="size-5" /></span>
        <div>
          <h3 className="font-semibold text-primary-soft-text">Learning objective</h3>
          <p className="text-sm text-text">{objective}</p>
        </div>
      </div>
      {lecture.resources?.length ? <Resources lecture={lecture} enrollmentId={player.enrollment_id} slug={player.slug} /> : null}
    </div>
  )
}
