import { ArrowRight, BarChart3, BookOpen, ClipboardCheck, MessageSquare, Plus, Sparkles, Star, Users, Wallet } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { useMe } from '@/features/identity/auth'
import { type StudioRevenue, useStudioCourses, useStudioDashboard, useStudioRevenue } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { money, relativeDate } from '@/lib/format'
import { useFill, useInView } from '@/lib/motion'
import { Link } from '@/lib/router'

import { CourseStatus } from './course-status'
import { CreateCourseDialog } from './CreateCourseDialog'

const gbp = (minor: number) => money(Math.round(minor), 'GBP')

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** Earnings per month (all channels added up): bars grow in when they scroll into view. */
function EarningsChart({ rows }: { rows: StudioRevenue['by_month'] }) {
  const months = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.month, (m.get(r.month) ?? 0) + r.amount)
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
  }, [rows])
  const [ref, seen] = useInView<HTMLDivElement>()
  const k = useFill(1, seen)
  const max = Math.max(1, ...months.map(([, v]) => v))
  if (!months.length) return <EmptyState icon={<BarChart3 />} title="No earnings yet" body="When learners buy your courses, your monthly earnings show here." className="py-8" />
  return (
    <div ref={ref} className="flex h-40 items-end gap-2 sm:gap-3" role="img" aria-label="Earnings for the last months">
      {months.map(([month, v]) => {
        const label = new Date(month).toLocaleDateString('en-GB', { month: 'short' })
        return (
          <Tooltip key={month} content={`${new Date(month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}: ${gbp(v)}`}>
            <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <div className="w-full max-w-10 rounded-t-md bg-primary/80 transition-[height] duration-700 ease-out" style={{ height: `${(v / max) * 100 * k}%`, minHeight: v ? 4 : 0 }} />
              <span className="text-[11px] text-muted">{label}</span>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}

function Attention({ toMark, unanswered, drafts }: { toMark: number; unanswered: number; drafts: number }) {
  const items = [
    { n: toMark, to: '/studio/grading', Icon: ClipboardCheck, text: (n: number) => `${n} ${n === 1 ? 'piece of work needs' : 'pieces of work need'} marking` },
    { n: unanswered, to: '/studio/questions', Icon: MessageSquare, text: (n: number) => `${n} ${n === 1 ? 'question is' : 'questions are'} waiting for your answer` },
    { n: drafts, to: '/studio/courses', Icon: BookOpen, text: (n: number) => `${n} ${n === 1 ? 'course has' : 'courses have'} a draft in progress` },
  ].filter((i) => i.n > 0)
  return (
    <Card>
      <CardHeader title="Needs attention" />
      <CardBody>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Sparkles className="size-4 text-success" /> You're all caught up.
          </p>
        ) : (
          <ul className="stagger grid gap-2">
            {items.map(({ n, to, Icon, text }) => (
              <li key={to}>
                <Link to={to} className="group flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40 hover:bg-surface-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text [&_svg]:size-4">
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1 font-medium">{text(n)}</span>
                  <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function QuickActions() {
  const links = [
    { to: '/studio/courses', label: 'My courses', Icon: BookOpen },
    { to: '/studio/students', label: 'Students', Icon: Users },
    { to: '/studio/revenue', label: 'Sales and earnings', Icon: BarChart3 },
    { to: '/studio/payouts', label: 'Payouts', Icon: Wallet },
  ]
  return (
    <Card>
      <CardHeader title="Quick actions" />
      <CardBody className="grid gap-2">
        <CreateCourseDialog
          trigger={(open) => (
            <Button onClick={open} className="w-full">
              <Plus /> Create a course
            </Button>
          )}
        />
        {links.map(({ to, label, Icon }) => (
          <Button key={to} variant="secondary" className="w-full" asChild>
            <Link to={to}>
              <Icon /> {label}
            </Link>
          </Button>
        ))}
      </CardBody>
    </Card>
  )
}

export function StudioDashboard() {
  const { data: me } = useMe()
  const dash = useStudioDashboard()
  const courses = useStudioCourses()
  const revenue = useStudioRevenue()
  const d = dash.data
  const first = me?.full_name?.split(' ')[0]

  if (dash.error) return <ErrorState message={(dash.error as Error).message} onRetry={() => void dash.refetch()} />

  const noCourses = courses.data && courses.data.length === 0
  const drafts = courses.data?.filter((c) => c.has_draft || c.status === 'draft').length ?? 0

  return (
    <>
      <PageHeader title={`${greeting()}${first ? `, ${first}` : ''}`} description="Your courses, learners and earnings at a glance." />
      <div className="grid gap-6">
        <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-5', d && 'stagger')}>
          {!d ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
          ) : (
            <>
              <StatCard label="Students" value={d.students} icon={<Users />} hint={`across ${d.courses} ${d.courses === 1 ? 'course' : 'courses'}`} />
              <StatCard
                label="Average rating"
                value={d.rating_count ? <CountUp value={d.rating_avg} format={(n) => n.toFixed(1)} /> : '–'}
                icon={<Star />}
                tone="warning"
                hint={d.rating_count ? <Rating value={d.rating_avg} count={d.rating_count} /> : 'No reviews yet'}
              />
              <StatCard label="Earned this month" value={<CountUp value={d.earned_this_month_gbp_minor} format={gbp} />} icon={<Wallet />} tone="success" hint={<Link to="/studio/revenue" className="text-primary hover:underline">See sales</Link>} />
              <Link to="/studio/grading" className="rounded-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
                <StatCard label="To mark" value={d.to_mark} icon={<ClipboardCheck />} tone={d.to_mark ? 'danger' : 'info'} hint="assignments and essay answers" />
              </Link>
              <Link to="/studio/questions" className="rounded-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
                <StatCard label="Unanswered questions" value={d.unanswered} icon={<MessageSquare />} tone={d.unanswered ? 'warning' : 'info'} hint="from your learners" />
              </Link>
            </>
          )}
        </div>

        {noCourses ? (
          <Card className="animate-reveal">
            <EmptyState
              icon={<Sparkles />}
              title="Create your first course"
              body="Start with a title. Then add lessons, quizzes and assignments, set a price and send it for review."
              action={
                <CreateCourseDialog
                  trigger={(open) => (
                    <Button size="lg" onClick={open}>
                      <Plus /> Create your first course
                    </Button>
                  )}
                />
              }
            />
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="grid min-w-0 gap-6">
            <Card>
              <CardHeader
                title="Earnings"
                description="Your share by month, all channels"
                action={
                  <Button variant="link" size="sm" asChild>
                    <Link to="/studio/revenue">Details</Link>
                  </Button>
                }
              />
              <CardBody>{revenue.error ? <ErrorState message={(revenue.error as Error).message} onRetry={() => void revenue.refetch()} /> : !revenue.data ? <Skeleton className="h-40" /> : <div className="animate-reveal"><EarningsChart rows={revenue.data.by_month} /></div>}</CardBody>
            </Card>

            {!noCourses ? (
              <Card>
                <CardHeader
                  title="Your courses"
                  action={
                    <Button variant="link" size="sm" asChild>
                      <Link to="/studio/courses">
                        View all <ArrowRight />
                      </Link>
                    </Button>
                  }
                />
                <div className="mt-3">
                  {courses.error ? (
                    <ErrorState message={(courses.error as Error).message} onRetry={() => void courses.refetch()} />
                  ) : !courses.data ? (
                    <div className="grid gap-3 p-5">
                      {Array.from({ length: 3 }, (_, i) => (
                        <Skeleton key={i} className="h-10" />
                      ))}
                    </div>
                  ) : (
                    <div className="animate-reveal">
                      <Table>
                        <thead>
                          <tr>
                            <Th>Course</Th>
                            <Th className="hidden sm:table-cell">Status</Th>
                            <Th className="text-right">Students</Th>
                            <Th className="hidden text-right md:table-cell">Earned</Th>
                          </tr>
                        </thead>
                        <tbody className="stagger">
                          {courses.data.slice(0, 5).map((c) => (
                            <Tr key={c.id}>
                              <Td>
                                <Link to={`/studio/courses/${c.id}`} className="block max-w-[14rem] truncate font-medium hover:text-primary sm:max-w-[22rem]">
                                  {c.title}
                                </Link>
                                <span className="text-xs text-muted">Updated {relativeDate(c.updated_at)}</span>
                                <span className="mt-1 block sm:hidden">
                                  <CourseStatus course={c} />
                                </span>
                              </Td>
                              <Td className="hidden sm:table-cell">
                                <CourseStatus course={c} />
                              </Td>
                              <Td className="text-right tabular">{c.students.toLocaleString('en-GB')}</Td>
                              <Td className="hidden text-right tabular md:table-cell">{gbp(c.earned_gbp_minor)}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
          <div className="grid h-fit min-w-0 gap-6">
            <QuickActions />
            {d ? <Attention toMark={d.to_mark} unanswered={d.unanswered} drafts={drafts} /> : <Skeleton className="h-40" />}
          </div>
        </div>
      </div>
    </>
  )
}
