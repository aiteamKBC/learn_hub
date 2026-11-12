import { Armchair, LifeBuoy, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type InventoryRow, useAllocate, useAllocations, useInventory } from '@/features/corporate/api'
import { ENTITLEMENT, PROGRAMME } from '@/features/corporate/agreements'
import { PersonPicker, QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function GiveSeat({ row, holders }: { row: InventoryRow; holders: string[] }) {
  const [open, setOpen] = useState(false)
  const allocate = useAllocate()
  const full = row.available <= 0
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)} disabled={full} title={full ? 'No free seats left' : undefined}>
        <UserPlus /> Give a seat
      </Button>
      <DialogContent title={`Give a seat: ${row.course_title}`} description={`${row.available} free ${row.available === 1 ? 'seat' : 'seats'}. They get the course straight away.`}>
        <PersonPicker
          label="Who should get it?"
          exclude={holders}
          disabled={allocate.isPending}
          onPick={(p) =>
            allocate.mutate(
              { offering_id: row.offering_id, user_id: p.user_id },
              {
                onSuccess: () => {
                  toast.success(`${p.name || p.email} can start the course now`)
                  setOpen(false)
                },
                onError: (e) => toast.error((e as Error).message),
              },
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function CourseSeats({ row, selected, onSelect }: { row: InventoryRow; selected: boolean; onSelect: () => void }) {
  const used = row.purchased ? Math.round((row.allocated / row.purchased) * 100) : 0
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'grid gap-3 rounded-xl border bg-surface p-4 text-left transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected ? 'border-primary shadow-md' : 'border-border hover:shadow-sm',
      )}
    >
      <span className="line-clamp-2 font-semibold">{row.course_title}</span>
      <Progress value={used} label={`${row.allocated} of ${row.purchased} seats given`} />
      <span className="flex justify-between text-sm">
        <span className="text-muted">
          {row.allocated} of {row.purchased} given
        </span>
        <span className={row.available ? 'font-medium text-success' : 'text-muted'}>{row.available} free</span>
      </span>
    </button>
  )
}

function Holders({ row }: { row: InventoryRow }) {
  const q = useAllocations(row.offering_id)
  const holders = q.data?.map((a) => a.user_id) ?? []
  return (
    <Card>
      <CardHeader title={row.course_title} description="People with a seat on this course" action={<GiveSeat row={row} holders={holders} />} />
      <div className="mt-3">
        <QueryBlock query={q} rows={3} empty={{ icon: <Armchair />, title: 'Nobody has a seat yet', body: 'Give seats to the people who should take this course.' }}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th className="hidden md:table-cell">Programme</Th>
                  <Th>Paid access</Th>
                  <Th className="hidden sm:table-cell">Since</Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={a.user_name} size="sm" className="hidden sm:inline-flex" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.user_name}</span>
                          <span className="block truncate text-xs text-muted">{a.user_email}</span>
                          {a.left_at ? <span className="block text-xs text-warning">Left {shortDate(a.left_at)}</span> : null}
                        </span>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <StatusBadge map={PROGRAMME} status={a.programme_status} />
                      {a.programme_start ? (
                        <span className="block text-xs text-muted">
                          {shortDate(a.programme_start)}
                          {a.programme_end ? ` – ${shortDate(a.programme_end)}` : ''}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge map={ENTITLEMENT} status={a.entitlement_status} />
                      {a.paid_through ? <span className="block text-xs text-muted">to {shortDate(a.paid_through)}</span> : null}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{shortDate(a.allocated_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryBlock>
      </div>
      <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-muted">
        <LifeBuoy className="mt-px size-3.5 shrink-0" />
        <span>
          Need to move a seat to someone else? <Link to="/support" className="font-medium text-primary hover:underline">Contact us</Link> and we will do it for you.
        </span>
      </p>
    </Card>
  )
}

export function SeatsPage() {
  const q = useInventory()
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    document.title = 'Seats · LearnHub'
  }, [])
  return (
    <>
      <PageHeader
        title="Seats"
        description="Recorded courses you have bought, and who has a seat."
        actions={
          <Button asChild variant="secondary">
            <Link to="/business/packages">Buy seats</Link>
          </Button>
        }
      />
      <QueryBlock query={q} rows={3}>
        {(all) => {
          const rows = all.filter((r) => r.delivery_type === 'recorded')
          if (!rows.length)
            return (
              <Card>
                <EmptyState icon={<Armchair />} title="No seats yet" body="Buy seats on a recorded course, then give them to your people." action={<Button asChild><Link to="/business/packages">See course packages</Link></Button>} />
              </Card>
            )
          const current = rows.find((r) => r.offering_id === selected) ?? rows[0]!
          return (
            <div className="grid gap-6">
              <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((r) => (
                  <CourseSeats key={r.offering_id} row={r} selected={r.offering_id === current.offering_id} onSelect={() => setSelected(r.offering_id)} />
                ))}
              </div>
              <Holders key={current.offering_id} row={current} />
            </div>
          )
        }}
      </QueryBlock>
    </>
  )
}
