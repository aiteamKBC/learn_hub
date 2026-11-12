import { Bell, Check, ChevronRight, CreditCard, Eye, GraduationCap, ImageUp, Info, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { LogoMark } from '@/components/ui/logo'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCurrencies } from '@/features/commerce/api'
import { type BrandingKind, type SettingDef, type SettingValue, useBrandingRemove, useBrandingUpload, useConsoleSettings, useSaveSettings } from '@/features/console/settings'
import { ConfirmDialog, useTabParam } from '@/features/console/ui'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'

type TabKey = 'general' | 'payment' | 'learning' | 'notification' | 'instructor' | 'security'
const TABS: { key: TabKey; label: string; icon: LucideIcon; hint: string; groups: string[] }[] = [
  { key: 'general', label: 'General', icon: Settings2, hint: 'Platform name, logo, language and regional preferences.', groups: ['general', 'access'] },
  { key: 'payment', label: 'Payment', icon: CreditCard, hint: 'Refunds, tax, discounts, regional prices and payouts.', groups: ['payment', 'pricing', 'payout'] },
  { key: 'learning', label: 'Learning', icon: GraduationCap, hint: 'Course review, certificates, reviews and Q&A.', groups: ['learning'] },
  { key: 'notification', label: 'Notification', icon: Bell, hint: 'Email copies, digests and staff alerts.', groups: ['notification'] },
  { key: 'instructor', label: 'Instructor', icon: Users, hint: 'Course limits and coupons for instructors.', groups: ['instructor'] },
  { key: 'security', label: 'Security', icon: ShieldCheck, hint: 'Passwords, sign-in length, email checks and 2-step sign-in.', groups: ['security'] },
]
const TAB_KEYS = TABS.map((t) => t.key)

const SECTION: Record<string, string> = { payment: 'Payments', pricing: 'Regional pricing', payout: 'Instructor payouts' }

// One plain sentence under each switch or field.
const HELP: Record<string, string> = {
  'access.registration_enabled': 'Allow new people to create accounts.',
  'access.instructor_applications': 'Allow people to apply to become instructors.',
  'access.guest_browsing': 'Allow visitors to browse courses without an account.',
  'access.maintenance_mode': 'Close the site to everyone except staff.',
  'access.maintenance_message': 'Shown to visitors while maintenance mode is on.',
  'payments.refund_window_days': 'How long after buying a learner can ask for a refund.',
  'payments.prices_include_tax': 'Prices shown at checkout already include VAT.',
  'payments.allow_promotion_stacking': 'A coupon can apply on top of a running promotion.',
  'payments.discount_reduces_commission': "Discounts come out of the instructor's share as well as ours.",
  'pricing.regional_enabled': "Charge each country's own price where one is set.",
  'pricing.fx_auto_refresh': 'Fetch new exchange rates every day.',
  'payouts.minimum_gbp_minor': 'In pence: 2500 is £25.',
  'learning.course_review_required': 'Staff approve every new course before it is published.',
  'learning.certificates_enabled': 'Learners get a certificate when they finish a course.',
  'learning.reviews_enabled': 'Learners can rate and review courses they took.',
  'learning.qa_enabled': 'Learners can ask questions inside a course.',
  'notifications.email_enabled': 'Send an email copy of notifications that have email switched on.',
  'notifications.staff_alerts': 'Tell staff when a health check fails.',
  'instructors.coupons_enabled': 'Instructors can make coupons for their own courses.',
  'security.session_days': 'People are asked to sign in again after this.',
  'security.require_email_verification': 'New accounts must confirm their email before signing in.',
  'security.mfa_enabled': 'People can protect their account with an authenticator app.',
  'security.mfa_required_for_staff': 'Staff without 2-step sign-in cannot open the console.',
}

