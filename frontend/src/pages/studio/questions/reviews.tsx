import { MessageSquareReply, Pencil, Star } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { useReplyToReview, useReviewInbox, type InboxReview } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'

import { ListSkeleton, Segmented } from './shared'

export function ReviewsTab() {
  const [params, setParams] = useSearchParams()
  const show = params.get('show') === 'unreplied' ? 'unreplied' : 'all'
  const list = useReviewInbox(show === 'unreplied')
  return (
    <div className="grid gap-3">
      <Segmented
        label="Which reviews"
        value={show}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unreplied', label: 'No reply yet' },
        ]}
        onChange={(v) =>
          setParams(
            (p) => {
              const n = new URLSearchParams(p)
              if (v === 'unreplied') n.set('show', v)
              else n.delete('show')
              return n
            },
            { replace: true, preventScrollReset: true },
          )
        }
      />
      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.error ? (
        <Card>
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        </Card>
      ) : !list.data?.length ? (
        <Card className="animate-reveal">
          <EmptyState icon={<Star />} title={show === 'unreplied' ? 'Every review has a reply' : 'No reviews yet'} body={show === 'unreplied' ? 'You have replied to all your reviews.' : 'Reviews from learners on your courses will appear here.'} />
        </Card>
      ) : (
        <ul className="stagger grid animate-reveal gap-3">
          {list.data.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex" role="img" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={cn('size-4', i <= value ? 'fill-warning text-warning' : 'fill-border text-border')} />
      ))}
    </span>
  )
}

function ReviewCard({ review: r }: { review: InboxReview }) {
  const reply = useReplyToReview()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(r.instructor_reply)
  const fieldId = `reply-${r.id}`

  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={r.author} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{r.author}</p>
          <p className="truncate text-xs text-muted">
            {r.course_title} · {relativeDate(r.created_at)}
          </p>
        </div>
        <Stars value={r.rating} />
      </div>
      {r.body ? <p className="mt-3 text-sm break-words whitespace-pre-wrap">{r.body}</p> : <p className="mt-3 text-sm text-muted italic">A rating without a written review.</p>}

      {r.instructor_reply && !editing ? (
        <div className="mt-4 rounded-lg border-l-2 border-primary bg-primary-soft/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-primary-soft-text">Your reply</p>
            <Button variant="ghost" size="sm" onClick={() => (setBody(r.instructor_reply), setEditing(true))}>
              <Pencil /> Edit
            </Button>
          </div>
          <p className="mt-1 text-sm break-words whitespace-pre-wrap">{r.instructor_reply}</p>
        </div>
      ) : editing ? (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            // mutateAsync: under "No reply yet" the card leaves the list once replied
            reply
              .mutateAsync({ reviewId: r.id, body: body.trim() })
              .then(() => {
                setEditing(false)
                toast.success('Reply posted')
              })
              .catch((er: Error) => toast.error(er.message))
          }}
        >
          <label htmlFor={fieldId} className="text-sm font-medium">
            Your reply
          </label>
          <Textarea id={fieldId} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} autoFocus placeholder="Thank them, or answer their point. Everyone can see your reply." />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={reply.isPending} disabled={!body.trim()}>
              Post reply
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          <MessageSquareReply /> Reply
        </Button>
      )}
    </li>
  )
}
