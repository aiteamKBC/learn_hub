import { Building2, CalendarClock, ClipboardCheck, PlayCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS, type StatusKey, useMyRequirements } from '@/features/compliance/api'
import { useMe } from '@/features/identity/auth'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

// what needs doing first: overdue and expired at the top, done and exempt at the bottom
const ORDER: StatusKey[] = ['overdue', 'expired', 'expiring_soon', 'in_progress', 'not_started', 'compliant', 'exempt']

function Company({ orgId, name }: { orgId: string; name: string }) {
  const q = useMyRequirements(orgId)
  const items = [...(q.data ?? [])].sort((a, b) => ORDER.indexOf(a.status as StatusKey) - ORDER.indexOf(b.status as StatusKey))
  const done = items.filter((i) => ['compliant', 'exempt'].includes(i.status)).length
  return (
    <section className="mb-6">
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Building2 className="size-4 text-muted" />
          <h2 className="text-base font-semibold">{name}</h2>
          {q.data ? (
            <span className="text-sm text-muted tabular">
              · {done} of {items.length} up to date
            </span>
          ) : null}
        </div>
        {q.error ? (
          <div className="p-5">
            <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
          </div>
        ) : q.isLoading ? (
          <div className="grid gap-3 p-5">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : !items.length ? (
          <EmptyState icon={<ClipboardCheck />} title="Nothing required right now" body={`${name} hasn't assigned you any mandatory training.`} />
        ) : (
          <ul className="stagger divide-y divide-border">
            {items.map((r) => {
              const s = STATUS[r.status as StatusKey] ?? STATUS.not_started
              const finished = r.status === 'compliant' || r.status === 'exempt'
              return (
                <li key={r.status_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <span className="hidden h-12 w-1.5 shrink-0 rounded-full sm:block" style={{ background: s.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.requirement}</p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">{r.course_title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    {r.due_at && !finished ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" /> Due {shortDate(r.due_at)} ({relativeDate(r.due_at)})
                      </span>
                    ) : null}
                    {r.completed_at ? <span>Completed {shortDate(r.completed_at)}</span> : null}
                    {r.expires_at ? <span>Renew by {shortDate(r.expires_at)}</span> : null}
                  </p>
                </div>
                {r.status !== 'exempt' ? (
                  <Button size="sm" variant={finished ? 'secondary' : 'primary'} asChild>
                    <Link to={`/learn/${r.course_slug}`}>
                      <PlayCircle /> {finished ? 'Review' : r.status === 'in_progress' ? 'Continue' : 'Start'}
                    </Link>
                  </Button>
                ) : null}
              </li>
            )
          })}
          </ul>
        )}
      </Card>
    </section>
  )
}

/** Mandatory training from every company the learner belongs to. */
export function RequiredTrainingPage() {
  const { data: me } = useMe()
  const orgs = me?.memberships ?? []
  return (
    <>
      <PageHeader title="Required training" description="Courses your company asks you to complete, with their deadlines and renewal dates." />
      {!orgs.length ? (
        <Card>
          <EmptyState icon={<ClipboardCheck />} title="No company training" body="When an employer adds you to their LearnHub account, their required courses appear here." />
        </Card>
      ) : (
        orgs.map((m) => <Company key={m.org_id} orgId={m.org_id} name={m.name} />)
      )}
    </>
  )
}
