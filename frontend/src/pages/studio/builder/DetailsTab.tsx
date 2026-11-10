import { ArrowDown, ArrowUp, ImageOff, Plus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'

import { RichText } from './curriculum/RichText'
import { Switch } from '@/components/ui/switch'
import { useCategories } from '@/features/catalog/api'
import { type CoursePatch, type StudioCourse, useUpdateCourse } from '@/features/studio/api'

import { useUnsavedChanges } from './unsaved'

const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'all', label: 'All levels' },
]

type Form = {
  title: string
  subtitle: string
  description: string
  category_id: string
  level: string
  thumbnail_url: string
  cpd_hours: string
  outcomes: string[]
  requirements: string[]
  in_subscription: boolean
  in_business: boolean
}

function fromCourse(c: StudioCourse): Form {
  return {
    title: c.title,
    subtitle: c.subtitle,
    description: c.description,
    category_id: c.category_id ?? '',
    level: c.level,
    thumbnail_url: c.thumbnail_url,
    cpd_hours: c.cpd_hours == null ? '' : String(c.cpd_hours),
    outcomes: c.outcomes,
    requirements: c.requirements,
    in_subscription: c.in_subscription,
    in_business: c.in_business,
  }
}

const clean = (items: string[]) => items.map((s) => s.trim()).filter(Boolean)

/** An editable bullet list: add, remove and move items with buttons (keyboard friendly). */
function BulletList({ label, hint, items, onChange, placeholder }: { label: string; hint: string; items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const id = useId()
  const move = (i: number, by: number) => {
    const next = [...items]
    const [it] = next.splice(i, 1)
    next.splice(i + by, 0, it!)
    onChange(next)
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-text">{label}</legend>
      <p id={`${id}-hint`} className="-mt-1 text-[13px] text-muted">
        {hint}
      </p>
      <ul className="grid gap-2 stagger">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <Input
              aria-label={`${label}: item ${i + 1}`}
              aria-describedby={`${id}-hint`}
              value={item}
              maxLength={200}
              placeholder={placeholder}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {items.length < 20 ? (
        <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => onChange([...items, ''])}>
          <Plus /> Add item
        </Button>
      ) : null}
    </fieldset>
  )
}

export function DetailsTab({ course }: { course: StudioCourse }) {
  const initial = useMemo(() => fromCourse(course), [course])
  const [form, setForm] = useState<Form>(initial)
  const [baseline, setBaseline] = useState<Form>(initial)
  const [error, setError] = useState<string | null>(null)
  const { data: categories } = useCategories()
  const save = useUpdateCourse(course.id)

  // the course was refetched (e.g. after saving): adopt it as the new starting point
  if (initial !== baseline && JSON.stringify(form) === JSON.stringify(baseline)) {
    setBaseline(initial)
    setForm(initial)
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  useUnsavedChanges(dirty && !save.isPending)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const thumbOk = !form.thumbnail_url || form.thumbnail_url.startsWith('https://')
  const titleOk = form.title.trim().length >= 3
  const cpd = form.cpd_hours === '' ? null : Number(form.cpd_hours)
  const cpdOk = cpd === null || (Number.isFinite(cpd) && cpd >= 0 && cpd <= 500)
  const marketplace = course.ownership === 'instructor'

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!titleOk || !thumbOk || !cpdOk) return
    setError(null)
    const body: CoursePatch = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
      description: form.description,
      category_id: form.category_id || null,
      level: form.level,
      thumbnail_url: form.thumbnail_url.trim(),
      cpd_hours: cpd,
      outcomes: clean(form.outcomes),
      requirements: clean(form.requirements),
      ...(marketplace ? { in_subscription: form.in_subscription, in_business: form.in_business } : {}),
    }
    const submitted = form
    save.mutate(body, {
      onSuccess: () => {
        // what we sent is now saved; the refetched course replaces it on the next render
        setBaseline(submitted)
        toast.success('Details saved')
      },
      onError: (err) => setError((err as Error).message),
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <div className="grid min-w-0 gap-6">
        <Card className="grid gap-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold">About the course</h2>
          <Field label="Title" error={!titleOk ? 'The title needs at least 3 characters.' : undefined}>
            {(p) => <Input {...p} value={form.title} maxLength={160} onChange={(e) => set('title', e.target.value)} required />}
          </Field>
          <Field label="Subtitle" hint="One line that sells the course.">
            {(p) => <Input {...p} value={form.subtitle} maxLength={240} onChange={(e) => set('subtitle', e.target.value)} />}
          </Field>
          {/* the same rich-text box as readings: it writes HTML, the server sanitises it */}
          <div className="grid gap-1.5">
            <Label htmlFor="course-description">Description</Label>
            <RichText id="course-description" label="Description" value={form.description} onChange={(html) => set('description', html)} placeholder="What the course covers and who it is for" minHeight={200} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Category">
              {(p) => (
                <NativeSelect {...p} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">Choose a category</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Level">
              {(p) => (
                <NativeSelect {...p} value={form.level} onChange={(e) => set('level', e.target.value)}>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </Card>

        <Card className="grid gap-6 p-5 sm:p-6">
          <BulletList label="What you'll learn" hint="Short outcomes, one per line. Learners see these on the course page." items={form.outcomes} onChange={(v) => set('outcomes', v)} placeholder="e.g. Write clear, tested code" />
          <BulletList label="Requirements" hint="What learners need before they start." items={form.requirements} onChange={(v) => set('requirements', v)} placeholder="e.g. A laptop with internet access" />
        </Card>
      </div>

      <div className="grid min-w-0 content-start gap-6">
        <Card className="grid gap-4 p-5">
          <h2 className="text-base font-semibold">Course image</h2>
          {form.thumbnail_url && thumbOk ? (
            <CourseThumb src={form.thumbnail_url} title={form.title} className="w-full" />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-muted">
              <ImageOff className="size-6" aria-hidden />
            </div>
          )}
          <Field label="Image link" hint="An https:// link to a 16:9 image." error={!thumbOk ? 'Use an https:// link.' : undefined}>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={form.thumbnail_url} maxLength={500} onChange={(e) => set('thumbnail_url', e.target.value)} />}
          </Field>
        </Card>

        <Card className="grid gap-4 p-5">
          <h2 className="text-base font-semibold">Settings</h2>
          <Field label="CPD hours" hint="Leave empty if the course carries no CPD." error={!cpdOk ? 'Enter a number from 0 to 500.' : undefined}>
            {(p) => <Input {...p} type="number" min={0} max={500} step={0.5} inputMode="decimal" value={form.cpd_hours} onChange={(e) => set('cpd_hours', e.target.value)} />}
          </Field>
          {marketplace ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="in-sub" className="font-normal">
                  Include in personal plans
                </Label>
                <Switch id="in-sub" checked={form.in_subscription} onCheckedChange={(v) => set('in_subscription', v)} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="in-biz" className="font-normal">
                  Include in business plans
                </Label>
                <Switch id="in-biz" checked={form.in_business} onCheckedChange={(v) => set('in_business', v)} />
              </div>
            </>
          ) : null}
        </Card>

        <div className="grid gap-2 lg:sticky lg:top-20">
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={!dirty || !titleOk || !thumbOk || !cpdOk} loading={save.isPending}>
              Save details
            </Button>
            <Button type="button" variant="secondary" disabled={!dirty || save.isPending} onClick={() => (setForm(baseline), setError(null))}>
              Undo
            </Button>
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          </p>
        </div>
      </div>
    </form>
  )
}
