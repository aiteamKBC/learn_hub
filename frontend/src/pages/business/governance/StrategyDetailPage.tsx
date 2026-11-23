import { ArrowLeft, Check, Plus, Save, Target, X } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type ObjectiveIn, type StrategyVersion, useAddStrategyObjective, useApproveStrategyVersion, useStrategies, useStrategyVersions, useUpdateStrategyVersion, VERSION_STATUS } from '@/features/governance/api'
import { MemberSelect, useMemberNames, memberName } from '@/features/governance/members'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function AddObjectiveDialog({ vid, sid }: { vid: string; sid: string }) {
  const [open, setOpen] = useState(false)
  const add = useAddStrategyObjective(vid, sid)
  const [form, setForm] = useState<ObjectiveIn>({ code: '', title: '', priority: 'medium', period: '', measure: '', description: '' })
  const set = (p: Partial<ObjectiveIn>) => setForm((f) => ({ ...f, ...p }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    add.mutate(form, {
      onSuccess: () => {
        toast.success('Objective added')
        setOpen(false)
        setForm({ code: '', title: '', priority: 'medium', period: '', measure: '', description: '' })
      },
      onError: (err) => toast.error((err as Error).message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Add objective
      </Button>
      <DialogContent title="Add a strategic objective">
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Code
              <Input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="O1" required />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Title
              <Input value={form.title} onChange={(e) => set({ title: e.target.value })} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Priority
              <NativeSelect aria-label="Priority" value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Period
              <Input value={form.period} onChange={(e) => set({ period: e.target.value })} placeholder="2026" />
            </label>
          </div>
          <label className="grid gap-1 text-xs text-muted">
            Owner
            <MemberSelect value={form.owner_id ?? ''} onChange={(v) => set({ owner_id: v || null })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            How it is measured
            <Input value={form.measure} onChange={(e) => set({ measure: e.target.value })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Description
            <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={add.isPending}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VersionEditor({ version, sid, admin }: { version: StrategyVersion; sid: string; admin: boolean }) {
  const update = useUpdateStrategyVersion(version.id, sid)
  const approve = useApproveStrategyVersion(version.id, sid)
  const editable = admin && version.status === 'draft'
  const [vision, setVision] = useState(version.vision)
  const [mission, setMission] = useState(version.mission)
  const [values, setValues] = useState<string[]>(version.values)
  const [newValue, setNewValue] = useState('')
  const [note, setNote] = useState(version.note)
  const [saved, setSaved] = useState({ vision: version.vision, mission: version.mission, values: JSON.stringify(version.values), note: version.note })
  const dirty = vision !== saved.vision || mission !== saved.mission || JSON.stringify(values) !== saved.values || note !== saved.note
  const names = useMemberNames()
  const st = VERSION_STATUS[version.status] ?? { label: version.status, tone: 'neutral' as const }

  function save() {
    update.mutate({ vision, mission, values, note }, { onSuccess: () => { toast.success('Saved'); setSaved({ vision, mission, values: JSON.stringify(values), note }) }, onError: (err) => toast.error((err as Error).message) })
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2">Version {version.number} <Badge tone={st.tone}>{st.label}</Badge></span>}
          description={editable ? 'Edit this draft, then approve it to make it live.' : 'This version is read-only.'}
          action={
            editable ? (
              <Button
                size="sm"
                loading={approve.isPending}
                disabled={dirty || update.isPending}
                onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success('Version approved'), onError: (err) => toast.error((err as Error).message) })}
              >
                <Check /> {dirty ? 'Save changes first' : 'Approve'}
              </Button>
            ) : undefined
          }
        />
        <CardBody className="grid gap-3 pt-0">
          <label className="grid gap-1 text-xs text-muted">
            Vision
            <Textarea value={vision} onChange={(e) => setVision(e.target.value)} disabled={!editable} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Mission
            <Textarea value={mission} onChange={(e) => setMission(e.target.value)} disabled={!editable} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Version note<Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} disabled={!editable} /></label>
          <div className="grid gap-1 text-xs text-muted">
            Values
            <ul className="flex flex-wrap gap-2">
              {values.map((v, i) => (
                <li key={i}>
                  <Badge tone="primary">
                    {v}
                    {editable ? (
                      <button type="button" aria-label={`Remove ${v}`} onClick={() => setValues(values.filter((_, j) => j !== i))} className="ml-1 hover:text-danger">
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
              {values.length === 0 ? <span className="text-sm text-muted">None yet</span> : null}
            </ul>
            {editable ? (
              <div className="mt-1 flex gap-2">
                <Input value={newValue} aria-label="Add a company value" onChange={(e) => setNewValue(e.target.value)} placeholder="Add a value" className="h-9" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), newValue.trim() && (setValues([...values, newValue.trim()]), setNewValue('')))} />
                <Button type="button" variant="secondary" size="sm" onClick={() => newValue.trim() && (setValues([...values, newValue.trim()]), setNewValue(''))}>
                  Add
                </Button>
              </div>
            ) : null}
          </div>
          {editable ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={save} loading={update.isPending}>
                <Save /> Save
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Objectives" description="The strategic objectives for this version." action={editable ? <AddObjectiveDialog vid={version.id} sid={sid} /> : undefined} />
        <CardBody className="pt-0">
          {version.objectives.length === 0 ? (
            <EmptyState icon={<Target />} title="No objectives yet" body={editable ? 'Add the first strategic objective.' : 'None set.'} />
          ) : (
            <ul className="grid gap-2">
              {version.objectives.map((o) => (
                <li key={o.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline">{o.code}</Badge>
                    <span className="font-medium">{o.title}</span>
                    <Badge tone={o.priority === 'high' ? 'warning' : 'neutral'}>{o.priority}</Badge>
                    {o.period ? <span className="text-xs text-muted">{o.period}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Owner: {memberName(names, o.owner_id)}
                    {o.measure ? ` · ${o.measure}` : ''}
                  </p>
                  {o.description ? <p className="mt-1 text-sm">{o.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export function StrategyDetailPage() {
  const { strategyId } = useParams<{ strategyId: string }>()
  const admin = useIsOrgAdmin()
  const strategies = useStrategies()
  const strategy = strategies.data?.find((s) => s.id === strategyId)
  const { data, isLoading, error, refetch } = useStrategyVersions(strategyId)
  const [selected, setSelected] = useState<string | null>(null)
  const versions = data ?? []
  const current = versions.find((v) => v.id === selected) ?? versions[0]

  return (
    <>
      <PageHeader
        back={
          <Link to="/business/governance/strategies" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" /> All strategies
          </Link>
        }
        title={strategy ? strategy.name : 'Strategy'}
        actions={
          versions.length > 1 ? (
            <NativeSelect aria-label="Strategy version" value={current?.id ?? ''} onChange={(e) => setSelected(e.target.value)} className="w-44">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.number} · {VERSION_STATUS[v.status]?.label ?? v.status}
                </option>
              ))}
            </NativeSelect>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : !current ? (
        <Card>
          <EmptyState icon={<Target />} title="No versions" body="This strategy has no versions yet." />
        </Card>
      ) : (
        <VersionEditor key={`${current.id}-${current.status}`} version={current} sid={strategyId!} admin={admin} />
      )}
    </>
  )
}
