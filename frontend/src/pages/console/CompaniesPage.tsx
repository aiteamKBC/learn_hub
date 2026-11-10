import { Building2, Plus, Search, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import {
  COMPANY_STATUSES,
  type ConsoleCompany,
  type ConsoleCompanyDetail,
  useAddAdmin,
  useCompanies,
  useCompany,
  useCompanyFeatures,
  useCompanyKpis,
  useCreateCompany,
  useEndGrant,
  useGrantFeature,
  useRemoveAdmin,
  useUpdateCompany,
} from '@/features/console/companies'
import { ConfirmDialog, DetailSheet, InfoRow, StatusPill, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { count, shortDate } from '@/lib/format'

function Kpis() {
  const { data } = useCompanyKpis()
  if (!data) return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-lg" />)}</div>
  return (
    <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Companies" value={data.total} icon={<Building2 />} hint={`${data.active} active`} />
      <StatCard label="On trial" value={data.trial} icon={<ShieldCheck />} tone="info" />
      <StatCard label="Suspended" value={data.suspended} icon={<Building2 />} tone={data.suspended ? 'danger' : 'success'} />
      <StatCard label="Seats in use" value={data.seats_used} icon={<Users />} tone="success" hint="people in company workspaces" />
    </div>
  )
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

function CreateCompany({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const create = useCreateCompany()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [owner, setOwner] = useState('')
  const [seats, setSeats] = useState('')
  const [status, setStatus] = useState('active')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name: name.trim(), slug: slug || slugify(name), owner_email: owner.trim(), seat_limit: seats ? Number(seats) : null, status },
      {
        onSuccess: (r) => (toast.success('Company created'), onOpenChange(false), setName(''), setSlug(''), setOwner(''), setSeats(''), onCreated(r.id)),
        onError: (er) => toast.error(er.message),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a company" description="The owner must already have an account. They are told by notification.">
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="Company name">{(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={200} />}</Field>
          <Field label="Web address name" hint="Lower-case letters, numbers and dashes.">
            {(f) => <Input {...f} value={slug || slugify(name)} onChange={(e) => setSlug(slugify(e.target.value))} required pattern="[a-z0-9-]+" />}
          </Field>
          <Field label="Owner's email">{(f) => <Input {...f} type="email" value={owner} onChange={(e) => setOwner(e.target.value)} required />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Seat limit" hint="Leave empty for no limit.">{(f) => <Input {...f} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
            <Field label="Status">
              {(f) => (
                <NativeSelect {...f} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create company</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DetailsSection({ c }: { c: ConsoleCompanyDetail }) {
  const update = useUpdateCompany(c.id)
  const [name, setName] = useState(c.name)
  const [seats, setSeats] = useState(c.seat_limit ? String(c.seat_limit) : '')
  const [status, setStatus] = useState(c.status)
  const [confirm, setConfirm] = useState(false)
  const nameChanged = name.trim() !== c.name
  const seatsChanged = (seats ? Number(seats) : null) !== c.seat_limit
  const statusChanged = status !== c.status
  const risky = statusChanged && (status === 'suspended' || status === 'cancelled')
  const save = (reason = '') =>
    update.mutate(
      {
        name: nameChanged ? name.trim() : undefined,
        status: statusChanged ? status : undefined,
        seat_limit: seatsChanged && seats ? Number(seats) : undefined,
        clear_seat_limit: seatsChanged && !seats,
        reason,
      },
      { onSuccess: () => (toast.success('Company updated'), setConfirm(false)), onError: (e) => toast.error(e.message) },
    )
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Details</h3>
      <Field label="Company name">{(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Seat limit" hint={`${count(c.members)} in use. Empty means no limit.`}>{(f) => <Input {...f} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
        <Field label="Status">
          {(f) => (
            <NativeSelect {...f} value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(COMPANY_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={!nameChanged && !seatsChanged && !statusChanged} onClick={() => (setName(c.name), setSeats(c.seat_limit ? String(c.seat_limit) : ''), setStatus(c.status))}>
          Discard
        </Button>
        <Button size="sm" loading={update.isPending && !confirm} disabled={!nameChanged && !seatsChanged && !statusChanged} onClick={() => (risky ? setConfirm(true) : save())}>
          Save changes
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={status === 'suspended' ? `Suspend ${c.name}?` : `Cancel ${c.name}?`}
        body="Its people lose access to the business workspace until it is active again. The company's admins are told."
        reason="required"
        confirmLabel={status === 'suspended' ? 'Suspend company' : 'Cancel company'}
        loading={update.isPending}
        onConfirm={(reason) => save(reason)}
      />
    </section>
  )
}

function AddonsSection({ c }: { c: ConsoleCompanyDetail }) {
  const features = useCompanyFeatures()
  const grant = useGrantFeature(c.id)
  const end = useEndGrant(c.id)
  const [feature, setFeature] = useState('')
  const [days, setDays] = useState('')
  const [ending, setEnding] = useState<{ id: string; label: string } | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    grant.mutate(
      { feature, days: days ? Number(days) : null, seats: null, note: '' },
      { onSuccess: () => (toast.success('Add-on switched on'), setFeature(''), setDays('')), onError: (er) => toast.error(er.message) },
    )
  }
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Add-ons and access</h3>
      {c.entitlements.length ? (
        <ul className="stagger grid gap-2">
          {c.entitlements.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="font-medium">{e.label}</span>
              <Badge tone={e.source === 'grant' ? 'info' : 'primary'}>{e.source === 'grant' ? 'Given by staff' : 'Paid'}</Badge>
              <StatusPill status={e.active ? 'active' : 'ended'} label={e.active ? 'On' : 'Off'} />
              <span className="text-xs text-muted">{e.ends_at ? `${e.active ? 'until' : 'ended'} ${shortDate(e.ends_at)}` : 'no end date'}</span>
              {e.active && e.source === 'grant' ? (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEnding({ id: e.id, label: e.label })}>
                  Switch off
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No add-ons yet.</p>
      )}
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end" onSubmit={submit}>
        <Field label="Switch on">
          {(f) => (
            <NativeSelect {...f} value={feature} onChange={(e) => setFeature(e.target.value)} required>
              <option value="">Choose an add-on…</option>
              {(features.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="For (days)">{(f) => <Input {...f} type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} placeholder="Always" />}</Field>
        <Button type="submit" size="sm" loading={grant.isPending} disabled={!feature}>
          <Plus /> Switch on
        </Button>
      </form>
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title={`Switch off ${ending?.label ?? 'this add-on'}?`}
        body="It stops now. The company's admins are told."
        reason="required"
        confirmLabel="Switch off"
        loading={end.isPending}
        onConfirm={(reason) => ending && end.mutate({ entitlement: ending.id, reason }, { onSuccess: () => (toast.success('Add-on switched off'), setEnding(null)), onError: (e) => toast.error(e.message) })}
      />
    </section>
  )
}

function AdminsSection({ c }: { c: ConsoleCompanyDetail }) {
  const add = useAddAdmin(c.id)
  const remove = useRemoveAdmin(c.id)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'owner'>('admin')
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Admins</h3>
      {c.admins.length ? (
        <ul className="stagger grid gap-2">
          {c.admins.map((a) => (
            <li key={a.member_id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
              <Avatar name={a.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted">{a.email}</p>
              </div>
              <Badge tone={a.role === 'owner' ? 'primary' : 'neutral'}>{a.role === 'owner' ? 'Owner' : 'Admin'}</Badge>
              <Button variant="ghost" size="icon" aria-label={`Remove ${a.name} as admin`} onClick={() => setRemoving({ id: a.member_id, name: a.name })}>
                <UserMinus />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No admins.</p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate({ email: email.trim(), role }, { onSuccess: () => (toast.success('Admin added'), setEmail('')), onError: (er) => toast.error(er.message) })
        }}
      >
        <Field label="Person's email">{(f) => <Input {...f} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Role">
          {(f) => (
            <NativeSelect {...f} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'owner')}>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" size="sm" loading={add.isPending}>
          <UserPlus /> Add admin
        </Button>
      </form>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this person'} as admin?`}
        body="They stay in the company as a learner."
        reason="required"
        confirmLabel="Remove admin"
        loading={remove.isPending}
        onConfirm={(reason) => removing && remove.mutate({ member: removing.id, reason }, { onSuccess: () => (toast.success('Admin removed'), setRemoving(null)), onError: (e) => toast.error(e.message) })}
      />
    </section>
  )
}

function CompanyDetail({ id }: { id: string }) {
  const q = useCompany(id)
  if (q.isLoading) return <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (q.error || !q.data) return <ErrorState message={q.error?.message ?? 'Company not found.'} onRetry={() => void q.refetch()} />
  const c = q.data
  const subs = [...c.subscriptions, ...c.addon_subscriptions]
  return (
    <div className="grid animate-reveal gap-6">
      <div>
        <InfoRow label="Status"><StatusPill status={c.status} label={COMPANY_STATUSES[c.status]} /></InfoRow>
        <InfoRow label="People">{count(c.members)}{c.seat_limit ? ` of ${count(c.seat_limit)} seats` : ''}</InfoRow>
        <InfoRow label="Billing currency">{c.billing_currency}</InfoRow>
        <InfoRow label="Joined">{shortDate(c.created_at)}</InfoRow>
      </div>
      <DetailsSection key={`${c.name}-${c.status}-${c.seat_limit}`} c={c} />
      <AddonsSection c={c} />
      <AdminsSection c={c} />
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Subscriptions</h3>
        {subs.length ? (
          <ul className="grid gap-2">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{s.plan}</span>
                <StatusPill status={s.status} />
                <span className="text-xs text-muted">{count(s.seats)} {s.seats === 1 ? 'seat' : 'seats'}</span>
                {s.current_period_end ? <span className="ml-auto text-xs text-muted">{s.cancel_at_period_end ? 'ends' : 'renews'} {shortDate(s.current_period_end)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No subscriptions. Plans are bought from the company's billing page.</p>
        )}
      </section>
    </div>
  )
}

function CompanyCard({ c, onOpen }: { c: ConsoleCompany; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="grid w-full gap-1.5 rounded-lg border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-border-strong">
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
        <StatusPill status={c.status} label={COMPANY_STATUSES[c.status]} />
      </span>
      <span className="text-xs text-muted">
        {count(c.members)}{c.seat_limit ? ` / ${count(c.seat_limit)}` : ''} people · {c.plan ?? 'No plan'}
      </span>
    </button>
  )
}

/** Console > Companies (pattern 05): every company with status, seats and add-ons;
 * the detail sheet edits them and manages admins. */
export function ConsoleCompaniesPage() {
  const [selected, setSelected] = useParam('company')
  const [status, setStatus] = useParam('status')
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const [creating, setCreating] = useState(false)
  const list = useCompanies({ q: debounced.trim(), status })
  const rows = list.data ?? []
  const filtered = !!(debounced.trim() || status)
  const current = rows.find((r) => r.id === selected)
  return (
    <>
      <PageHeader
        title="Companies"
        description="Business customers: status, seats, add-ons and admins."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add company
          </Button>
        }
      />
      <div className="grid gap-6">
        <Kpis />
        <Card className="min-w-0">
          <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" aria-label="Search companies" />
            <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(COMPANY_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          ) : list.isLoading ? (
            <div className="grid gap-3 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !rows.length ? (
            <EmptyState icon={<Building2 />} title={filtered ? 'No companies match' : 'No companies yet'} body={filtered ? 'Try other filters.' : 'Companies appear here when they sign up for a business plan, or when you add one.'} />
          ) : (
            <div className="animate-reveal">
              <ul className="stagger grid gap-2.5 p-3 md:hidden">
                {rows.map((c) => <li key={c.id}><CompanyCard c={c} onOpen={() => setSelected(c.id)} /></li>)}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Company</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Seats</Th>
                      <Th>Plan</Th>
                      <Th className="hidden xl:table-cell">Add-ons</Th>
                      <Th className="text-right">Joined</Th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((c) => (
                      <Tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                        <Td>
                          <button type="button" className="max-w-[16rem] truncate text-left font-medium hover:text-primary" onClick={(e) => (e.stopPropagation(), setSelected(c.id))}>
                            {c.name}
                          </button>
                          <p className="text-xs text-muted">{c.admins} {c.admins === 1 ? 'admin' : 'admins'}</p>
                        </Td>
                        <Td><StatusPill status={c.status} label={COMPANY_STATUSES[c.status]} /></Td>
                        <Td className="text-right tabular">{count(c.members)}{c.seat_limit ? <span className="text-muted"> / {count(c.seat_limit)}</span> : null}</Td>
                        <Td className="max-w-[12rem] truncate">{c.plan ?? <span className="text-muted">None</span>}</Td>
                        <Td className="hidden xl:table-cell">
                          <span className="flex flex-wrap gap-1">{c.addons.length ? c.addons.map((a) => <Badge key={a} tone="info">{a}</Badge>) : <span className="text-muted">None</span>}</span>
                        </Td>
                        <Td className="text-right text-xs text-muted tabular">{shortDate(c.created_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </Card>
      </div>
      <DetailSheet open={!!selected} onOpenChange={(o) => !o && setSelected('')} title={current?.name ?? 'Company'} description={current ? `/${current.slug}` : undefined}>
        {selected ? <CompanyDetail id={selected} /> : null}
      </DetailSheet>
      <CreateCompany open={creating} onOpenChange={setCreating} onCreated={setSelected} />
    </>
  )
}
