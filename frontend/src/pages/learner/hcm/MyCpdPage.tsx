import { BookOpenCheck, CheckCircle2, Clock, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { shortDate } from '@/lib/format'
import { CPD_KIND_LABEL, useAddCpd, useMyCpd, useMyProfile } from '@/features/hcm/api'

function LogForm({ onDone }: { onDone: () => void }) {
  const add = useAddCpd()
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState('')
  const [completedOn, setCompletedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [hours, setHours] = useState('1')

  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate(
          { title: title.trim(), provider: provider.trim(), completed_on: completedOn, hours: Number(hours) },
          {
            onSuccess: () => {
              toast.success('CPD added')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <Field label="What did you do?">
        {(p) => <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Accessibility webinar" />}
      </Field>
      <Field label="Provider" hint="Who ran or published it. Optional.">
        {(p) => <Input {...p} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="For example: GOV.UK" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date completed">
          {(p) => <Input {...p} type="date" required max={new Date().toISOString().slice(0, 10)} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />}
        </Field>
        <Field label="Hours">
          {(p) => <Input {...p} type="number" required min={0.01} max={999} step={0.01} value={hours} onChange={(e) => setHours(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={add.isPending} disabled={!title.trim() || !(Number(hours) > 0)}>
          <Plus /> Add CPD
        </Button>
      </div>
    </form>
  )
}

export function MyCpdPage() {
  const { data, isLoading, error, refetch } = useMyCpd()
  const profile = useMyProfile()
  const [open, setOpen] = useState(false)
  const total = profile.data ? Number(profile.data.cpd_hours_cached) : null

  return (
    <>
      <PageHeader
        title="My CPD"
        description="Record the learning you do outside the platform. Your logged hours add up here."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Log CPD
          </Button>
        }
      />
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 sm:max-w-md">
          <StatCard label="Hours logged" value={total === null ? '—' : <CountUp value={total} format={(hours) => hours.toLocaleString('en-GB', { maximumFractionDigits: 2 })} />} icon={<Clock />} hint="recorded so far" />
          <StatCard label="Entries" value={data ? data.length : '—'} icon={<BookOpenCheck />} tone="info" hint="pieces of learning" />
        </div>

        <Card>
          <CardHeader title="Your CPD record" description="Newest first." />
          {error ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : isLoading || !data ? (
            <div className="grid gap-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : data.length === 0 ? (
            <EmptyState
              icon={<BookOpenCheck />}
              title="No CPD logged yet"
              body="Add the courses, events and reading you do outside the platform."
              action={
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Log CPD
                </Button>
              }
            />
          ) : (
            <div className="animate-reveal">
              <Table>
                <thead>
                  <tr>
                    <Th>Activity</Th>
                    <Th className="hidden sm:table-cell">Provider</Th>
                    <Th className="hidden sm:table-cell">Completed</Th>
                    <Th className="text-right">Hours</Th>
                    <Th className="text-right">Status</Th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {data.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <p className="font-medium break-words">{c.title}</p>
                        <p className="text-xs text-muted sm:hidden">{c.provider || CPD_KIND_LABEL[c.kind] || c.kind}</p>
                        <p className="text-xs text-muted sm:hidden">{shortDate(c.completed_on)}</p>
                      </Td>
                      <Td className="hidden text-muted sm:table-cell">{c.provider || CPD_KIND_LABEL[c.kind] || '–'}</Td>
                      <Td className="hidden text-muted sm:table-cell">{shortDate(c.completed_on)}</Td>
                      <Td className="text-right font-semibold tabular">{c.hours}</Td>
                      <Td className="text-right">
                        {c.verified ? (
                          <Badge tone="success">
                            <CheckCircle2 /> Verified
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Self-reported</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Log CPD" description="Add a piece of learning you have completed.">
          <LogForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
