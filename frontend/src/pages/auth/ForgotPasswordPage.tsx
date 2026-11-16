import { ArrowLeft, ArrowRight, Mail, MailCheck, ShieldCheck } from 'lucide-react'
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
      eyebrow="Account recovery"
      title={
        <>
          Forgot your
          <br />
          password<span className="text-primary">?</span>
        </>
      }
      subtitle="Enter your email and we'll send you a secure link to reset your password."
      gridClassName="lg:grid-cols-[72fr_28fr]"
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {err && !Object.keys(err.fields).length ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {err.message}
          </p>
        ) : null}
        <Field label="Email" error={err?.fields.email}>
          {(p) => <Input {...p} icon={<Mail />} type="email" autoComplete="email" placeholder="Email address" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={request.isPending} disabled={!email.includes('@')} className="w-full">
          Send reset link <ArrowRight className="size-4" />
        </Button>
      </form>

      <Link to="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" /> Back to log in
      </Link>

      <div className="mt-8 flex items-start gap-3 border-t border-border pt-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-text">Secure account recovery</p>
          <p className="mt-0.5 text-[13px] text-muted">Your information stays private and protected.</p>
        </div>
      </div>
    </AuthShell>
  )
}
