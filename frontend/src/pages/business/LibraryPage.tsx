import { Award, BarChart3, BookOpen, Clock, PlayCircle, Search, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type LibraryCourse, useAssignments, useLibrary } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { duration, relativeDate } from '@/lib/format'
import { Link } from '@/lib/router'

const STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  completed: { label: 'Completed', tone: 'success' },
  active: { label: 'In progress', tone: 'info' },
  expired: { label: 'Expired', tone: 'warning' },
}

/** Who has this course and how far they are (side sheet). */
function ProgressSheet({ course, onClose }: { course: LibraryCourse | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useAssignments(course?.id ?? null)
  return (
    <Dialog open={!!course} onOpenChange={(o) => !o && onClose()}>
      {course ? (
        <DialogContent side="right" title={course.title} description="Who has this course and how far they are" className="w-[min(640px,100vw)]">
          <div className="grid gap-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Assigned</p>
                <p className="mt-0.5 text-xl font-semibold tabular">{course.assigned}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Completed</p>
                <p className="mt-0.5 text-xl font-semibold tabular">{course.completed}</p>
              </div>
            </div>
            <Button asChild>
              <Link to={`/business/assign?course=${course.id}`}>
                <UserPlus /> Assign to more people
              </Link>
            </Button>
            {error ? (
              <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
            ) : isLoading || !data ? (
              <div className="grid gap-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : data.length === 0 ? (
              <EmptyState className="py-8" icon={<Users />} title="Nobody has it yet" body="Assign it to people or whole teams." />
            ) : (
              <ul className="stagger grid gap-1 animate-reveal">
                {data.map((r) => {
                  const s = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
                  return (
                    <li key={r.enrollment_id} className="rounded-md border border-border p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name || r.email} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.name || r.email}</p>
                          <p className="truncate text-xs text-muted">{r.last_accessed_at ? `Last active ${relativeDate(r.last_accessed_at)}` : 'Not started yet'}</p>
                        </div>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <Progress value={r.progress_pct} tone={r.status === 'completed' ? 'success' : 'primary'} label={`${r.name}: ${Math.round(r.progress_pct)}% done`} />
                        <span className="w-9 shrink-0 text-right text-xs text-muted tabular">{Math.round(r.progress_pct)}%</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function LibraryCard({ c, onProgress }: { c: LibraryCourse; onProgress: () => void }) {
  const pct = c.assigned ? (c.completed / c.assigned) * 100 : 0
  return (
    <Card className="flex flex-col p-2.5 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow">
      <div className="relative">
        <CourseThumb src={c.thumbnail_url} title={c.title} />
        <Badge tone={c.ownership === 'organization' ? 'primary' : 'neutral'} className="absolute top-2 left-2 shadow-sm">
          {c.ownership === 'organization' ? 'Your company' : 'LearnHub'}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3 pb-1">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight">{c.title}</h3>
        {c.subtitle ? <p className="mt-1 line-clamp-1 text-[13px] text-muted">{c.subtitle}</p> : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <PlayCircle className="size-3.5" /> {c.lecture_count} lessons
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {duration(c.total_duration_sec)}
          </span>
          {c.cpd_hours ? (
            <span className="inline-flex items-center gap-1">
              <Award className="size-3.5" /> {c.cpd_hours} CPD hours
            </span>
          ) : null}
        </p>
        <div className="mt-3 rounded-md bg-surface-2/60 p-2.5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted">
              <span className="font-semibold text-text tabular">{c.assigned}</span> assigned
            </span>
            <span className="text-muted">
              <span className="font-semibold text-text tabular">{c.completed}</span> completed
            </span>
          </div>
          <Progress value={pct} tone="success" label={`${c.title}: ${c.completed} of ${c.assigned} completed`} />
        </div>
        <div className="mt-auto flex gap-2 pt-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onProgress}>
            <BarChart3 /> Progress
          </Button>
          <Button size="sm" className="flex-1" asChild>
            <Link to={`/business/assign?course=${c.id}`}>
              <UserPlus /> Assign
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const source = params.get('source') ?? ''
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<LibraryCourse | null>(null)
  const { data, isLoading, error, refetch } = useLibrary(source || undefined)
  const shown = useMemo(() => (q.trim() ? (data ?? []).filter((c) => `${c.title} ${c.subtitle}`.toLowerCase().includes(q.trim().toLowerCase())) : (data ?? [])), [data, q])

  return (
    <>
      <PageHeader
        title="Course library"
        description="Courses your company can assign: your own and the LearnHub library."
        actions={
          <Button asChild>
            <Link to="/business/assign">
              <UserPlus /> Assign training
            </Link>
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={source || 'all'} onValueChange={(v) => setParams(v === 'all' ? {} : { source: v }, { replace: true })}>
          <TabsList aria-label="Where courses come from" className="border-b-0">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="platform">LearnHub</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="w-full sm:w-72">
          <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" />
        </div>
      </div>
      {error ? (
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <div className={cn('grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', data && 'stagger')}>
          {isLoading || !data ? (
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-2.5">
                <Skeleton className="aspect-video w-full" />
                <div className="space-y-2 px-1 pt-3 pb-1">
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="mt-3 h-12" />
                  <Skeleton className="mt-3 h-8" />
                </div>
              </div>
            ))
          ) : shown.length === 0 ? (
            <Card className="col-span-full">
              <EmptyState
                icon={q ? <Search /> : <BookOpen />}
                title={q ? 'No courses match' : source === 'company' ? 'No company courses yet' : 'No courses here yet'}
                body={q ? 'Try another word.' : source === 'company' ? 'Courses your company builds will show here.' : 'Courses you can assign will show here.'}
              />
            </Card>
          ) : (
            shown.map((c) => <LibraryCard key={c.id} c={c} onProgress={() => setOpen(c)} />)
          )}
        </div>
      )}
      <ProgressSheet course={open} onClose={() => setOpen(null)} />
    </>
  )
}