const LANGUAGES: Record<string, string> = { en: 'English (UK)', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish' }
const DIGEST: Record<string, string> = { off: 'Off', daily: 'Daily', weekly: 'Weekly' }
const SCHEDULE: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly' }
const DATE_EXAMPLE: Record<string, string> = { 'd MMM yyyy': '31 Oct 2025', 'dd/MM/yyyy': '31/10/2025', 'yyyy-MM-dd': '2025-10-31' }
const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()
const HIDDEN = new Set(['general.logo_url', 'general.favicon_url']) // edited by upload

type Draft = Record<string, SettingValue>

function choiceLabels(key: string): Record<string, string> | null {
  if (key === 'general.default_language') return LANGUAGES
  if (key === 'general.date_format') return DATE_EXAMPLE
  if (key === 'notifications.digest') return DIGEST
  if (key === 'payouts.schedule') return SCHEDULE
  return null
}

function SwitchRow({ def, value, onChange }: { def: SettingDef; value: boolean; onChange: (v: boolean) => void }) {
  const id = `setting-${def.key}`
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-medium">{def.label}</label>
        {HELP[def.key] ? <p className="text-xs text-muted">{HELP[def.key]}</p> : null}
      </div>
      <Switch id={id} checked={value} onCheckedChange={onChange} />
    </div>
  )
}

