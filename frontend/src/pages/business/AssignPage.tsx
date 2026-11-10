import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, CheckCircle2, Network, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type AssignResult, unitLevel, useAssign, useAssignPreview, useLibrary, usePeopleSearch, useUnits } from '@/features/org/api'
import { CheckList, RoleBadge, useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { duration } from '@/lib/format'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'
import { Link } from '@/lib/router'

const STEPS = ['Course', 'People and units', 'Confirm'] as const

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-200',
                done ? 'bg-success text-white' : current ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted',
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn('hidden truncate text-sm sm:block', current ? 'font-semibold' : 'text-muted')}>{label}</span>
            {i < STEPS.length - 1 ? <span aria-hidden className={cn('h-px flex-1 transition-colors duration-200', done ? 'bg-success' : 'bg-border')} /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function AssignPage() {
  const [params] = useSearchParams()
  const preset = params.get('course')
  const { data: library, isLoading: libLoading, error: libError, refetch } = useLibrary()
  const { data: units } = useUnits()
  const assign = useAssign()
  const [step, setStep] = useState(preset ? 1 : 0)
  const [courseId, setCourseId] = useState<string | null>(preset)
  const [courseQ, setCourseQ] = useState('')
  const [peopleQ, setPeopleQ] = useState('')
  const debounced = useDebounced(peopleQ)
  const people = usePeopleSearch(debounced)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [unitIds, setUnitIds] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [result, setResult] = useState<AssignResult | null>(null)

  const course = library?.find((c) => c.id === courseId) ?? null
  const courses = useMemo(() => (courseQ.trim() ? (library ?? []).filter((c) => c.title.toLowerCase().includes(courseQ.trim().toLowerCase())) : (library ?? [])), [library, courseQ])
  const checkedCourse = courses.findIndex((c) => c.id === courseId)
  const chosenUnits = (units ?? []).filter((u) => unitIds.includes(u.id))
  // the exact numbers for the confirm step (a dry run on the server: nothing is written)
  const preview = useAssignPreview(step === 2 && courseId && !result ? { course_id: courseId, member_ids: memberIds, unit_ids: unitIds } : null)
  const willGet = preview.data?.enrolled ?? 0
  const alreadyHave = preview.data?.already_had_it ?? 0

  const submit = () => {
    if (!courseId) return
    assign.mutate(
      { course_id: courseId, member_ids: memberIds, unit_ids: unitIds },
      {
        onSuccess: (r) => {
          setResult(r)
          toast.success(r.enrolled === 1 ? '1 person enrolled' : `${r.enrolled} people enrolled`)
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  const restart = () => {
    setResult(null)
    setMemberIds([])
    setUnitIds([])
    setStep(0)
    setCourseId(null)
  }

  return (
    <>
      <PageHeader title="Assign training" description="Give a course to people or whole teams. They get a notification and it appears in their learning." />
      <div className="mx-auto max-w-4xl">
        <Stepper step={result ? 3 : step} />

        {result ? (
          <Card className="animate-reveal">
            <EmptyState
              icon={<CheckCircle2 />}
              title="Training assigned"
              body={
                <>
                  <span className="font-semibold text-text">{result.enrolled}</span> {result.enrolled === 1 ? 'person' : 'people'} enrolled on {course?.title ?? 'the course'}
                  {result.already_had_it ? (
                    <>
                      , <span className="font-semibold text-text">{result.already_had_it}</span> already had it
                    </>
                  ) : null}
                  .
                </>
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" asChild>
                    <Link to="/business/library">
                      <BarChart3 /> See progress
                    </Link>
                  </Button>
                  <Button onClick={restart}>Assign another course</Button>
                </div>
              }
            />
          </Card>
        ) : step === 0 ? (
          <Card className="animate-reveal">
            <CardHeader title="Choose a course" description="From your company library" />
            <CardBody className="grid gap-4">
              <Input icon={<Search />} type="search" value={courseQ} onChange={(e) => setCourseQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" />
              {libError ? (
                <ErrorState message={(libError as Error).message} onRetry={() => void refetch()} />
              ) : libLoading || !library ? (
                <div className="grid gap-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : courses.length === 0 ? (
                <EmptyState className="py-6" icon={<BookOpen />} title="No courses found" body="Try another word." />
              ) : (
                <ul role="radiogroup" aria-label="Courses" className="stagger grid max-h-[28rem] gap-2 overflow-y-auto">
                  {courses.map((c, i) => {
                    const on = c.id === courseId
                    return (
                      <li key={c.id} role="none">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          tabIndex={radioTabIndex(i, checkedCourse)}
                          onKeyDown={(e) => radioKeyDown(e, i, courses.length, (j) => setCourseId(courses[j].id))}
                          onClick={() => setCourseId(c.id)}
                          className={cn('flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors', on ? 'border-primary bg-primary-soft/50 ring-1 ring-primary/30' : 'border-border hover:bg-surface-2/60')}
                        >
                          <CourseThumb src={c.thumbnail_url} title={c.title} className="w-24 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{c.title}</span>
                            <span className="block truncate text-xs text-muted">
                              {c.lecture_count} lessons · {duration(c.total_duration_sec)} · {c.assigned} assigned
                            </span>
                          </span>
                          {on ? <Check className="size-5 shrink-0 text-primary" /> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="flex justify-end">
                <Button disabled={!courseId} onClick={() => setStep(1)}>
                  Next <ArrowRight />
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : step === 1 ? (
          <div className="grid animate-reveal gap-6">
            {course ? (
              <p className="text-sm text-muted">
                Course: <span className="font-medium text-text">{course.title}</span>
              </p>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="People" description={memberIds.length ? `${memberIds.length} chosen` : 'Pick individual people'} />
                <CardBody>
                  {people.error ? (
                    <ErrorState message={(people.error as Error).message} onRetry={() => void people.refetch()} />
                  ) : (
                    <CheckList
                      label="People"
                      loading={people.isLoading}
                      items={people.data?.items ?? []}
                      selected={memberIds}
                      getId={(p) => p.member_id}
                      onToggle={(id, on) => {
                        const p = people.data?.items.find((x) => x.member_id === id)
                        if (p) setNames((n) => ({ ...n, [id]: p.name || p.email }))
                        setMemberIds(on ? [...memberIds, id] : memberIds.filter((x) => x !== id))
                      }}
                      search={{ value: peopleQ, onChange: setPeopleQ, placeholder: 'Search people' }}
                      empty="Nobody matches."
                      render={(p) => (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={p.name || p.email} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.name || p.email}</span>
                            <span className="block truncate text-xs text-muted">{p.units[0] ?? p.email}</span>
                          </span>
                          <RoleBadge role={p.role} />
                        </span>
                      )}
                    />
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Units" description="Everyone in the unit, including the units below it" />
                <CardBody>
                  <CheckList
                    label="Units"
                    loading={!units}
                    items={units ?? []}
                    selected={unitIds}
                    getId={(u) => u.id}
                    onToggle={(id, on) => setUnitIds(on ? [...unitIds, id] : unitIds.filter((x) => x !== id))}
                    empty="No units yet."
                    render={(u) => (
                      <span className="flex items-center gap-2" style={{ paddingLeft: Math.min(unitLevel(u, units!), 6) * 14 }}>
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <span className="shrink-0 text-xs text-muted tabular">{u.people}</span>
                      </span>
                    )}
                  />
                  <p className="mt-2 text-xs text-muted">Choosing a unit includes its sub-units. The number is the people directly in each unit.</p>
                </CardBody>
              </Card>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep(0)}>
                <ArrowLeft /> Back
              </Button>
              <Button disabled={!memberIds.length && !unitIds.length} onClick={() => setStep(2)}>
                Next <ArrowRight />
              </Button>
            </div>
          </div>
        ) : (
          <Card className="animate-reveal">
            <CardHeader title="Check and assign" />
            <CardBody className="grid gap-5">
              {course ? (
                <div className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <CourseThumb src={course.thumbnail_url} title={course.title} className="w-24 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{course.title}</p>
                    <p className="text-xs text-muted">
                      {course.lecture_count} lessons · {duration(course.total_duration_sec)}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Users className="size-4" /> People ({memberIds.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {memberIds.length ? memberIds.map((id) => <Badge key={id}>{names[id] ?? 'Someone'}</Badge>) : <span className="text-sm text-muted">None</span>}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Network className="size-4" /> Units ({chosenUnits.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {chosenUnits.length ? chosenUnits.map((u) => <Badge key={u.id}>{u.name}</Badge>) : <span className="text-sm text-muted">None</span>}
                  </div>
                </div>
              </div>
              {preview.error ? (
                <ErrorState message={(preview.error as Error).message} onRetry={() => void preview.refetch()} />
              ) : preview.isLoading || !preview.data ? (
                <Skeleton className="h-12 rounded-lg" />
              ) : (
                <div aria-live="polite" className={cn('animate-reveal rounded-lg px-4 py-3 text-sm', willGet ? 'bg-primary-soft text-primary-soft-text' : 'bg-warning-soft text-warning')}>
                  {willGet ? (
                    <p>
                      <span className="font-semibold tabular">{willGet}</span> {willGet === 1 ? 'person' : 'people'} will get this course.
                    </p>
                  ) : (
                    <p>Nobody new would get this course. Go back and choose other people or units.</p>
                  )}
                  {alreadyHave ? (
                    <p className="mt-0.5 opacity-90">
                      <span className="font-semibold tabular">{alreadyHave}</span> {alreadyHave === 1 ? 'person already has' : 'people already have'} it.
                    </p>
                  ) : null}
                </div>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  <ArrowLeft /> Back
                </Button>
                <Button loading={assign.isPending} disabled={!willGet} onClick={submit}>
                  Assign course
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  )
}
