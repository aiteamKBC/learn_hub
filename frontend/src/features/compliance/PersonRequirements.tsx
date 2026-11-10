import { Ban, BellRing, CalendarPlus, ChevronDown, ClipboardCheck, History, ShieldOff, ShieldQuestion, Undo2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsOrgAdmin } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { relativeDate, shortDate } from '@/lib/format'

import {
  type PersonExemption,
  type PersonRecord,
  type PersonStatus,
  statusOf,
  useExempt,
  useExtend,
  usePersonCompliance,
  useRecordCompletion,
  useRemind,
  useRevokeExemption,
  useVoidRecord,
} from './api'

// ---------------------------------------------------------------- dates
const pad = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = () => localDay(new Date())
const tomorrow = () => localDay(new Date(Date.now() + 86_400_000))
/** A day picked in a date input, as the end (or start) of that day in the user's time zone. */
const endOfDay = (day: string) => new Date(`${day}T23:59:00`).toISOString()
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString()

const errorText = (e: unknown) => (e as Error)?.message || 'Something went wrong. Please try again.'
const MIN_REASON = 3

type Panel = { kind: 'extend' | 'exempt' | 'record' } | { kind: 'void'; recordId: string } | { kind: 'revoke'; exemptionId: string } | null

// ---------------------------------------------------------------- small forms
function FormShell({ title, onCancel, onSubmit, pending, submitLabel, tone = 'primary', children }: { title: string; onCancel: () => void; onSubmit: (e: FormEvent) => void; pending: boolean; submitLabel: string; tone?: 'primary' | 'danger'; children?: ReactNode }) {
  return (
    <form onSubmit={onSubmit} noValidate className="animate-reveal grid gap-3 rounded-lg border border-border bg-surface-2/50 p-4" aria-label={title}>
      <p className="text-sm font-semibold">{title}</p>
      {children}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function ExtendForm({ memberId, status, onDone }: { memberId: string; status: PersonStatus; onDone: () => void }) {
  const extend = useExtend(memberId)
  const [day, setDay] = useState('')
  const [error, setError] = useState<string>()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!day) return setError('Choose the new due date.')
    if (day < tomorrow()) return setError('The new due date must be in the future.')
    setError(undefined)
    extend.mutate(
      { statusId: status.status_id, dueAt: endOfDay(day) },
      { onSuccess: () => (toast.success(`Due date moved to ${shortDate(endOfDay(day))}`), onDone()), onError: (err) => toast.error(errorText(err)) },
    )
  }
  return (
    <FormShell title="Extend the due date" onCancel={onDone} onSubmit={submit} pending={extend.isPending} submitLabel="Extend">
      <Field label="New due date" error={error} hint={status.due_at ? `Currently due ${shortDate(status.due_at)}` : undefined}>
        {(p) => <Input type="date" min={tomorrow()} value={day} onChange={(e) => setDay(e.target.value)} {...p} />}
      </Field>
    </FormShell>
  )
}

function ExemptForm({ memberId, status, onDone }: { memberId: string; status: PersonStatus; onDone: () => void }) {
  const exempt = useExempt(memberId)
  const [reason, setReason] = useState('')
  const [ends, setEnds] = useState('')
  const [errors, setErrors] = useState<{ reason?: string; ends?: string }>({})
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = {
      reason: reason.trim().length < MIN_REASON ? 'Give a reason (at least 3 characters).' : undefined,
      ends: ends && ends < tomorrow() ? 'The end date must be in the future.' : undefined,
    }
    setErrors(next)
    if (next.reason || next.ends) return
    exempt.mutate(
      { statusId: status.status_id, reason: reason.trim(), endsAt: ends ? endOfDay(ends) : null },
      { onSuccess: () => (toast.success('Exemption granted'), onDone()), onError: (err) => toast.error(errorText(err)) },
    )
  }
  return (
    <FormShell title="Exempt from this requirement" onCancel={onDone} onSubmit={submit} pending={exempt.isPending} submitLabel="Exempt">
      <Field label="Reason" error={errors.reason} hint="Shown in the history and the audit trail.">
        {(p) => <Textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" {...p} />}
      </Field>
      <Field label="Ends on (optional)" error={errors.ends} hint="Leave empty for no end date.">
        {(p) => <Input type="date" min={tomorrow()} value={ends} onChange={(e) => setEnds(e.target.value)} {...p} />}
      </Field>
    </FormShell>
  )
}