function Editor({ def, value, onChange }: { def: SettingDef; value: SettingValue; onChange: (v: SettingValue) => void }) {
  // Keep this hook above every return: the editor can switch between a boolean
  // and a currency setting while the component instance stays mounted.
  const currencies = useCurrencies().data ?? []
  if (def.kind === 'bool') return <SwitchRow def={def} value={!!value} onChange={onChange} />
  const hint = HELP[def.key] ?? (def.kind === 'int' && def.min != null && def.max != null ? `Between ${def.min} and ${def.max}.` : undefined)
  const labels = choiceLabels(def.key)
  const currencyList = currencies.some((c) => c.code === value) ? currencies : [{ code: String(value), name: String(value) }, ...currencies]
  return (
    <Field label={def.label} hint={hint}>
      {(f) =>
        def.kind === 'choice' ? (
          <NativeSelect {...f} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {def.choices.map((c) => <option key={c} value={c}>{labels?.[c] ?? c}</option>)}
          </NativeSelect>
        ) : def.kind === 'int' ? (
          <Input {...f} type="number" inputMode="numeric" min={def.min ?? undefined} max={def.max ?? undefined} value={String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        ) : def.key === 'general.default_currency' ? (
          <NativeSelect {...f} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {currencyList.map((c) => <option key={c.code} value={c.code}>{c.code === c.name ? c.code : `${c.code}: ${c.name}`}</option>)}
          </NativeSelect>
        ) : def.key === 'general.time_zone' && zones.length ? (
          <NativeSelect {...f} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {(zones.includes(String(value)) ? zones : [String(value), ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </NativeSelect>
        ) : (
          <Input {...f} value={String(value)} maxLength={def.max_len} required={def.key === 'general.platform_name'} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  )
}

function BrandingField({ kind, url, name }: { kind: BrandingKind; url: string; name: string }) {
  const upload = useBrandingUpload()
  const remove = useBrandingRemove()
  const input = useRef<HTMLInputElement>(null)
  const label = kind === 'logo' ? 'Logo' : 'Favicon'
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        <Info className="size-3.5 text-muted" aria-hidden />
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <div className={cn('grid shrink-0 place-items-center rounded-lg border border-dashed border-border-strong bg-surface-2/60', kind === 'logo' ? 'h-20 w-48 px-3' : 'size-16')}>
          {url ? (
            <img src={url} alt={`Current ${label.toLowerCase()}`} className={kind === 'logo' ? 'max-h-12 max-w-full object-contain' : 'size-8 object-contain'} />
          ) : kind === 'logo' ? (
            <span className="inline-flex items-center gap-2"><LogoMark /><span className="max-w-[7rem] truncate font-bold">{name}</span></span>
          ) : (
            <LogoMark />
          )}
        </div>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              className="sr-only"
              aria-label={`Choose a ${label.toLowerCase()} file`}
              accept={kind === 'logo' ? '.png,.svg,.webp,.jpg,.jpeg' : '.ico,.png,.svg'}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) upload.mutate({ kind, file }, { onSuccess: () => toast.success(`${label} updated`), onError: (er) => toast.error(er.message) })
              }}
            />
            <Button type="button" variant="secondary" size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>
              <ImageUp /> Upload {label.toLowerCase()}
            </Button>
            {url ? (
              <Button type="button" variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate(kind, { onSuccess: () => toast.success(`${label} removed`), onError: (er) => toast.error(er.message) })}>
                <Trash2 /> Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted">{kind === 'logo' ? 'PNG, SVG, WebP or JPG, up to 2 MB. About 400 × 120 px works best.' : 'ICO, PNG or SVG, up to 512 KB. 32 × 32 px.'}</p>
        </div>
      </div>
    </div>
  )
}

function Preview({ name, tagline, logo }: { name: string; tagline: string; logo: string }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Eye className="size-4 text-primary" /> Platform preview</h2>
      <p className="text-xs text-muted">How your platform appears to people. Updates as you type.</p>
      <div className="mt-4 overflow-hidden rounded-lg border border-border shadow-sm" aria-hidden>
        <div className="flex gap-1.5 border-b border-border bg-surface-2 px-3 py-2">
          <span className="size-2.5 rounded-full bg-danger" /><span className="size-2.5 rounded-full bg-warning" /><span className="size-2.5 rounded-full bg-success" />
        </div>
        <div className="flex items-center gap-3 bg-surface px-3 py-2.5">
          {logo ? <img src={logo} alt="" className="h-6 max-w-[96px] object-contain" /> : <span className="inline-flex min-w-0 items-center gap-1.5"><LogoMark className="size-6" /><span className="truncate text-sm font-bold">{name || 'Platform'}</span></span>}
          <span className="ml-auto hidden gap-3 text-[10px] text-muted sm:flex"><span>Courses</span><span>Plans</span><span>Teach</span></span>
        </div>
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-[color-mix(in_oklab,var(--primary)_55%,black)] px-4 py-8 text-center">
          <svg viewBox="0 0 200 60" className="absolute inset-x-0 bottom-0 w-full opacity-30" preserveAspectRatio="none"><path d="M0 40 C50 10 90 60 140 30 S200 20 200 20 V60 H0Z" fill="white" /></svg>
          <p className="relative text-lg font-bold text-white">{tagline || ' '}</p>
        </div>
      </div>
    </Card>
  )
}

/** Console > Settings (mockup 18): every platform setting in six tabs, saved together;
 * the general tab also has the logo, favicon, a live preview and the site switches. */
export function ConsoleSettingsPage() {
  const q = useConsoleSettings()
  const save = useSaveSettings()
  const [tab, setTab] = useTabParam(TAB_KEYS, 'general')
  const [draft, setDraft] = useState<Draft>({})
  const [confirmMaintenance, setConfirmMaintenance] = useState(false)
  const defs = useMemo(() => q.data?.settings ?? [], [q.data])
  const saved = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.value as SettingValue])), [defs])
  const value = (key: string) => (key in draft ? draft[key]! : saved[key]!)
  const changed = Object.keys(draft).filter((k) => draft[k] !== saved[k])
  const changedIn = (t: (typeof TABS)[number]) => changed.filter((k) => t.groups.includes(defs.find((d) => d.key === k)?.group ?? '')).length

  useEffect(() => {
    if (!changed.length) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changed.length])

  const set = (key: string, v: SettingValue) => setDraft((d) => ({ ...d, [key]: v }))
  const doSave = () =>
    save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]!])), {
      onSuccess: (r) => (setDraft({}), setConfirmMaintenance(false), toast.success(r.changed.length ? `Saved ${r.changed.length} ${r.changed.length === 1 ? 'change' : 'changes'}` : 'Nothing to save')),
      onError: (e) => toast.error(e.message),
    })
  const onSave = () => (changed.includes('access.maintenance_mode') && draft['access.maintenance_mode'] === true ? setConfirmMaintenance(true) : doSave())

  const current = TABS.find((t) => t.key === tab)!
  const byGroup = (g: string) => defs.filter((d) => d.group === g && !HIDDEN.has(d.key))
  const last = defs.filter((d) => d.updated_at).sort((a, b) => (a.updated_at! < b.updated_at! ? 1 : -1))[0]

  return (
    <>
      <PageHeader title="Platform settings" description="Your platform's identity, payments, learning, notifications, instructor options and security." />
      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[540px] rounded-lg" />
          <Skeleton className="h-[540px] rounded-lg" />
        </div>
      ) : (
        <div className="grid animate-reveal gap-5">
          <Tabs value={tab} onValueChange={(t) => setTab(t as TabKey)}>
            <TabsList aria-label="Settings sections">
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  <t.icon /> {t.label}
                  {changedIn(t) ? <span className="size-1.5 rounded-full bg-warning" aria-label="unsaved changes" /> : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="min-w-0 p-5 sm:p-6">
              <div className="flex items-start gap-3 border-b border-border pb-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><current.icon className="size-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold">{current.label} settings</h2>
                  <p className="text-sm text-muted">{current.hint}</p>
                </div>
              </div>
              <div key={tab} className="stagger mt-5 grid gap-5">
                {tab === 'general' ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {byGroup('general').slice(0, 2).map((d) => <Editor key={d.key} def={d} value={value(d.key)} onChange={(v) => set(d.key, v)} />)}
                    </div>
                    <BrandingField kind="logo" url={String(saved['general.logo_url'] ?? '')} name={String(value('general.platform_name'))} />
                    <BrandingField kind="favicon" url={String(saved['general.favicon_url'] ?? '')} name={String(value('general.platform_name'))} />
                    <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                      {byGroup('general').slice(2).map((d) => <Editor key={d.key} def={d} value={value(d.key)} onChange={(v) => set(d.key, v)} />)}
                    </div>
                  </>
                ) : (
                  current.groups.map((g) => (
                    <section key={g} className="grid gap-3">
                      {current.groups.length > 1 ? <h3 className="text-sm font-semibold">{SECTION[g] ?? g}</h3> : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {byGroup(g).map((d) => (
                          <div key={d.key} className={d.kind === 'bool' ? 'sm:col-span-2' : undefined}>
                            <Editor def={d} value={value(d.key)} onChange={(v) => set(d.key, v)} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button onClick={onSave} loading={save.isPending && !confirmMaintenance} disabled={!changed.length}>
                  <Check /> Save changes
                </Button>
                <Button variant="secondary" onClick={() => setDraft({})} disabled={!changed.length}>
                  <RotateCcw /> Discard changes
                </Button>
                <span className="text-xs text-muted" aria-live="polite">
                  {changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : last ? `Last changed ${relativeDate(last.updated_at!)}${last.updated_by ? ` by ${last.updated_by}` : ''}` : 'All settings are at their defaults.'}
                </span>
              </div>
            </Card>

            <div className="grid min-w-0 gap-5">
              {tab === 'general' ? (
                <>
                  <Preview name={String(value('general.platform_name'))} tagline={String(value('general.tagline'))} logo={String(saved['general.logo_url'] ?? '')} />
                  <Card className="p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold"><SlidersHorizontal className="size-4 text-primary" /> Additional options</h2>
                    <p className="text-xs text-muted">Staff can always sign in and use the console.</p>
                    <div className="stagger mt-4 grid gap-2.5">
                      {byGroup('access').map((d) => (
                        <Editor key={d.key} def={d} value={value(d.key)} onChange={(v) => set(d.key, v)} />
                      ))}
                    </div>
                  </Card>
                </>
              ) : null}
              <Card className="p-3">
                <h2 className="px-2 pt-2 text-base font-semibold">Settings overview</h2>
                <p className="px-2 text-xs text-muted">Quick access to every section.</p>
                <ul className="mt-2 grid gap-1">
                  {TABS.map((t) => (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => setTab(t.key)}
                        aria-current={t.key === tab ? 'page' : undefined}
                        className={cn('flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors', t.key === tab ? 'bg-primary-soft' : 'hover:bg-surface-2')}
                      >
                        <t.icon className={cn('size-5 shrink-0', t.key === tab ? 'text-primary' : 'text-muted')} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{t.label} settings{changedIn(t) ? <span className="ml-1.5 text-xs font-normal text-warning">· {changedIn(t)} unsaved</span> : null}</span>
                          <span className="block text-xs text-muted">{t.hint}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmMaintenance}
        onOpenChange={setConfirmMaintenance}
        title="Turn on maintenance mode?"
        body="Everyone except staff sees the maintenance page and cannot use the site until you turn it off."
        confirmLabel="Save and close the site"
        loading={save.isPending}
        onConfirm={doSave}
      />
    </>
  )
}
