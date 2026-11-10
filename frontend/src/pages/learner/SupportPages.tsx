import { ArrowLeft, ChevronRight, LifeBuoy, Lock, MessageSquarePlus, Paperclip, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { openTicketAttachment, useCloseTicket, useOpenTicket, useReplyTicket, useTicket, useTickets } from '@/features/engagement/api'
import { usePlatformName } from '@/features/platform/api'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'
import { Link, useNavigate } from '@/lib/router'

const CATEGORIES = [
  ['course', 'Course content'],
  ['payment', 'Payments and refunds'],
  ['account', 'Account and sign-in'],
  ['technical', 'Technical problem'],
  ['business', 'Business account'],
  ['instructor', 'Teaching and payouts'],
] as const

const STATUS: Record<string, { label: string; tone: 'primary' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Open', tone: 'primary' },
  waiting: { label: 'Waiting for you', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
}

function NewTicket({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useOpenTicket()
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('course')
  const [body, setBody] = useState('')
  const send = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { subject: subject.trim(), category, body: body.trim() },
      {
        onSuccess: (t) => {
          toast.success(`Request ${t.reference} sent. We usually reply within a working day.`)
          onOpenChange(false)
          setSubject('')
          setBody('')
          navigate(`/support/${t.id}`)
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Contact support" description="Tell us what happened. Include the course and what you expected to see.">
        <form onSubmit={send} className="grid gap-4">
          <Field label="Topic">
            {(f) => (
              <NativeSelect {...f} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Subject">{(f) => <Input {...f} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />}</Field>
          <Field label="Message">{(f) => <Textarea {...f} className="min-h-36" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} required />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!subject.trim() || !body.trim()}>
              <Send /> Send
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SupportPage() {
  const q = useTickets()
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        title="Help & support"
        description="Your conversations with the LearnHub team."
        actions={
          <Button onClick={() => setOpen(true)}>
            <MessageSquarePlus /> New request
          </Button>
        }
      />
      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon={<LifeBuoy />} title="No requests yet" body="Questions about a course's content? Ask in its Q&A. For anything else (payments, your account, a problem) contact us here." action={<Button onClick={() => setOpen(true)}>Contact support</Button>} />
        </Card>
      ) : (
        <ul className="stagger grid gap-2.5">
          {q.data.map((t) => {
            const s = STATUS[t.status] ?? STATUS.open!
            return (
              <li key={t.id}>
                <Link to={`/support/${t.id}`} className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium group-hover:text-primary">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-mono">{t.reference}</span> · {CATEGORIES.find(([v]) => v === t.category)?.[1] ?? t.category} · updated {relativeDate(t.last_message_at)}
                    </p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <ChevronRight className="size-4 text-subtle" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <NewTicket open={open} onOpenChange={setOpen} />
    </>
  )
}

export function TicketPage() {
  const { id } = useParams()
  const q = useTicket(id)
  const reply = useReplyTicket(id)
  const close = useCloseTicket(id)
  const platform = usePlatformName()
  const [body, setBody] = useState('')
  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
      <Link to="/support">
        <ArrowLeft /> All requests
      </Link>
    </Button>
  )
  if (q.error)
    return (
      <>
        {back}
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      </>
    )
  if (q.isLoading || !q.data) return <Skeleton className="h-96 rounded-xl" />
  const t = q.data
  const s = STATUS[t.status] ?? STATUS.open!
  const closed = t.status === 'closed'
  return (
    <>
      <PageHeader
        back={back}
        title={t.subject}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{t.reference}</span> <Badge tone={s.tone}>{s.label}</Badge>
          </span>
        }
        actions={
          closed ? null : (
            <Button variant="secondary" size="sm" loading={close.isPending} onClick={() => close.mutate(undefined, { onSuccess: () => toast.success('Request closed') })}>
              <Lock /> Close request
            </Button>
          )
        }
      />
      <ol className="stagger grid max-w-3xl gap-3">
        {t.messages.map((m) => (
          <li key={m.id} className={cn('flex gap-3', m.is_staff ? '' : 'flex-row-reverse')}>
            <Avatar name={m.author.name} src={m.author.avatar_url} size="sm" />
            <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm', m.is_staff ? 'rounded-tl-sm border border-border bg-surface' : 'rounded-tr-sm bg-primary text-on-primary')}>
              <p className={cn('text-xs font-medium', m.is_staff ? 'text-primary' : 'text-on-primary/80')}>
                {m.is_staff ? `${m.author.name} · ${platform} support` : 'You'} · {relativeDate(m.created_at)}
              </p>
              {m.body_html ? (
                // cleaned on the server (nh3) before it is stored or sent
                <div className="prose-sm mt-1 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: m.body_html }} />
              ) : (
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              )}
              {m.attachment ? (
                <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2 py-1 text-xs font-medium hover:underline" onClick={() => void openTicketAttachment(t.id, m.id).catch((e: Error) => toast.error(e.message))}>
                  <Paperclip className="size-3.5" /> {m.attachment.name}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {closed ? (
        <p className="mt-6 text-sm text-muted">This request is closed. Open a new one if you need more help.</p>
      ) : (
        <form
          className="mt-6 max-w-3xl rounded-xl border border-border bg-surface p-3 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault()
            reply.mutate(body.trim(), { onSuccess: () => setBody(''), onError: (er) => toast.error(er.message) })
          }}
        >
          <label htmlFor="reply" className="sr-only">
            Reply
          </label>
          <Textarea id="reply" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} placeholder="Write a reply" className="min-h-24 border-0 shadow-none focus-visible:ring-0" />
          <div className="flex justify-end pt-2">
            <Button size="sm" type="submit" loading={reply.isPending} disabled={!body.trim()}>
              <Send /> Send reply
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
