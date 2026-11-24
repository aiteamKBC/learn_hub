import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, ExternalLink, Search, Users, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS, usePersonCompliance, useRequirements } from '@/features/compliance/api'
import { usePeople } from '@/features/org/api'
import { Link } from '@/lib/router'

const tabs = ['Plans', 'Calendar', 'Allocate courses'] as const
type Tab = (typeof tabs)[number]

/** Company training-plan workspace, built on real company membership and compliance data. */
export function TrainingPlansPage() {
  const [tab, setTab] = useState<Tab>('Plans')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const people = usePeople({ q: query || undefined })
  const requirements = useRequirements()
  const personOptions = people.data?.pages.flatMap((page) => page.items) ?? []
  const selected = personOptions.find((person) => person.member_id === selectedId) ?? personOptions[0]
  const personData = usePersonCompliance(selected?.member_id)
  const items = personData.data?.requirements ?? []
  const counts = useMemo(() => ({
    required: items.length,
    completed: items.filter((item) => ['compliant', 'exempt'].includes(item.status)).length,
    dueSoon: items.filter((item) => item.status === 'expiring_soon').length,
    overdue: items.filter((item) => ['overdue', 'expired'].includes(item.status)).length,
  }), [items])
  const stats: { label: string; value: string | number; Icon: LucideIcon }[] = [
    { label: 'People in view', value: personOptions.length, Icon: Users },
    { label: 'Required items', value: counts.required, Icon: ClipboardList },
    { label: 'Completed', value: counts.completed, Icon: CheckCircle2 },
    { label: 'Overdue', value: counts.overdue, Icon: CalendarDays },
  ]

  return (
    <>
      <PageHeader title="Training plans" description="Review each person’s required learning, progress and deadlines across your company." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <label className="relative min-w-[15rem] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person…" aria-label="Find a person" />
          </label>
          <div className="flex max-w-full gap-2 overflow-x-auto">
            {personOptions.slice(0, 6).map((person) => <Button key={person.member_id} size="sm" variant={selected?.member_id === person.member_id ? 'secondary' : 'ghost'} onClick={() => setSelectedId(person.member_id)}>{person.name}</Button>)}
          </div>
        </div>
        <Button variant="secondary" asChild><Link to="/business/matrix"><Users /> View training matrix</Link></Button>
      </div>

      <nav aria-label="Training plan sections" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {tabs.map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === item ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2 hover:text-text'}`}>{item}</button>)}
      </nav>

      {tab === 'Allocate courses' ? (
        <Card><CardBody className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Assign required training</h2><p className="mt-1 text-sm text-muted">Create a company requirement and target it to teams or job roles.</p></div><Button asChild><Link to="/business/requirements">Manage requirements</Link></Button></CardBody></Card>
      ) : tab === 'Calendar' ? (
        <Card><CardHeader title="Upcoming deadlines" description="Deadlines from the selected person’s assigned requirements." action={<CalendarDays className="size-5 text-muted" aria-hidden />} />{personData.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : personData.error ? <ErrorState message={(personData.error as Error).message} onRetry={() => void personData.refetch()} /> : !selected ? <EmptyState icon={<Users />} title="Choose a person" body="Search for a company member to see their training deadlines." /> : <ul className="grid gap-2 p-4">{items.filter((item) => item.due_at && !['compliant', 'exempt'].includes(item.status)).sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '')).map((item) => <li key={item.status_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><span className="font-medium">{item.name}</span><span className="text-sm text-muted">Due {new Date(item.due_at!).toLocaleDateString()}</span><Badge tone={(STATUS[item.status as keyof typeof STATUS]?.tone ?? 'neutral') as 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'outline'}>{STATUS[item.status as keyof typeof STATUS]?.label ?? item.status}</Badge></li>)}{items.every((item) => !item.due_at || ['compliant', 'exempt'].includes(item.status)) ? <li className="text-sm text-muted">No upcoming deadlines.</li> : null}</ul>}</Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, Icon }) => <Card key={label}><CardBody className="flex items-center justify-between"><div><p className="text-sm text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div><Icon className="size-5 text-primary" aria-hidden /></CardBody></Card>)}
          </div>
          {people.error || requirements.error ? <ErrorState message={((people.error ?? requirements.error) as Error).message} onRetry={() => { void people.refetch(); void requirements.refetch() }} /> : null}
          {people.isLoading || requirements.isLoading ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : !selected ? <Card><EmptyState icon={<Users />} title="No people found" body="Search for a company member to view their assigned training." /></Card> : (
            <>
              <Card className="mb-4"><CardBody className="flex flex-wrap items-center gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{selected.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</div>
                <div className="min-w-0 flex-1"><h2 className="font-semibold">{selected.name}</h2><p className="text-sm text-muted">{selected.job_title || selected.email} · Required learning plan</p></div>
                <div className="flex gap-5 text-center text-sm"><div><b>{counts.required ? Math.round(counts.completed / counts.required * 100) : 0}%</b><p className="text-xs text-muted">progress</p></div><div><b>{counts.dueSoon}</b><p className="text-xs text-muted">due soon</p></div><div><b className={counts.overdue ? 'text-danger' : ''}>{counts.overdue}</b><p className="text-xs text-muted">overdue</p></div></div>
              </CardBody></Card>
              {personData.error ? <ErrorState message={(personData.error as Error).message} onRetry={() => void personData.refetch()} /> : personData.isLoading ? <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : items.length ? <ul className="grid gap-3">{items.map((item) => <li key={item.status_id}><Card><CardBody className="flex flex-wrap items-center gap-4"><div className="min-w-0 flex-1"><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-sm text-muted">{item.course_title}</p></div><Badge tone={(STATUS[item.status as keyof typeof STATUS]?.tone ?? 'neutral') as 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'outline'}>{STATUS[item.status as keyof typeof STATUS]?.label ?? item.status}</Badge><span className="text-sm text-muted">{item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : 'No deadline'}</span><Button size="sm" variant="secondary" asChild><Link to={`/business/matrix?req=${item.requirement_id}`}><ExternalLink /> Details</Link></Button></CardBody></Card></li>)}</ul> : <Card><EmptyState icon={<BookOpen />} title="No training assigned" body="Allocate a requirement to this person to start their plan." action={<Button asChild><Link to="/business/requirements">Allocate training</Link></Button>} /></Card>}
            </>
          )}
        </>
      )}
    </>
  )
}
