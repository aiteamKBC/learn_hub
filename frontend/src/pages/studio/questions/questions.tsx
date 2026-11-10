import { ArrowLeft, BadgeCheck, CheckCircle2, MessageSquare, MessagesSquare, Send } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnswerQuestion, useQuestionInbox, useQuestionThread } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'

import { ListSkeleton, Segmented, preview } from './shared'

// The ticket-list + thread pattern: questions on the left, the open one (?q=) on the right.
export function QuestionsTab() {
  const [params, setParams] = useSearchParams()
  const show = params.get('show') === 'all' ? 'all' : 'unanswered'
  const selected = params.get('q') ?? undefined
  const list = useQuestionInbox(show === 'unanswered')
  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v) n.set(k, v)
        else n.delete(k)
        return n
      },
      { replace: k !== 'q', preventScrollReset: true },
    )
  // unanswered first, then newest
  const items = [...(list.data ?? [])].sort((a, b) => Number(a.has_instructor_answer) - Number(b.has_instructor_answer) || b.created_at.localeCompare(a.created_at))

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className={cn('grid min-w-0 gap-3', selected && 'hidden md:grid')}>
        <Segmented
          label="Which questions"
          value={show}
          options={[
            { value: 'unanswered', label: 'Unanswered' },
            { value: 'all', label: 'All' },
          ]}
          onChange={(v) => set('show', v === 'all' ? 'all' : null)}
        />
        {list.isLoading ? (
          <ListSkeleton />
        ) : list.error ? (
          <Card>
            <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          </Card>
        ) : !items.length ? (
          <Card className="animate-reveal">
            <EmptyState icon={<MessagesSquare />} title={show === 'unanswered' ? 'No questions waiting' : 'No questions yet'} body={show === 'unanswered' ? 'Every question has an answer from you. Nice work.' : 'Questions learners ask on your courses will appear here.'} />
          </Card>
        ) : (
          <Card className="animate-reveal overflow-hidden">
            <ul className="stagger grid max-h-[70vh] gap-1 overflow-y-auto p-2" aria-label="Questions">
              {items.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => set('q', x.id)}
                    aria-current={x.id === selected ? 'true' : undefined}
                    className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2', x.id === selected && 'bg-primary-soft hover:bg-primary-soft')}
                  >
                    <Avatar name={x.author} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-sm font-medium">{x.title}</span>
                        {x.has_instructor_answer ? (
                          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-label="You answered" />
                        ) : (
                          <Badge tone="warning">New</Badge>
                        )}
                      </span>
                      {x.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{preview(x.body)}</span> : null}
                      <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                        <span className="max-w-full truncate">{x.course_title}</span>
                        <span>{relativeDate(x.created_at)}</span>
                        <span className="tabular">
                          {x.answer_count} {x.answer_count === 1 ? 'answer' : 'answers'}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className={cn('min-w-0', !selected && 'hidden md:block')}>
        {selected ? (
          <Thread key={selected} id={selected} onBack={() => set('q', null)} />
        ) : (
          <Card>
            <EmptyState icon={<MessageSquare />} title="Choose a question" body="Pick a question to read it and answer. The learner is notified when you reply." />
          </Card>
        )}
      </div>
    </div>
  )
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuestionThread(id)
  const answer = useAnswerQuestion()
  const [body, setBody] = useState('')

  if (q.isLoading)
    return (
      <Card className="grid gap-3 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20" />
        <Skeleton className="h-16" />
      </Card>
    )
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState message={q.error?.message ?? 'Question not found.'} onRetry={() => void q.refetch()} />
      </Card>
    )
  const d = q.data
  return (
    <div className="grid animate-reveal gap-4">
      <Button variant="ghost" size="sm" className="justify-self-start md:hidden" onClick={onBack}>
        <ArrowLeft /> All questions
      </Button>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar name={d.author.name} src={d.author.avatar_url} size="sm" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{d.title}</h2>
            <p className="text-xs text-muted">
              {d.author.name} · {relativeDate(d.created_at)}
            </p>
          </div>
          {d.resolved ? (
            <Badge tone="success">
              <CheckCircle2 /> Resolved
            </Badge>
          ) : null}
        </div>
        {d.body ? <p className="mt-3 text-sm break-words whitespace-pre-wrap">{d.body}</p> : null}
      </Card>

      <h3 className="text-sm font-semibold">
        {d.answers.length} {d.answers.length === 1 ? 'answer' : 'answers'}
      </h3>
      {d.answers.length ? (
        <ul className="stagger grid gap-2.5">
          {d.answers.map((a) => (
            <li key={a.id} className={cn('rounded-xl border bg-surface p-4 shadow-sm', a.is_instructor ? 'border-primary/40' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2.5">
                <Avatar name={a.author.name} src={a.author.avatar_url} size="sm" />
                <p className="text-sm font-medium">{a.author.name}</p>
                {a.is_instructor ? (
                  <Badge tone="primary">
                    <BadgeCheck /> Instructor
                  </Badge>
                ) : null}
                <span className="ml-auto text-xs text-muted">{relativeDate(a.created_at)}</span>
              </div>
              <p className="mt-2 text-sm break-words whitespace-pre-wrap">{a.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          answer.mutate(
            { questionId: id, body: body.trim() },
            {
              onSuccess: () => {
                setBody('')
                toast.success('Answer posted. The learner has been told.')
              },
              onError: (er) => toast.error(er.message),
            },
          )
        }}
        className="rounded-xl border border-border bg-surface p-3 shadow-sm"
      >
        <label htmlFor="studio-answer" className="sr-only">
          Your answer
        </label>
        <Textarea id="studio-answer" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} placeholder="Write your answer. It shows with an Instructor badge." className="min-h-24 border-0 shadow-none focus-visible:ring-0" />
        <div className="flex justify-end pt-2">
          <Button size="sm" type="submit" loading={answer.isPending} disabled={!body.trim()}>
            <Send /> Post answer
          </Button>
        </div>
      </form>
    </div>
  )
}
