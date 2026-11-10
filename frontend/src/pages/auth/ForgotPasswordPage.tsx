import { MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { AuthError, useRequestPasswordReset } from '@/features/identity/auth'
import { Link } from '@/lib/router'

import { AuthShell } from './AuthShell'

/** "Forgot password?" from the log-in page: we email a link to set a new one. */
export function ForgotPasswordPage() {
  const request = useRequestPasswordReset()
  const [email, setEmail] = useState('')
  const err = request.error instanceof AuthError ? request.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    request.mutate(email.trim())
  }

  if (request.isSuccess) {
    return (
      <AuthShell title="Check your inbox">
        <div className="animate-reveal rounded-lg border border-border bg-surface p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
            <MailCheck className="size-6" />
          </span>
          {/* the same answer for every address, so nobody can find out who has an account */}
          <p className="mt-4 text-sm">
            If <span className="font-medium break-all">{email.trim()}</span> has an account, we've sent it a link to set a new password.
          </p>
          <p className="mt-3 text-xs text-muted">The link works once. Nothing there? Check your junk folder.</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => request.reset()}>
            Use another email
          </Button>
          <Button asChild>
            <Link to="/login">Back to log in</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle={
        <>
          Enter your email and we'll send you a link to set a new one.{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {err && !Object.keys(err.fields).length ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {err.message}
          </p>
        ) : null}
        <Field label="Email" error={err?.fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={request.isPending} disabled={!email.includes('@')} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthShell>
  )
}
