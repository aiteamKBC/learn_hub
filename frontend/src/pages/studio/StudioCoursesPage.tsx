import { BookOpen, Plus, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, Rating } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useStudioCourses } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { money, relativeDate } from '@/lib/format'
import { Link } from '@/lib/router'

import { type CourseFilter, CourseStatus, FILTERS, matches } from './course-status'
import { CreateCourseDialog } from './CreateCourseDialog'

const gbp = (minor: number) => money(minor, 'GBP')

export function StudioCoursesPage() {
  const { data, isLoading, error, refetch } = useStudioCourses()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : 'all') as CourseFilter
  const [q, setQ] = useState('')

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, data?.filter((c) => matches(c, f.key)).length ?? 0])), [data])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? []).filter((c) => matches(c, filter) && (!needle || c.title.toLowerCase().includes(needle)))
  }, [data, filter, q])

  const setFilter = (f: CourseFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (f === 'all') next.delete('status')
        else next.set('status', f)
        return next
      },
      { replace: true },
    )

  const create = (
    <CreateCourseDialog
      trigger={(open) => (
        <Button onClick={open}>
          <Plus /> Create course
        </Button>
      )}
    />
  )

  return (
    <>
      <PageHeader title="My courses" description="Build, update and follow every course you teach." actions={create} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <Card className="grid gap-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </Card>
      ) : data.length === 0 ? (
        <Card className="animate-reveal">
          <EmptyState icon={<BookOpen />} title="No courses yet" body="Create your first course: give it a title and the builder opens straight away." action={create} />
        </Card>
      ) : (
        <div className="grid gap-4 animate-reveal">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                    filter === f.key ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-muted hover:text-text',
                  )}
                >
                  {f.label} <span className="tabular opacity-80">({counts[f.key]})</span>
                </button>
              ))}
            </div>
            <div className="w-full sm:w-64">
              <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your courses" aria-label="Search your courses" />
            </div>
          </div>

          {rows.length === 0 ? (
            <Card>
              <EmptyState icon={<Search />} title="No courses match" body="Try another filter or search." />
            </Card>
          ) : (
            <>
              {/* phone: cards */}
              <ul className="stagger grid gap-3 md:hidden">
                {rows.map((c) => (
                  <li key={c.id}>
                    <Link to={`/studio/courses/${c.id}`} className="block rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40">
                      <p className="font-medium break-words">{c.title}</p>
                      <div className="mt-2">
                        <CourseStatus course={c} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5" /> {c.students.toLocaleString('en-GB')}
                        </span>
                        <Rating value={c.rating_avg} count={c.rating_count} />
                        <span className="tabular">{gbp(c.earned_gbp_minor)}</span>
                        <span>Updated {relativeDate(c.updated_at)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* desktop: table */}
              <Card className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Course</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Students</Th>
                      <Th>Rating</Th>
                      <Th className="text-right">Earned</Th>
                      <Th className="hidden lg:table-cell">Updated</Th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((c) => (
                      <Tr key={c.id}>
                        <Td>
                          <Link to={`/studio/courses/${c.id}`} className="block max-w-[22rem] truncate font-medium hover:text-primary">
                            {c.title}
                          </Link>
                          {c.ownership === 'organization' ? <span className="text-xs text-muted">Company course</span> : null}
                        </Td>
                        <Td>
                          <CourseStatus course={c} />
                        </Td>
                        <Td className="text-right tabular">{c.students.toLocaleString('en-GB')}</Td>
                        <Td>
                          <Rating value={c.rating_avg} count={c.rating_count} />
                        </Td>
                        <Td className="text-right tabular">{gbp(c.earned_gbp_minor)}</Td>
                        <Td className="hidden whitespace-nowrap text-muted lg:table-cell">{relativeDate(c.updated_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}
    </>
  )
}
