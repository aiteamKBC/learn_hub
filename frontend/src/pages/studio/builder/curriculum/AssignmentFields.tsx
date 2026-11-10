import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Label } from '@/components/ui/input'
import { Checkbox, Switch } from '@/components/ui/switch'
import type { AssignmentPatch, StudioAssignment } from '@/features/studio/api'

import { RichText } from './RichText'

export type AssignmentDraft = {
  instructions: string
  max_score: string
  pass_score: string
  submission_types: string[]
  due_days: string
  allow_late: boolean
  max_resubmissions: string
  rubric: { criterion: string; points: string }[]
}

const TYPES = [
  { value: 'text', label: 'Written answer' },
  { value: 'url', label: 'Link' },
  { value: 'file', label: 'File upload' },
]

export function assignmentDraft(a: StudioAssignment): AssignmentDraft {
  return {
    instructions: a.instructions,
    max_score: String(a.max_score),
    pass_score: String(a.pass_score),
    submission_types: a.submission_types,
    due_days: a.due_days_after_enrolment ? String(a.due_days_after_enrolment) : '',
    allow_late: a.allow_late,
    max_resubmissions: String(a.max_resubmissions),
    rubric: (a.rubric ?? []).map((r) => ({ criterion: String(r.criterion ?? ''), points: String(r.points ?? '') })),
  }
}

const int = (s: string) => (s.trim() === '' ? NaN : Number(s))

export function assignmentErrors(d: AssignmentDraft) {
  const e: Partial<Record<'max_score' | 'pass_score' | 'submission_types' | 'due_days' | 'max_resubmissions' | 'rubric', string>> = {}
  const max = int(d.max_score)
  const pass = int(d.pass_score)
  if (!Number.isInteger(max) || max < 1 || max > 1000) e.max_score = 'Between 1 and 1000.'
  if (!Number.isInteger(pass) || pass < 0 || pass > 1000) e.pass_score = 'Between 0 and 1000.'
  else if (Number.isInteger(max) && pass > max) e.pass_score = 'The pass mark cannot be more than the maximum score.'
  if (!d.submission_types.length) e.submission_types = 'Choose at least one way to hand in work.'
  if (d.due_days && !(Number.isInteger(int(d.due_days)) && int(d.due_days) >= 1 && int(d.due_days) <= 365)) e.due_days = 'Between 1 and 365 days, or empty for no deadline.'
  const resub = int(d.max_resubmissions)
  if (!Number.isInteger(resub) || resub < 0 || resub > 10) e.max_resubmissions = 'Between 0 and 10.'
  if (d.rubric.length > 20) e.rubric = 'Up to 20 criteria.'
  else if (d.rubric.some((r) => !r.criterion.trim() || !(Number.isInteger(int(r.points)) && int(r.points) >= 0))) e.rubric = 'Every criterion needs a name and whole-number points.'
  return e
}

export function assignmentPayload(d: AssignmentDraft): AssignmentPatch {
  return {
    instructions: d.instructions,
    max_score: Number(d.max_score),
    pass_score: Number(d.pass_score),
    submission_types: d.submission_types,
    due_days_after_enrolment: d.due_days ? Number(d.due_days) : null,
    allow_late: d.allow_late,
    max_resubmissions: Number(d.max_resubmissions),
    rubric: d.rubric.map((r) => ({ criterion: r.criterion.trim(), points: Number(r.points) })),
  }
}

export function AssignmentFields({ value: d, onChange, errors, readOnly }: { value: AssignmentDraft; onChange: (d: AssignmentDraft) => void; errors: ReturnType<typeof assignmentErrors>; readOnly?: boolean }) {
  const uid = useId()
  const set = (patch: Partial<AssignmentDraft>) => onChange({ ...d, ...patch })
  const rubricTotal = d.rubric.reduce((n, r) => n + (Number(r.points) || 0), 0)

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-ins`}>Instructions</Label>
        <RichText id={`${uid}-ins`} label="Instructions" value={d.instructions} onChange={(instructions) => set({ instructions })} placeholder="What should learners do, and what does a good answer include?" readOnly={readOnly} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Maximum score" error={errors.max_score}>{(p) => <Input {...p} type="number" min={1} max={1000} value={d.max_score} disabled={readOnly} onChange={(e) => set({ max_score: e.target.value })} />}</Field>
        <Field label="Pass mark" error={errors.pass_score}>{(p) => <Input {...p} type="number" min={0} max={1000} value={d.pass_score} disabled={readOnly} onChange={(e) => set({ pass_score: e.target.value })} />}</Field>
        <Field label="Resubmissions allowed" error={errors.max_resubmissions}>{(p) => <Input {...p} type="number" min={0} max={10} value={d.max_resubmissions} disabled={readOnly} onChange={(e) => set({ max_resubmissions: e.target.value })} />}</Field>
      </div>

      <fieldset className="grid gap-2" aria-describedby={errors.submission_types ? `${uid}-types-err` : undefined}>
        <legend className="mb-1 text-sm font-medium">Learners hand in</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={d.submission_types.includes(t.value)}
                disabled={readOnly}
                onCheckedChange={(on) => set({ submission_types: on ? [...d.submission_types, t.value] : d.submission_types.filter((x) => x !== t.value) })}
              />
              {t.label}
            </label>
          ))}
        </div>
        {errors.submission_types ? <p id={`${uid}-types-err`} className="text-[13px] text-danger">{errors.submission_types}</p> : null}
      </fieldset>

      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label="Due (days after enrolling)" hint="Leave empty for no deadline." error={errors.due_days}>
          {(p) => <Input {...p} type="number" min={1} max={365} value={d.due_days} disabled={readOnly} onChange={(e) => set({ due_days: e.target.value })} />}
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
          <span>Accept late work</span>
          <Switch checked={d.allow_late} disabled={readOnly} onCheckedChange={(allow_late) => set({ allow_late })} aria-label="Accept late work" />
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          Rubric <span className="font-normal text-muted">· optional · {rubricTotal} of {d.max_score || 0} points</span>
        </legend>
        {d.rubric.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
            <Input aria-label={`Criterion ${i + 1}`} placeholder="e.g. Clear structure" value={r.criterion} maxLength={200} disabled={readOnly} onChange={(e) => set({ rubric: d.rubric.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)) })} />
            <Input aria-label={`Points for criterion ${i + 1}`} type="number" min={0} value={r.points} disabled={readOnly} onChange={(e) => set({ rubric: d.rubric.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)) })} />
            {readOnly ? <span /> : <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove criterion ${i + 1}`} onClick={() => set({ rubric: d.rubric.filter((_, j) => j !== i) })}><Trash2 /></Button>}
          </div>
        ))}
        {errors.rubric ? <p className="text-[13px] text-danger">{errors.rubric}</p> : null}
        {rubricTotal && Number(d.max_score) && rubricTotal !== Number(d.max_score) ? <p className="text-[13px] text-muted">Tip: the rubric usually adds up to the maximum score.</p> : null}
        {readOnly ? null : (
          <Button type="button" variant="secondary" size="sm" className="justify-self-start" disabled={d.rubric.length >= 20} onClick={() => set({ rubric: [...d.rubric, { criterion: '', points: '' }] })}>
            <Plus /> Add criterion
          </Button>
        )}
      </fieldset>
    </div>
  )
}
