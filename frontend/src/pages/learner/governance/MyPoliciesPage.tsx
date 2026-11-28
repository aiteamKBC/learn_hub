import { BookOpen, Check, CheckCircle2, ClipboardCheck, FileText, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { ADOPTION_STAGES, adoptionTone, type PolicyRecord, type UnderstandingCheck, policySections, policyCheck, useAcknowledgePolicy, useMyPolicies, useMyPolicyContent, useReadPolicy, useSubmitCheck } from '@/features/governance/api'
import { relativeDate } from '@/lib/format'

function CheckForm({ pid, check, scored }: { pid: string; check: UnderstandingCheck; scored: boolean }) {
  const submit = useSubmitCheck(pid)
  const [answer, setAnswer] = useState<number | null>(null)
  const options = check.options ?? []
  if (!check.question || options.length === 0) return <p className="text-sm text-muted">No understanding check for this document.</p>
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{check.question}</p>
      <ul className="grid gap-1.5">
        {options.map((o, i) => (
          <li key={i}>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`check-${pid}`} checked={answer === i} onChange={() => setAnswer(i)} />
              {o}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-3">
        <Button
          size="sm"
          disabled={answer === null}
          loading={submit.isPending}
          onClick={() =>
            answer !== null &&
            submit.mutate(answer, {
              onSuccess: (r) => toast[r.check_score && r.check_score >= 100 ? 'success' : 'message'](r.check_score && r.check_score >= 100 ? 'Correct — well done' : 'Answer recorded'),
              onError: (err) => toast.error((err as Error).message),
            })
          }
        >
          Submit answer
        </Button>
        {scored ? <span className="text-xs text-muted">You have already taken this check.</span> : null}
      </div>
    </div>
  )
}

function PolicyReader({ pid, record }: { pid: string; record: PolicyRecord }) {
  const content = useMyPolicyContent(pid)
  const read = useReadPolicy(pid)
  const ack = useAcknowledgePolicy(pid)
  const version = content.data?.version
  const sections = policySections(version?.sections)
  const check = policyCheck(version?.understanding_check)
  const needsReack = record.needs_reack

  if (content.error) return <ErrorState message={content.error.message} onRetry={() => void content.refetch()} />
  if (content.isLoading || !version) return <Skeleton className="h-48 rounded-lg" />

  return (
    <div className="grid gap-4">
      {needsReack ? <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm">A new version has been published. Please read and acknowledge it again.</p> : null}
      {version.summary ? <p className="text-sm">{version.summary}</p> : null}
      {sections.length ? (
        <div className="grid gap-3">
          {sections.map((s, i) => (
            <section key={i}>
              {s.heading ? <h4 className="font-semibold">{s.heading}</h4> : null}
              {s.body ? <p className="mt-0.5 text-sm text-muted whitespace-pre-wrap">{s.body}</p> : null}
            </section>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm" variant="secondary" loading={read.isPending} disabled={!!record.read_at && !needsReack} onClick={() => read.mutate(undefined, { onSuccess: () => toast.success('Marked as read'), onError: (err) => toast.error((err as Error).message) })}>
          <BookOpen /> {record.read_at && !needsReack ? 'Read' : 'Mark as read'}
        </Button>
        <Button size="sm" loading={ack.isPending} disabled={!!record.ack_at && !needsReack} onClick={() => ack.mutate(undefined, { onSuccess: () => toast.success('Acknowledged'), onError: (err) => toast.error((err as Error).message) })}>
          <Check /> {record.ack_at && !needsReack ? 'Acknowledged' : 'I acknowledge'}
        </Button>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <ClipboardCheck className="size-4" /> Understanding check
        </p>
        <CheckForm key={version.id} pid={pid} check={check} scored={!!record.check_at && !needsReack} />
      </div>
    </div>
  )
}

function PolicyCard({ record }: { record: PolicyRecord }) {
  const [open, setOpen] = useState(false)
  const stage = record.adoption_stage
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {record.policy_title} <Badge tone={adoptionTone(stage)}>{record.adoption_label || ADOPTION_STAGES[stage]}</Badge>{record.needs_reack ? <Badge tone="warning">New version</Badge> : null}
          </span>
        }
        description={`${record.policy_code} · v${record.current_version}`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" onClick={() => setOpen(true)}>
              <FileText /> Open
            </Button>
            <DialogContent title={record.policy_title} description={record.policy_code} className="max-w-[640px]">
              <PolicyReader pid={record.doc_id} record={record} />
            </DialogContent>
          </Dialog>
        }
      />
      <CardBody className="pt-0">
        <ul className="flex flex-wrap gap-4 text-xs text-muted">
          <li className="flex items-center gap-1">{record.read_at ? <CheckCircle2 className="size-3.5 text-success" /> : null} Read {record.read_at ? `· ${relativeDate(record.read_at)}` : '· not yet'}</li>
          <li className="flex items-center gap-1">{record.ack_at ? <CheckCircle2 className="size-3.5 text-success" /> : null} Acknowledged {record.ack_at ? `· ${relativeDate(record.ack_at)}` : '· not yet'}</li>
          <li className="flex items-center gap-1">{record.check_at ? <CheckCircle2 className="size-3.5 text-success" /> : null} Check {record.check_at ? `· ${record.check_score ?? 0}%` : '· not yet'}</li>
        </ul>
      </CardBody>
    </Card>
  )
}

export function MyPoliciesPage() {
  const { data, isLoading, error, refetch } = useMyPolicies()
  return (
    <>
      <PageHeader title="My policies" description="The policies and procedures that apply to you. Please read, acknowledge and complete the understanding check." />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-4" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<ScrollText />} title="Nothing to read" body="No policies have been allocated to you yet." />
        </Card>
      ) : (
        <div className="stagger grid gap-4">
          {data.map((r) => (
            <PolicyCard key={r.doc_id} record={r} />
          ))}
        </div>
      )}
    </>
  )
}
