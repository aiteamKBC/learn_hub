import { ChevronRight, Plus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { TRACK_LABEL } from '@/features/hcm/api'
import { useCreateRole, useRoles } from '@/features/frameworks/api'
import { useIsOrgAdmin, useJobRoles, useUnits } from '@/features/org/api'
import { Link, useNavigate } from '@/lib/router'

const TRACKS = ['ic', 'management', 'specialist', 'support']

function CreateForm({ onDone }: { onDone: (id: string) => void }) {
  const create = useCreateRole()
  const jobRoles = useJobRoles()
  const units = useUnits()
  const [form, setForm] = useState({ job_role_id: '', unit_id: '', title: '', level: '1', step: '1', track: '' })

  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate(
          { job_role_id: form.job_role_id, unit_id: form.unit_id || null, title: form.title.trim(), level: Number(form.level), step: Number(form.step), track: form.track },
          { onSuccess: (r) => onDone(r.id), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <Field label="Job role" hint="Which job role this framework describes.">
        {(p) => (
          <NativeSelect {...p} value={form.job_role_id} onChange={(e) => setForm((f) => ({ ...f, job_role_id: e.target.value }))}>
            <option value="" disabled>
              Choose a job role
            </option>
            {jobRoles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Title">{(p) => <Input {...p} required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="For example: Senior Analyst" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level">{(p) => <Input {...p} type="number" required min={1} max={4} step={1} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} />}</Field>
        <Field label="Step" hint="The step within the level.">{(p) => <Input {...p} type="number" required min={1} max={20} step={1} value={form.step} onChange={(e) => setForm((f) => ({ ...f, step: e.target.value }))} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Track">
          {(p) => (
            <NativeSelect {...p} value={form.track} onChange={(e) => setForm((f) => ({ ...f, track: e.target.value }))}>
              <option value="">Not set</option>
              {TRACKS.map((t) => (
                <option key={t} value={t}>
                  {TRACK_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Unit" hint="Optional. Limit this role to one unit.">
          {(p) => (
            <NativeSelect {...p} value={form.unit_id} onChange={(e) => setForm((f) => ({ ...f, unit_id: e.target.value }))}>
              <option value="">Whole company</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!form.job_role_id || !form.title.trim()}>
          <Plus /> Create role
        </Button>
      </div>
    </form>
  )
}

export function RolesPage() {
  const admin = useIsOrgAdmin()
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useRoles()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="Role frameworks"
        description="What good looks like for each role: the competencies, qualifications and CPD it needs."
        actions={
          admin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New role
            </Button>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <Card>
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Workflow />}
            title="No role frameworks yet"
            body={admin ? 'Create your first role framework, then build its first version.' : 'No role frameworks have been created yet.'}
            action={admin ? <Button onClick={() => setCreating(true)}>New role</Button> : undefined}
          />
        </Card>
      ) : (
        <Card className="animate-reveal">
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Level</Th>
                <Th className="hidden sm:table-cell">Track</Th>
                <Th>Approved</Th>
                <Th>Latest draft</Th>
                <Th className="text-right">
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {data.map((r) => (
                <Tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/business/frameworks/roles/${r.id}`)}>
                  <Td>
                    <Link to={`/business/frameworks/roles/${r.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {r.title}
                    </Link>
                    {r.archived ? <Badge tone="neutral" className="ml-2">Archived</Badge> : null}
                  </Td>
                  <Td className="tabular text-muted">
                    L{r.level}.{r.step}
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{(TRACK_LABEL[r.track] ?? r.track) || '–'}</Td>
                  <Td>{r.approved_version_number ? <Badge tone="success">v{r.approved_version_number}</Badge> : <Badge tone="neutral">None</Badge>}</Td>
                  <Td className="tabular text-muted">{r.latest_version_number ? `v${r.latest_version_number}` : '–'}</Td>
                  <Td className="text-right">
                    <ChevronRight className="ml-auto size-4 text-subtle" aria-hidden />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {admin ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent title="New role framework" description="Describe a role, then build and approve its versions.">
            <CreateForm onDone={(id) => navigate(`/business/frameworks/roles/${id}`)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
