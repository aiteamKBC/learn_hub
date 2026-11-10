import { Award, Bell, Building2, ChevronRight, ClipboardCheck, KeyRound, LifeBuoy, ReceiptText, Trophy, User } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { PasswordInput, PasswordStrength } from '@/components/ui/password'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCurrencies } from '@/features/commerce/api'
import { usePreferences, useSetPreference } from '@/features/engagement/api'
import { AuthError, useChangePassword, useHasPassword, useMe, useUpdateMe } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { useCurrency } from '@/lib/currency'
import { Link } from '@/lib/router'

import { TwoStepCard } from './TwoStepCard'

/** Phones have no sidebar: the account page doubles as the way to everything else. */
const shortcuts = [
  { to: '/learn/required', label: 'Required training', Icon: ClipboardCheck, company: true },
  { to: '/learn/certificates', label: 'Certificates', Icon: Award },
  { to: '/learn/achievements', label: 'Achievements', Icon: Trophy },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/account/orders', label: 'Purchase history', Icon: ReceiptText },
  { to: '/support', label: 'Help & support', Icon: LifeBuoy },
]

function zones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Europe/London']
  }
}

function Profile() {
  const { data: me } = useMe()
  const update = useUpdateMe()
  const currencies = useCurrencies()
  const { setCurrency } = useCurrency()
  const [name, setName] = useState(me?.full_name ?? '')
  const [tz, setTz] = useState(me?.timezone || 'UTC')
  const [cur, setCur] = useState(me?.preferred_currency ?? '')
  const all = useMemo(() => {
    const list = zones()
    const current = me?.timezone || 'UTC'
    return list.includes(current) ? list : [current, ...list] // "UTC" is not in every browser's list
  }, [me?.timezone])
  useEffect(() => {
    if (me) (setName(me.full_name), setTz(me.timezone || 'UTC'), setCur(me.preferred_currency))
  }, [me])
  if (!me) return null
  const dirty = name.trim() !== me.full_name || tz !== (me.timezone || 'UTC') || cur !== me.preferred_currency

  const save = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(
      { full_name: name.trim(), timezone: tz },
      {
        onSuccess: async () => {
          if (cur && cur !== me.preferred_currency) await setCurrency(cur)
          toast.success('Profile saved')
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }

  return (
    <Card id="profile">
      <CardHeader title="Profile" description="Your name is printed on your certificates." />
      <CardBody>
        <form onSubmit={save} className="grid gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={me.full_name || me.email} src={me.avatar_url} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium">{me.full_name || 'Your name'}</p>
              <p className="truncate text-sm text-muted">{me.email}</p>
            </div>
          </div>
          <Field label="Full name" hint="As it should appear on certificates.">
            {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoComplete="name" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Time zone" hint="Deadlines and live sessions are shown in it.">
              {(f) => (
                <NativeSelect {...f} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {all.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Currency" hint="Prices are shown and charged in it.">
              {(f) => (
                <NativeSelect {...f} value={cur} onChange={(e) => setCur(e.target.value)}>
                  <option value="">Automatic</option>
                  {(currencies.data ?? []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={update.isPending} disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function Password() {
  const has = useHasPassword()
  const minLength = usePublicSettings().settings['security.password_min_length']
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    if (next !== confirm) return setErrors({ confirm: "The passwords don't match." })
    change.mutate(
      { current_password: has.data ? current : undefined, new_password: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          setConfirm('')
          toast.success('Password changed')
        },
        onError: (er) => (er instanceof AuthError && Object.keys(er.fields).length ? setErrors(er.fields) : toast.error(er.message)),
      },
    )
  }
  return (
    <Card id="password">
      <CardHeader title={has.data === false ? 'Set a password' : 'Password'} description={has.data === false ? 'You sign in with Google or Microsoft. Add a password to sign in with your email too.' : `Use at least ${minLength} characters. A passphrase is easier to remember.`} />
      <CardBody>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {has.data !== false ? (
            <Field label="Current password" error={errors.current_password}>
              {(f) => <PasswordInput {...f} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />}
            </Field>
          ) : null}
          <div className="grid content-start gap-2">
            <Field label="New password" error={errors.new_password}>
              {(f) => <PasswordInput {...f} value={next} onChange={(e) => (setNext(e.target.value), setErrors({}))} autoComplete="new-password" minLength={minLength} required />}
            </Field>
            <PasswordStrength password={next} minLength={minLength} />
          </div>
          <Field label="Confirm new password" error={errors.confirm}>
            {(f) => <PasswordInput {...f} value={confirm} onChange={(e) => (setConfirm(e.target.value), setErrors({}))} autoComplete="new-password" required />}
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="secondary" loading={change.isPending} disabled={!next || !confirm || (has.data !== false && !current)}>
              <KeyRound /> {has.data === false ? 'Set password' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function NotificationSettings() {
  const prefs = usePreferences()
  const set = useSetPreference()
  return (
    <Card id="notifications">
      <CardHeader title="Notifications" description="Choose what reaches you, and how." />
      <CardBody className="pt-3">
        {prefs.error ? (
          <ErrorState message={prefs.error.message} onRetry={() => void prefs.refetch()} />
        ) : prefs.isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-medium">About</th>
                <th className="w-20 py-2 text-center font-medium">In app</th>
                <th className="w-20 py-2 text-center font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(prefs.data ?? []).map((p) => {
                const save = (patch: { email?: boolean; in_app?: boolean }) => set.mutate({ kind: p.kind, email: p.email, in_app: p.in_app, ...patch }, { onError: (e) => toast.error(e.message) })
                return (
                  <tr key={p.kind}>
                    <td className="py-3 pr-3">{p.title}</td>
                    <td className="py-3 text-center">
                      <Switch checked={p.in_app} onCheckedChange={(v) => save({ in_app: v })} aria-label={`${p.title}: in the app`} />
                    </td>
                    <td className="py-3 text-center">
                      {p.email_available ? <Switch checked={p.email} onCheckedChange={(v) => save({ email: v })} aria-label={`${p.title}: by email`} /> : <span className="text-xs text-subtle">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

const roles: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', learner: 'Learner' }

export function AccountPage() {
  const { data: me } = useMe()
  const companies = me?.memberships ?? []
  useEffect(() => {
    // arriving from "Settings" on the notifications page: go to that section
    const id = location.hash.slice(1)
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [])
  return (
    <>
      <PageHeader title="Settings" description="Your profile, sign-in and notifications." />
      <nav aria-label="Account" className="mb-6 overflow-hidden rounded-lg border border-border bg-surface shadow-sm md:hidden">
        {shortcuts
          .filter((s) => !s.company || companies.length)
          .map(({ to, label, Icon }) => (
            <Link key={to} to={to} className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0 hover:bg-surface-2">
              <Icon className="size-[18px] text-muted" /> <span className="flex-1">{label}</span> <ChevronRight className="size-4 text-subtle" />
            </Link>
          ))}
      </nav>
      <div className="stagger grid max-w-3xl scroll-mt-24 gap-6 [&>*]:scroll-mt-24">
        <Profile />
        <Password />
        <TwoStepCard />
        <NotificationSettings />
        <Card id="companies">
          <CardHeader title="Companies" description="Workspaces you belong to. Training they assign appears in My learning." />
          <CardBody>
            {companies.length ? (
              <ul className="divide-y divide-border">
                {companies.map((m) => (
                  <li key={m.org_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text">
                      <Building2 className="size-4" />
                    </span>
                    <span className="flex-1 font-medium">{m.name}</span>
                    <Badge>{roles[m.role] ?? m.role}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="inline-flex items-center gap-2 text-sm text-muted">
                <User className="size-4" /> Personal account: not part of a company.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
