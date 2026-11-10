import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password'
import { AuthError, useLogin, useMfaAuthenticate } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { safeNext } from '@/lib/next'

import { AuthShell } from './AuthShell'
import { SocialButtons } from './SocialButtons'
import { Link, useNavigate } from '@/lib/router'

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const mfa = useMfaAuthenticate()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [code, setCode] = useState('')
  const { settings } = usePublicSettings()
  const err = login.error instanceof AuthError ? login.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password }, { onSuccess: (r) => (r === 'mfa' ? setStep('code') : navigate(next, { replace: true })) })
  }

  if (step === 'code') {
    const codeErr = mfa.error instanceof AuthError ? mfa.error : null
    return (
      <AuthShell title="Enter your code" subtitle="Open your authenticator app and type the 6-digit code. Lost your phone? Use one of your recovery codes.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            mfa.mutate(code.replace(/\s/g, ''), { onSuccess: () => navigate(next, { replace: true }) })
          }}
        >
          <Field label="Code" error={codeErr?.fields.code ?? (codeErr && !Object.keys(codeErr.fields).length ? codeErr.message : undefined)}>
            {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />}
          </Field>
          <Button type="submit" size="lg" loading={mfa.isPending} disabled={code.trim().length < 6} className="w-full">
            Verify and log in
          </Button>
          <Button type="button" variant="ghost" onClick={() => (setStep('password'), setCode(''), mfa.reset())}>
            Back
          </Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        settings['access.registration_enabled'] ? (
          <>
            New to {settings['general.platform_name']}?{' '}
            <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          'Sign in to continue.'
        )
      }
    >
      <SocialButtons next={next} />
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {err && !Object.keys(err.fields).length ? (
          <p role="alert" className={err.pendingVerification ? 'rounded-md bg-info-soft px-3 py-2.5 text-sm text-info' : 'rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger'}>
            {err.message}
          </p>
        ) : null}
        <Field label="Email" error={err?.fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" error={err?.fields.password}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/account/password/reset" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={login.isPending} className="w-full">
          Log in
        </Button>
      </form>
    </AuthShell>
  )
}
