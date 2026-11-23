import { CheckCircle2, ClipboardList, History, Pencil, Plus, Send, Undo2 } from 'lucide-react'
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
import { MemberSelect, useMemberNames, memberName } from '@/features/pms/members'
import { NEXT_STAGE_LABEL, type Proposal, type ProposalIn, PROPOSAL_STAGE, useCreateProposal, useProposalAction, useProposalHistory, useProposals, useUpdateProposal } from '@/features/pms/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { relativeDate } from '@/lib/format'

const STAGE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'hod_review', label: 'Dept review' },
  { value: 'hr_alignment', label: 'HR alignment' },
  { value: 'exec_approval', label: 'Executive' },
  { value: 'active', label: 'Active' },
] as const

function StageBadge({ stage }: { stage: string }) {
  const s = PROPOSAL_STAGE[stage] ?? { label: stage, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

function CreateProposalDialog({ proposal }: { proposal?: Proposal }) {
  const [open, setOpen] = useState(false)
  const create = useCreateProposal()
  const update = useUpdateProposal(proposal?.id ?? '')
  const initial: ProposalIn = proposal ? { name: proposal.name, objective_code: proposal.objective_code, objective_title: proposal.objective_title, dept: proposal.dept, definition: proposal.definition, unit: proposal.unit, baseline: proposal.baseline, target: proposal.target, higher_better: proposal.higher_better, source: proposal.source, cadence: proposal.cadence, period: proposal.period, review_date: proposal.review_date, weight: proposal.weight, owner_id: proposal.owner_id } : { name: '', objective_code: '', objective_title: '', dept: '', definition: '', unit: '', higher_better: true, source: '', cadence: 'monthly', period: '', weight: 10 }
  const [form, setForm] = useState<ProposalIn>(initial)
  const set = (patch: Partial<ProposalIn>) => setForm((f) => ({ ...f, ...patch }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const run = proposal ? update : create
    run.mutate(
      { ...form, baseline: form.baseline === '' ? null : form.baseline, target: form.target === '' ? null : form.target },
      {
        onSuccess: () => {
          toast.success(proposal ? 'Proposal updated' : 'Proposal created as a draft')
          setOpen(false)
          setForm({ name: '', objective_code: '', objective_title: '', dept: '', definition: '', unit: '', higher_better: true, source: '', cadence: 'monthly', period: '', weight: 10 })
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size={proposal ? 'sm' : 'md'} variant={proposal ? 'secondary' : 'primary'} onClick={() => { setForm(initial); setOpen(true) }}>
        {proposal ? <Pencil /> : <Plus />} {proposal ? 'Edit proposal' : 'New proposal'}
      </Button>
      <DialogContent title={proposal ? 'Edit KPI proposal' : 'Propose a KPI'} description="Save your definition, then submit it to begin the approval route." className="max-w-[640px]">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Name
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} minLength={2} maxLength={200} required />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted">
              Department
              <Input value={form.dept} onChange={(e) => set({ dept: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Objective title
              <Input value={form.objective_title} onChange={(e) => set({ objective_title: e.target.value })} />
            </label>
          </div>
          <label className="grid gap-1 text-xs text-muted">
            Definition
            <Textarea value={form.definition} onChange={(e) => set({ definition: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs text-muted">
              Unit
              <Input value={form.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="%, days…" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Baseline
              <Input value={(form.baseline as string) ?? ''} onChange={(e) => set({ baseline: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Target
              <Input value={(form.target as string) ?? ''} onChange={(e) => set({ target: e.target.value })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs text-muted">
              Cadence
              <NativeSelect aria-label="Cadence" value={form.cadence} onChange={(e) => set({ cadence: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="weekly">Weekly</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Direction
              <NativeSelect aria-label="Direction" value={form.higher_better ? 'up' : 'down'} onChange={(e) => set({ higher_better: e.target.value === 'up' })}>
                <option value="up">Higher is better</option>
                <option value="down">Lower is better</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Weight
              <Input type="number" min={1} max={100} value={form.weight} onChange={(e) => set({ weight: Number(e.target.value) })} required />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted">Objective code<Input value={form.objective_code} maxLength={16} onChange={(e) => set({ objective_code: e.target.value })} /></label>
            <label className="grid gap-1 text-xs text-muted">Period<Input value={form.period} maxLength={32} onChange={(e) => set({ period: e.target.value })} placeholder="For example: 2026 Q4" /></label>
            <label className="grid gap-1 text-xs text-muted">Review date<Input type="date" value={form.review_date ?? ''} onChange={(e) => set({ review_date: e.target.value || null })} /></label>
            <label className="grid gap-1 text-xs text-muted">Data source<Input value={form.source} maxLength={200} onChange={(e) => set({ source: e.target.value })} /></label>
          </div>
          <label className="grid gap-1 text-xs text-muted">
            Owner
            <MemberSelect value={form.owner_id ?? ''} onChange={(v) => set({ owner_id: v || null })} />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={proposal ? update.isPending : create.isPending}>
              {proposal ? 'Save changes' : 'Create draft'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ActionButton({ proposal, action }: { proposal: Proposal; action: 'submit' | 'approve' | 'request-changes' }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const run = useProposalAction(proposal.id, action)
  const meta = {
    submit: { label: 'Submit for review', icon: <Send />, variant: 'primary' as const, title: 'Submit this proposal' },
    approve: { label: proposal.stage in NEXT_STAGE_LABEL ? `Approve → ${NEXT_STAGE_LABEL[proposal.stage]}` : 'Approve', icon: <CheckCircle2 />, variant: 'primary' as const, title: 'Approve this stage' },
    'request-changes': { label: 'Request changes', icon: <Undo2 />, variant: 'secondary' as const, title: 'Send back for changes' },
  }[action]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant={meta.variant} onClick={() => setOpen(true)}>
        {meta.icon} {meta.label}
      </Button>
      <DialogContent title={meta.title} description={proposal.name}>
        <label className="grid gap-1 text-xs text-muted">
          Comment {action === 'request-changes' ? '' : '(optional)'}
          <Textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} required={action === 'request-changes'} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant={meta.variant}
            loading={run.isPending}
            disabled={action === 'request-changes' && !comment.trim()}
            onClick={() =>
              run.mutate(comment.trim(), {
                onSuccess: () => {
                  toast.success('Done')
                  setOpen(false)
                  setComment('')
                },
                onError: (err) => toast.error((err as Error).message),
              })
            }
          >
            {meta.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HistoryTimeline({ proposalId }: { proposalId: string }) {
  const { data, isLoading, error, refetch } = useProposalHistory(proposalId)
  if (isLoading) return <Skeleton className="h-24 rounded-lg" />
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (!data?.length) return <p className="text-sm text-muted">No history yet.</p>
  return (
    <ol className="relative ml-2 border-l border-border">
      {data.map((h, i) => (
        <li key={i} className="mb-4 ml-4 last:mb-0">
          <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium capitalize">{h.action.replace(/_/g, ' ')}</span>
            <StageBadge stage={h.stage} />
            <span className="text-xs text-muted">{relativeDate(h.at)}</span>
          </div>
          {h.comment ? <p className="mt-0.5 text-sm text-muted">{h.comment}</p> : null}
        </li>
      ))}
    </ol>
  )
}

function ProposalRow({ proposal, admin, names }: { proposal: Proposal; admin: boolean; names: Map<string, string> }) {
  const [open, setOpen] = useState(false)
  const canSubmit = proposal.stage === 'draft' || proposal.stage === 'changes_requested'
  const canApprove = ['hod_review', 'hr_alignment', 'exec_approval'].includes(proposal.stage)
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold break-words">{proposal.name}</h3>
            <StageBadge stage={proposal.stage} />
            {proposal.ai_draft ? <Badge tone="info">AI drafted</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {proposal.dept || 'Company'} · Owner: {memberName(names, proposal.owner_id)} · v{proposal.version}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              <History /> Details
            </Button>
            <DialogContent title={proposal.name} description={`${proposal.dept || 'Company'} · v${proposal.version}`} className="max-w-[600px]">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Unit</dt>
                  <dd>{proposal.unit || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Cadence</dt>
                  <dd className="capitalize">{proposal.cadence}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Target</dt>
                  <dd className="tabular">{proposal.target ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Baseline</dt>
                  <dd className="tabular">{proposal.baseline ?? '—'}</dd>
                </div>
              </dl>
              {proposal.definition ? <p className="mt-3 text-sm text-muted">{proposal.definition}</p> : null}
              <div className="mt-5">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <History className="size-4" /> Approval history
                </p>
                <HistoryTimeline proposalId={proposal.id} />
              </div>
            </DialogContent>
          </Dialog>
          {admin && canSubmit ? <ActionButton proposal={proposal} action="submit" /> : null}
          {admin && canSubmit ? <CreateProposalDialog proposal={proposal} /> : null}
          {admin && canApprove ? (
            <>
              <ActionButton proposal={proposal} action="approve" />
              <ActionButton proposal={proposal} action="request-changes" />
            </>
          ) : null}
        </div>
      </Card>
    </li>
  )
}

export function ProposalsPage() {
  const admin = useIsOrgAdmin()
  const [stage, setStage] = useState<string>('all')
  const { data, isLoading, error, refetch } = useProposals(stage === 'all' ? undefined : stage)
  const names = useMemberNames()

  return (
    <>
      <PageHeader title="KPI proposals" description="New and changed KPIs move through department, HR and executive approval before they go live." actions={admin ? <CreateProposalDialog /> : null} />
      <Tabs value={stage} onValueChange={setStage}>
        <TabsList>
          {STAGE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={stage}>
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
              <EmptyState icon={<ClipboardList />} title="Nothing here" body={admin ? 'Create a proposal to get started.' : 'No KPI proposals at this stage.'} />
            </Card>
          ) : (
            <ul className="stagger grid gap-3">
              {data.map((p) => (
                <ProposalRow key={p.id} proposal={p} admin={admin} names={names} />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
