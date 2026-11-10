import { Archive, Briefcase, Building2, ClipboardCheck, Globe2, Hash, MapPin, MoreHorizontal, Network, Pencil, Plus, UserCog, Users, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { complianceTone, useSummary } from '@/features/compliance/api'
import {
  type JobRole,
  type Unit,
  UNIT_KINDS,
  unitLevel,
  useArchiveJobRole,
  useArchiveUnit,
  useCreateJobRole,
  useCreateUnit,
  useIsOrgAdmin,
  useJobRoles,
  usePeopleSearch,
  useRenameJobRole,
  useSetUnitManagers,
  useUnits,
  useUpdateUnit,
} from '@/features/org/api'
import { CheckList, RoleBadge, useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

const KIND_ICON: Record<string, typeof MapPin> = { company: Building2, region: Globe2, site: MapPin, department: Briefcase, team: Users }
const kindLabel = (k: string) => UNIT_KINDS.find((x) => x.value === k)?.label ?? (k === 'company' ? 'Company' : k)
const fail = (e: unknown) => toast.error((e as Error).message)

type UnitAction = { kind: 'add' | 'rename' | 'code' | 'archive'; unit: Unit } | null

// ---------------------------------------------------------------- dialogs
function UnitDialog({ action, onClose, onCreated }: { action: UnitAction; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateUnit()
  const update = useUpdateUnit()
  const archive = useArchiveUnit()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [kind, setKind] = useState('site')
  const [prev, setPrev] = useState<UnitAction>(null)
  // reset the fields each time the dialog opens for a unit (no effect needed)
  if (action !== prev) {
    setPrev(action)
    setName(action?.kind === 'rename' ? action.unit.name : '')
    setCode(action?.kind === 'code' ? action.unit.code : '')
    setKind(action?.unit.kind === 'region' ? 'site' : action?.unit.kind === 'site' ? 'department' : action?.unit.kind === 'department' ? 'team' : action?.unit.kind === 'company' ? 'region' : 'team')
  }
  if (!action) return null
  const u = action.unit
  const done = (msg: string) => () => (toast.success(msg), onClose())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (action.kind === 'add') {
      if (!name.trim()) return
      create.mutate({ parent_id: u.id, kind, name: name.trim(), code: code.trim() }, { onSuccess: (r) => (toast.success(`${r.name} added`), onCreated(r.id), onClose()), onError: fail })
    } else if (action.kind === 'rename') {
      if (!name.trim()) return
      update.mutate({ unitId: u.id, name: name.trim() }, { onSuccess: done('Unit renamed'), onError: fail })
    } else if (action.kind === 'code') {
      update.mutate({ unitId: u.id, code: code.trim() }, { onSuccess: done('Code saved'), onError: fail })
    }
  }

  const titles = { add: `Add a unit under ${u.name}`, rename: `Rename ${u.name}`, code: `Code for ${u.name}`, archive: `Archive ${u.name}?` }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={titles[action.kind]} description={action.kind === 'archive' ? 'It disappears from the tree, filters and reports. Units below it are archived too. Only empty units can be archived.' : undefined}>
        {action.kind === 'archive' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(u.id, { onSuccess: done(`${u.name} archived`), onError: fail })}>
              <Archive /> Archive
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            {action.kind === 'add' ? (
              <Field label="Type">
                {(p) => (
                  <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
                    {UNIT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : null}
            {action.kind !== 'code' ? <Field label="Name">{(p) => <Input {...p} autoFocus required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />}</Field> : null}
            {action.kind !== 'rename' ? (
              <Field label="Code" hint="Optional. A short reference, for example a site number.">
                {(p) => <Input {...p} autoFocus={action.kind === 'code'} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} />}
              </Field>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={create.isPending || update.isPending}>
                {action.kind === 'add' ? 'Add unit' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Pick the unit's managers from the people list (side sheet). */
function ManagersSheet({ unit, open, onOpenChange }: { unit: Unit; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const search = usePeopleSearch(debounced, open)
  const save = useSetUnitManagers()
  const [picked, setPicked] = useState<string[] | null>(null)
  const names = useMemo(() => {
    const m = new Map<string, string>(unit.manager_ids.map((id, i) => [id, unit.managers[i] ?? '']))
    for (const p of search.data?.items ?? []) m.set(p.member_id, p.name || p.email)
    return m
  }, [unit.manager_ids, unit.managers, search.data])
  const selected = picked ?? unit.manager_ids

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(null)
        onOpenChange(o)
      }}
    >
      <DialogContent side="right" title={`Managers of ${unit.name}`} description="Managers see and remind the people in this unit and every unit below it." className="w-[min(600px,100vw)]">
        <div className="grid gap-4 p-4">
          {selected.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Chosen managers">
              {selected.map((id) => (
                <li key={id}>
                  <Badge tone="primary" className="gap-1.5 py-1 pr-1">
                    {names.get(id) ?? 'Someone'}
                    <button type="button" className="rounded-full p-0.5 hover:bg-black/10" aria-label={`Remove ${names.get(id) ?? 'manager'}`} onClick={() => setPicked(selected.filter((x) => x !== id))}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No managers yet.</p>
          )}
          <CheckList
            label="People"
            loading={search.isLoading}
            items={search.data?.items ?? []}
            selected={selected}
            getId={(p) => p.member_id}
            onToggle={(id, on) => setPicked(on ? [...selected, id] : selected.filter((x) => x !== id))}
            search={{ value: q, onChange: setQ, placeholder: 'Search people' }}
            empty="Nobody matches."
            render={(p) => (
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={p.name || p.email} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name || p.email}</span>
                  <span className="block truncate text-xs text-muted">{p.units[0] ?? p.email}</span>
                </span>
                <RoleBadge role={p.role} />
              </span>
            )}
          />
          <p className="text-xs text-muted">Learners you choose become managers.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              loading={save.isPending}
              disabled={picked === null}
              onClick={() =>
                save.mutate(
                  { unitId: unit.id, memberIds: selected },
                  {
                    onSuccess: () => {
                      toast.success('Managers saved')
                      setPicked(null)
                      onOpenChange(false)
                    },
                    onError: fail,
                  },
                )
              }
            >
              Save managers
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- tree + detail
function UnitRow({ u, level, selected, onSelect, onAction, admin }: { u: Unit; level: number; selected: boolean; onSelect: () => void; onAction: (a: UnitAction) => void; admin: boolean }) {
  const Icon = KIND_ICON[u.kind] ?? Network
  return (
    <li className={cn('group flex items-center gap-1 rounded-md pr-1 transition-colors', selected ? 'bg-primary-soft' : 'hover:bg-surface-2/70')}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pr-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        style={{ paddingLeft: 10 + Math.min(level, 6) * 18 }}
      >
        {level > 0 ? <span aria-hidden className="-ml-2 h-px w-2 shrink-0 bg-border-strong" /> : null}
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', selected ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted')}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium', selected && 'text-primary-soft-text')}>{u.name}</span>
          <span className="block truncate text-xs text-muted">
            {kindLabel(u.kind)}
            {u.code ? ` · ${u.code}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted tabular" title="People">
          {u.people}
        </span>
      </button>
      {admin ? (
        // not modal: the menu opens dialogs, and a modal menu would leave the page inert
        <Menu modal={false}>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => onAction({ kind: 'add', unit: u })}>
              <Plus /> Add a unit below
            </MenuItem>
            <MenuItem onSelect={() => onAction({ kind: 'rename', unit: u })}>
              <Pencil /> Rename
            </MenuItem>
            <MenuItem onSelect={() => onAction({ kind: 'code', unit: u })}>
              <Hash /> Change code
            </MenuItem>
            {u.parent_id ? (
              <>
                <MenuSeparator />
                <MenuItem className="text-danger [&_svg]:text-danger" onSelect={() => onAction({ kind: 'archive', unit: u })}>
                  <Archive /> Archive
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      ) : null}
    </li>
  )
}

function Detail({ unit, units, admin, onAction }: { unit: Unit; units: Unit[]; admin: boolean; onAction: (a: UnitAction) => void }) {
  // this unit and the units below it (the dashboard only lists the top-level units)
  const summary = useSummary(unit.id)
  const [managersOpen, setManagersOpen] = useState(false)
  const stats = useMemo(() => {
    if (!summary.data || summary.isPlaceholderData) return null
    let due = 0
    let ok = 0
    let late = 0
    for (const r of summary.data) {
      due += r.total - r.exempt
      ok += r.compliant + r.expiring_soon
      late += r.overdue + r.expired
    }
    return { due, late, pct: due ? (ok / due) * 100 : 0 }
  }, [summary.data, summary.isPlaceholderData])
  const path = useMemo(() => {
    const out: Unit[] = []
    let p = units.find((x) => x.id === unit.parent_id)
    while (p) {
      out.unshift(p)
      const parentId: string | null = p.parent_id
      p = units.find((x) => x.id === parentId)
    }
    return out
  }, [unit, units])
  const children = units.filter((x) => x.parent_id === unit.id)
  const Icon = KIND_ICON[unit.kind] ?? Network

  return (
    <Card key={unit.id} className="animate-reveal">
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            {path.length ? <p className="truncate text-xs text-muted">{path.map((p) => p.name).join(' / ')}</p> : null}
            <h2 className="truncate text-lg font-semibold tracking-tight">{unit.name}</h2>
            <p className="text-[13px] text-muted">
              {kindLabel(unit.kind)}
              {unit.code ? ` · code ${unit.code}` : ''}
            </p>
          </div>
          {admin ? (
            <Button variant="secondary" size="sm" onClick={() => onAction({ kind: 'add', unit })}>
              <Plus /> Add below
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3.5">
            <p className="text-xs text-muted">People</p>
            <p className="mt-1 text-2xl font-semibold tabular">{unit.people}</p>
            <p className="text-[11px] text-subtle">directly in this unit</p>
          </div>
          <div className="rounded-lg border border-border p-3.5">
            <p className="text-xs text-muted">Compliance</p>
            {summary.error ? (
              <p className="mt-1 text-sm text-muted">Couldn't load the figures.</p>
            ) : !stats ? (
              <Skeleton className="mt-1 h-7 w-16" />
            ) : stats.due ? (
              <div className="animate-reveal">
                <p className="mt-1 text-2xl font-semibold tabular">{stats.pct.toFixed(0)}%</p>
                <Progress value={stats.pct} tone={complianceTone(stats.pct)} className="mt-1.5" label={`${unit.name} compliance`} />
                <p className="mt-1 text-[11px] text-subtle">{stats.late ? `${stats.late} overdue or expired` : 'nothing overdue'}, including units below</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">No required training here yet</p>
            )}
          </div>
        </div>

        <section aria-labelledby="mgr-title">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 id="mgr-title" className="text-sm font-semibold">
              Managers
            </h3>
            {admin ? (
              <Button variant="link" size="sm" onClick={() => setManagersOpen(true)}>
                <UserCog /> Assign managers
              </Button>
            ) : null}
          </div>
          {unit.managers.length ? (
            <ul className="stagger grid gap-2">
              {unit.managers.map((m) => (
                <li key={m} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={m} size="sm" /> {m}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nobody manages this unit yet.</p>
          )}
        </section>

        {children.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Units below</h3>
            <div className="flex flex-wrap gap-1.5">
              {children.map((c) => (
                <Badge key={c.id} tone="outline">
                  {c.name}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/business/matrix?unit=${unit.id}`}>
              <ClipboardCheck /> Training matrix
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/business/people?unit=${unit.id}`}>
              <Users /> People
            </Link>
          </Button>
        </div>
      </CardBody>
      {admin ? <ManagersSheet unit={unit} open={managersOpen} onOpenChange={setManagersOpen} /> : null}
    </Card>
  )
}

// ---------------------------------------------------------------- job roles
function JobRoleRow({ r, admin }: { r: JobRole; admin: boolean }) {
  const rename = useRenameJobRole()
  const archive = useArchiveJobRole()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(r.name)
  const [confirm, setConfirm] = useState(false)
  if (editing) {
    return (
      <li className="py-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            rename.mutate({ roleId: r.id, name: name.trim(), code: r.code }, { onSuccess: () => (toast.success('Job role renamed'), setEditing(false)), onError: fail })
          }}
        >
          <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label={`New name for ${r.name}`} className="h-9" />
          <Button type="submit" size="sm" loading={rename.isPending}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => (setEditing(false), setName(r.name))}>
            Cancel
          </Button>
        </form>
      </li>
    )
  }
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
      <span className="text-xs text-muted tabular">
        {r.people} {r.people === 1 ? 'person' : 'people'}
      </span>
      {admin ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label={`Rename ${r.name}`} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Archive ${r.name}`} onClick={() => setConfirm(true)}>
            <Archive />
          </Button>
          <Dialog open={confirm} onOpenChange={setConfirm}>
            <DialogContent title={`Archive ${r.name}?`} description="It disappears from filters and requirement targets. Only roles nobody has can be archived.">
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(r.id, { onSuccess: () => (toast.success(`${r.name} archived`), setConfirm(false)), onError: fail })}>
                  <Archive /> Archive
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </li>
  )
}

function JobRoles({ admin }: { admin: boolean }) {
  const { data, isLoading, error, refetch } = useJobRoles()
  const create = useCreateJobRole()
  const [name, setName] = useState('')
  return (
    <Card>
      <CardHeader title="Job roles" description="Use them to target required training, for example “Care assistant”." />
      <CardBody className="grid gap-3">
        {admin ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              create.mutate(name.trim(), { onSuccess: (r) => (toast.success(`${r.name} added`), setName('')), onError: fail })
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New job role" aria-label="New job role name" maxLength={120} />
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              <Plus /> Add
            </Button>
          </form>
        ) : null}
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState className="py-6" icon={<Briefcase />} title="No job roles yet" body={admin ? 'Add the roles people do in your company.' : 'An admin can add them.'} />
        ) : (
          <ul className="stagger divide-y divide-border">
            {data.map((r) => (
              <JobRoleRow key={r.id} r={r} admin={admin} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function UnitsPage() {
  const admin = useIsOrgAdmin()
  const { data: units, isLoading, error, refetch } = useUnits()
  const [params, setParams] = useSearchParams()
  const [action, setAction] = useState<UnitAction>(null)
  const selectedId = params.get('unit')
  const selected = units?.find((u) => u.id === selectedId) ?? units?.[0] ?? null
  const select = (id: string) => setParams({ unit: id }, { replace: true })

  let body: ReactNode
  if (error) body = <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  else if (isLoading || !units)
    body = (
      <div className="grid gap-2 p-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-11" style={{ marginLeft: (i % 3) * 18 }} />
        ))}
      </div>
    )
  else if (units.length === 0)
    body = admin ? (
      <EmptyState icon={<Network />} title="No units yet" body="Your company's locations and teams will show here." />
    ) : (
      <EmptyState icon={<Network />} title="No units to show" body="You don't manage any locations or teams yet. An admin can make you a manager of one." />
    )
  else
    body = (
      // units whose parent isn't listed (a manager's own branches) start at the left edge
      <ul className="stagger grid gap-0.5 p-2" aria-label="Locations and teams">
        {units.map((u) => (
          <UnitRow key={u.id} u={u} level={unitLevel(u, units)} admin={admin} selected={selected?.id === u.id} onSelect={() => select(u.id)} onAction={setAction} />
        ))}
      </ul>
    )

  return (
    <>
      <PageHeader title="Locations & teams" description={admin ? 'How your company is organised: regions, sites, departments and teams.' : 'The units you manage and the units below them.'} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title={admin ? 'Structure' : 'Your units'} description={units ? `${units.length} ${units.length === 1 ? 'unit' : 'units'}` : undefined} />
          <div className="mt-2">{body}</div>
        </Card>
        <div className="grid min-w-0 content-start gap-6">
          {selected && units ? <Detail unit={selected} units={units} admin={admin} onAction={setAction} /> : isLoading ? <Skeleton className="h-80 rounded-lg" /> : null}
          <JobRoles admin={admin} />
        </div>
      </div>
      <UnitDialog action={action} onClose={() => setAction(null)} onCreated={select} />
    </>
  )
}
