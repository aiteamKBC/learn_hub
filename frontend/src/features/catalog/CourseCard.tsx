import { Clock, PlayCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Rating } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/ui/skeleton'
import { duration, money } from '@/lib/format'
import { WishlistHeart } from '@/features/commerce/WishlistHeart'

import type { CourseCardData } from './api'
import { Link } from '@/lib/router'

export function Price({ price, className }: { price: CourseCardData['price']; className?: string }) {
  if (!price) return null
  if (price.free) return <span className={className}>Free</span>
  const list = price.list_minor ?? 0
  const now = price.sale_minor ?? list
  return (
    <span className={className}>
      <span className="font-semibold text-text tabular">{money(now, price.currency, price.exponent)}</span>
      {price.sale_minor != null ? <span className="ml-1.5 text-[13px] text-subtle line-through tabular">{money(list, price.currency, price.exponent)}</span> : null}
    </span>
  )
}

/** Name the clicked card's cover and title so they morph into the course page. */
function nameForMorph(e: React.MouseEvent<HTMLAnchorElement>) {
  const card = e.currentTarget
  card.querySelector<HTMLElement>('[data-morph=cover]')?.style.setProperty('view-transition-name', 'course-cover')
  card.querySelector<HTMLElement>('[data-morph=title]')?.style.setProperty('view-transition-name', 'course-title')
}

export function CourseCard({ course }: { course: CourseCardData }) {
  return (
    <div className="relative flex flex-col">
      <Link
        to={`/courses/${course.slug}`}
        onClick={nameForMorph}
        className="group flex flex-1 flex-col rounded-lg border border-border bg-surface p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow"
      >
        <div className="relative" data-morph="cover">
          <CourseThumb src={course.thumbnail_url} title={course.title} category={course.category} />
          {course.student_count > 50 ? <Badge tone="warning" className="absolute top-2 left-2 bg-warning-soft/95 shadow-sm">Bestseller</Badge> : null}
        </div>
        <div className="flex flex-1 flex-col px-1 pt-3 pb-1">
          <h3 data-morph="title" className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight text-text group-hover:text-primary">{course.title}</h3>
          <p className="mt-1 truncate text-[13px] text-muted">{course.instructors.join(', ')}</p>
          <div className="mt-2">
            <Rating value={course.rating_avg} count={course.rating_count} />
          </div>
          <p className="mt-2 flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {duration(course.total_duration_sec)}
            </span>
            <span className="inline-flex items-center gap-1">
              <PlayCircle className="size-3.5" /> {course.lecture_count} lectures
            </span>
          </p>
          <div className="mt-auto flex items-end justify-between pt-3">
            <Price price={course.price} />
            {course.level && course.level !== 'all' ? <Badge tone="outline" className="capitalize">{course.level}</Badge> : null}
          </div>
        </div>
      </Link>
      <WishlistHeart courseId={course.id} slug={course.slug} title={course.title} className="absolute top-4 right-4 z-10" size="icon-sm" />
    </div>
  )
}

export function CourseCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <Skeleton className="aspect-video w-full" />
      <div className="space-y-2 px-1 pt-3 pb-1">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="mt-4 h-5 w-16" />
      </div>
    </div>
  )
}

export function CourseGrid({ courses, loading, count = 8 }: { courses?: CourseCardData[]; loading?: boolean; count?: number }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', !loading && courses && 'stagger')}>
      {loading || !courses ? Array.from({ length: count }, (_, i) => <CourseCardSkeleton key={i} />) : courses.map((c) => <CourseCard key={c.id} course={c} />)}
    </div>
  )
}
