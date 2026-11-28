import { Gauge, LineChart, Plus, Target } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type Kpi, useKpis, useMeasurements, useRecordMeasurement } from '@/features/pms/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function attainmentColour(pct: number) {
  if (pct >= 90) return 'var(--chart-5)'
  if (pct >= 60) return 'var(--chart-1)'
  return 'var(--chart-3)'
}

export function RecordDialog({ kpi, admin }: { kpi: Kpi; admin: boolean }) {
  const [open, setOpen] = useState(false)
  const measurements = useMeasurements(open ? kpi.id : undefined)
  const record = useRecordMeasurement(kpi.id)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [index, setIndex] = useState(kpi.cadence === 'quarterly' ? Math.floor(now.getMonth() / 3) + 1 : kpi.cadence === 'weekly' ? 1 : now.getMonth() + 1)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (value.trim() === '') return
    record.mutate(
      { period_year: year, period_index: index, value: value.trim(), note: note.trim() },
      {
        onSuccess: () => {
          toast.success('Measurement recorded')
          setValue('')
          setNote('')
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <LineChart /> {admin ? 'Record' : 'History'}
      </Button>
      <DialogContent title={kpi.name} description={`Measured in ${kpi.unit || 'value'} · ${kpi.cadence}`} className="max-w-[560px]">
        {admin ? (
          <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Record a measurement</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs text-muted">
                Year
                <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} required />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                {kpi.cadence === 'quarterly' ? 'Quarter (1–4)' : kpi.cadence === 'weekly' ? 'Week (1–53)' : 'Month (1–12)'}
                <Input type="number" min={1} max={kpi.cadence === 'quarterly' ? 4 : kpi.cadence === 'weekly' ? 53 : 12} value={index} onChange={(e) => setIndex(Number(e.target.value))} required />
              </label>
            </div>
            <label className="grid gap-1 text-xs text-muted">
              Value ({kpi.unit || 'number'})
              <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Note (optional)
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={record.isPending}>
                Save measurement
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Recent measurements</p>
          {measurements.isLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : measurements.error ? (
            <ErrorState message={(measurements.error as Error).message} onRetry={() => void measurements.refetch()} />
          ) : (measurements.data?.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No measurements yet.</p>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>Period</Th>
                  <Th>Value</Th>
                  <Th>Recorded</Th>
                </Tr>
              </thead>
              <tbody>
                {measurements.data!.map((m) => (
                  <Tr key={m.id}>
                    <Td className="tabular">
                      {m.period_year} · {m.period_index}
                    </Td>
                    <Td className="font-medium tabular">{m.value}</Td>
                    <Td className="text-sm text-muted">{shortDate(m.recorded_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KpiCard({ kpi, admin }: { kpi: Kpi; admin: boolean }) {
  const pct = kpi.attainment == null ? null : Math.round(kpi.attainment)
  return (
    <li>
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4 sm:w-40 sm:shrink-0">
          {pct == null ? (
            <div className="flex size-24 flex-col items-center justify-center rounded-full border border-dashed border-border text-center text-xs text-muted">No data yet</div>
          ) : (
            <Ring value={pct} size={96} stroke={9} color={attainmentColour(pct)} label="attained" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold break-words">{kpi.name}</h2>
            <Badge tone="outline">{kpi.dept || 'Company'}</Badge>
            {kpi.weight ? <Badge tone="neutral">Weight {kpi.weight}</Badge> : null}
          </div>
          {kpi.objective_title ? <p className="mt-0.5 text-[13px] text-muted">Objective: {kpi.objective_title}</p> : null}
          {kpi.definition ? <p className="mt-2 text-sm text-muted">{kpi.definition}</p> : null}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted">Latest</dt>
              <dd className="font-medium tabular">{kpi.latest_value ?? '—'}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Target</dt>
              <dd className="font-medium tabular">{kpi.target ?? '—'}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Baseline</dt>
              <dd className="font-medium tabular">{kpi.baseline ?? '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="sm:ml-auto">
          <RecordDialog kpi={kpi} admin={admin} />
        </div>
      </Card>
    </li>
  )
}

export function KpisPage() {
  const admin = useIsOrgAdmin()
  const { data, isLoading, error, refetch } = useKpis()
  const active = (data ?? []).filter((k) => k.status === 'active')

  return (
    <>
      <PageHeader
        title="Performance measures"
        description="The active KPIs for your company, how they are doing, and the latest readings."
        actions={
          admin ? (
            <Button asChild variant="secondary">
              <Link to="/business/pms/proposals">
                <Plus /> Propose a KPI
              </Link>
            </Button>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gauge />}
            title="No active KPIs yet"
            body={admin ? 'Propose a KPI and take it through approval. Once it is approved it shows here.' : 'Your company has not set any performance measures yet.'}
            action={
              admin ? (
                <Button asChild>
                  <Link to="/business/pms/proposals">
                    <Target /> Propose a KPI
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="animate-reveal grid gap-3">
          <p className="text-xs text-muted">
            {active.length} active {active.length === 1 ? 'measure' : 'measures'}
          </p>
          <ul className="stagger grid gap-4">
            {active.map((k) => (
              <KpiCard key={k.id} kpi={k} admin={admin} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
