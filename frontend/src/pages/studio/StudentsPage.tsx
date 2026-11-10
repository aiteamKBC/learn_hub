import { ArrowDownUp, BookOpen, CheckCircle2, GraduationCap, Info, Search, TrendingUp, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useCourseStudents, useStudioCourses } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

type Sort = 'recent' | 'name' | 'progress' | 'active'
const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Newest first' },
  { key: 'active', label: 'Last active' },
  { key: 'progress', label: 'Progress' },
  { key: 'name', label: 'Name' },
]

function Students({ courseId }: { courseId: string }) {
  const { data, isLoading, error, refetch } = useCourseStudents(courseId)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [status, setStatus] = useState('')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = (data ?? []).filter((s) => (!needle || s.name.toLowerCase().includes(needle)) && (!status || s.status === status))
    const t = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0)
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'progress' ? b.progress_pct - a.progress_pct : sort === 'active' ? t(b.last_accessed_at) - t(a.last_accessed_at) : t(b.enrolled_at) - t(a.enrolled_at),
    )
  }, [data, q, sort, status])

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />

  const total = data?.length ?? 0
  const completed = data?.filter((s) => s.status === 'completed').length ?? 0
  const avg = total ? data!.reduce((n, s) => n + s.progress_pct, 0) / total : 0

  return (
    <div className="grid gap-6">
      <div className={cn('grid gap-4 sm:grid-cols-3', data && 'stagger')}>
        {isLoading || !data ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
        ) : (
          <>
            <StatCard label="Students" value={total} icon={<Users />} />
            <StatCard label="Average progress" value={<CountUp value={avg} format={(n) => `${Math.round(n)}%`} />} icon={<TrendingUp />} tone="info" />
            <StatCard label="Completed" value={completed} icon={<CheckCircle2 />} tone="success" hint={total ? `${Math.round((completed / total) * 100)}% of students` : undefined} />
          </>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1 basis-56">
            <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" aria-label="Search students" />
          </div>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="w-auto">
            <option value="">All statuses</option>
            <option value="active">In progress</option>
            <option value="completed">Completed</option>
          </NativeSelect>
          <div className="flex items-center gap-2">
            <ArrowDownUp className="size-4 text-muted" aria-hidden />
            <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort students" className="w-auto">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {isLoading || !data ? (
          <div className="grid gap-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={<GraduationCap />} title="No students yet" body="When learners enrol in this course, you'll see their progress here." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Search />} title="No students match" body="Try another search or filter." />
        ) : (
          <div className="animate-reveal">
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th className="w-[34%]">Progress</Th>
                  <Th className="hidden sm:table-cell">Status</Th>
                  <Th className="hidden md:table-cell">Enrolled</Th>
                  <Th className="hidden lg:table-cell">Last active</Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((s, i) => (
                  <Tr key={`${s.name}-${s.enrolled_at}-${i}`}>
                    <Td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={s.name} size="sm" />
                        <div className="min-w-0">
                          <p className="max-w-[9rem] truncate font-medium sm:max-w-[16rem]">{s.name}</p>
                          <p className="text-xs text-muted lg:hidden">{s.last_accessed_at ? `Active ${relativeDate(s.last_accessed_at)}` : 'Not started'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Progress value={s.progress_pct} tone={s.status === 'completed' ? 'success' : 'primary'} className="min-w-12 flex-1" label={`${s.name}: ${Math.round(s.progress_pct)}% complete`} />
                        <span className="w-10 text-right text-[13px] tabular">{Math.round(s.progress_pct)}%</span>
                      </div>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      {s.status === 'completed' ? (
                        <Badge tone="success">
                          <CheckCircle2 /> Completed
                        </Badge>
                      ) : (
                        <Badge tone="info">In progress</Badge>
                      )}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-muted md:table-cell">{shortDate(s.enrolled_at)}</Td>
                    <Td className="hidden whitespace-nowrap text-muted lg:table-cell">{s.last_accessed_at ? relativeDate(s.last_accessed_at) : 'Not started'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="flex gap-2 border-t border-border p-4 text-[13px] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          This list shows learners who enrolled themselves. Progress for learners whose company gave them the course is visible to that company, not here.
        </p>
      </Card>
    </div>
  )
}

export function StudentsPage() {
  const courses = useStudioCourses()
  const [params, setParams] = useSearchParams()
  const list = courses.data ?? []
  const picked = params.get('course')
  const courseId = list.some((c) => c.id === picked) ? picked! : list[0]?.id

  const pick = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('course', id)
        return next
      },
      { replace: true },
    )

  return (
    <>
      <PageHeader
        title="Students"
        description="Follow how learners are getting on in each of your courses."
        actions={
          list.length ? (
            <div className="w-full min-w-0 sm:w-80">
              <Field label="Course">
                {(p) => (
                  <NativeSelect {...p} value={courseId} onChange={(e) => pick(e.target.value)}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </div>
          ) : null
        }
      />
      {courses.error ? (
        <ErrorState message={(courses.error as Error).message} onRetry={() => void courses.refetch()} />
      ) : !courses.data ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[118px]" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : !courseId ? (
        <Card className="animate-reveal">
          <EmptyState
            icon={<BookOpen />}
            title="No courses yet"
            body="Once you have a course, its students and their progress show here."
            action={
              <Button asChild>
                <Link to="/studio/courses">Go to my courses</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Students key={courseId} courseId={courseId} />
      )}
    </>
  )
}