function RecordForm({ memberId, status, onDone }: { memberId: string; status: PersonStatus; onDone: () => void }) {
  const record = useRecordCompletion(memberId)
  const [day, setDay] = useState(today())
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ day?: string; note?: string }>({})
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = {
      day: !day ? 'Choose the completion date.' : day > today() ? 'The completion date cannot be in the future.' : undefined,
      note: note.trim().length < MIN_REASON ? 'Say what evidence you saw (at least 3 characters).' : undefined,
    }
    setErrors(next)
    if (next.day || next.note) return
    record.mutate(
      { statusId: status.status_id, completedAt: startOfDay(day), note: note.trim() },
      { onSuccess: () => (toast.success('Completion recorded'), onDone()), onError: (err) => toast.error(errorText(err)) },
    )
  }
  return (
    <FormShell title="Record a completion" onCancel={onDone} onSubmit={submit} pending={record.isPending} submitLabel="Record">
      <Field label="Completed on" error={errors.day}>
        {(p) => <Input type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} {...p} />}
      </Field>
      <Field label="Note" error={errors.note} hint="For example: external certificate seen, number 12345.">
        {(p) => <Textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" {...p} />}
      </Field>
    </FormShell>
  )
}

function VoidForm({ memberId, record, onDone }: { memberId: string; record: PersonRecord; onDone: () => void }) {
  const voidRecord = useVoidRecord(memberId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < MIN_REASON) return setError('Give a reason (at least 3 characters).')
    setError(undefined)
    voidRecord.mutate({ recordId: record.id, reason: reason.trim() }, { onSuccess: () => (toast.success('Record voided'), onDone()), onError: (err) => toast.error(errorText(err)) })
  }
  return (
    <FormShell title={`Void the completion of ${shortDate(record.completed_at)}`} onCancel={onDone} onSubmit={submit} pending={voidRecord.isPending} submitLabel="Void record" tone="danger">
      <p className="text-[13px] text-muted">The record stays in the history, marked as void. The status is worked out again without it.</p>
      <Field label="Reason" error={error}>
        {(p) => <Textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" {...p} />}
      </Field>
    </FormShell>
  )
}

function RevokeConfirm({ memberId, exemption, onDone }: { memberId: string; exemption: PersonExemption; onDone: () => void }) {
  const revoke = useRevokeExemption(memberId)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    revoke.mutate(exemption.id, { onSuccess: () => (toast.success('Exemption revoked'), onDone()), onError: (err) => toast.error(errorText(err)) })
  }
  return (
    <FormShell title="Revoke this exemption?" onCancel={onDone} onSubmit={submit} pending={revoke.isPending} submitLabel="Revoke" tone="danger">
      <p className="text-[13px] text-muted">The requirement applies to this person again from today.</p>
    </FormShell>
  )
}

// ---------------------------------------------------------------- history
type HistoryEvent = { at: string; key: string; node: ReactNode }

