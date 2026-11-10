import { Award, BookOpen, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, Clock, ExternalLink, FileText, History, Inbox, ListChecks, MessageSquareText, Pencil, PlayCircle, Search, ShieldCheck, Star, User, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader, Rating } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type CourseDecision, type QueueItem, type QueueTab, type ReviewVersion, useApprovalQueue, useCourseDecision, useReviewPlayback, useReviewVersion, useTemplateDecision } from '@/features/console/approvals'
import { CertificatePreview } from '@/features/console/certificate-preview'
import { templatePreviewPath, useCertTemplates } from '@/features/console/certificates'
import { ConfirmDialog, gbp, StatusPill, useParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { API_BASE_URL } from '@/lib/env'
import { cn } from '@/lib/cn'
import { duration, relativeDate, shortDate } from '@/lib/format'

const QUEUE_TABS = ['all', 'new', 'changes', 'templates'] as const
const QUEUE_LABEL: Record<QueueTab, string> = { all: 'All', new: 'New courses', changes: 'Course changes', templates: 'Certificate templates' }
const LABEL_TONE: Record<string, 'primary' | 'warning' | 'info' | 'danger'> = { 'New course': 'primary', 'Course change': 'info', 'Course change (major)': 'warning', 'Certificate template': 'info' }

// ---------------------------------------------------------------- queue (left)
function Queue({ tab, setTab, selected, onPick }: { tab: QueueTab; setTab: (t: QueueTab) => void; selected: string; onPick: (i: QueueItem) => void }) {
  const [q, setQ] = useState('')
  const term = useDebounced(q, 250)
  const { data, error, refetch, isLoading } = useApprovalQueue(tab, term)
  const counts = data?.counts
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader title={<span className="flex items-center gap-2"><Inbox className="size-4 text-primary" aria-hidden /> Approval queue {counts ? <span className="text-muted tabular">({counts.all})</span> : null}</span>} />
      <div className="flex flex-wrap gap-1.5 px-5 pt-3" role="group" aria-label="Filter the queue">
        {QUEUE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn('rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none', tab === t ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-muted hover:text-text')}
          >
            {QUEUE_LABEL[t]} <span className="tabular opacity-80">({counts ? counts[t] : '…'})</span>
          </button>
        ))}
      </div>
      {counts && counts.major ? <p className="px-5 pt-2 text-[12px] text-warning">{counts.major} of the course changes are marked as major.</p> : null}
      <div className="px-5 pt-3 pb-3">
        <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in queue" aria-label="Search in the approval queue" />
      </div>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-2 px-5 pb-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={term ? 'Nothing matches' : 'All caught up'} body={term ? 'Try another search.' : 'Nothing is waiting for a decision.'} />
      ) : (
        <ul className="stagger grid gap-1 overflow-y-auto px-3 pb-3 lg:max-h-[calc(100vh-22rem)]" aria-label="Waiting for a decision">
          {data.items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-current={selected === i.id ? 'true' : undefined}
                className={cn('flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none', selected === i.id ? 'border-primary/50 bg-primary-soft/50' : 'border-transparent hover:bg-surface-2')}
              >
                {i.kind === 'template' ? (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-info-soft text-info"><Award className="size-5" aria-hidden /></span>
                ) : (
                  <CourseThumb src={i.thumbnail_url} title={i.title} category={i.category} className="h-12 w-16 shrink-0 rounded-md" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.title}</span>
                  <Badge tone={LABEL_TONE[i.label] ?? 'neutral'} className="mt-1">{i.label}</Badge>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
                    <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden /> {i.by_name ?? 'Unknown'}</span>
                    {i.submitted_at ? <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /> {relativeDate(i.submitted_at)}</span> : null}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- course review (middle + right)
function Player({ v }: { v: ReviewVersion }) {
  const [play, setPlay] = useState(false)
  const pb = useReviewPlayback(v.preview_lecture_id, play)
  if (!v.preview_lecture_id) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-2 text-sm text-muted">
        <span className="flex items-center gap-2"><PlayCircle className="size-5" aria-hidden /> This version has no video lesson.</span>
      </div>
    )
  }
  if (!play) {
    return (
      <button type="button" onClick={() => setPlay(true)} className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1e1b4b] to-[#312e81] text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
        <span className="absolute top-3 left-3 rounded bg-white/15 px-2 py-0.5 text-[11px]">Course intro</span>
        <span className="flex size-14 items-center justify-center rounded-full bg-white/20 transition-transform duration-200 group-hover:scale-105"><PlayCircle className="size-8" aria-hidden /></span>
        <span className="sr-only">Play the preview video</span>
      </button>
    )
  }
  if (pb.isLoading) return <Skeleton className="aspect-video" />
  if (pb.error || !pb.data?.url) {
    return <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-2 p-4 text-center text-sm text-muted">{pb.error ? (pb.error as Error).message : 'This is a demo video without a real recording.'}</div>
  }
  return <iframe src={pb.data.url} title={`Preview of ${v.course.title}`} className="aspect-video w-full rounded-lg border-0" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen" />
}

const KIND_LABEL: Record<string, string> = { video: 'Video', article: 'Reading', quiz: 'Quiz', assignment: 'Assignment', live_session: 'Live session', external_link: 'Link', download: 'Download' }

function CourseReview({ id }: { id: string }) {
  const { data: v, error, refetch, isLoading } = useReviewVersion(id)
  const [tab, setTab] = useState('preview')
  useEffect(() => setTab('preview'), [id])
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !v) return <div className="grid gap-4 lg:col-span-2"><Skeleton className="h-36" /><Skeleton className="h-96" /></div>
  const c = v.course
  const inc = v.includes
  return (
    <>
      <div className="grid min-w-0 gap-4 animate-reveal">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <CourseThumb src={c.thumbnail_url} title={c.title} category={c.category} className="aspect-video w-full shrink-0 rounded-lg sm:w-44" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight break-words">{c.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <Badge tone={v.first_release ? 'primary' : v.is_major_change ? 'warning' : 'info'}>{v.first_release ? 'New course' : v.is_major_change ? 'Course change (major)' : 'Course change'}</Badge>
                <span>Version {v.number}</span>
                {v.submitted_at ? <span>Submitted {relativeDate(v.submitted_at)}</span> : null}
                <StatusPill status={v.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                <span className="inline-flex items-center gap-1.5"><User className="size-3.5 text-muted" aria-hidden /> By {v.instructors.map((i) => i.name).join(', ') || 'Unknown'}</span>
                {c.category ? <span>{c.category}</span> : null}
                {c.level ? <span>{c.level}</span> : null}
                <span className="font-medium tabular">{c.is_free ? 'Free' : c.price_gbp_minor !== null && c.price_gbp_minor !== undefined ? gbp(c.price_gbp_minor) : 'No price'}</span>
              </div>
              {v.change_summary ? <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[13px]"><span className="font-medium">What changed: </span>{v.change_summary}</p> : null}
            </div>
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Review sections">
              <TabsTrigger value="preview"><PlayCircle /> Course preview</TabsTrigger>
              <TabsTrigger value="content"><ListChecks /> Content &amp; checklist</TabsTrigger>
              <TabsTrigger value="instructor"><User /> Instructor details</TabsTrigger>
              <TabsTrigger value="history"><History /> Approval history</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-[1fr_200px]">
                <Player v={v} />
                {inc ? (
                  <div className="rounded-lg border border-border p-3 text-[13px]">
                    <p className="mb-2 font-semibold">Course includes</p>
                    <ul className="grid gap-1.5 text-muted">
                      <li>{inc.lessons} lessons</li>
                      <li>{inc.quizzes} quizzes</li>
                      <li>{inc.assignments} assignments</li>
                      <li>{duration(inc.duration_sec)} of content</li>
                      <li>{inc.certificate ? 'Certificate of completion' : 'No certificate'}</li>
                    </ul>
                  </div>
                ) : null}
              </div>
              <section>
                <h3 className="font-semibold">About this course</h3>
                {c.description ? <div className="prose-sm mt-1.5 max-w-none text-sm text-muted [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: c.description }} /> : <p className="mt-1.5 text-sm text-muted">No description yet.</p>}
              </section>
              {c.outcomes.length ? (
                <section>
                  <h3 className="font-semibold">What you'll learn</h3>
                  <ul className="mt-2 grid gap-1.5 text-sm">
                    {c.outcomes.map((o) => <li key={o} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{o}</li>)}
                  </ul>
                </section>
              ) : null}
            </TabsContent>
            <TabsContent value="content" className="grid gap-4">
              {v.checklist.length ? (
                <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  <p className="font-medium">The builder checklist found problems:</p>
                  <ul className="mt-1 list-disc pl-5">{v.checklist.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              ) : <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-[13px] text-success"><CheckCircle2 className="size-4" aria-hidden /> Every lesson passes the builder checklist.</p>}
              <ol className="grid gap-3">
                {v.sections.map((s, si) => (
                  <li key={s.id} className="rounded-lg border border-border">
                    <p className="border-b border-border px-3 py-2 text-sm font-medium">Section {si + 1}: {s.title}</p>
                    <ul className="divide-y divide-border">
                      {s.lectures.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                          <span className="min-w-0 truncate">{l.title}</span>
                          <span className="flex shrink-0 items-center gap-2 text-muted">
                            {l.is_preview ? <Badge tone="info">Preview</Badge> : null}
                            {KIND_LABEL[l.kind] ?? l.kind}
                            {l.duration_sec ? ` · ${duration(l.duration_sec)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </TabsContent>
            <TabsContent value="instructor" className="grid gap-4">
              {v.instructors.map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={i.name} src={i.avatar_url || undefined} />
                    <div className="min-w-0">
                      <p className="font-medium">{i.name}</p>
                      <p className="truncate text-[13px] text-muted">{i.email}</p>
                      {i.headline ? <p className="mt-1 text-[13px]">{i.headline}</p> : null}
                    </div>
                    {i.status ? <span className="ml-auto"><StatusPill status={i.status} /></span> : null}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                    <div><dt className="text-muted">Courses</dt><dd className="font-semibold tabular">{i.course_count}</dd></div>
                    <div><dt className="text-muted">Published</dt><dd className="font-semibold tabular">{i.published_count}</dd></div>
                    <div><dt className="text-muted">Students</dt><dd className="font-semibold tabular">{i.student_count.toLocaleString('en-GB')}</dd></div>
                    <div><dt className="text-muted">Rejected before</dt><dd className="font-semibold tabular">{i.rejected_versions}</dd></div>
                  </dl>
                  {i.approved_at ? <p className="mt-2 text-[12px] text-muted">Teaching since {shortDate(i.approved_at)}</p> : null}
                  {i.bio ? <p className="mt-2 line-clamp-4 text-[13px] text-muted">{i.bio}</p> : null}
                </div>
              ))}
              {v.other_courses.length ? (
                <div>
                  <p className="mb-2 text-sm font-medium">Other courses</p>
                  <ul className="grid gap-1.5">
                    {v.other_courses.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
                        <span className="min-w-0 truncate">{o.title}</span>
                        <span className="flex shrink-0 items-center gap-3 text-muted"><Rating value={o.rating_avg} /> <StatusPill status={o.status} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="history">
              <ol className="relative grid gap-4 border-l border-border pl-5">
                {v.history.map((h) => (
                  <li key={h.version_id} className="relative">
                    <span aria-hidden className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-surface" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">Version {h.number}</span>
                      <StatusPill status={h.status} />
                      {h.is_major_change ? <Badge tone="warning">Major change</Badge> : null}
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted">
                      {h.submitted_at ? `Submitted ${shortDate(h.submitted_at)}${h.submitted_by ? ` by ${h.submitted_by}` : ''}` : 'Not submitted'}
                      {h.reviewed_at ? ` · Decided ${shortDate(h.reviewed_at)}${h.reviewed_by ? ` by ${h.reviewed_by}` : ''}` : ''}
                    </p>
                    {h.change_summary ? <p className="mt-1 text-[13px]">{h.change_summary}</p> : null}
                    {h.review_notes ? <p className="mt-1.5 rounded-md bg-surface-2 px-3 py-2 text-[13px]"><span className="font-medium">Reviewer notes: </span>{h.review_notes}</p> : null}
                  </li>
                ))}
              </ol>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
      <Decision v={v} />
    </>
  )
}

function Decision({ v }: { v: ReviewVersion }) {
  const [notes, setNotes] = useState('')
  const [reject, setReject] = useState(false)
  const [noteError, setNoteError] = useState('')
  const decide = useCourseDecision()
  useEffect(() => (setNotes(''), setNoteError('')), [v.version_id])
  const open = v.status === 'in_review'
  const run = (decision: CourseDecision, text: string) =>
    decide.mutate(
      { versionId: v.version_id, decision, text },
      {
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Approved: the course is live' : decision === 'reject' ? 'Course rejected. The instructor has been told.' : 'Changes requested. The instructor has been told.')
          setNotes('')
          setReject(false)
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )
  return (
    <div className="grid content-start gap-4 animate-reveal">
      <Card className="p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-primary" aria-hidden /> Review decision</h3>
        {!open ? <p className="mt-2 text-[13px] text-muted">This version has been decided already ({v.status.replace('_', ' ')}).</p> : null}
        <div className="mt-3 grid gap-2">
          <Button className="bg-success text-white hover:bg-success/90" disabled={!open} loading={decide.isPending && decide.variables?.decision === 'approve'} onClick={() => run('approve', notes.trim())}>
            <CheckCircle2 /> Approve course
          </Button>
          <Button variant="soft" disabled={!open} loading={decide.isPending && decide.variables?.decision === 'request-changes'} onClick={() => (notes.trim() ? run('request-changes', notes.trim()) : setNoteError('Write what the instructor should change.'))}>
            <Pencil /> Request changes
          </Button>
          <Button variant="secondary" className="border-danger/40 text-danger hover:bg-danger-soft" disabled={!open} onClick={() => setReject(true)}>
            <X /> Reject course
          </Button>
        </div>
      </Card>
      <Card className="p-4 sm:p-5">
        <label htmlFor="review-notes" className="flex items-center gap-2 font-semibold"><MessageSquareText className="size-4 text-primary" aria-hidden /> Review notes <span className="font-normal text-muted">(needed to request changes)</span></label>
        <Textarea id="review-notes" className="mt-3" rows={5} maxLength={1000} value={notes} disabled={!open} onChange={(e) => (setNotes(e.target.value), setNoteError(''))} placeholder="Add your feedback or notes for the instructor…" aria-invalid={noteError ? true : undefined} aria-describedby="review-notes-hint" />
        <p id="review-notes-hint" className={cn('mt-1 flex justify-between text-xs', noteError ? 'text-danger' : 'text-muted')}>
          <span>{noteError}</span>
          <span className="tabular">{notes.length} / 1,000</span>
        </p>
      </Card>
      <Card className="p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-primary" aria-hidden /> Quick checks</h3>
        <ul className="mt-3 grid gap-2 text-[13px]">
          {v.quick_checks.map((q) => (
            <li key={q.label} className="flex items-start gap-2">
              {q.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
              <span>{q.label}<span className="sr-only">{q.ok ? ': yes' : ': not yet'}</span></span>
            </li>
          ))}
          <li className="flex items-start gap-2 rounded-md bg-info-soft px-2 py-1.5 text-info"><FileText className="mt-0.5 size-4 shrink-0" aria-hidden /> Watch the preview and read the content before deciding.</li>
        </ul>
      </Card>
      <ConfirmDialog
        open={reject}
        onOpenChange={setReject}
        title={`Reject "${v.course.title}"?`}
        body="The submission is closed and never goes live. The instructor sees your reason and can start a new version later."
        confirmLabel="Reject course"
        reason="required"
        reasonLabel="Reason for the instructor"
        loading={decide.isPending}
        onConfirm={(reason) => run('reject', reason)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- template review
function TemplateReview({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useCertTemplates()
  const decide = useTemplateDecision()
  const [reject, setReject] = useState(false)
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !data) return <Skeleton className="h-96 lg:col-span-2" />
  const t = data.find((x) => x.id === id)
  if (!t) return <Card className="lg:col-span-2"><EmptyState icon={<Award />} title="Template not found" body="It may have been decided already." /></Card>
  const pending = t.status === 'pending'
  return (
    <>
      <Card className="min-w-0 p-4 animate-reveal sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{t.name}</h2>
          <Badge tone="info">Certificate template</Badge>
          <StatusPill status={t.status} />
        </div>
        <p className="mb-3 text-[13px] text-muted">Made by {t.created_by} · updated {relativeDate(t.updated_at)}</p>
        <CertificatePreview data={t} />
        <Button asChild variant="secondary" className="mt-4 w-full">
          <a href={`${API_BASE_URL}${templatePreviewPath(t.id)}`} target="_blank" rel="noreferrer"><ExternalLink /> View full size (PDF)</a>
        </Button>
      </Card>
      <div className="grid content-start gap-4 animate-reveal">
        <Card className="p-4 sm:p-5">
          <h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-primary" aria-hidden /> Review decision</h3>
          {!pending ? <p className="mt-2 text-[13px] text-muted">This template has been decided already.</p> : null}
          <div className="mt-3 grid gap-2">
            <Button className="bg-success text-white hover:bg-success/90" disabled={!pending} loading={decide.isPending && decide.variables?.approve} onClick={() => decide.mutate({ templateId: t.id, approve: true }, { onSuccess: () => toast.success('Template approved'), onError: (e) => toast.error((e as Error).message) })}>
              <CheckCircle2 /> Approve template
            </Button>
            <Button variant="secondary" className="border-danger/40 text-danger hover:bg-danger-soft" disabled={!pending} onClick={() => setReject(true)}>
              <X /> Reject template
            </Button>
          </div>
        </Card>
        <Card className="p-4 text-[13px] sm:p-5">
          <h3 className="mb-2 font-semibold">Details</h3>
          <p>Style: <span className="font-medium capitalize">{t.layout.style}</span></p>
          <p>Signatory: <span className="font-medium">{t.signatory_name || 'None'}</span>{t.signatory_title ? `, ${t.signatory_title}` : ''}</p>
          <p>QR code: <span className="font-medium">{t.show_qr_code ? 'Shown' : 'Hidden'}</span></p>
        </Card>
      </div>
      <ConfirmDialog
        open={reject}
        onOpenChange={setReject}
        title={`Reject "${t.name}"?`}
        body="The instructor sees your reason and can edit the template and send it again."
        confirmLabel="Reject template"
        reason="required"
        reasonLabel="Reason for the instructor"
        loading={decide.isPending}
        onConfirm={(reason) => decide.mutate({ templateId: t.id, approve: false, reason }, { onSuccess: () => (toast.success('Template rejected'), setReject(false)), onError: (e) => toast.error((e as Error).message) })}
      />
    </>
  )
}

// ---------------------------------------------------------------- page
export function ConsoleApprovalsPage() {
  const [tab, setTab] = useTabParam(QUEUE_TABS, 'all')
  const [item, setItem] = useParam('item')
  const [kind, setKind] = useParam('kind')
  const detail = useRef<HTMLDivElement>(null)
  const pick = (i: QueueItem) => {
    setItem(i.id)
    setKind(i.kind === 'template' ? 'template' : '')
    // on a phone the review sits under the queue: bring it into view
    if (window.matchMedia('(max-width: 1023px)').matches) setTimeout(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const isTemplate = kind === 'template' || (tab === 'templates' && !!item && kind !== 'course')
  return (
    <>
      <PageHeader title="Course approval & moderation" description="Review new courses, major changes and certificate templates." actions={<Badge tone="primary" className="gap-1.5"><Star className="size-3.5" aria-hidden /> Decisions tell the instructor straight away</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr] xl:grid-cols-[minmax(280px,340px)_1fr_300px]">
        <Queue tab={tab} setTab={setTab} selected={item} onPick={pick} />
        <div ref={detail} className="min-w-0 scroll-mt-20 xl:col-span-2">
          {!item ? (
            <Card>
              <EmptyState icon={<BookOpen />} title="Choose something to review" body="Pick a course or certificate template from the queue." />
            </Card>
          ) : (
            <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_300px]">{isTemplate ? <TemplateReview id={item} /> : <CourseReview id={item} />}</div>
          )}
        </div>
      </div>
    </>
  )
}
