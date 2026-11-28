import { BarChart3, BookOpen, ClipboardCheck, Star, Users } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useStudioCourses, useStudioDashboard } from '@/features/studio/api'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

import { CourseStatus } from './course-status'

const gbp = (minor: number) => money(Math.round(minor), 'GBP')

/** Reports & analytics: course reach, ratings and the teaching work waiting on the
 *  instructor. Earnings live on their own page; this view is about learners and quality. */
export function ReportsPage() {
  const dash = useStudioDashboard()
  const courses = useStudioCourses()

  const rows = useMemo(() => [...(courses.data ?? [])].sort((a, b) => b.students - a.students), [courses.data])
  const maxStudents = rows.reduce((top, c) => Math.max(top, c.students), 0)

  return (
    <div className="min-w-0">
      <PageHeader title="Reports & analytics" description="How your courses are performing — reach, ratings and the work waiting on you." />

      {dash.error ? (
        <ErrorState message={(dash.error as Error).message} onRetry={() => void dash.refetch()} />
      ) : !dash.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="animate-reveal grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Learners reached" icon={<Users />} value={<CountUp value={dash.data.students} />} hint="Across all your courses" />
          <StatCard label="Published courses" tone="info" icon={<BookOpen />} value={<CountUp value={dash.data.published} />} hint={`${dash.data.courses} in total`} />
          <StatCard
            label="Average rating"
            tone="warning"
            icon={<Star />}
            value={dash.data.rating_count ? <CountUp value={dash.data.rating_avg} format={(n) => n.toFixed(1)} /> : 'New'}
            hint={`${dash.data.rating_count} review${dash.data.rating_count === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Waiting on you"
            tone={dash.data.to_mark + dash.data.unanswered ? 'danger' : 'success'}
            icon={<ClipboardCheck />}
            value={<CountUp value={dash.data.to_mark + dash.data.unanswered} />}
            hint={`${dash.data.to_mark} to mark · ${dash.data.unanswered} unanswered`}
          />
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Course performance" description="Reach and rating for each course, most learners first." />
        <CardBody>
          {courses.error ? (
            <ErrorState message={(courses.error as Error).message} onRetry={() => void courses.refetch()} />
          ) : !courses.data ? (
            <Skeleton className="h-48" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BarChart3 />}
              title="No courses yet"
              body="Publish your first course and its reach and ratings will show up here."
              action={
                <Button asChild>
                  <Link to="/studio/courses">Go to my courses</Link>
                </Button>
              }
              className="py-8"
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Course</Th>
                  <Th>Learners</Th>
                  <Th>Rating</Th>
                  <Th className="text-right">Earned</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Tr key={c.id}>
                    <Td className="max-w-80">
                      <Link to={`/studio/courses/${c.id}`} className="block truncate font-medium text-primary hover:underline">
                        {c.title}
                      </Link>
                      <CourseStatus course={c} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="w-10 font-medium tabular">{c.students}</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-primary/15" aria-hidden>
                          <span className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${maxStudents ? Math.round((c.students / maxStudents) * 100) : 0}%` }} />
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <Rating value={c.rating_avg} count={c.rating_count} />
                    </Td>
                    <Td className="text-right font-medium tabular">{gbp(c.earned_gbp_minor)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
