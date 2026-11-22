import { Coins, Loader2, MinusCircle, PlusCircle, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useAdjustWallet, useAdminRates, useAdminStudentSearch, useAdminWallet, useAdminWalletLedger } from '@/features/b2c/console'
import { dateTime } from '@/features/console/money-ui'
import { useDebounced } from '@/features/org/ui'
import { count } from '@/lib/format'
import { tokenValueGbp } from '@/lib/token-value'

/** Console > Wallet. Staff find a learner, read their token balance, grants and ledger, and
 * make a manual adjustment. A reason is always required and recorded in the audit trail. */
export function AdminWalletPage() {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string; email: string } | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader title="Token wallets" description="Look up a learner to view and adjust their token balance. Every adjustment needs a reason and is audited." />
      {selected ? (
        <WalletDetail user={selected} onBack={() => setSelected(null)} />
      ) : (
        <StudentPicker q={q} setQ={setQ} onPick={setSelected} />
      )}
    </div>
  )
}

function StudentPicker({ q, setQ, onPick }: { q: string; setQ: (v: string) => void; onPick: (u: { id: string; name: string; email: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const box = useRef<HTMLDivElement>(null)
  const term = useDebounced(q.trim(), 200)
  const search = useAdminStudentSearch(term, open)
  const waitingForSearch = q.trim() !== term
  const rows = waitingForSearch ? [] : (search.data?.pages.flatMap((p) => p.items) ?? [])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const pick = (row: (typeof rows)[number]) => {
    setOpen(false)
    onPick({ id: row.id, name: row.name, email: row.email })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return setOpen(false)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      if (rows.length) setActive((index) => open ? (index + 1) % rows.length : 0)
    } else if (event.key === 'ArrowUp' && rows.length) {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index - 1 + rows.length) % rows.length)
    } else if (event.key === 'Enter' && open && rows[active]) {
      event.preventDefault()
      pick(rows[active])
    }
  }
  return (
    <Card>
      <CardHeader title="Find a learner" />
      <div className="p-4">
        <div ref={box} className="relative">
          <Input
            icon={search.isFetching ? <Loader2 className="animate-spin" /> : <Search />}
            type="search"
            value={q}
            onChange={(event) => { setQ(event.target.value); setActive(0); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search by name or email…"
            aria-label="Search learners"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
          />
          {open ? (
            <div id={listId} role="listbox" aria-label="Learners" className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
              {waitingForSearch || search.isLoading ? <p className="px-3 py-3 text-sm text-muted">Loading learners…</p> : search.error ? (
                <div className="px-3 py-2"><ErrorState message="Could not load learners." onRetry={() => void search.refetch()} /></div>
              ) : !rows.length ? (
                <p className="px-3 py-3 text-sm text-muted">{term ? 'No learners match this search.' : 'No learners found.'}</p>
              ) : (
                <>
                  {rows.map((row, index) => (
                    <button
                      key={row.id}
                      id={`${listId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => pick(row)}
                      className={`flex w-full min-w-0 flex-col rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none ${index === active ? 'bg-primary-soft' : ''}`}
                    >
                      <span className="truncate font-medium">{row.name || row.email}</span>
                      <span className="truncate text-xs text-muted">{row.email}{row.status !== 'active' ? ` · ${row.status}` : ''}</span>
                    </button>
                  ))}
                  {search.hasNextPage ? <Button variant="ghost" size="sm" className="mt-1 w-full" loading={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>Load more learners</Button> : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function WalletDetail({ user, onBack }: { user: { id: string; name: string; email: string }; onBack: () => void }) {
  const wallet = useAdminWallet(user.id)
  const ledger = useAdminWalletLedger(user.id)
  const rates = useAdminRates()
  const rate = Number(rates.data?.find((r) => r.is_current)?.tokens_per_gbp_minor ?? 0) || undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold">{user.name || user.email}</p>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to search
        </Button>
      </div>

      {wallet.isLoading ? (
        <Skeleton className="h-28 rounded-lg" />
      ) : wallet.error ? (
        <ErrorState message="We couldn't load this wallet." onRetry={() => void wallet.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Balance" value={<span className="tabular-nums">{count(wallet.data?.balance.balance ?? 0)}</span>} icon={<Coins />} tone="primary" hint={`tokens${tokenValueGbp(wallet.data?.balance.balance, rate) ? ` · ${tokenValueGbp(wallet.data?.balance.balance, rate)}` : ''}`} />
            <StatCard
              label="Expiring within 7 days"
              value={<span className="tabular-nums">{count(wallet.data?.balance.expiring_within_7_days ?? 0)}</span>}
              icon={<Coins />}
              tone={wallet.data?.balance.expiring_within_7_days ? 'warning' : 'info'}
              hint="tokens"
            />
          </div>

          <AdjustForm userId={user.id} rate={rate} />

          <Card>
            <CardHeader title="Grants" description={`${wallet.data?.grants.length ?? 0} most recent`} />
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <Tr>
                    <Th>Source</Th>
                    <Th>Amount</Th>
                    <Th>Remaining</Th>
                    <Th>Granted</Th>
                    <Th>Expires</Th>
                    <Th>Note</Th>
                  </Tr>
                </thead>
                <tbody>
                  {wallet.data?.grants.map((g) => (
                    <Tr key={g.id}>
                      <Td className="capitalize">{g.source}</Td>
                      <Td className="tabular-nums">{count(g.amount)}</Td>
                      <Td className="tabular-nums">{count(g.remaining)}</Td>
                      <Td className="whitespace-nowrap text-muted">{dateTime(g.granted_at)}</Td>
                      <Td className="whitespace-nowrap text-muted">{g.expires_at ? dateTime(g.expires_at) : '—'}</Td>
                      <Td className="max-w-[18ch] truncate text-muted">{g.note || '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Ledger" description="Every movement, newest first" />
            {ledger.isLoading ? (
              <Skeleton className="m-4 h-32 rounded-lg" />
            ) : !ledger.data?.length ? (
              <p className="p-4 text-sm text-muted">No ledger entries.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <Tr>
                      <Th>When</Th>
                      <Th>Kind</Th>
                      <Th>Amount</Th>
                      <Th>Balance after</Th>
                      <Th>Note</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((e) => (
                      <Tr key={e.id}>
                        <Td className="whitespace-nowrap text-muted">{dateTime(e.created_at)}</Td>
                        <Td className="capitalize">{e.kind.replace(/_/g, ' ')}</Td>
                        <Td className={`tabular-nums ${e.amount < 0 ? 'text-danger' : 'text-success'}`}>
                          {e.amount > 0 ? '+' : ''}
                          {count(e.amount)}
                        </Td>
                        <Td className="tabular-nums">{count(e.balance_after)}</Td>
                        <Td className="max-w-[24ch] truncate text-muted">{e.note || '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function AdjustForm({ userId, rate }: { userId: string; rate: number | undefined }) {
  const adjust = useAdjustWallet()
  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const n = parseInt(amount, 10)
  const valid = Number.isFinite(n) && n > 0 && note.trim().length >= 3

  const submit = () => {
    if (!valid) return
    adjust.mutate(
      { userId, amount: sign * n, note: note.trim() },
      {
        onSuccess: () => {
          toast.success(`Wallet ${sign > 0 ? 'credited' : 'debited'} by ${n} tokens.`)
          setAmount('')
          setNote('')
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  return (
    <Card>
      <CardHeader title="Adjust balance" description="Add or remove tokens. A reason is required and audited." />
      <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="flex gap-2">
          <Button type="button" variant={sign > 0 ? 'primary' : 'secondary'} onClick={() => setSign(1)} aria-pressed={sign > 0}>
            <PlusCircle /> Add
          </Button>
          <Button type="button" variant={sign < 0 ? 'danger' : 'secondary'} onClick={() => setSign(-1)} aria-pressed={sign < 0}>
            <MinusCircle /> Remove
          </Button>
        </div>
        <div className="grid gap-4">
          <Field label="Amount (tokens)">
            {(p) => <Input {...p} type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100" />}
          </Field>
          {tokenValueGbp(Number.isInteger(n) ? n : null, rate) ? <p className="-mt-3 text-xs text-muted">Reference value: {tokenValueGbp(n, rate)}</p> : null}
          <Field label="Reason (required)" hint="Shown in the audit trail and the learner's ledger.">
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why are you adjusting this balance?" />}
          </Field>
          <div>
            <Button disabled={!valid} loading={adjust.isPending} onClick={submit}>
              Apply adjustment
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
