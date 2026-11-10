import { ArrowBigUp, ArrowLeft, BadgeCheck, CheckCircle2, Megaphone, MessageSquarePlus, MessagesSquare, NotebookPen, Pencil, Search, Star, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAnnouncements, useAnswer, useAsk, useMyReview, useQuestion, useQuestions, useResolve, useVote, useWriteReview } from '@/features/engagement/api'
import { ReportButton } from '@/features/engagement/ReportButton'
import { useMe } from '@/features/identity/auth'
import { type Pin, pinnedSecond, playhead } from '@/features/learning/bunny'
import { type Lecture, type Player, useAddNote, useDeleteNote, useNotes } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

import { NoteEditor, NoteTimeChip, PinControl } from './note-time'
import { lectureUrl } from './shared'

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- notes
export function NotesPanel({ player, lecture }: { player: Player; lecture: Lecture }) {
  const notes = useNotes(player.enrollment_id)
  const add = useAddNote(player.enrollment_id)
  const remove = useDeleteNote(player.enrollment_id)
  const [body, setBody] = useState('')
  const [pin, setPin] = useState<Pin>({ mode: 'live' })
  const [editing, setEditing] = useState<string | null>(null)
  const [scope, setScope] = useState<'lecture' | 'all'>('lecture')
  const titles = new Map(player.sections.flatMap((s) => s.lectures.map((l) => [l.key, l.title] as const)))
  const kinds = new Map(player.sections.flatMap((s) => s.lectures.map((l) => [l.key, l.kind] as const)))
  const isVideo = lecture.kind === 'video'
  // this lecture's notes in video order (untimed ones last); all notes keep the server's order
  const items = (notes.data ?? [])
    .filter((n) => scope === 'all' || n.lecture_key === lecture.key)
    .sort((a, b) => (scope === 'all' ? 0 : (a.timestamp_sec ?? 1e9) - (b.timestamp_sec ?? 1e9)))

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    // read the playhead at save time, so a note pinned to "now" gets the latest second
    const live = playhead.key === lecture.key ? Math.floor(playhead.sec) : null
    const at = isVideo ? pinnedSecond(pin, live) : null
    add.mutate(
      { lecture_key: lecture.key, body: body.trim(), timestamp_sec: at },
      { onSuccess: () => (setBody(''), setPin({ mode: 'live' })), onError: (er) => toast.error(er.message) },
    )
  }

  return (
    <div className="grid gap-5">
      <form onSubmit={save} className="rounded-xl border border-border bg-surface p-3 shadow-sm">
        <label htmlFor="note" className="sr-only">
          New note
        </label>
        <Textarea id="note" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} placeholder={isVideo ? 'Write a note: it is pinned to this moment of the video' : 'Write a note for this lecture'} className="min-h-20 border-0 shadow-none focus-visible:ring-0" />
        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
            {isVideo ? <PinControl lectureKey={lecture.key} pin={pin} onChange={setPin} /> : null}
            <span>Only you can see your notes.</span>
          </span>
          <Button size="sm" type="submit" loading={add.isPending} disabled={!body.trim()}>
            Save note
          </Button>
        </div>
      </form>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={scope === 'lecture' ? 'soft' : 'ghost'} onClick={() => setScope('lecture')}>
          This lecture
        </Button>
        <Button size="sm" variant={scope === 'all' ? 'soft' : 'ghost'} onClick={() => setScope('all')}>
          All notes
        </Button>
      </div>

      {notes.isLoading ? (
        <ListSkeleton />
      ) : notes.error ? (
        <ErrorState message={notes.error.message} onRetry={() => void notes.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<NotebookPen />} title="No notes yet" body="Notes you write while learning are kept here, next to the lecture they belong to." />
      ) : (
        <ul className="stagger grid gap-3">
          {items.map((n) => (
            <li key={n.id} className="group rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
                  <NoteTimeChip note={n} currentKey={lecture.key} slug={player.slug} />
                  {scope === 'all' ? (
                    <Link to={lectureUrl(player.slug, n.lecture_key)} className="truncate font-medium hover:text-primary">
                      {titles.get(n.lecture_key) ?? 'Lecture'}
                    </Link>
                  ) : null}
                  <span>{relativeDate(n.created_at)}</span>
                </div>
                <span className="flex shrink-0 items-center">
                  <button type="button" aria-label="Edit note" onClick={() => setEditing(editing === n.id ? null : n.id)} className="rounded p-1 text-subtle opacity-70 transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-text">
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" aria-label="Delete note" onClick={() => remove.mutate(n.id, { onError: (er) => toast.error(er.message) })} className="rounded p-1 text-subtle opacity-70 transition-opacity group-hover:opacity-100 hover:bg-danger-soft hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </div>
              {editing === n.id ? (
                <NoteEditor note={n} enrollmentId={player.enrollment_id} isVideo={(kinds.get(n.lecture_key) ?? '') === 'video'} onDone={() => setEditing(null)} />
              ) : (
                <p className="mt-2 text-sm whitespace-pre-wrap">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Q&A
export function QAPanel({ player, lecture, questionId }: { player: Player; lecture: Lecture; questionId?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [thisLecture, setThisLecture] = useState(false)
  const [unanswered, setUnanswered] = useState(false)
  const [asking, setAsking] = useState(false)
  const list = useQuestions(player.course_id, { lectureKey: thisLecture ? lecture.key : undefined, q: search, unanswered })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const open = (id: string | null) => navigate(id ? `/learn/${player.slug}/qa/${id}` : lectureUrl(player.slug, lecture.key), { replace: !id, preventScrollReset: true })

  if (questionId) return <QuestionThread id={questionId} onBack={() => open(null)} />

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form className="flex-1" onSubmit={(e) => (e.preventDefault(), setSearch(q.trim()))}>
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions in this course" aria-label="Search questions" />
        </form>
        <Button onClick={() => setAsking(true)}>
          <MessageSquarePlus /> Ask a question
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <Switch checked={thisLecture} onCheckedChange={setThisLecture} /> This lecture only
        </label>
        <label className="inline-flex items-center gap-2">
          <Switch checked={unanswered} onCheckedChange={setUnanswered} /> Unanswered
        </label>
      </div>

      {list.isLoading ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<MessagesSquare />} title={search ? 'No questions match' : 'No questions yet'} body={search ? 'Try other words, or ask it yourself.' : 'Stuck on something? Ask: the instructor and other learners can answer.'} />
      ) : (
        <ul className={cn('stagger grid gap-2.5 transition-opacity', list.isFetching && !list.isFetchingNextPage && 'opacity-60')}>
          {items.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => open(x.id)} className="group flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow">
                <Avatar name={x.author.name} src={x.author.avatar_url} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-medium group-hover:text-primary">{x.title}</span>
                    {x.resolved ? <Badge tone="success"><CheckCircle2 /> Resolved</Badge> : null}
                  </span>
                  {x.body ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{x.body}</span> : null}
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{x.author.name}</span>
                    <span>{relativeDate(x.created_at)}</span>
                    <span className="tabular">{x.answer_count} {x.answer_count === 1 ? 'answer' : 'answers'}</span>
                    {x.has_instructor_answer ? <span className="inline-flex items-center gap-1 text-primary"><BadgeCheck className="size-3.5" /> Instructor replied</span> : null}
                  </span>
                </span>
                <span className={cn('flex flex-col items-center text-xs font-semibold tabular', x.voted ? 'text-primary' : 'text-muted')}>
                  <ArrowBigUp className="size-5" /> {x.vote_count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="secondary" className="justify-self-center" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
          Show more
        </Button>
      ) : null}

      <AskDialog open={asking} onOpenChange={setAsking} courseId={player.course_id} lecture={lecture} onAsked={(id) => open(id)} />
    </div>
  )
}

function AskDialog({ open, onOpenChange, courseId, lecture, onAsked }: { open: boolean; onOpenChange: (v: boolean) => void; courseId: string; lecture: Lecture; onAsked: (id: string) => void }) {
  const ask = useAsk(courseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pin, setPin] = useState(true)
  const send = (e: FormEvent) => {
    e.preventDefault()
    ask.mutate(
      { title: title.trim(), body: body.trim(), lecture_key: pin ? lecture.key : null },
      {
        onSuccess: (q) => {
          toast.success('Question posted')
          setTitle('')
          setBody('')
          onOpenChange(false)
          onAsked(q.id)
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Ask a question" description="Be specific: what you tried, and where you got stuck.">
        <form onSubmit={send} className="grid gap-4">
          <Field label="Question">{(f) => <Input {...f} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Why does the serializer drop my field?" />}</Field>
          <Field label="Details (optional)">{(f) => <Textarea {...f} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} />}</Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <Switch checked={pin} onCheckedChange={setPin} /> About “{lecture.title}”
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={ask.isPending} disabled={!title.trim()}>
              Post question
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QuestionThread({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: me } = useMe()
  const q = useQuestion(id)
  const vote = useVote()
  const resolve = useResolve(id)
  const answer = useAnswer(id)
  const [body, setBody] = useState('')
  if (q.isLoading) return <ListSkeleton rows={2} />
  if (q.error || !q.data) return <ErrorState message={q.error?.message ?? 'Question not found.'} onRetry={() => void q.refetch()} />
  const d = q.data
  const mine = me?.id === d.author.id
  return (
    <div className="grid animate-reveal gap-4">
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}>
        <ArrowLeft /> All questions
      </Button>
      <article className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar name={d.author.name} src={d.author.avatar_url} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{d.title}</h3>
            <p className="text-xs text-muted">
              {d.author.name} · {relativeDate(d.created_at)}
            </p>
          </div>
          {mine ? (
            // your own question: others can upvote it, you can't
            <span className="flex flex-col items-center px-2 py-1 text-xs font-semibold text-muted tabular" aria-label={`${d.vote_count} votes`}>
              <ArrowBigUp className="size-5" /> {d.vote_count}
            </span>
          ) : (
            <button type="button" aria-pressed={d.voted} aria-label={d.voted ? 'Remove your vote' : 'I have this question too'} onClick={() => vote.mutate(d.id, { onError: (er) => toast.error(er.message) })} className={cn('flex flex-col items-center rounded-md px-2 py-1 text-xs font-semibold tabular transition-colors', d.voted ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2')}>
              <ArrowBigUp className={cn('size-5', d.voted && 'fill-current')} /> {d.vote_count}
            </button>
          )}
        </div>
        {d.body ? <p className="mt-3 text-sm whitespace-pre-wrap">{d.body}</p> : null}
        {mine && !d.resolved && d.answers.length ? (
          <Button size="sm" variant="secondary" className="mt-4" loading={resolve.isPending} onClick={() => resolve.mutate(undefined, { onSuccess: () => toast.success('Marked as resolved') })}>
            <CheckCircle2 /> Mark as resolved
          </Button>
        ) : d.resolved ? (
          <Badge tone="success" className="mt-4">
            <CheckCircle2 /> Resolved
          </Badge>
        ) : null}
        <div className="mt-2 flex justify-end">
          <ReportButton kind="question" id={d.id} authorId={d.author.id} />
        </div>
      </article>

      <h4 className="text-sm font-semibold">
        {d.answers.length} {d.answers.length === 1 ? 'answer' : 'answers'}
      </h4>
      <ul className="stagger grid gap-2.5">
        {d.answers.map((a) => (
          <li key={a.id} className={cn('rounded-xl border bg-surface p-4 shadow-sm', a.is_instructor ? 'border-primary/40' : 'border-border')}>
            <div className="flex items-center gap-2.5">
              <Avatar name={a.author.name} src={a.author.avatar_url} size="sm" />
              <p className="text-sm font-medium">{a.author.name}</p>
              {a.is_instructor ? <Badge tone="primary"><BadgeCheck /> Instructor</Badge> : null}
              <span className="ml-auto text-xs text-muted">{relativeDate(a.created_at)}</span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{a.body}</p>
            <div className="mt-1 flex justify-end">
              <ReportButton kind="answer" id={a.id} authorId={a.author.id} />
            </div>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          answer.mutate(body.trim(), { onSuccess: () => setBody(''), onError: (er) => toast.error(er.message) })
        }}
        className="rounded-xl border border-border bg-surface p-3 shadow-sm"
      >
        <label htmlFor="answer" className="sr-only">
          Your answer
        </label>
        <Textarea id="answer" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} placeholder="Share what you know" className="min-h-20 border-0 shadow-none focus-visible:ring-0" />
        <div className="flex justify-end pt-2">
          <Button size="sm" type="submit" loading={answer.isPending} disabled={!body.trim()}>
            Post answer
          </Button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- announcements
export function AnnouncementsPanel({ player, focus }: { player: Player; focus?: string }) {
  const list = useAnnouncements(player.course_id)
  if (list.isLoading) return <ListSkeleton rows={2} />
  if (list.error) return <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
  if (!list.data?.length) return <EmptyState icon={<Megaphone />} title="No announcements" body="News from the instructor about this course will appear here." />
  return (
    <ul className="stagger grid gap-3">
      {list.data.map((a) => (
        <li key={a.id} id={`announcement-${a.id}`} className={cn('rounded-xl border bg-surface p-4 shadow-sm sm:p-5', focus === a.id ? 'border-primary ring-3 ring-primary/15' : 'border-border')}>
          <div className="flex items-center gap-2.5">
            <Avatar name={a.author.name} src={a.author.avatar_url} size="sm" />
            <div>
              <p className="text-sm font-medium">{a.author.name}</p>
              <p className="text-xs text-muted">{relativeDate(a.created_at)}</p>
            </div>
          </div>
          <h3 className="mt-3 font-semibold">{a.title}</h3>
          <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{a.body}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- review
export function Stars({ value, onChange, size = 'md' }: { value: number; onChange?: (v: number) => void; size?: 'md' | 'lg' }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const label = ['', 'Awful', 'Poor', 'Average', 'Good', 'Amazing'][shown]
  return (
    <div className="flex items-center gap-3">
      <div role={onChange ? 'radiogroup' : 'img'} aria-label={onChange ? 'Your rating' : `Rated ${value} of 5`} className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i === 1 ? '' : 's'}`}
            disabled={!onChange}
            onMouseEnter={() => onChange && setHover(i)}
            onClick={() => onChange?.(i)}
            className="p-0.5 transition-transform enabled:hover:scale-110 enabled:active:scale-95"
          >
            <Star className={cn(size === 'lg' ? 'size-8' : 'size-6', 'transition-colors', i <= shown ? 'fill-warning text-warning' : 'fill-transparent text-border-strong')} />
          </button>
        ))}
      </div>
      {onChange && label ? <span className="text-sm font-medium text-muted">{label}</span> : null}
    </div>
  )
}

export function ReviewPanel({ player }: { player: Player }) {
  const mine = useMyReview(player.course_id)
  const write = useWriteReview(player.course_id)
  const existing = mine.data?.review
  const [rating, setRating] = useState<number | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const r = rating ?? existing?.rating ?? 0
  const b = body ?? existing?.body ?? ''

  if (mine.isLoading) return <ListSkeleton rows={1} />
  if (mine.error) return <ErrorState message={mine.error.message} onRetry={() => void mine.refetch()} />
  if (!mine.data?.can_review) return <EmptyState icon={<Star />} title="Reviews aren't open for this course" body="Training assigned by your company is not reviewed publicly." />

  return (
    <form
      className="max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        write.mutate({ rating: r, body: b.trim() }, { onSuccess: () => toast.success(existing ? 'Review updated' : 'Thanks for your review'), onError: (er) => toast.error(er.message) })
      }}
    >
      <h3 className="font-semibold">{existing ? 'Your review' : 'How is this course so far?'}</h3>
      <p className="mt-1 text-sm text-muted">Your rating helps other learners choose. You can change it any time.</p>
      <div className="mt-4">
        <Stars value={r} onChange={setRating} size="lg" />
      </div>
      <div className="mt-4">
        <Field label="Tell others why (optional)">{(f) => <Textarea {...f} value={b} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="What did you like? What could be better?" />}</Field>
      </div>
      {existing?.instructor_reply ? (
        <div className="mt-4 rounded-lg border-l-3 border-primary bg-primary-soft/50 px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-primary-soft-text">Instructor's reply</p>
          <p className="mt-1 whitespace-pre-wrap">{existing.instructor_reply}</p>
        </div>
      ) : null}
      <Button type="submit" className="mt-4" loading={write.isPending} disabled={!r}>
        {existing ? 'Update review' : 'Post review'}
      </Button>
    </form>
  )
}
