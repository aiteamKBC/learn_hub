import { BarChart3, CalendarRange, CheckCircle2, Gauge, Lock, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type Campaign, useCampaignScores, useCampaigns, useCloseCampaign, useCreateCampaign, useMaturityFrameworks, useMaturityVersion } from '@/features/frameworks/api'
import { fullDateTime } from '@/features/frameworks/format'
import { useIsOrgAdmin } from '@/features/org/api'

const QUARTERS = [1, 2, 3, 4]

function toIso(local: string) {
  return local ? new Date(local).toISOString() : ''
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateCampaign()
  const frameworks = useMaturityFrameworks()
  const now = new Date()
  const [form, setForm] = useState({
    framework_version_id: '',
    dept: '',
    quarter_year: String(now.getFullYear()),
    quarter: String(Math.floor(now.getMonth() / 3) + 1),
    starts_at: '',
    ends_at: '',
  })

  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (!form.starts_at || !form.ends_at) return toast.error('Choose a start and end time')
        if (new Date(form.ends_at) <= new Date(form.starts_at)) return toast.error('The closing time must be after the opening time')
        create.mutate(
          {
            framework_version_id: form.framework_version_id,
            dept: form.dept.trim(),
            quarter_year: Number(form.quarter_year),
            quarter: Number(form.quarter),
            starts_at: toIso(form.starts_at),
            ends_at: toIso(form.ends_at),
          },
          {
            onSuccess: () => {
              toast.success('Campaign created')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <Field label="Maturity framework">
        {(p) => (
          <NativeSelect {...p} value={form.framework_version_id} onChange={(e) => setForm((f) => ({ ...f, framework_version_id: e.target.value }))}>
            <option value="" disabled>
              Choose a framework
            </option>
            {frameworks.data?.filter((fw) => fw.published_version_id).map((fw) => (
              <option key={fw.id} value={fw.published_version_id!}>
                {fw.title} ({fw.dept})
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Department">{(p) => <Input {...p} required value={form.dept} onChange={(e) => setForm((f) => ({ ...f, dept: e.target.value }))} placeholder="For example: Engineering" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Year">{(p) => <Input {...p} type="number" required min={2000} max={2100} value={form.quarter_year} onChange={(e) => setForm((f) => ({ ...f, quarter_year: e.target.value }))} />}</Field>
        <Field label="Quarter">
          {(p) => (
            <NativeSelect {...p} value={form.quarter} onChange={(e) => setForm((f) => ({ ...f, quarter: e.target.value }))}>
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens">{(p) => <Input {...p} type="datetime-local" required value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />}</Field>
        <Field label="Closes">{(p) => <Input {...p} type="datetime-local" required value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />}</Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!form.framework_version_id || !form.dept.trim()}>
          <Plus /> Create campaign
        </Button>
      </div>
    </form>
  )
}

function Scores({ campaignId, versionId }: { campaignId: string; versionId: string }) {
  const { data, isLoading, error, refetch } = useCampaignScores(campaignId)
  const version = useMaturityVersion(versionId)
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !data) return <Skeleton className="h-24 rounded-lg" />
  const entries: [string, number][] = [['Responses', data.response_count]]
  if (typeof data.scores.overall === 'number') entries.push(['Overall score', data.scores.overall])
  const dimensionScores = data.scores.by_dimension
  return (
    <div className="grid gap-4">
    <dl className="grid grid-cols-2 gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted capitalize">{k.replace(/_/g, ' ')}</dt>
          <dd className="text-xl font-semibold tabular">{k === 'Responses' ? v : `${v.toFixed(1)} / 5`}</dd>
        </div>
      ))}
    </dl>
    {version.error ? <ErrorState message={(version.error as Error).message} onRetry={() => void version.refetch()} /> : version.isLoading ? <Skeleton className="h-20" /> : (
      <dl className="grid gap-2">
        {version.data?.dimensions.map((dimension) => {
          const score = dimensionScores && typeof dimensionScores === 'object' ? Reflect.get(dimensionScores, dimension.id) : undefined
          return <div key={dimension.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"><dt className="min-w-0 break-words">{dimension.name}<span className="block text-xs text-muted">Target level {dimension.target_level}</span></dt><dd className="font-semibold tabular">{typeof score === 'number' ? `${score.toFixed(1)} / 5` : 'No responses'}</dd></div>
        })}
      </dl>
    )}
    </div>
  )
}

function CampaignCard({ c, admin }: { c: Campaign; admin: boolean }) {
  const close = useCloseCampaign()
  const [showScores, setShowScores] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const closed = !!c.closed_at
  const scheduled = new Date(c.starts_at).getTime() > Date.now()
  const ended = new Date(c.ends_at).getTime() < Date.now()

  return (
    <Card>
      <CardHeader
        title={`${c.dept} · Q${c.quarter} ${c.quarter_year}`}
        description={`${fullDateTime(c.starts_at)} – ${fullDateTime(c.ends_at)}`}
        action={closed ? <Badge tone="neutral">Closed</Badge> : scheduled ? <Badge tone="info">Scheduled</Badge> : ended ? <Badge tone="warning">Ended</Badge> : <Badge tone="success">Open</Badge>}
      />
      <CardBody className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Users className="size-4" aria-hidden /> {c.response_count} {c.response_count === 1 ? 'response' : 'responses'}
          </span>
          <div className="flex flex-wrap gap-2">
            {admin ? (
              <Button size="sm" variant="secondary" onClick={() => setShowScores((s) => !s)}>
                <BarChart3 /> {showScores ? 'Hide scores' : 'Show scores'}
              </Button>
            ) : null}
            {!closed && admin ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmClose(true)}
              >
                <Lock /> Close campaign
              </Button>
            ) : null}
          </div>
        </div>
        {admin && showScores ? <Scores campaignId={c.id} versionId={c.framework_version_id} /> : null}
        <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
          <DialogContent title="Close this campaign?" description="This finalises the results and stops people submitting or updating responses.">
            <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmClose(false)} disabled={close.isPending}>Keep open</Button><Button loading={close.isPending} onClick={() => close.mutate(c.id, { onSuccess: () => { toast.success('Campaign closed'); setConfirmClose(false) }, onError: (error) => toast.error((error as Error).message) })}><Lock /> Close campaign</Button></div>
          </DialogContent>
        </Dialog>
      </CardBody>
    </Card>
  )
}

/** The Department maturity body, used as a tab inside the Frameworks library page.
 * It owns its own heading row and "New campaign" action. */
export function MaturitySection() {
  const admin = useIsOrgAdmin()
  const frameworks = useMaturityFrameworks()
  const campaigns = useCampaigns()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">Run quarterly maturity reviews by department and see how each one scores.</p>
        {admin ? (
          <Button onClick={() => setCreating(true)} disabled={!frameworks.data?.some((fw) => fw.published_version_id)}>
            <Plus /> New campaign
          </Button>
        ) : null}
      </div>
      <div className="grid gap-6">
        <Card>
          <CardHeader title="Maturity frameworks" description="The models your campaigns measure against." action={<Gauge className="size-5 text-muted" aria-hidden />} />
          {frameworks.error ? (
            <ErrorState message={(frameworks.error as Error).message} onRetry={() => void frameworks.refetch()} />
          ) : frameworks.isLoading || !frameworks.data ? (
            <div className="grid gap-2 p-4">
              {Array.from({ length: 2 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : frameworks.data.length === 0 ? (
            <EmptyState icon={<Gauge />} title="No maturity frameworks" body="None are available to your company yet." />
          ) : (
            <ul className="stagger grid gap-2 p-4 sm:grid-cols-2">
              {frameworks.data.map((fw) => (
                <li key={fw.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{fw.title}</p>
                    <p className="text-xs text-muted">{fw.dept}</p>
                  </div>
                  {fw.is_platform ? <Badge tone="info">Platform</Badge> : <Badge tone="primary">Your company</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted">
            <CalendarRange className="size-4" aria-hidden /> Campaigns
          </h2>
          {campaigns.error ? (
            <ErrorState message={(campaigns.error as Error).message} onRetry={() => void campaigns.refetch()} />
          ) : campaigns.isLoading || !campaigns.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <Skeleton key={i} className="h-40 rounded-lg" />
              ))}
            </div>
          ) : campaigns.data.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 />}
                title="No campaigns yet"
                body={admin ? 'Start a campaign to collect a department’s self-assessment.' : 'No maturity campaigns have been run yet.'}
                action={admin && frameworks.data?.some((fw) => fw.published_version_id) ? <Button onClick={() => setCreating(true)}>New campaign</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="animate-reveal grid gap-4 lg:grid-cols-2">
              {campaigns.data.map((c) => (
                <CampaignCard key={c.id} c={c} admin={admin} />
              ))}
            </div>
          )}
        </div>
      </div>

      {admin ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent title="New maturity campaign" description="Collect a department’s self-assessment for a quarter.">
            <CreateForm onDone={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
