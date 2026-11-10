import { CheckCircle2, ChevronRight, ClipboardList, Download, ExternalLink, FileText, ListChecks, PlayCircle, Radio } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { type Lecture, useCompleteLecture } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

export const kinds: Record<string, { Icon: typeof PlayCircle; label: string }> = {
  video: { Icon: PlayCircle, label: 'Video' },
  article: { Icon: FileText, label: 'Reading' },
  quiz: { Icon: ListChecks, label: 'Quiz' },
  assignment: { Icon: ClipboardList, label: 'Assignment' },
  live_session: { Icon: Radio, label: 'Live session' },
  external_link: { Icon: ExternalLink, label: 'Link' },
  download: { Icon: Download, label: 'Download' },
}

export const kindOf = (k: string) => kinds[k] ?? kinds.article!

/** "12 min", "1 h 5 min", or nothing for lectures without a length. */
export function minutes(sec: number) {
  if (!sec) return ''
  const m = Math.max(1, Math.round(sec / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

export function lectureUrl(slug: string, key: string) {
  return `/learn/${slug}/lecture/${key}`
}

/**
 * The footer of every lecture the learner finishes by hand: "Mark as complete", then
 * the way on to the next one.
 */
export function CompleteBar({ lecture, enrollmentId, slug, manual = true, className }: { lecture: Lecture; enrollmentId: string; slug: string; manual?: boolean; className?: string }) {
  const complete = useCompleteLecture(enrollmentId)
  const done = lecture.completed
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5', className)}>
      {done ? (
        <p className="inline-flex animate-pop items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-5" /> Completed
        </p>
      ) : manual ? (
        <Button
          variant="soft"
          loading={complete.isPending}
          onClick={() =>
            complete.mutate(lecture.key, {
              onSuccess: (r) => toast.success(r.progress_pct >= 100 ? 'Course complete. Well done!' : 'Marked as complete'),
              onError: (e) => toast.error(e.message),
            })
          }
        >
          <CheckCircle2 /> Mark as complete
        </Button>
      ) : (
        <span />
      )}
      {lecture.next_key ? (
        <Button variant={done ? 'primary' : 'ghost'} asChild>
          <Link to={lectureUrl(slug, lecture.next_key)}>
            Next lecture <ChevronRight />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/** Text the server stores as sanitised HTML, but which older rows may hold as plain text
 * (e.g. marking feedback): HTML is rendered, plain text keeps its line breaks. */
export function RichOrText({ value, className }: { value: string; className?: string }) {
  return /<[a-z][^>]*>/i.test(value) ? <Html html={value} className={className} /> : <p className={cn('whitespace-pre-wrap', className)}>{value}</p>
}

export function Html({ html, className }: { html: string; className?: string }) {
  // sanitised on the server (nh3 allow-list, core/html.py) before it is stored
  return <div className={cn('prose-lesson', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