function Timeline({ events }: { events: HistoryEvent[] }) {
  if (!events.length) return <p className="text-[13px] text-muted">No completions or exemptions yet.</p>
  return (
    <ol className="stagger relative grid gap-4 border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.key} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" />
          {e.node}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- one requirement
function RequirementItem({ memberId, status, records, exemptions, open, onToggle }: { memberId: string; status: PersonStatus; records: PersonRecord[]; exemptions: PersonExemption[]; open: boolean; onToggle: () => void }) {
  const admin = useIsOrgAdmin()
  const remind = useRemind()
  const [panel, setPanel] = useState<Panel>(null)
  const s = statusOf(status.status)
  const close = () => setPanel(null)
  const bodyId = `req-${status.status_id}`
  const nothingDue = status.status === 'compliant' || status.status === 'exempt'

  const events: HistoryEvent[] = [
    ...records.map((r) => ({
      at: r.completed_at,
      key: `r${r.id}`,
      node: (
        <div className={cn('text-sm', r.voided && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('font-medium', r.voided && 'line-through')}>{r.source === 'manual' ? 'Completion recorded' : r.source === 'import' ? 'Completion imported' : 'Course completed'}</span>
            {r.voided ? <Badge tone="danger">Void</Badge> : null}
            <span className="text-xs text-muted">{shortDate(r.completed_at)}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {[r.recorded_by ? `by ${r.recorded_by}` : null, r.expires_at ? `valid until ${shortDate(r.expires_at)}` : null].filter(Boolean).join(' · ') || 'Counted automatically'}
          </p>
          {r.note ? <p className="mt-1 text-[13px] break-words">“{r.note}”</p> : null}
          {r.voided && r.void_reason ? <p className="mt-1 text-[13px] break-words text-danger">Voided: {r.void_reason}</p> : null}
          {admin && !r.voided ? (
            <Button variant="link" size="sm" className="mt-1 text-danger" onClick={() => setPanel({ kind: 'void', recordId: r.id })} aria-label={`Void the completion of ${shortDate(r.completed_at)}`}>
              <Ban /> Void
            </Button>
          ) : null}
        </div>
      ),
    })),
    ...exemptions.map((x) => ({
      at: x.starts_at,
      key: `x${x.id}`,
      node: (
        <div className={cn('text-sm', x.revoked_at && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('font-medium', x.revoked_at && 'line-through')}>Exempted</span>
            {x.revoked_at ? <Badge tone="neutral">Revoked {shortDate(x.revoked_at)}</Badge> : null}
            <span className="text-xs text-muted">{shortDate(x.starts_at)}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            by {x.granted_by} · {x.ends_at ? `until ${shortDate(x.ends_at)}` : 'no end date'}
          </p>
          <p className="mt-1 text-[13px] break-words">“{x.reason}”</p>
          {admin && !x.revoked_at ? (
            <Button variant="link" size="sm" className="mt-1 text-danger" onClick={() => setPanel({ kind: 'revoke', exemptionId: x.id })} aria-label={`Revoke the exemption from ${shortDate(x.starts_at)}`}>
              <Undo2 /> Revoke
            </Button>
          ) : null}
        </div>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const voiding = panel?.kind === 'void' ? records.find((r) => r.id === panel.recordId) : undefined
  const revoking = panel?.kind === 'revoke' ? exemptions.find((x) => x.id === panel.exemptionId) : undefined

  return (
    <li className="rounded-lg border border-border bg-surface">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={open ? bodyId : undefined}className="flex w-full items-start gap-3 rounded-lg p-4 text-left transition-colors hover:bg-surface-2/60">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{status.name}</p>
          <p className="mt-0.5 truncate text-[13px] text-muted">{status.course_title}</p>
        </div>
        <Badge tone={s.tone} dot>
          {s.label}
        </Badge>
        <ChevronDown aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id={bodyId} className="animate-reveal grid gap-4 border-t border-border p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {(
              [
                ['Due', status.due_at],
                ['Completed', status.completed_at],
                ['Expires', status.expires_at],
                ['Extended to', status.due_override_at],
              ] as [string, string | null][]
            )
              .filter(([label, v]) => v || label !== 'Extended to')
              .map(([label, v]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 font-medium">
                    {v ? (
                      <>
                        {shortDate(v)} <span className="text-xs font-normal text-muted">({relativeDate(v)})</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </dd>
                </div>
              ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            {admin ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setPanel({ kind: 'extend' })} aria-pressed={panel?.kind === 'extend'}>
                  <CalendarPlus /> Extend
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPanel({ kind: 'record' })} aria-pressed={panel?.kind === 'record'}>
                  <ClipboardCheck /> Record completion
                </Button>
                {status.status !== 'exempt' ? (
                  <Button size="sm" variant="secondary" onClick={() => setPanel({ kind: 'exempt' })} aria-pressed={panel?.kind === 'exempt'}>
                    <ShieldOff /> Exempt
                  </Button>
                ) : null}
              </>
            ) : null}
            {!nothingDue ? (
              <Button
                size="sm"
                variant="soft"
                loading={remind.isPending}
                onClick={() => remind.mutate(status.status_id, { onSuccess: () => toast.success('Reminder sent'), onError: (err) => toast.error(errorText(err)) })}
              >
                <BellRing /> Send reminder
              </Button>
            ) : null}
          </div>

          {panel?.kind === 'extend' ? <ExtendForm memberId={memberId} status={status} onDone={close} /> : null}
          {panel?.kind === 'exempt' ? <ExemptForm memberId={memberId} status={status} onDone={close} /> : null}
          {panel?.kind === 'record' ? <RecordForm memberId={memberId} status={status} onDone={close} /> : null}
          {voiding ? <VoidForm memberId={memberId} record={voiding} onDone={close} /> : null}
          {revoking ? <RevokeConfirm memberId={memberId} exemption={revoking} onDone={close} /> : null}

          <div>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted">
              <History className="size-3.5" aria-hidden /> History
            </p>
            <Timeline events={events} />
          </div>
        </div>
      ) : null}
    </li>
  )
}

/**
 * One person's required training: status, dates, history and the actions an admin (or,
 * for reminders, a manager) may take. Used by the matrix sheet and the person page.
 * With `focusRequirementId`, that requirement is shown (open) first and the rest wait
 * behind a "show all" button.
 */
export function PersonRequirements({ memberId, focusRequirementId }: { memberId: string; focusRequirementId?: string }) {
  const { data, isLoading, error, refetch } = usePersonCompliance(memberId)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(focusRequirementId ? [focusRequirementId] : []))
  const [showAll, setShowAll] = useState(!focusRequirementId)

  if (error) return <ErrorState message={errorText(error)} onRetry={() => void refetch()} />
  if (isLoading || !data)
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading required training">
        {Array.from({ length: focusRequirementId ? 1 : 3 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-lg" />
        ))}
      </div>
    )
  if (!data.requirements.length) return <EmptyState icon={<ShieldQuestion />} title="No required training" body="None of the company's requirements apply to this person yet." />

  const focused = focusRequirementId ? data.requirements.find((r) => r.requirement_id === focusRequirementId) : undefined
  const list = focused && !showAll ? [focused] : focused ? [focused, ...data.requirements.filter((r) => r !== focused)] : data.requirements
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="animate-reveal grid gap-3">
      {focusRequirementId && !focused ? <p className="text-[13px] text-muted">This requirement does not apply to this person.</p> : null}
      <ul className="stagger grid gap-3">
        {list.map((s) => (
          <RequirementItem
            key={s.status_id}
            memberId={memberId}
            status={s}
            records={data.records.filter((r) => r.requirement_id === s.requirement_id)}
            exemptions={data.exemptions.filter((x) => x.requirement_id === s.requirement_id)}
            open={openIds.has(s.requirement_id)}
            onToggle={() => toggle(s.requirement_id)}
          />
        ))}
      </ul>
      {focused && !showAll && data.requirements.length > 1 ? (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll(true)}>
          <ChevronDown /> Show all {data.requirements.length} requirements
        </Button>
      ) : null}
    </div>
  )
}
