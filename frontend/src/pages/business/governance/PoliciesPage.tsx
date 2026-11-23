import { FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DOC_TYPE_LABEL, POLICY_STATUS, type PolicyIn, useCreatePolicy, usePolicies } from '@/features/governance/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'
import { MemberSelect } from '@/features/governance/members'

function CreatePolicyDialog() {
  const [open, setOpen] = useState(false)
  const create = useCreatePolicy()
  const [form, setForm] = useState<PolicyIn>({ code: '', title: '', doc_type: 'policy', category: '', objective_code: '', summary: '' })
  const set = (p: Partial<PolicyIn>) => setForm((f) => ({ ...f, ...p }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    create.mutate(form, {
      onSuccess: () => {
        toast.success('Created as a draft')
        setOpen(false)
        setForm({ code: '', title: '', doc_type: 'policy', category: '', objective_code: '', summary: '' })
      },
      onError: (err) => toast.error((err as Error).message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New document
      </Button>
      <DialogContent title="New policy or SOP" description="This creates a first draft you can write and then approve.">
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Code
              <Input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="POL-01" required />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Title
              <Input value={form.title} onChange={(e) => set({ title: e.target.value })} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Type
              <NativeSelect aria-label="Type" value={form.doc_type} onChange={(e) => set({ doc_type: e.target.value })}>
                <option value="policy">Policy</option>
                <option value="sop">SOP</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Category
              <Input value={form.category} onChange={(e) => set({ category: e.target.value })} />
            </label>
          </div>
          <label className="grid gap-1 text-xs text-muted">
            Summary
            <Textarea value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Strategic objective code<Input value={form.objective_code} maxLength={16} onChange={(e) => set({ objective_code: e.target.value })} /></label>
          <div className="grid gap-1 text-xs text-muted"><span>Owner (optional)</span><MemberSelect value={form.owner_id ?? ''} onChange={(value) => set({ owner_id: value || null })} /></div>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'policy', label: 'Policies' },
  { value: 'sop', label: 'SOPs' },
]

export function PoliciesPage() {
  const admin = useIsOrgAdmin()
  const [tab, setTab] = useState('all')
  const { data, isLoading, error, refetch } = usePolicies(tab === 'all' ? undefined : tab)

  return (
    <>
      <PageHeader title="Policies & SOPs" description="Company policy documents and standard procedures, with who they apply to and how well they are adopted." actions={admin ? <CreatePolicyDialog /> : null} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {error ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : isLoading || !data ? (
            <div className="grid gap-3" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          ) : data.length === 0 ? (
            <Card>
              <EmptyState icon={<FileText />} title="Nothing here yet" body={admin ? 'Create a policy or SOP to get started.' : 'No documents have been published yet.'} action={admin ? <CreatePolicyDialog /> : undefined} />
            </Card>
          ) : (
            <ul className="stagger grid gap-3">
              {data.map((p) => {
                const s = POLICY_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as const }
                return (
                  <li key={p.id}>
                    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="outline">{p.code}</Badge>
                          <h2 className="font-semibold break-words">{p.title}</h2>
                          <Badge tone="neutral">{DOC_TYPE_LABEL[p.doc_type] ?? p.doc_type}</Badge>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted">
                          v{p.current_version}
                          {p.category ? ` · ${p.category}` : ''}
                          {p.summary ? ` · ${p.summary}` : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" asChild>
                        <Link to={`/business/governance/policies/${p.id}`}>Open</Link>
                      </Button>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
