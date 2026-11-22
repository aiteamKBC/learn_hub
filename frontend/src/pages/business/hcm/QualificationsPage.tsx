import { Award, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useCreateQualification, useQualifications } from '@/features/hcm/api'
import { useIsOrgAdmin } from '@/features/org/api'

function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateQualification()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate(
          { name: name.trim(), code: code.trim() },
          {
            onSuccess: () => {
              toast.success('Qualification added')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <Field label="Name">
        {(p) => <Input {...p} required minLength={2} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: First Aid at Work" />}
      </Field>
      <Field label="Code" hint="A short reference, if you use one. Optional.">
        {(p) => <Input {...p} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} placeholder="For example: FAW-3" />}
      </Field>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          <Plus /> Add qualification
        </Button>
      </div>
    </form>
  )
}

export function QualificationsPage() {
  const admin = useIsOrgAdmin()
  const { data, isLoading, error, refetch } = useQualifications(true)
  const [open, setOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Qualifications"
        description={admin ? 'The qualifications your company can award to people.' : 'The qualifications your company awards. Only HR admins can change these.'}
        actions={
          admin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New qualification
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
            icon={<Award />}
            title="No qualifications yet"
            body={admin ? 'Add the qualifications your people can hold, then award them from a person’s profile.' : 'Your HR admin has not added any qualifications yet.'}
            action={
              admin ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> New qualification
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="animate-reveal">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {data.map((q) => (
                <Tr key={q.id}>
                  <Td className="font-medium">{q.name}</Td>
                  <Td className="text-muted">{q.code || '–'}</Td>
                  <Td className="text-right">{q.archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="success">Active</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {admin ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title="New qualification" description="Add a qualification your company can award.">
            <CreateForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
