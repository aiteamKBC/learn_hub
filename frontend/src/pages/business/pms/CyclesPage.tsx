import { CalendarRange, Lock, Plus, Unlock } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type Cycle, CYCLE_STATUS, useCreateCycle, useCycles, useCycleState } from '@/features/pms/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function isoLocal(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function CreateCycleDialog() {
  const [open, setOpen] = useState(false)
  const create = useCreateCycle()
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 86400000)
  const [name, setName] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1)
  const [opensAt, setOpensAt] = useState(isoLocal(now))
  const [closesAt, setClosesAt] = useState(isoLocal(in30))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (new Date(closesAt) <= new Date(opensAt)) { toast.error('The closing date must be after the opening date.'); return }
    create.mutate(
      { name: name.trim(), year, quarter, opens_at: new Date(opensAt).toISOString(), closes_at: new Date(closesAt).toISOString() },
      {
        onSuccess: () => {
          toast.success('Review cycle created')
          setOpen(false)
          setName('')
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New cycle
      </Button>
      <DialogContent title="New review cycle" description="Set the window in which reviews happen.">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Name
            <Input value={name} minLength={2} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 reviews" required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Year
              <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} required />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Quarter
              <Input type="number" min={1} max={4} value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Opens
              <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Closes
              <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StateButton({ cycle, action }: { cycle: Cycle; action: 'open' | 'close' }) {
  const run = useCycleState(cycle.id, action)
  return (
    <Button
      size="sm"
      variant={action === 'open' ? 'primary' : 'secondary'}
      loading={run.isPending}
      onClick={() => run.mutate(undefined, { onSuccess: () => toast.success(action === 'open' ? 'Cycle opened' : 'Cycle closed'), onError: (err) => toast.error((err as Error).message) })}
    >
      {action === 'open' ? <Unlock /> : <Lock />} {action === 'open' ? 'Open' : 'Close'}
    </Button>
  )
}

function CycleCard({ cycle, admin }: { cycle: Cycle; admin: boolean }) {
  const s = CYCLE_STATUS[cycle.status] ?? { label: cycle.status, tone: 'neutral' as const }
  return (
    <li>
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{cycle.name}</h2>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            Q{cycle.quarter} {cycle.year} · {shortDate(cycle.opens_at)} – {shortDate(cycle.closes_at)} · {cycle.review_count} {cycle.review_count === 1 ? 'review' : 'reviews'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin && cycle.status === 'draft' ? <StateButton cycle={cycle} action="open" /> : null}
          {admin && cycle.status === 'open' ? <StateButton cycle={cycle} action="close" /> : null}
          <Button size="sm" variant="secondary" asChild>
            <Link to={`/business/pms/cycles/${cycle.id}`}>View reviews</Link>
          </Button>
        </div>
      </Card>
    </li>
  )
}

export function CyclesPage() {
  const admin = useIsOrgAdmin()
  const { data, isLoading, error, refetch } = useCycles()

  return (
    <>
      <PageHeader title="Review cycles" description="The periods in which performance reviews are written and signed off." actions={admin ? <CreateCycleDialog /> : null} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarRange />} title="No review cycles yet" body={admin ? 'Create a cycle to start writing performance reviews.' : 'No review cycles have been set up yet.'} action={admin ? <CreateCycleDialog /> : undefined} />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {data.map((c) => (
            <CycleCard key={c.id} cycle={c} admin={admin} />
          ))}
        </ul>
      )}
    </>
  )
}
