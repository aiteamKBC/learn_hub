import { MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PasswordInput, PasswordStrength } from '@/components/ui/password'
import { AuthError, useSignup } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { safeNext } from '@/lib/next'

import { AuthShell } from './AuthShell'
import { SocialButtons } from './SocialButtons'
import { Link, useNavigate } from '@/lib/router'

export function SignupPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const signup = useSignup()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [sent, setSent] = useState(false)
  const err = signup.error instanceof AuthError ? signup.error : null
  const { settings } = usePublicSettings()
  const minLength = settings['security.password_min_length']

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setMismatch(true)
    signup.mutate({ email, password }, { onSuccess: (r) => (r === 'verify-email' ? setSent(true) : navigate(next, { replace: true })) })
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox">
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
            <MailCheck className="size-6" />
          </span>
          <p className="mt-4 text-sm">
            We sent a confirmation link to <span className="font-medium">{email}</span>. Open it to finish creating your account.
          </p>
          <p className="mt-3 text-xs text-muted">Nothing there? Check your junk folder.</p>
        </div>
        {/* sign-up answers the same way for known emails (no account probing), so say what happens then */}
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account with this email? We've emailed you a reminder instead.{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      </AuthShell>
    )
  }

  if (!settings['access.registration_enabled']) {
    // console > Settings: registration is off (the API refuses sign-ups too)
    return (
      <AuthShell title="Sign-ups are closed" subtitle="New accounts can't be created right now. If you already have one, you can still log in.">
        <Button asChild size="lg" className="w-full">
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>Log in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <SocialButtons next={next} />
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {err && !Object.keys(err.fields).length ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {err.message}
          </p>
        ) : null}
        <Field label="Email" error={err?.fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <div className="grid gap-2">
          <Field label="Password" hint={`At least ${minLength} characters, not a common password.`} error={err?.fields.password}>
            {(p) => <PasswordInput {...p} autoComplete="new-password" required minLength={minLength} value={password} onChange={(e) => (setPassword(e.target.value), setMismatch(false))} />}
          </Field>
          <PasswordStrength password={password} minLength={minLength} />
        </div>
        <Field label="Confirm password" error={mismatch ? "The passwords don't match." : undefined}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" required value={confirm} onChange={(e) => (setConfirm(e.target.value), setMismatch(false))} />}
        </Field>
        <Button type="submit" size="lg" loading={signup.isPending} className="w-full">
          Create account
        </Button>
        <p className="text-center text-xs text-muted">By creating an account you agree to the terms of use and privacy policy.</p>
      </form>
    </AuthShell>
  )
}
