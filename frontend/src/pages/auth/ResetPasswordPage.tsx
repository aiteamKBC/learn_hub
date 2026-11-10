import { CheckCircle2, XCircle } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/input'
import { PasswordInput, PasswordStrength } from '@/components/ui/password'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthError, useResetKey, useResetPassword } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { Link } from '@/lib/router'

import { AuthShell } from './AuthShell'

/** The link in the reset email lands here: check it, then set the new password. */
export function ResetPasswordPage() {
  const { key = '' } = useParams()
  const valid = useResetKey(key)
  const reset = useResetPassword()
  const minLength = usePublicSettings().settings['security.password_min_length']
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const err = reset.error instanceof AuthError ? reset.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setMismatch(true)
    reset.mutate({ key, password })
  }

  if (valid.isPending) {
    return (
      <AuthShell title="Set a new password">
        <div className="grid gap-4" aria-busy="true" aria-label="Checking your link">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-11" />
        </div>
      </AuthShell>
    )
  }

  if (reset.isSuccess) {
    return (
      <AuthShell title="Password changed">
        <div className="animate-reveal rounded-lg border border-border bg-surface p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <p className="mt-3 font-medium">Your new password is set.</p>
          <p className="mt-1 text-sm text-muted">{reset.data === 'signed-in' ? "You're signed in." : 'Log in with it now.'}</p>
          <Button className="mt-5" asChild>
            <Link to={reset.data === 'signed-in' ? '/learn' : '/login'}>{reset.data === 'signed-in' ? 'Start learning' : 'Log in'}</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  // a refused key on submit (expired meanwhile) shows the same screen as one refused up front
  if (!valid.data || err?.fields.key) {
    return (
      <AuthShell title="This link doesn't work">
        <div className="animate-reveal rounded-lg border border-border bg-surface p-6 text-center">
          <XCircle className="mx-auto size-10 text-danger" />
          <p className="mt-3 font-medium">The link has expired or was already used.</p>
          <p className="mt-1 text-sm text-muted">Ask for a new one: it only takes a moment.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" asChild>
              <Link to="/login">Back to log in</Link>
            </Button>
            <Button asChild>
              <Link to="/account/password/reset">Send a new link</Link>
            </Button>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a password you don't use anywhere else.">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {err && !Object.keys(err.fields).length ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {err.message}
          </p>
        ) : null}
        <div className="grid gap-2">
          <Field label="New password" hint={`At least ${minLength} characters, not a common password.`} error={err?.fields.password}>
            {(p) => <PasswordInput {...p} autoComplete="new-password" required autoFocus minLength={minLength} value={password} onChange={(e) => (setPassword(e.target.value), setMismatch(false))} />}
          </Field>
          <PasswordStrength password={password} minLength={minLength} />
        </div>
        <Field label="Confirm new password" error={mismatch ? "The passwords don't match." : undefined}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" required value={confirm} onChange={(e) => (setConfirm(e.target.value), setMismatch(false))} />}
        </Field>
        <Button type="submit" size="lg" loading={reset.isPending} disabled={!password || !confirm} className="w-full">
          Set new password
        </Button>
      </form>
    </AuthShell>
  )
}
