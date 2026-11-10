import { BookOpen, Megaphone, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { useMe } from '@/features/identity/auth'
import { useAnnounce, useCourseAnnouncements, useStudioCourses } from '@/features/studio/api'
import { relativeDate } from '@/lib/format'

import { ListSkeleton } from './shared'

export function AnnouncementsTab() {
  const courses = useStudioCourses()
  const [params, setParams] = useSearchParams()
  // published courses first: those are the ones with learners to tell
  const list = [...(courses.data ?? [])].sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || b.students - a.students)
  const courseId = params.get('course') ?? list[0]?.id
  const course = list.find((c) => c.id === courseId)
  const announcements = useCourseAnnouncements(course?.id)
  const [composing, setComposing] = useState(false)

  if (courses.isLoading) return <ListSkeleton rows={2} />
  if (courses.error)
    return (
      <Card>
        <ErrorState message={courses.error.message} onRetry={() => void courses.refetch()} />
      </Card>
    )
  if (!list.length)
    return (
      <Card className="animate-reveal">
        <EmptyState icon={<BookOpen />} title="No courses yet" body="Once you have a course with learners, you can send them news from here." />
      </Card>
    )

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <Field label="Course">
            {(f) => (
              <NativeSelect
                {...f}
                value={course?.id ?? ''}
                onChange={(e) =>
                  setParams(
                    (p) => {
                      const n = new URLSearchParams(p)
                      n.set('course', e.target.value)
                      return n
                    },
                    { replace: true, preventScrollReset: true },
                  )
                }
              >
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.status === 'published' ? ` (${c.students.toLocaleString('en-GB')} ${c.students === 1 ? 'learner' : 'learners'})` : ' (not published)'}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Button onClick={() => setComposing(true)} disabled={!course}>
          <Plus /> New announcement
        </Button>
      </div>

      {announcements.isLoading ? (
        <ListSkeleton rows={2} />
      ) : announcements.error ? (
        <Card>
          <ErrorState message={announcements.error.message} onRetry={() => void announcements.refetch()} />
        </Card>
      ) : !announcements.data?.length ? (
        <Card className="animate-reveal">
          <EmptyState icon={<Megaphone />} title="No announcements yet" body="Share news, new lectures or reminders. Everyone on the course gets a notification." action={<Button variant="secondary" onClick={() => setComposing(true)}><Plus /> Write the first one</Button>} />
        </Card>
      ) : (
        <ul className="stagger grid animate-reveal gap-3">
          {announcements.data.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
              <div className="flex items-center gap-2.5">
                <Avatar name={a.author.name} src={a.author.avatar_url} size="sm" />
                <div>
                  <p className="text-sm font-medium">{a.author.name}</p>
                  <p className="text-xs text-muted">{relativeDate(a.created_at)}</p>
                </div>
              </div>
              <h3 className="mt-3 font-semibold">{a.title}</h3>
              <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted">{a.body}</p>
            </li>
          ))}
        </ul>
      )}

      {course ? <Composer key={course.id} open={composing} onOpenChange={setComposing} courseId={course.id} courseTitle={course.title} /> : null}
    </div>
  )
}

/** A side sheet with title and body, and a live preview of how learners will see it. */
function Composer({ open, onOpenChange, courseId, courseTitle }: { open: boolean; onOpenChange: (v: boolean) => void; courseId: string; courseTitle: string }) {
  const { data: me } = useMe()
  const announce = useAnnounce()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const dirty = !!(title.trim() || body.trim())

  const close = (next: boolean) => {
    if (!next && dirty && !announce.isPending && !window.confirm('Discard this announcement? What you wrote will be lost.')) return
    if (!next) (setTitle(''), setBody(''))
    onOpenChange(next)
  }
  const send = (e: FormEvent) => {
    e.preventDefault()
    announce.mutate(
      { courseId, title: title.trim(), body: body.trim() },
      {
        onSuccess: () => {
          toast.success('Announcement sent. Learners on the course are being notified.')
          setTitle('')
          setBody('')
          onOpenChange(false)
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent side="right" title="New announcement" description={courseTitle} className="w-[min(680px,100vw)]">
        <form onSubmit={send} className="grid gap-4 p-4">
          <Field label="Title">{(f) => <Input {...f} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. New section on testing is live" />}</Field>
          <Field label="Message" hint="Plain text. Line breaks are kept.">
            {(f) => <Textarea {...f} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} className="min-h-40" required />}
          </Field>

          <section aria-label="Preview">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">How learners will see it</p>
            <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-3">
              <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Avatar name={me?.full_name || 'You'} src={me?.avatar_url} size="sm" />
                  <div>
                    <p className="text-sm font-medium">{me?.full_name || 'You'}</p>
                    <p className="text-xs text-muted">Just now</p>
                  </div>
                </div>
                <h3 className="mt-3 font-semibold break-words">{title.trim() || <span className="text-muted">Your title</span>}</h3>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted">{body.trim() || 'Your message appears here.'}</p>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={announce.isPending} disabled={!title.trim() || !body.trim()}>
              <Megaphone /> Send to learners
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
