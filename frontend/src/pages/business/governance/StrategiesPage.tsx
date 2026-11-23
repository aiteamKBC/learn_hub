import { Compass, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateStrategy, useStrategies } from '@/features/governance/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function CreateStrategyDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const create = useCreateStrategy()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    create.mutate(name.trim(), {
      onSuccess: () => {
        toast.success('Strategy created')
        setOpen(false)
        setName('')
      },
      onError: (err) => toast.error((err as Error).message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New strategy
      </Button>
      <DialogContent title="New strategy" description="This creates a first draft version you can fill in and approve.">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 company strategy" required />
          </label>
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

export function StrategiesPage() {
  const admin = useIsOrgAdmin()
  const { data, isLoading, error, refetch } = useStrategies()

  return (
    <>
      <PageHeader title="Strategy" description="Your company's vision, mission, values and objectives — versioned and approved." actions={admin ? <CreateStrategyDialog /> : null} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<Compass />} title="No strategy yet" body={admin ? 'Create a strategy to set out your vision, mission and values.' : 'Your company has not published a strategy yet.'} action={admin ? <CreateStrategyDialog /> : undefined} />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {data.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{s.name}</h2>
                    {s.approved_version_number ? <Badge tone="success">Approved v{s.approved_version_number}</Badge> : <Badge tone="warning">Draft</Badge>}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">{s.latest_version_number ? `Latest version v${s.latest_version_number}` : 'No versions yet'}</p>
                </div>
                <Button size="sm" variant="secondary" asChild>
                  <Link to={`/business/governance/strategies/${s.id}`}>Open</Link>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
