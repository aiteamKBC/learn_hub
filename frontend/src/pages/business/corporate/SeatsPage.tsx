import { Armchair, LifeBuoy, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type InventoryRow, useAllocate, useAllocations, useInventory } from '@/features/corporate/api'
import { ENTITLEMENT, PROGRAMME } from '@/features/corporate/agreements'
import { PersonPicker, QueryBlock, StatusBadge } from '@/features/corporate/ui'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

function GiveSeat({ row, holders, autoOpen = false }: { row: InventoryRow; holders: string[]; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen && row.available > 0)
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

function Holders({ row, give }: { row: InventoryRow; give: boolean }) {
  const q = useAllocations(row.offering_id)
  const holders = q.data?.map((a) => a.user_id) ?? []
  return (
    <Card>
      <CardHeader title={row.course_title} description="People with a seat on this course" action={q.data ? <GiveSeat row={row} holders={holders} autoOpen={give} /> : null} />
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

/** /business/seats is now the "Seats" tab of Purchases & seats. */
export function SeatsPage() {
  return <Navigate to="/business/purchases-and-seats" replace />
}

/** Seats bought on recorded courses: totals (the server's counts per course, added up),
 * one card per course and who holds a seat. `offering` picks a course; with `give` its
 * "Give a seat" opens straight away (after a purchase). */
export function SeatsPanel({ offering, give = false }: { offering?: string | null; give?: boolean }) {
  const q = useInventory()
  const [selected, setSelected] = useState<string | null>(offering ?? null)
  return (
    <>
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
          const total = (k: 'purchased' | 'allocated' | 'available') => rows.reduce((n, r) => n + r[k], 0)
          return (
            <div className="grid gap-6">
              <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard label="Seats bought" value={total('purchased')} icon={<Armchair />} hint={`${rows.length} ${rows.length === 1 ? 'course' : 'courses'}`} />
                <StatCard label="Seats given" value={total('allocated')} icon={<UserPlus />} tone="info" hint="to your people" />
                <StatCard label="Free seats" value={total('available')} icon={<Armchair />} tone="success" hint="ready to give" />
              </div>
              <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((r) => (
                  <CourseSeats key={r.offering_id} row={r} selected={r.offering_id === current.offering_id} onSelect={() => setSelected(r.offering_id)} />
                ))}
              </div>
              <Holders key={current.offering_id} row={current} give={give && current.offering_id === offering} />
            </div>
          )
        }}
      </QueryBlock>
    </>
  )
}
