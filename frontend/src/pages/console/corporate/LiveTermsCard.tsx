/**
 * Console > Company packages > Live payment plans. Per live course the platform admin
 * sets: how long it runs, a deposit paid at booking that covers the first months, then
 * instalments (each covering some months, counted from the intake start), and the price
 * for a private intake. Companies pay on these terms.
 */
import { CalendarDays, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type CnLiveTerms, useCnLiveTerms, useCnSaveLiveTerms, useCnSendLiveReminders } from '@/features/corporate/console'
import { gbp } from '@/features/corporate/format'
import { QueryBlock } from '@/features/corporate/ui'
import { shortDate } from '@/lib/format'
import { toast } from '@/lib/toast'

type Part = { months: string; pounds: string }
const toMinor = (v: string) => Math.round(Number(v || 0) * 100)
const toPounds = (minor?: number | null) => (minor ? String(minor / 100) : '')

function TermsForm({ row, onDone }: { row: CnLiveTerms; onDone: () => void }) {
  const [months, setMonths] = useState(String(row.programme_months ?? 6))
  const [depMonths, setDepMonths] = useState(String(row.deposit_months ?? 2))
  const [deposit, setDeposit] = useState(toPounds(row.deposit_minor))
  const [parts, setParts] = useState<Part[]>(row.instalments.length ? row.instalments.map((p) => ({ months: String(p.months), pounds: toPounds(p.amount_minor) })) : [{ months: '2', pounds: '' }])
  const [privatePrice, setPrivatePrice] = useState(toPounds(row.private_price_minor))
  const save = useCnSaveLiveTerms()

  const covered = Number(depMonths || 0) + parts.reduce((n, p) => n + Number(p.months || 0), 0)
  const seat = toMinor(deposit) + parts.reduce((n, p) => n + toMinor(p.pounds), 0)
  const fits = covered === Number(months)
  const setPart = (i: number, k: keyof Part, v: string) => setParts((all) => all.map((p, n) => (n === i ? { ...p, [k]: v } : p)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        courseId: row.course_id,
        programme_months: Number(months),
        deposit_months: Number(depMonths),
        deposit_minor: toMinor(deposit),
        instalments: parts.filter((p) => p.months || p.pounds).map((p) => ({ months: Number(p.months), amount_minor: toMinor(p.pounds) })),
        private_price_minor: privatePrice ? toMinor(privatePrice) : null,
      },
      { onSuccess: () => (toast.success('Payment plan saved.'), onDone()), onError: (err) => toast.error((err as Error).message) },
    )
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Course length (months)">{(p) => <Input {...p} type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
        <Field label="Deposit covers (months)" hint="Paid when booking.">{(p) => <Input {...p} type="number" min={1} max={60} value={depMonths} onChange={(e) => setDepMonths(e.target.value)} />}</Field>
        <Field label="Deposit per seat (£)">{(p) => <Input {...p} type="number" min={0.01} step={0.01} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />}</Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">After the deposit</legend>
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label={`Instalment ${i + 1}: covers (months)`}>{(f) => <Input {...f} type="number" min={1} max={60} value={p.months} onChange={(e) => setPart(i, 'months', e.target.value)} />}</Field>
            <Field label="Per seat (£)">{(f) => <Input {...f} type="number" min={0.01} step={0.01} inputMode="decimal" value={p.pounds} onChange={(e) => setPart(i, 'pounds', e.target.value)} />}</Field>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove instalment ${i + 1}`} onClick={() => setParts((all) => all.filter((_, n) => n !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" className="justify-self-start" disabled={parts.length >= 24} onClick={() => setParts((all) => [...all, { months: '2', pounds: '' }])}>
          <Plus /> Add instalment
        </Button>
      </fieldset>

      <Field label="Private intake price (£)" hint="Optional. One price for a whole intake opened for one company.">
        {(p) => <Input {...p} type="number" min={0.01} step={0.01} inputMode="decimal" value={privatePrice} onChange={(e) => setPrivatePrice(e.target.value)} className="sm:w-56" />}
      </Field>

      <div className="grid gap-1 rounded-lg bg-surface-2 p-3 text-sm" aria-live="polite">
        <p className="flex justify-between">
          <span className="text-muted">Months covered</span>
          <span className={fits ? 'text-success' : 'text-danger'}>
            {covered} of {months || 0}
          </span>
        </p>
        <p className="flex justify-between font-semibold">
          <span>Seat price</span>
          <span className="tabular">{gbp(seat)}</span>
        </p>
        {!fits ? <p className="text-xs text-danger">The deposit and instalments must cover the whole course.</p> : null}
      </div>

      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={save.isPending} disabled={!fits || !toMinor(deposit)}>
          Save plan
        </Button>
      </div>
    </form>
  )
}

/** How the plan reads in the table: "£200 now (2 months), then 2 × £200 (2 months each)". */
function planText(r: CnLiveTerms) {
  if (!r.has_terms) return 'Not set'
  const rest = r.instalments.map((p) => `${gbp(p.amount_minor)} (${p.months} mo)`).join(', ')
  return `${gbp(r.deposit_minor ?? 0)} deposit (${r.deposit_months} mo)${rest ? `, then ${rest}` : ''}`
}

export function LiveTermsCard() {
  const q = useCnLiveTerms()
  const [editing, setEditing] = useState<CnLiveTerms | null>(null)
  return (
    <Card>
      <CardHeader title="Live payment plans" description="Per live course: a deposit at booking that covers the first months, then instalments. Months count from the start of the intake. Companies get a reminder a week before their paid months end."
        action={<RemindNow />}
      />
      <QueryBlock query={q} empty={{ icon: <Video />, title: 'No live courses', body: 'Switch live on for a course in "Recorded or live" above, then set its plan here.' }}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <Th>Course</Th>
                <Th>Plan per seat</Th>
                <Th>Seat price</Th>
                <Th>Private intake</Th>
                <Th>Next intakes</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.course_id}>
                  <Td className="font-medium">{r.title}</Td>
                  <Td className="text-sm">{r.has_terms ? planText(r) : <Badge tone="warning">Not set</Badge>}</Td>
                  <Td className="tabular">{r.seat_price_minor ? gbp(r.seat_price_minor) : '—'}</Td>
                  <Td className="tabular">{r.private_price_minor ? gbp(r.private_price_minor) : '—'}</Td>
                  <Td className="text-xs text-muted">
                    {r.intakes.length ? (
                      r.intakes.map((i) => (
                        <span key={i.id} className="flex items-center gap-1">
                          <CalendarDays className="size-3" /> {i.starts_on ? shortDate(i.starts_on) : i.title}
                        </span>
                      ))
                    ) : (
                      <span>None planned</span>
                    )}
                  </Td>
                  <Td>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                      <Pencil /> {r.has_terms ? 'Edit' : 'Set plan'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBlock>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? (
          <DialogContent title={`Payment plan: ${editing.title}`} description="Per seat. The deposit is paid when booking; each instalment is due before the months already paid run out." className="max-w-2xl">
            <TermsForm row={editing} onDone={() => setEditing(null)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  )
}

function RemindNow() {
  const m = useCnSendLiveReminders()
  return (
    <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (r) => toast.success(r.sent ? `${r.sent} reminder${r.sent === 1 ? '' : 's'} sent.` : 'Nothing due this week.'), onError: (e) => toast.error((e as Error).message) })}>
      Send reminders now
    </Button>
  )
}
