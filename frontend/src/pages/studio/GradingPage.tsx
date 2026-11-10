import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, Clock, FileQuestion, FileText, Inbox } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useGradingQueue, type GradingAttempt, type GradingSubmission } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'

import { EssayMarking, SubmissionMarking } from './grading/marking'

// One queue for both kinds of work: assignment hand-ins ("s:<id>") and quizzes with
// essay answers waiting for a mark ("a:<id>"). The open item lives in the URL (?item=).
export type QueueItem = { key: string; kind: 'submission'; learner: string; course: string; title: string; submitted_at: string | null | undefined; late: boolean; attempt_no: number; data: GradingSubmission } | { key: string; kind: 'attempt'; learner: string; course: string; title: string; submitted_at: string | null | undefined; late: boolean; attempt_no: number; data: GradingAttempt }

export function GradingPage() {
  const q = useGradingQueue()
  const [params, setParams] = useSearchParams()
  const items = useMemo<QueueItem[]>(() => {
    if (!q.data) return []
    const subs: QueueItem[] = q.data.submissions.map((s) => ({ key: `s:${s.id}`, kind: 'submission', learner: s.learner, course: s.course, title: s.lecture, submitted_at: s.submitted_at, late: s.is_late, attempt_no: s.attempt_no, data: s }))
    const atts: QueueItem[] = q.data.attempts.map((a) => ({ key: `a:${a.id}`, kind: 'attempt', learner: a.learner, course: a.course, title: a.quiz, submitted_at: a.submitted_at, late: false, attempt_no: 0, data: a }))
    // oldest first: whoever has waited longest is marked first
    return [...subs, ...atts].sort((x, y) => (x.submitted_at ?? '').localeCompare(y.submitted_at ?? ''))
  }, [q.data])

  const selectedKey = params.get('item')
  const index = items.findIndex((i) => i.key === selectedKey)
  const selected = index >= 0 ? items[index] : undefined
  const open = (key: string | null, replace = false) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (key) next.set('item', key)
        else next.delete('item')
        return next
      },
      { replace, preventScrollReset: true },
    )
  // after marking: the next item in the queue (the marked one drops out on refetch)
  const afterMarking = () => {
    const rest = items.filter((i) => i.key !== selectedKey)
    const next = rest[Math.min(index, rest.length - 1)]
    open(next?.key ?? null, true)
  }

  return (
    <div className="min-w-0">
      <PageHeader title="Marking" description="Assignments and essay answers waiting for you, oldest first. Learners are told as soon as you save a mark." />
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card className="grid gap-3 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[72px]" />
            ))}
          </Card>
          <Skeleton className="hidden h-96 md:block" />
        </div>
      ) : q.error ? (
        <Card>
          <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
        </Card>
      ) : !items.length ? (
        <Card className="animate-reveal">
          <EmptyState icon={<ClipboardCheck />} title="Nothing to mark" body="You're all caught up. New assignments and essay answers will appear here as learners hand them in." />
        </Card>
      ) : (
        <div className="grid animate-reveal items-start gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card className={cn('min-w-0 overflow-hidden', selected && 'hidden md:block')}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Waiting</p>
              <Badge tone="primary" className="tabular">
                {items.length}
              </Badge>
            </div>
            <ul className="stagger grid max-h-[70vh] gap-1 overflow-y-auto p-2" aria-label="Work to mark">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => open(i.key)}
                    aria-current={i.key === selectedKey ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2',
                      i.key === selectedKey && 'bg-primary-soft hover:bg-primary-soft',
                    )}
                  >
                    <Avatar name={i.learner} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.learner}</span>
                        {i.late ? <Badge tone="warning">Late</Badge> : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                        {i.kind === 'submission' ? <FileText className="size-3.5 shrink-0" /> : <FileQuestion className="size-3.5 shrink-0" />}
                        <span className="truncate">{i.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{i.course}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                        {i.submitted_at ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" /> {relativeDate(i.submitted_at)}
                          </span>
                        ) : null}
                        <span>{i.kind === 'submission' ? `Attempt ${i.attempt_no}` : 'Quiz essay'}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className={cn('min-w-0', !selected && 'hidden md:block')}>
            {selected ? (
              <div key={selected.key} className="grid animate-reveal gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" size="sm" onClick={() => open(null)} className="md:hidden">
                    <ArrowLeft /> All work
                  </Button>
                  <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface p-0.5 shadow-sm">
                    <Button variant="ghost" size="icon-sm" aria-label="Previous" disabled={index <= 0} onClick={() => open(items[index - 1]!.key, true)}>
                      <ChevronLeft />
                    </Button>
                    <span className="px-1 text-xs font-medium text-muted tabular">
                      {index + 1} of {items.length}
                    </span>
                    <Button variant="ghost" size="icon-sm" aria-label="Next" disabled={index >= items.length - 1} onClick={() => open(items[index + 1]!.key, true)}>
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
                {selected.kind === 'submission' ? <SubmissionMarking item={selected.data} onDone={afterMarking} /> : <EssayMarking item={selected.data} onDone={afterMarking} />}
              </div>
            ) : (
              <Card>
                <EmptyState icon={<Inbox />} title="Choose something to mark" body="Pick a hand-in from the list to read it and give a mark." />
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
