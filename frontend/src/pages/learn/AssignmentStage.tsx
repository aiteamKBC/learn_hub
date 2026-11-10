import { CalendarClock, CheckCircle2, FileUp, Hourglass, Link2, Paperclip, RotateCcw, Send, Trophy, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { type Lecture, type Submission, uploadSubmissionFile, useSubmitAssignment } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { shortDate } from '@/lib/format'

import { CompleteBar, Html, RichOrText } from './shared'
import { Sheet } from './stages'

type Props = { lecture: Lecture; enrollmentId: string; slug: string }
type Pending = { id: string; file: File; pct: number; assetId?: string; error?: string }

const status: Record<string, { label: string; tone: 'warning' | 'success' | 'danger' | 'info' }> = {
  submitted: { label: 'Waiting for marking', tone: 'warning' },
  graded: { label: 'Marked', tone: 'success' },
  returned: { label: 'Returned to you', tone: 'info' },
}

export function AssignmentStage({ lecture, enrollmentId, slug }: Props) {
  const a = lecture.assignment!
  const latest = a.submissions.at(-1)
  const waiting = latest?.status === 'submitted'
  const passed = a.submissions.some((s) => s.passed)
  const due = a.due_at ? new Date(a.due_at) : null
  const overdue = !!due && due.getTime() < Date.now()
  const closed = overdue && !a.allow_late
  const [editing, setEditing] = useState(!latest)

  return (
    <Sheet lecture={lecture} meta={`${a.max_score} points`}>
      <div className="flex flex-wrap gap-2">
        {due ? (
          <Badge tone={overdue ? 'danger' : 'neutral'}>
            <CalendarClock /> {overdue ? 'Was due' : 'Due'} {shortDate(due.toISOString())}
          </Badge>
        ) : null}
        <Badge tone="neutral">
          <Trophy /> Pass with {a.pass_score} of {a.max_score}
        </Badge>
        {overdue && a.allow_late ? <Badge tone="warning">Late work is accepted</Badge> : null}
      </div>

      {a.instructions ? <Html html={a.instructions} className="mt-6" /> : null}

      {a.rubric.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">How it's marked</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {a.rubric.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 text-sm last:border-0">
                <span className="min-w-0">{r.criterion}</span>
                <span className="shrink-0 font-semibold tabular">{r.points} pts</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {a.submissions.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Your submissions</h2>
          <ol className="stagger grid gap-3">
            {a.submissions
              .slice()
              .reverse()
              .map((s) => (
                <SubmissionCard key={s.id} s={s} max={a.max_score} />
              ))}
          </ol>
        </section>
      ) : null}

      {passed ? null : waiting ? (
        <p className="mt-6 inline-flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <Hourglass className="size-4" /> Your work is with the instructor. You'll get a notification when it's marked.
        </p>
      ) : closed ? (
        <p className="mt-6 text-sm text-muted">The deadline has passed and this assignment no longer takes submissions.</p>
      ) : editing ? (
        <SubmitForm lecture={lecture} enrollmentId={enrollmentId} onDone={() => setEditing(false)} onCancel={latest ? () => setEditing(false) : undefined} />
      ) : (
        <Button className="mt-6" onClick={() => setEditing(true)}>
          <RotateCcw /> Submit again
        </Button>
      )}

      <CompleteBar lecture={lecture} enrollmentId={enrollmentId} slug={slug} manual={false} className="mt-10" />
    </Sheet>
  )
}

function SubmissionCard({ s, max }: { s: Submission; max: number }) {
  const st = status[s.status] ?? { label: s.status, tone: 'info' as const }
  return (
    <li className={cn('rounded-xl border bg-surface p-4 shadow-sm', s.passed ? 'border-success/40' : 'border-border')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Attempt {s.attempt_no} <span className="font-normal text-muted">· {shortDate(s.submitted_at)}</span>
          {s.is_late ? <span className="ml-2 text-xs text-warning">late</span> : null}
        </p>
        <div className="flex items-center gap-2">
          {s.score != null ? (
            <span className={cn('text-sm font-semibold tabular', s.passed ? 'text-success' : 'text-text')}>
              {s.score} / {max}
            </span>
          ) : null}
          <Badge tone={s.passed ? 'success' : st.tone}>{s.passed ? 'Passed' : st.label}</Badge>
        </div>
      </div>
      {s.text ? <p className="mt-3 line-clamp-6 text-sm whitespace-pre-wrap text-muted">{s.text}</p> : null}
      {s.url ? (
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-primary hover:underline">
          <Link2 className="size-4 shrink-0" /> <span className="truncate">{s.url}</span>
        </a>
      ) : null}
      {s.files?.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {s.files.map((f, i) => (
            <li key={i} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs">
              <Paperclip className="size-3.5" /> {f.filename}
            </li>
          ))}
        </ul>
      ) : null}
      {s.feedback ? (
        <div className="mt-3 rounded-lg border-l-3 border-primary bg-primary-soft/50 px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-primary-soft-text">Instructor feedback</p>
          <RichOrText value={s.feedback} className="mt-1 text-sm [&_p]:mb-2 [&_p:last-child]:mb-0" />
        </div>
      ) : null}
    </li>
  )
}

function SubmitForm({ lecture, enrollmentId, onDone, onCancel }: { lecture: Lecture; enrollmentId: string; onDone: () => void; onCancel?: () => void }) {
  const types = lecture.assignment!.submission_types
  const submit = useSubmitAssignment(enrollmentId, lecture.key)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<Pending[]>([])
  const input = useRef<HTMLInputElement>(null)
  const uploading = files.some((f) => !f.assetId && !f.error)
  const urlError = url.trim() && !url.trim().startsWith('https://') ? 'Links must start with https://' : undefined

  const add = (list: FileList | null) => {
    for (const file of Array.from(list ?? []).slice(0, 5 - files.length)) {
      const id = crypto.randomUUID()
      setFiles((prev) => [...prev, { id, file, pct: 0 }])
      const patch = (p: Partial<Pending>) => setFiles((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)))
      uploadSubmissionFile(enrollmentId, lecture.key, file, (pct) => patch({ pct }))
        .then((assetId) => patch({ assetId, pct: 100 }))
        .catch((e: Error) => patch({ error: e.message }))
    }
    if (input.current) input.current.value = ''
  }

  const send = () =>
    submit.mutate(
      { text: types.includes('text') ? text : '', url: types.includes('url') ? url.trim() : '', asset_ids: files.flatMap((f) => (f.assetId ? [f.assetId] : [])) },
      {
        onSuccess: () => {
          toast.success('Submitted. Your instructor will mark it.')
          onDone()
        },
        onError: (e) => toast.error(e.message),
      },
    )

  const empty = !text.trim() && !url.trim() && !files.some((f) => f.assetId)
  return (
    <section className="mt-8 animate-reveal rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold">Hand in your work</h2>
      <div className="mt-4 grid gap-4">
        {types.includes('text') ? (
          <Field label="Your answer">
            {(f) => <Textarea {...f} className="min-h-40" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your answer here" />}
          </Field>
        ) : null}
        {types.includes('url') ? (
          <Field label="Link to your work" error={urlError}>
            {(f) => <Input {...f} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}
          </Field>
        ) : null}
        {types.includes('file') ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Files</p>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={files.length >= 5}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => (e.preventDefault(), add(e.dataTransfer.files))}
              className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border px-4 py-6 text-center text-sm text-muted transition-colors hover:border-primary/50 hover:bg-primary-soft/30 disabled:opacity-50"
            >
              <FileUp className="size-6 text-primary" />
              <span>
                <span className="font-medium text-text">Choose files</span> or drop them here
              </span>
              <span className="text-xs">PDF, Word, Excel, PowerPoint, images or ZIP · up to 5 files</span>
            </button>
            <input ref={input} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
            {files.length ? (
              <ul className="mt-3 grid gap-2">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <Paperclip className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{f.file.name}</span>
                      {f.error ? (
                        <span className="block text-xs text-danger">{f.error}</span>
                      ) : f.assetId ? null : (
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full bg-primary transition-[width]" style={{ width: `${f.pct}%` }} />
                        </span>
                      )}
                    </span>
                    {f.assetId ? <CheckCircle2 className="size-4 text-success" /> : null}
                    <button type="button" aria-label={`Remove ${f.file.name}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}>
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button onClick={send} loading={submit.isPending} disabled={empty || uploading || !!urlError}>
          <Send /> Submit
        </Button>
      </div>
    </section>
  )
}
