import { LineChart } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type Kpi, useMeasurements, useRecordMeasurement } from '@/features/pms/api'
import { shortDate } from '@/lib/format'

/** Record a KPI actual for a period, and show the recent measurement history.
 * Admins see the record form; everyone else sees history only. */
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
