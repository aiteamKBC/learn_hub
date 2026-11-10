import { Archive, Bell, Building2, Palette, Search } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, Label } from '@/components/ui/input'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyMark } from '@/components/layout/BusinessLayout'
import { type Company, useCompany, useIsOrgAdmin, useSaveBranding } from '@/features/org/api'
import { brandStyle, contrast, HEX } from '@/features/org/branding'
import { SavedTick } from '@/features/org/ui'

/** Native colour picker + hex text box, kept in step. Empty means "use LearnHub's". */
function ColourField({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const bad = text !== '' && !HEX.test(text)
  return (
    <Field label={label} hint={hint} error={bad ? 'Use the form #rrggbb, for example #0f766e.' : undefined}>
      {(p) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label}: colour picker`}
            value={HEX.test(value) ? value : '#7c3aed'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 disabled:cursor-not-allowed"
          />
          <Input
            {...p}
            value={text}
            disabled={disabled}
            placeholder="#rrggbb"
            maxLength={7}
            className="font-mono"
            onChange={(e) => {
              const v = e.target.value.trim()
              setText(v)
              if (v === '' || HEX.test(v)) onChange(v.toLowerCase())
            }}
          />
          {value && !disabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              Reset
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  )
}

/** A small copy of the workspace (sidebar + header) in the chosen colours. */
function Preview({ name, logo, primary, accent }: { name: string; logo: string; primary: string; accent: string }) {
  const style = brandStyle(primary, accent)
  const tooDark = !!primary && HEX.test(primary) && !(style && '--nav-active' in style)
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-border shadow-sm" style={style} aria-label="Preview of your workspace" role="img">
        <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr]">
          <div className="grid content-start gap-1 bg-nav p-2.5 text-nav-text">
            <span className="mb-1.5 h-3 w-16 rounded bg-white/20" />
            {['Overview', 'People', 'Reports'].map((t, i) => (
              <span key={t} className={i === 1 ? 'rounded-md bg-nav-active px-2 py-1.5 text-[11px] font-medium text-nav-text-active' : 'px-2 py-1.5 text-[11px]'}>
                {t}
              </span>
            ))}
          </div>
          <div className="min-w-0 bg-background">
            <div className="flex h-11 items-center gap-2 border-b border-border bg-surface px-3">
              <span className="flex min-w-0 items-center gap-1.5 border-b-2 pb-0.5" style={{ borderColor: 'var(--brand-accent, transparent)' }}>
                <CompanyMark name={name} logoUrl={logo} className="size-6" />
                <span className="truncate text-xs font-semibold">{name}</span>
              </span>
              <span className="ml-auto hidden h-6 w-24 items-center gap-1 rounded-md border border-border px-1.5 text-[10px] text-subtle sm:flex">
                <Search className="size-3" /> Search
              </span>
            </div>
            <div className="grid gap-2 p-3">
              <span className="h-3 w-24 rounded bg-surface-2" />
              <span className="h-2 w-40 max-w-full rounded bg-surface-2" />
              <span className="mt-1 h-10 rounded-md border border-border bg-surface" />
            </div>
          </div>
        </div>
      </div>
      {tooDark ? <p className="mt-2 text-xs text-warning">This colour is too close to the dark sidebar, so the sidebar keeps its usual colour.</p> : null}
    </div>
  )
}

function BrandingForm({ company }: { company: Company }) {
  const admin = useIsOrgAdmin()
  const save = useSaveBranding()
  const initial = { logo_url: company.logo_url, primary_color: company.primary_color, accent_color: company.accent_color }
  const [form, setForm] = useState(initial)
  const [saved, setSaved] = useState(false)
  useEffect(() => setForm({ logo_url: company.logo_url, primary_color: company.primary_color, accent_color: company.accent_color }), [company.logo_url, company.primary_color, company.accent_color])
  const logoBad = form.logo_url.trim() !== '' && !form.logo_url.trim().startsWith('https://')
  const dirty = form.logo_url.trim() !== initial.logo_url || form.primary_color !== initial.primary_color || form.accent_color !== initial.accent_color
  const lowContrast = form.accent_color && contrast(form.accent_color, '#ffffff') < 1.5

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (logoBad || !dirty) return
    save.mutate(
      { ...form, logo_url: form.logo_url.trim() },
      {
        onSuccess: () => {
          toast.success('Branding saved')
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Branding" description={admin ? 'Your logo and colours in the business workspace.' : 'Only admins can change the branding.'} />
        <CardBody className="grid gap-5">
          <Field label="Logo link" hint="An https:// link to a PNG or SVG. Square logos look best." error={logoBad ? 'The link must start with https://' : undefined}>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://…" maxLength={500} value={form.logo_url} disabled={!admin} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />}
          </Field>
          <ColourField label="Main colour" hint="Used for the selected item in the sidebar." value={form.primary_color} disabled={!admin} onChange={(v) => setForm({ ...form, primary_color: v })} />
          <ColourField label="Accent colour" hint="Used under your company name in the header." value={form.accent_color} disabled={!admin} onChange={(v) => setForm({ ...form, accent_color: v })} />
          {lowContrast ? <p className="text-xs text-warning">This accent is very light and may be hard to see on a white page.</p> : null}
          {admin ? (
            <div className="flex items-center justify-end gap-3">
              {saved ? <SavedTick /> : null}
              <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => setForm(initial)}>
                Undo changes
              </Button>
              <Button type="submit" disabled={!dirty || logoBad} loading={save.isPending}>
                Save branding
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Preview" description="How your workspace will look" />
        <CardBody>
          <Preview name={company.name} logo={form.logo_url.trim()} primary={form.primary_color} accent={form.accent_color} />
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
            <Palette className="size-3.5" /> Text on your colours turns white or dark automatically so it stays easy to read.
          </p>
        </CardBody>
      </Card>
    </form>
  )
}

export function CompanySettingsPage() {
  const { data: company, isLoading, error, refetch } = useCompany()
  return (
    <>
      <PageHeader title="Company settings" description="Your company profile, branding and how long records are kept." />
      {error ? (
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !company ? (
        <div className="grid gap-6">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : (
        <div className="stagger grid gap-6">
          <Card>
            <CardHeader title="Company" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="company-name">Company name</Label>
                <Input id="company-name" value={company.name} readOnly aria-describedby="company-name-hint" />
                <p id="company-name-hint" className="text-[13px] text-muted">
                  To change it, contact LearnHub support.
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
                  <Building2 className="size-[18px]" />
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">Web address</p>
                  <p className="truncate text-muted">{company.slug}</p>
                </div>
              </div>
            </CardBody>
          </Card>
          <BrandingForm company={company} />
          <Card>
            <CardHeader title="Records and data" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
                  <Archive className="size-[18px]" />
                </span>
                <p className="text-sm text-muted">
                  Training records are kept for <span className="font-semibold text-text">{company.retention_months} months</span>, including for people who leave, so you can show them in audits.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
                  <Bell className="size-[18px]" />
                </span>
                <p className="text-sm text-muted">Reminder timing is set on each requirement. Contact LearnHub support to change how long records are kept.</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  )
}
