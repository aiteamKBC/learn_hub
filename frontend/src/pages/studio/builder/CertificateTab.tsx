import { Check, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { CertificatePreview } from '@/features/console/certificate-preview'
import { type CertLayout, DEFAULT_LAYOUT } from '@/features/console/certificates'
import {
  type StudioCertTemplate,
  type StudioCertTemplateInput,
  type StudioCourse,
  useSaveStudioCertTemplate,
  useSetCourseCertTemplate,
  useStudioCertTemplates,
} from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { useUnsavedChanges } from './unsaved'

const DEFAULT = 'default'
const STATUS: Record<string, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  active: { tone: 'success', label: 'Approved' },
  pending: { tone: 'warning', label: 'Waiting for approval' },
  rejected: { tone: 'danger', label: 'Not approved' },
}

const layoutOf = (t: StudioCertTemplate | undefined): CertLayout => (t ? (t.layout as CertLayout) : DEFAULT_LAYOUT)
const previewOf = (t: StudioCertTemplate | undefined) => ({
  layout: layoutOf(t),
  signatory_name: t?.signatory_name ?? '',
  signatory_title: t?.signatory_title ?? '',
  show_qr_code: t?.show_qr_code ?? true,
})

/** Course builder > Certificate (mockup 23): which template learners' certificates use. */
export function CertificateTab({ course }: { course: StudioCourse }) {
  const templates = useStudioCertTemplates()
  const save = useSetCourseCertTemplate(course.id)
  const current = course.certificate_template_id ?? DEFAULT
  const [picked, setPicked] = useState(current)
  const [editing, setEditing] = useState<StudioCertTemplate | 'new' | null>(null)
  const dirty = picked !== current
  useUnsavedChanges(dirty && !save.isPending)

  if (templates.isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true" aria-label="Loading certificate templates">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
        <Skeleton className="aspect-[297/210] rounded-xl" />
      </div>
    )
  }
  if (templates.error) return <ErrorState onRetry={() => void templates.refetch()} />

  const rows = templates.data
  const platformDefault = rows.find((t) => t.is_default && t.is_platform)
  // The platform default first, then everything usable; the instructor's own drafts are listed but can't be picked.
  const options = [{ id: DEFAULT, template: platformDefault, usable: true }, ...rows.filter((t) => t !== platformDefault).map((t) => ({ id: t.id, template: t, usable: t.status === 'active' }))]
  const usable = options.filter((o) => o.usable)
  const checkedIndex = usable.findIndex((o) => o.id === picked)
  const shown = options.find((o) => o.id === picked)?.template ?? platformDefault

  const onSave = () =>
    save.mutate(picked === DEFAULT ? null : picked, {
      onSuccess: () => toast.success('Certificate template saved'),
      onError: (e) => toast.error((e as Error).message),
    })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" id="cert-label">
              Certificate template
            </h2>
            <p className="mt-1 text-sm text-muted">Learners get this certificate when they finish the course.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus /> Design your own
          </Button>
        </div>
        <div role="radiogroup" aria-labelledby="cert-label" className="mt-5 grid gap-3 sm:grid-cols-2 stagger">
          {options.map((o) => {
            const on = picked === o.id
            const i = usable.indexOf(o)
            const t = o.template
            const status = t && !t.is_platform ? STATUS[t.status] : undefined
            return (
              <div key={o.id} className={cn('relative rounded-xl border transition-[border-color,background-color,box-shadow] duration-200', on ? 'border-primary bg-primary-soft/60 shadow-sm' : 'border-border bg-surface hover:border-border-strong', !o.usable && 'opacity-90')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={!o.usable}
                  disabled={!o.usable}
                  tabIndex={o.usable ? radioTabIndex(i, checkedIndex) : -1}
                  onClick={() => setPicked(o.id)}
                  onKeyDown={(e) => radioKeyDown(e, i, usable.length, (j) => setPicked(usable[j]!.id))}
                  className="grid w-full gap-3 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-not-allowed"
                >
                  <CertificatePreview data={previewOf(t)} className="pointer-events-none" />
                  <span className="flex min-w-0 items-center gap-2 pr-9">
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3.5', on ? 'border-primary bg-primary text-on-primary' : 'border-border-strong')}>{on ? <Check /> : null}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{o.id === DEFAULT ? 'Platform default' : t!.name}</span>
                      <span className="block truncate text-xs text-muted">{o.id === DEFAULT ? (platformDefault?.name ?? 'Standard certificate') : t!.is_platform ? 'Platform template' : 'Your design'}</span>
                    </span>
                  </span>
                  {status ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {t!.status === 'rejected' && t!.decision_reason ? <span className="text-xs text-muted">{t!.decision_reason}</span> : null}
                    </span>
                  ) : null}
                </button>
                {t && !t.is_platform ? (
                  <Button size="icon-sm" variant="ghost" className="absolute right-2 bottom-2" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid min-w-0 content-start gap-3">
        <Card className="p-4">
          <p className="mb-3 text-[13px] text-muted">Preview</p>
          <CertificatePreview data={previewOf(shown)} />
        </Card>
        <Button onClick={onSave} disabled={!dirty} loading={save.isPending}>
          Save certificate
        </Button>
        <p className="text-xs text-muted" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'Your own designs can be used once our team approves them.'}
        </p>
      </div>

      <TemplateDialog template={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  )
}

function TemplateDialog({ template, open, onOpenChange }: { template: StudioCertTemplate | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveStudioCertTemplate()
  const blank: StudioCertTemplateInput = { name: '', layout: DEFAULT_LAYOUT, signatory_name: '', signatory_title: '', show_qr_code: true }
  const [f, setF] = useState<StudioCertTemplateInput>(blank)
  useEffect(() => {
    if (!open) return
    setF(template ? { name: template.name, layout: template.layout, signatory_name: template.signatory_name, signatory_title: template.signatory_title, show_qr_code: template.show_qr_code } : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template])
  const layout = f.layout as CertLayout
  const L = <K extends keyof CertLayout>(k: K, v: CertLayout[K]) => setF((x) => ({ ...x, layout: { ...(x.layout as CertLayout), [k]: v } }))
  const toggles: [keyof CertLayout, string][] = [['show_platform', 'Platform name'], ['show_seal', 'Seal'], ['show_cpd', 'CPD hours'], ['show_instructor', 'Instructor name']]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={template ? `Edit "${template.name}"` : 'Design a certificate'} description="Our team checks every design before learners see it." className="max-w-4xl">
        <form
          className="grid gap-5 lg:grid-cols-[1fr_1.1fr]"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ ...f, id: template?.id }, { onSuccess: () => (toast.success('Sent for approval'), onOpenChange(false)), onError: (err) => toast.error((err as Error).message) })
          }}
        >
          <div className="grid content-start gap-3">
            <Field label="Template name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={3} maxLength={120} required />}</Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Style">
                {(p) => (
                  <NativeSelect {...p} value={layout.style} onChange={(e) => L('style', e.target.value)}>
                    <option value="classic">Classic</option>
                    <option value="modern">Modern</option>
                    <option value="minimal">Minimal</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Main colour">{(p) => <Input {...p} type="color" value={layout.primary} onChange={(e) => L('primary', e.target.value.toUpperCase())} className="h-10 p-1" />}</Field>
              <Field label="Accent colour">{(p) => <Input {...p} type="color" value={layout.accent} onChange={(e) => L('accent', e.target.value.toUpperCase())} className="h-10 p-1" />}</Field>
            </div>
            <Field label="Heading">{(p) => <Input {...p} value={layout.heading} maxLength={60} onChange={(e) => L('heading', e.target.value)} required />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Line before the name">{(p) => <Input {...p} value={layout.intro} maxLength={80} onChange={(e) => L('intro', e.target.value)} required />}</Field>
              <Field label="Line before the course">{(p) => <Input {...p} value={layout.completion} maxLength={80} onChange={(e) => L('completion', e.target.value)} required />}</Field>
            </div>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1 text-sm font-medium">Show</legend>
              {toggles.map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  {label}
                  <Switch checked={Boolean(layout[k])} onCheckedChange={(v) => L(k, v as never)} aria-label={`Show ${label.toLowerCase()}`} />
                </label>
              ))}
              <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                QR code
                <Switch checked={f.show_qr_code} onCheckedChange={(v) => setF({ ...f, show_qr_code: v })} aria-label="Show the QR code" />
              </label>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Signed by">{(p) => <Input {...p} value={f.signatory_name} maxLength={120} onChange={(e) => setF({ ...f, signatory_name: e.target.value })} />}</Field>
              <Field label="Their title">{(p) => <Input {...p} value={f.signatory_title} maxLength={120} onChange={(e) => setF({ ...f, signatory_title: e.target.value })} placeholder="Course instructor" />}</Field>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <CertificatePreview data={{ ...f, layout }} />
            {template && template.status !== 'pending' ? <p className="text-[12.5px] text-warning">Saving sends this design for approval again.</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                Send for approval
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
