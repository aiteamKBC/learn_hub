import { BookMarked, ClipboardCheck, GaugeCircle, Send, Sparkles, Target, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { Link } from '@/lib/router'
import {
  type Campaign,
  KIND_LABEL,
  PRIORITY_TONE,
  useCampaigns,
  useMyCompetence,
  useMaturityVersion,
  useRoles,
  useReadiness,
  useRecommendations,
  useSubmitResponse,
} from '@/features/frameworks/api'

function levelTone(level: number): 'success' | 'warning' | 'neutral' {
  if (level >= 3) return 'success'
  if (level >= 1) return 'warning'
  return 'neutral'
}

function CompetenceCard() {
  const { data, isLoading, error, refetch } = useMyCompetence()
  return (
    <Card>
      <CardHeader title="Your evidenced competence" description="Levels built from the courses and assessments you have completed." action={<TrendingUp className="size-5 text-muted" aria-hidden />} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-2 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<Sparkles />} title="No evidence yet" body="Complete courses and assessments to build your competence record." />
      ) : (
        <ul className="stagger grid gap-2 p-4">
          {data.items.map((it) => (
            <li key={it.competency_id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted tabular">{it.code}</span>
                  <Badge tone={KIND_LABEL[it.kind]?.tone ?? 'neutral'}>{KIND_LABEL[it.kind]?.label ?? it.kind}</Badge>
                </div>
                <p className="mt-0.5 truncate font-medium">{it.name}</p>
              </div>
              <Badge tone={levelTone(it.evidenced_level)}>Level {it.evidenced_level}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ReadinessCard({ versionId }: { versionId: string }) {
  const readiness = useReadiness(versionId)
  const recs = useRecommendations(versionId)

  return (
    <Card>
      <CardHeader title="Readiness for this role" description="How you measure up against the role version you opened." action={<GaugeCircle className="size-5 text-muted" aria-hidden />} />
      {readiness.error ? (
        <ErrorState message={(readiness.error as Error).message} onRetry={() => void readiness.refetch()} />
      ) : readiness.isLoading || !readiness.data ? (
        <div className="p-5">
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : (
        <CardBody className="grid gap-5">
          <div className="flex flex-wrap items-center gap-5">
            <Ring value={Math.round(readiness.data.competence_score)} size={104} stroke={9} label="match" />
            <div className="grid gap-2 text-sm">
              <p>{readiness.data.ready ? <Badge tone="success">Ready for this role</Badge> : <Badge tone="warning">Not ready yet</Badge>}</p>
              <p className="text-muted">
                Qualifications: {readiness.data.qualifications_met ? <span className="text-success">all met</span> : <span className="text-warning">{readiness.data.missing_qualification_ids.length} missing</span>}
              </p>
            </div>
          </div>

          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Target className="size-4" aria-hidden /> Gaps to close
            </h3>
            {readiness.data.gaps.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No gaps. You meet every competency this role needs.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {readiness.data.gaps.map((g) => (
                  <li key={`${g.competency_id}-${g.required_level}-${g.priority}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-xs text-muted tabular">{g.code}</span>
                      <p className="truncate font-medium">{g.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={PRIORITY_TONE[g.priority] ?? 'neutral'}>{g.priority}</Badge>
                      <span className="tabular text-muted">
                        {g.evidenced_level} → {g.required_level}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <BookMarked className="size-4" aria-hidden /> Courses that would help
            </h3>
            {recs.error ? (
              <ErrorState message={(recs.error as Error).message} onRetry={() => void recs.refetch()} />
            ) : recs.isLoading ? (
              <Skeleton className="mt-2 h-16 rounded-lg" />
            ) : !recs.data?.length ? (
              <p className="mt-2 text-sm text-muted">No course suggestions right now.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {recs.data.map((r, i) => (
                  <li key={`${r.course_id}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.course_title}</p>
                      <p className="text-xs text-muted tabular">{r.competency_code} · to level {r.required_level}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="info">Reaches {r.target_level}</Badge><Button size="sm" variant="secondary" asChild><Link to={`/courses?q=${encodeURIComponent(r.course_title)}`}>Find course</Link></Button></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardBody>
      )}
    </Card>
  )
}

function RespondForm({ campaign, onDone }: { campaign: Campaign; onDone: () => void }) {
  const submit = useSubmitResponse()
  const version = useMaturityVersion(campaign.framework_version_id)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const criteria = version.data?.dimensions.flatMap((dimension) => dimension.criteria) ?? []
  if (version.error) return <ErrorState message={(version.error as Error).message} onRetry={() => void version.refetch()} />
  if (version.isLoading) return <Skeleton className="h-40" />
  if (!criteria.length) return <EmptyState icon={<ClipboardCheck />} title="No assessment questions" body="This framework has no assessment criteria. Please contact your company administrator." />
  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (criteria.some((criterion) => answers[criterion.id] == null)) return toast.error('Choose a level for every assessment question')
        submit.mutate(
          { campaignId: campaign.id, body: { answers, reflections: { note } } },
          {
            onSuccess: () => {
              toast.success('Thank you. Your response is in.')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      {version.data?.dimensions.map((dimension) => <fieldset key={dimension.id} className="grid min-w-0 gap-4 rounded-lg border border-border p-4"><legend className="px-1 text-sm font-semibold">{dimension.name}</legend>{dimension.criteria.map((criterion) => <Field key={criterion.id} label={criterion.question || criterion.practice} hint={criterion.evidence || undefined}>{(props) => <NativeSelect {...props} required value={answers[criterion.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [criterion.id]: Number(event.target.value) }))}><option value="" disabled>Choose a level</option>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}{criterion.anchors[level - 1] ? ` — ${criterion.anchors[level - 1]}` : ''}</option>)}</NativeSelect>}</Field>)}</fieldset>)}
      <div className="grid gap-1.5">
        <Label htmlFor="mat-note">What is working, and what would help?</Label>
        <Textarea id="mat-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional." />
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={submit.isPending}>
          <Send /> Submit response
        </Button>
      </div>
    </form>
  )
}

function CampaignsCard() {
  const { data, isLoading, error, refetch } = useCampaigns()
  const [respond, setRespond] = useState<Campaign | null>(null)
  const now = Date.now()
  const open = (data ?? []).filter((c) => !c.closed_at && new Date(c.starts_at).getTime() <= now && new Date(c.ends_at).getTime() >= now)

  return (
    <Card>
      <CardHeader title="Maturity check-ins" description="Open department reviews in your company. Choose the campaign relevant to your work." action={<ClipboardCheck className="size-5 text-muted" aria-hidden />} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : open.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="Nothing open" body="There are no maturity reviews open for you just now." />
      ) : (
        <ul className="grid gap-2 p-4">
          {open.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="font-medium">
                  {c.dept} · Q{c.quarter} {c.quarter_year}
                </p>
                <p className="text-xs text-muted">Open now</p>
              </div>
              <Button size="sm" onClick={() => setRespond(c)}>
                Respond
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!respond} onOpenChange={(o) => !o && setRespond(null)}>
        <DialogContent title="Maturity response" description={respond ? `${respond.dept} · Q${respond.quarter} ${respond.quarter_year}` : undefined}>
          {respond ? <RespondForm campaign={respond} onDone={() => setRespond(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function MyCompetencePage() {
  const [params, setParams] = useSearchParams()
  const versionId = params.get('version') ?? ''
  const roles = useRoles()

  return (
    <>
      <PageHeader title="My competence" description="The competencies you have evidenced, how you match a role, and what would help you grow." />
      <Card className="mb-6"><CardBody>{roles.error ? <ErrorState message={(roles.error as Error).message} onRetry={() => void roles.refetch()} /> : <Field label="Compare with a role" hint="Choose an approved role framework to see your readiness and recommended learning.">{(props) => <NativeSelect {...props} disabled={roles.isLoading} value={roles.data?.some((role) => role.approved_version_id === versionId) ? versionId : ''} onChange={(event) => setParams((current) => { if (event.target.value) current.set('version', event.target.value); else current.delete('version'); return current })}><option value="">{roles.isLoading ? 'Loading roles…' : 'Choose an approved role'}</option>{roles.data?.filter((role) => role.approved_version_id).map((role) => <option key={role.id} value={role.approved_version_id!}>{role.title} · Level {role.level}</option>)}</NativeSelect>}</Field>}</CardBody></Card>
      <div className="animate-reveal grid gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <CompetenceCard />
          <CampaignsCard />
        </div>
        <div className="grid gap-6">
          {versionId ? (
            <ReadinessCard versionId={versionId} />
          ) : (
            <Card className="p-5">
              <EmptyState
                icon={<GaugeCircle />}
                title="Check your readiness for a role"
                body="Choose an approved role above to see how you match it and what would close the gap."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
