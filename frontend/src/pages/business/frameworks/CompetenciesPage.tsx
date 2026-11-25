import { Copy, Layers, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Competency, KIND_LABEL, KIND_OPTIONS, useCloneCompetency, useCompetencies, useCreateCompetency, useUpdateCompetency } from '@/features/frameworks/api'
import { useWorkspace } from '@/features/identity/workspace'
import { useIsOrgAdmin } from '@/features/org/api'

function KindBadge({ kind }: { kind: string }) {
  const k = KIND_LABEL[kind]
  return <Badge tone={k?.tone ?? 'neutral'}>{k?.label ?? kind}</Badge>
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateCompetency()
  const [form, setForm] = useState({ code: '', name: '', description: '', kind: 'S' })
  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate(
          { code: form.code.trim(), name: form.name.trim(), description: form.description.trim(), kind: form.kind, sort_order: 0 },
          {
            onSuccess: () => {
              toast.success('Competency added')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field label="Code">{(p) => <Input {...p} required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="DATA-1" />}</Field>
        <Field label="Name">{(p) => <Input {...p} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Data analysis" />}</Field>
      </div>
      <Field label="Kind">
        {(p) => (
          <NativeSelect {...p} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Description" hint="What this competency means. Optional.">
        {(p) => <Textarea {...p} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}
      </Field>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!form.code.trim() || !form.name.trim()}>
          <Plus /> Add competency
        </Button>
      </div>
    </form>
  )
}

function EditForm({ competency, onDone }: { competency: Competency; onDone: () => void }) {
  const update = useUpdateCompetency()
  const [name, setName] = useState(competency.name)
  const [description, setDescription] = useState(competency.description)
  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(
          { id: competency.id, body: { name: name.trim(), description: description.trim() } },
          {
            onSuccess: () => {
              toast.success('Competency updated')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <Field label="Name">{(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Description">{(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={update.isPending} disabled={!name.trim()}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

function CompetencyTable({ items, admin, canEditPlatform, onEdit, onClone, cloning }: { items: Competency[]; admin: boolean; canEditPlatform: boolean; onEdit: (c: Competency) => void; onClone: (c: Competency) => void; cloning: string | null }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Kind</Th>
          {admin ? (
            <Th className="text-right">
              <span className="sr-only">Actions</span>
            </Th>
          ) : null}
        </tr>
      </thead>
      <tbody className="stagger">
        {items.map((c) => (
          <Tr key={c.id}>
            <Td className="font-medium tabular">{c.code}</Td>
            <Td>
              <p className="font-medium">{c.name}</p>
              {c.description ? <p className="max-w-md truncate text-xs text-muted">{c.description}</p> : null}
            </Td>
            <Td>
              <KindBadge kind={c.kind} />
            </Td>
            {admin ? (
              <Td className="text-right">
                {c.is_platform && !canEditPlatform ? (
                  <Button size="sm" variant="secondary" loading={cloning === c.id} onClick={() => onClone(c)}>
                    <Copy /> Clone
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(c)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </Td>
            ) : null}
          </Tr>
        ))}
      </tbody>
    </Table>
  )
}

/** The Competencies (KSB catalogue) body, used as a tab inside the Frameworks library
 * page. It owns its own heading row and "New competency" action. */
export function CompetenciesSection() {
  const admin = useIsOrgAdmin()
  const { isPlatformAdminView } = useWorkspace()
  const [kind, setKind] = useState('')
  const { data, isLoading, error, refetch } = useCompetencies(kind)
  const clone = useCloneCompetency()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Competency | null>(null)

  const platform = data?.filter((c) => c.is_platform) ?? []
  const org = data?.filter((c) => !c.is_platform) ?? []

  const doClone = (c: Competency) =>
    clone.mutate(c.id, { onSuccess: () => toast.success(`${c.name} cloned to your company`), onError: (err) => toast.error((err as Error).message) })

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          {isPlatformAdminView ? 'The master skills library for the whole platform. New competencies you add here are shared with every company.' : 'The knowledge, skills, behaviours and professional standards your roles are built from.'}
        </p>
        {admin ? (
          <Button onClick={() => setCreating(true)}>
            <Plus /> New competency
          </Button>
        ) : null}
      </div>
      <div className="grid gap-5">
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted" htmlFor="kind-filter">
            Kind
          </label>
          <NativeSelect id="kind-filter" value={kind} onChange={(e) => setKind(e.target.value)} className="w-48">
            <option value="">All kinds</option>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <Card>
            <div className="grid gap-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          </Card>
        ) : data.length === 0 ? (
          <Card>
            <EmptyState icon={<Layers />} title="No competencies" body="No competencies match this filter." />
          </Card>
        ) : (
          <Tabs defaultValue="org" className="animate-reveal">
            <TabsList>
              <TabsTrigger value="org">Your company ({org.length})</TabsTrigger>
              <TabsTrigger value="platform">Platform library ({platform.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="org">
              <Card>
                {org.length === 0 ? (
                  <EmptyState
                    icon={<Layers />}
                    title="None yet"
                    body={admin ? 'Create your own competencies, or clone one from the platform library.' : 'Your company has no competencies of its own yet.'}
                    action={admin ? <Button onClick={() => setCreating(true)}>New competency</Button> : undefined}
                  />
                ) : (
                  <CompetencyTable items={org} admin={admin} canEditPlatform={isPlatformAdminView} onEdit={setEditing} onClone={doClone} cloning={clone.isPending ? clone.variables ?? null : null} />
                )}
              </Card>
            </TabsContent>
            <TabsContent value="platform">
              <Card>
                {platform.length === 0 ? (
                  <EmptyState
                    icon={<Layers />}
                    title="None"
                    body={isPlatformAdminView ? 'The platform library is empty. Add the first shared competency.' : 'No platform competencies match this filter.'}
                    action={isPlatformAdminView ? <Button onClick={() => setCreating(true)}>New competency</Button> : undefined}
                  />
                ) : (
                  <CompetencyTable items={platform} admin={admin} canEditPlatform={isPlatformAdminView} onEdit={setEditing} onClone={doClone} cloning={clone.isPending ? clone.variables ?? null : null} />
                )}
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {admin ? (
        <>
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent title="New competency" description={isPlatformAdminView ? 'Add a competency to the shared platform library — every company will see it.' : 'Add a competency owned by your company.'}>
              <CreateForm onDone={() => setCreating(false)} />
            </DialogContent>
          </Dialog>
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogContent title="Edit competency" description={editing?.code}>
              {editing ? <EditForm key={editing.id} competency={editing} onDone={() => setEditing(null)} /> : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  )
}
