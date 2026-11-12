import { Coins, MinusCircle, PlusCircle, Search, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useAdjustWallet, useAdminStudentSearch, useAdminWallet, useAdminWalletLedger } from '@/features/b2c/console'
import { dateTime, SearchBox } from '@/features/console/money-ui'
import { count } from '@/lib/format'

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
  const search = useAdminStudentSearch(q)
  const rows = search.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader title="Find a learner" />
      <div className="p-4">
        <SearchBox value={q} onChange={setQ} label="Search learners" placeholder="Search by name or email…" />
        {!q.trim() ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Search className="size-4" /> Type a name or email to begin.
          </p>
        ) : search.isLoading ? (
          <Skeleton className="mt-4 h-40 rounded-lg" />
        ) : search.error ? (
          <ErrorState message="Search failed." onRetry={() => void search.refetch()} />
        ) : !rows.length ? (
          <EmptyState className="mt-4" icon={<Search />} title="No learners found" body="Try a different name or email." />
        ) : (
          <>
            <Table className="mt-4">
              <thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.name || '—'}</Td>
                    <Td className="text-muted">{r.email}</Td>
                    <Td>
                      <Badge tone={r.status === 'active' ? 'success' : 'neutral'} className="capitalize">
                        {r.status}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => onPick({ id: r.id, name: r.name, email: r.email })}>
                        <Wallet /> View wallet
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {search.hasNextPage ? (
              <Button variant="secondary" className="mt-3" loading={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>
                Load more
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Card>
  )
}

function WalletDetail({ user, onBack }: { user: { id: string; name: string; email: string }; onBack: () => void }) {
  const wallet = useAdminWallet(user.id)
  const ledger = useAdminWalletLedger(user.id)

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
            <StatCard label="Balance" value={<span className="tabular-nums">{count(wallet.data?.balance.balance ?? 0)}</span>} icon={<Coins />} tone="primary" hint="tokens" />
            <StatCard
              label="Expiring within 7 days"
              value={<span className="tabular-nums">{count(wallet.data?.balance.expiring_within_7_days ?? 0)}</span>}
              icon={<Coins />}
              tone={wallet.data?.balance.expiring_within_7_days ? 'warning' : 'info'}
              hint="tokens"
            />
          </div>

          <AdjustForm userId={user.id} />

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

function AdjustForm({ userId }: { userId: string }) {
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
