import { Clock, PlayCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Rating } from '@/components/ui/misc'
import { duration } from '@/lib/format'
import { Link } from '@/lib/router'

import type { CourseCardData } from './api'
import { Price } from './CourseCard'
import { WishlistHeart } from '@/features/commerce/WishlistHeart'

/** A course as a wide row: catalogue list view, cart and wishlist lines. */
export function CourseRow({ course, aside, actions, showPrice = true, showWishlist = false }: { course: CourseCardData; aside?: ReactNode; actions?: ReactNode; showPrice?: boolean; showWishlist?: boolean }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow sm:flex-row">
      <Link to={`/courses/${course.slug}`} className="shrink-0 sm:w-56" tabIndex={-1} aria-hidden>
        <CourseThumb src={course.thumbnail_url} title={course.title} category={course.category} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:py-1">
        <Link to={`/courses/${course.slug}`} className="w-fit text-base leading-snug font-semibold tracking-tight hover:text-primary">
          {course.title}
        </Link>
        {course.subtitle ? <p className="line-clamp-2 text-sm text-muted">{course.subtitle}</p> : null}
        <p className="text-[13px] text-muted">{course.instructors.join(', ')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <Rating value={course.rating_avg} count={course.rating_count} />
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {duration(course.total_duration_sec)}
          </span>
          <span className="inline-flex items-center gap-1">
            <PlayCircle className="size-3.5" /> {course.lecture_count} lectures
          </span>
          {course.level && course.level !== 'all' ? <Badge tone="outline" className="capitalize">{course.level}</Badge> : null}
        </div>
        {actions ? <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2">{actions}</div> : null}
      </div>
      <div className="flex shrink-0 items-start justify-between gap-3 sm:flex-col sm:items-end sm:py-1">
        {aside ?? (showPrice ? <Price price={course.price} className="text-lg" /> : null)}
        {showWishlist ? <WishlistHeart courseId={course.id} slug={course.slug} title={course.title} size="icon-sm" /> : null}
      </div>
    </div>
  )
}
