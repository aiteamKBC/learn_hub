import { EyeOff, Flag, HelpCircle, MessageCircle, MessagesSquare, Search, Send, ShieldCheck, Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCreateTicket } from '@/features/console/comms'
import { type ModItem, type ModKind, type ModReport, useDismissReport, useHideReported, useModItems, useModReports, useModSummary, useSetHidden, useStaffAnswer } from '@/features/console/moderation'
import { ConfirmDialog, LoadMore, StatusPill, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { relativeDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

const TABS = ['reported', 'review', 'question', 'answer'] as const
const NOUN: Record<ModKind, string> = { review: 'review', question: 'question', answer: 'answer' }

function Summary() {
  const { data, error, refetch } = useModSummary()
  if (error) return <ErrorState message={error.message} onRetry={() => void refetch()} />
  if (!data) return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-lg" />)}</div>
  return (
    <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Open reports" value={data.open_reports} icon={<Flag />} tone={data.open_reports ? 'danger' : 'success'} hint="waiting for a decision" />
      <StatCard label="Low ratings (30 days)" value={data.low_ratings_30d} icon={<Star />} tone="warning" hint="1 or 2 stars" />
      <StatCard label="Hidden reviews" value={data.hidden_reviews} icon={<EyeOff />} tone="info" />
      <StatCard label="Hidden questions & answers" value={data.hidden_questions + data.hidden_answers} icon={<MessagesSquare />} tone="info" />
    </div>
  )
}

/** Hide (reason required, the author is told) or show again. */
function HideButton({ kind, id, hidden }: { kind: ModKind; id: string; hidden: boolean }) {
  const set = useSetHidden()
  const [open, setOpen] = useState(false)
  if (hidden) {
    return (
      <Button variant="secondary" size="sm" loading={set.isPending} onClick={() => set.mutate({ kind, id, hide: false, reason: '' }, { onSuccess: () => toast.success('Shown again'), onError: (e) => toast.error(e.message) })}>
        Show again
      </Button>
    )
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <EyeOff /> Hide
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Hide this ${NOUN[kind]}?`}
        body="It disappears for learners. The author is told why; anyone who reported it is thanked."
        reason="required"
        reasonLabel="Reason (the author sees this)"
        confirmLabel="Hide"
        loading={set.isPending}
        onConfirm={(reason) => set.mutate({ kind, id, hide: true, reason }, { onSuccess: () => (toast.success('Hidden'), setOpen(false)), onError: (e) => toast.error(e.message) })}
      />
    </>
  )
}

function ItemCard({ it }: { it: ModItem }) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [message, setMessage] = useState('')
  const answer = useStaffAnswer()
  const createTicket = useCreateTicket()
  const navigate = useNavigate()
  const kind = it.kind as ModKind
  return (
    <li className="grid gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{kind === 'answer' ? 'Answer by' : kind === 'question' ? 'Question by' : 'Review by'}</span>
        <span className="font-medium text-text">{it.author}</span>
        <span className="text-muted">on</span>
        <Link to={`/courses/${it.course_slug}`} className="max-w-[16rem] truncate font-medium text-primary hover:underline">{it.course}</Link>
        {it.rating ? <Rating value={it.rating} /> : null}
        {it.is_staff_answer ? <Badge tone="primary">LearnHub team answer</Badge> : null}
        {it.open_reports ? <Badge tone="danger"><Flag /> {it.open_reports} {it.open_reports === 1 ? 'report' : 'reports'}</Badge> : null}
        {it.hidden ? <StatusPill status="hidden" /> : null}
        <span className="ml-auto text-muted">{relativeDate(it.created_at)}</span>
      </div>
      {it.title ? <p className="font-medium">{kind === 'answer' ? `Answer to “${it.title}”` : it.title}</p> : null}
      <p className="text-sm whitespace-pre-wrap text-muted">{it.body || <em>No text</em>}</p>
      {kind === 'review' && it.instructor_reply ? <p className="rounded-md bg-surface-2 p-3 text-sm"><span className="font-medium">Instructor reply:</span> {it.instructor_reply}</p> : null}
      {kind === 'question' ? <p className="text-xs text-muted">{it.answer_count ?? 0} {(it.answer_count ?? 0) === 1 ? 'answer' : 'answers'} · Replies here are visible in the course.</p> : null}
      {kind === 'answer' ? <p className="text-xs text-muted">Original question by <span className="font-medium text-text">{it.question_author}</span>. A public answer appears under that question; a private message goes to <span className="font-medium text-text">{it.author}</span>, who wrote the answer above.</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {kind === 'question' && !it.hidden ? <Button variant="secondary" size="sm" onClick={() => setReplyOpen(true)}><Send /> Answer question</Button> : null}
        {kind === 'answer' && it.question_id && !it.question_hidden ? <Button variant="secondary" size="sm" onClick={() => setReplyOpen(true)}><Send /> Answer original question</Button> : null}
        {!it.is_staff_answer ? <Button variant="secondary" size="sm" onClick={() => setMessageOpen(true)}><MessageCircle /> Message {it.author} privately</Button> : null}
        <HideButton kind={kind} id={it.id} hidden={it.hidden} />
      </div>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent title="Answer the original question publicly" description={`Your answer to “${it.title}” will appear in the course. ${it.question_author || it.author}, who asked the question, will be notified.`}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!it.question_id) return; answer.mutate({ questionId: it.question_id, body: reply.trim() }, { onSuccess: () => { toast.success('Answer posted'); setReply(''); setReplyOpen(false) }, onError: (err) => toast.error(err.message) }) }}>
            <Textarea aria-label="Your public answer" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={10000} required />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReplyOpen(false)}>Cancel</Button><Button type="submit" loading={answer.isPending} disabled={!reply.trim()}>Post answer</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent title={`Private message to ${it.author}`} description={`This message goes to ${it.author}${kind === 'answer' ? ', who wrote the answer shown on this card' : ''}. They can reply through Help.`}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); createTicket.mutate({ user_email: it.author_email, subject: `${kind === 'review' ? 'Review' : kind === 'question' ? 'Question' : 'Answer'} on ${it.course}: ${it.title || it.body.slice(0, 60)}`.slice(0, 200), category: 'course', priority: 'normal', body: message.trim() }, { onSuccess: (result) => { toast.success('Message sent'); setMessageOpen(false); navigate(`/console/communications?ticket=${result.id}`) }, onError: (err) => toast.error(err.message) }) }}>
            <Textarea aria-label="Private message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={10000} required placeholder="Write your reply to the learner" />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMessageOpen(false)}>Cancel</Button><Button type="submit" loading={createTicket.isPending} disabled={!message.trim()}>Send message</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function ItemsTab({ kind }: { kind: ModKind }) {
  const [status, setStatus] = useState('visible')
  const [rating, setRating] = useState(0)
  const [unanswered, setUnanswered] = useState(true)
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const list = useModItems({ kind, status, q: debounced.trim(), max_rating: kind === 'review' ? rating : undefined, unanswered: kind === 'question' && unanswered })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="min-w-0">
      <div className="border-b border-border px-4 py-3 text-sm text-muted">
        {kind === 'review' ? 'Course ratings and written feedback. Message the reviewer privately; hide only content that breaks the rules.' : kind === 'question' ? 'Learners’ course questions. Answer publicly here, or message the learner privately about an individual issue.' : 'Answers already posted to course questions. Add your own answer to the question, or message the answer’s author privately.'}
      </div>
      <div className={`grid gap-2 border-b border-border p-4 ${kind === 'answer' ? 'sm:grid-cols-[minmax(0,1fr)_10rem]' : 'sm:grid-cols-[minmax(0,1fr)_10rem_10rem]'}`}>
        <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text, author or course" aria-label={`Search ${NOUN[kind]}s`} />
        <NativeSelect aria-label="Filter by visibility" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </NativeSelect>
        {kind === 'review' ? (
          <NativeSelect aria-label="Filter by rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            <option value={0}>Any rating</option>
            <option value={2}>2 stars or fewer</option>
            <option value={3}>3 stars or fewer</option>
          </NativeSelect>
        ) : kind === 'question' ? (
          <NativeSelect aria-label="Filter questions by answers" value={unanswered ? 'unanswered' : 'all'} onChange={(e) => setUnanswered(e.target.value === 'unanswered')}>
            <option value="all">All questions</option>
            <option value="unanswered">Unanswered</option>
          </NativeSelect>
        ) : null}
      </div>
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={kind === 'review' ? <Star /> : <HelpCircle />} title={`No ${NOUN[kind]}s match`} body="Try other filters." />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-4">{rows.map((it) => <ItemCard key={it.id} it={it} />)}</ul>
          <LoadMore shown={rows.length} noun={`${NOUN[kind]}s`} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </div>
      )}
    </Card>
  )
}

function ReportCard({ r }: { r: ModReport }) {
  const hide = useHideReported()
  const dismiss = useDismissReport()
  const [action, setAction] = useState<'hide' | 'dismiss' | null>(null)
  const open = r.status === 'open'
  const unavailable = r.content_hidden || r.content_text == null
  return (
    <li className="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="neutral">{NOUN[r.target_type as ModKind] ?? r.target_type}</Badge>
        {r.course ? <span className="max-w-[16rem] truncate text-muted">{r.course}</span> : null}
        <StatusPill status={r.status} label={r.status === 'actioned' ? (r.content_hidden ? 'Content hidden' : 'Hidden when handled') : undefined} />
        {r.reports_on_target > 1 ? <Badge tone="danger">{r.reports_on_target} reports</Badge> : null}
        <span className="ml-auto text-muted">{relativeDate(r.created_at)}</span>
      </div>
      <blockquote className="rounded-md border-l-2 border-border-strong bg-surface-2/60 px-3 py-2 text-sm whitespace-pre-wrap">
        {r.content_text ?? <em className="text-muted">This content no longer exists.</em>}
        {r.content_author ? <span className="mt-1 block text-xs text-muted">by {r.content_author}{r.content_hidden ? ' · hidden' : ''}</span> : null}
      </blockquote>
      <p className="text-sm">
        <span className="font-medium">{r.reporter}</span> <span className="text-muted">reported:</span> {r.reason}
      </p>
      {open ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAction('dismiss')}>
            <ShieldCheck /> {unavailable ? 'Dismiss reports' : 'Keep it'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setAction('hide')} disabled={r.content_text == null}>
            <EyeOff /> Hide content
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">
          {r.handled_by ? `${r.handled_by} · ` : ''}
          {r.handled_at ? relativeDate(r.handled_at) : ''}
          {r.resolution_note ? ` · ${r.resolution_note}` : ''}
        </p>
      )}
      <ConfirmDialog
        open={action === 'hide'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Hide the reported content?"
        body={r.content_hidden ? 'This content is already hidden. Every open report on it will be closed and the reporters thanked.' : 'The author is told why. Every open report on it is closed and the reporters are thanked.'}
        reason="required"
        reasonLabel={r.content_hidden ? 'Reason for the decision' : 'Reason (the author sees this)'}
        confirmLabel="Hide content"
        loading={hide.isPending}
        onConfirm={(reason) => hide.mutate({ id: r.id, reason }, { onSuccess: () => (toast.success('Content hidden'), setAction(null)), onError: (e) => toast.error(e.message) })}
      />
      <ConfirmDialog
        open={action === 'dismiss'}
        onOpenChange={(o) => !o && setAction(null)}
        tone="primary"
        title={unavailable ? 'Dismiss these reports?' : 'Keep this content?'}
        body={unavailable ? 'Every open report on this content is closed. Its visibility does not change, and reporters are notified that the reports were dismissed.' : 'Every open report on this content is closed, and reporters are told it stays up.'}
        reason="optional"
        reasonLabel="Note for the record"
        confirmLabel={unavailable ? 'Dismiss reports' : 'Keep it'}
        loading={dismiss.isPending}
        onConfirm={(note) => dismiss.mutate({ id: r.id, note }, { onSuccess: () => (toast.success('Report dismissed'), setAction(null)), onError: (e) => toast.error(e.message) })}
      />
    </li>
  )
}

function ReportedTab() {
  const [status, setStatus] = useState('open')
  const [targetType, setTargetType] = useState('')
  const list = useModReports(status, targetType)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <h2 className="text-base font-semibold">Reported by learners</h2>
        <NativeSelect className="ml-auto w-44" aria-label="Filter reports" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="actioned">Content hidden</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All reports</option>
        </NativeSelect>
        <NativeSelect className="w-44" aria-label="Filter reported content type" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="">All content</option>
          <option value="review">Reviews</option>
          <option value="question">Questions</option>
          <option value="answer">Answers</option>
        </NativeSelect>
      </div>
      <p className="px-4 pt-3 text-xs text-muted">Each report is listed separately. A decision closes every open report on the same review, question or answer.</p>
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-3 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<ShieldCheck />} title={status === 'open' ? 'No open reports' : 'Nothing here'} body="When a learner reports a review, question or answer it appears here." />
      ) : (
        <div className="animate-reveal">
          <ul className="stagger grid gap-3 p-4">{rows.map((r) => <ReportCard key={r.id} r={r} />)}</ul>
          <LoadMore shown={rows.length} noun="reports" hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </div>
      )}
    </Card>
  )
}

/** Console > Reviews (pattern 25): what learners reported, and every review, question
 * and answer with hide / show and a reason. */
export function ConsoleReviewsPage() {
  const [tab, setTab] = useTabParam(TABS, 'reported')
  const { data } = useModSummary()
  return (
    <>
      <PageHeader title="Reviews & moderation" description="Review feedback, answer course questions, message authors and decide reported content." />
      <div className="grid gap-6">
        <Summary />
        <Tabs value={tab} onValueChange={(t) => setTab(t as (typeof TABS)[number])}>
          <TabsList aria-label="Moderation">
            <TabsTrigger value="reported"><Flag /> Reported {data?.open_reports ? <Badge tone="danger">{data.open_reports}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="review"><Star /> Reviews</TabsTrigger>
            <TabsTrigger value="question"><HelpCircle /> Questions</TabsTrigger>
            <TabsTrigger value="answer"><MessageCircle /> Answers</TabsTrigger>
          </TabsList>
          <TabsContent value="reported"><ReportedTab /></TabsContent>
          <TabsContent value="review"><ItemsTab kind="review" /></TabsContent>
          <TabsContent value="question"><ItemsTab kind="question" /></TabsContent>
          <TabsContent value="answer"><ItemsTab kind="answer" /></TabsContent>
        </Tabs>
      </div>
    </>
  )
}
