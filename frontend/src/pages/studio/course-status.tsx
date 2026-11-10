import { CheckCircle2, FileEdit, Hourglass, MessageSquareWarning, PencilLine } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { StudioCourseRow } from '@/features/studio/api'

// A course row has its listing status, plus the status of the version being worked on
// (`draft_status`: draft / in_review / changes_requested), if there is one.
export type CourseFilter = 'all' | 'published' | 'draft' | 'in_review' | 'changes_requested'

export const FILTERS: { key: CourseFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'in_review', label: 'In review' },
  { key: 'changes_requested', label: 'Changes requested' },
]

const isLive = (c: StudioCourseRow) => c.status === 'published' || c.status === 'unlisted'

export function matches(c: StudioCourseRow, f: CourseFilter) {
  if (f === 'all') return true
  if (f === 'published') return isLive(c)
  if (f === 'draft') return c.draft_status === 'draft' || (c.status === 'draft' && !c.draft_status)
  return c.draft_status === f
}

export function CourseStatus({ course }: { course: StudioCourseRow }) {
  const live = isLive(course)
  const working = course.draft_status
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {live ? (
        <Badge tone="success">
          <CheckCircle2 /> {course.status === 'unlisted' ? 'Unlisted' : 'Published'}
        </Badge>
      ) : course.status === 'archived' ? (
        <Badge tone="neutral">Archived</Badge>
      ) : null}
      {working === 'in_review' ? (
        <Badge tone="info">
          <Hourglass /> In review
        </Badge>
      ) : working === 'changes_requested' ? (
        <Badge tone="warning">
          <MessageSquareWarning /> Changes requested
        </Badge>
      ) : working === 'draft' || !live ? (
        <Badge tone={live ? 'info' : 'neutral'}>
          {live ? <PencilLine /> : <FileEdit />} {live ? 'New draft' : 'Draft'}
        </Badge>
      ) : null}
    </span>
  )
}

export function slugSuggestion(title: string) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}
