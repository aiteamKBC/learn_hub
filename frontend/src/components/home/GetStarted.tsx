import { LockKeyhole, Mail, MailCheck, Sparkles } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PasswordInput, PasswordStrength } from '@/components/ui/password'
import { AuthError, landingForMe, useLogin, useMfaAuthenticate, useSignup } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { cn } from '@/lib/cn'
import { Link, useNavigate } from '@/lib/router'

type Tab = 'login' | 'signup'

function LoginForm() {
  const navigate = useNavigate()
  const login = useLogin()
  const mfa = useMfaAuthenticate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [code, setCode] = useState('')
  const err = login.error instanceof AuthError ? login.error : null
  // Show a message for ANY failed sign-in. allauth usually returns an AuthError (with a
  // field-level message, or a general one); anything else (network, unexpected) still gets
  // a friendly fallback, so a wrong email/password never fails silently.
  const generalError =
    login.error && !(err && Object.keys(err.fields).length)
      ? (err?.message ?? 'That email or password is not right. Please check and try again.')
      : null

  if (step === 'code') {
    const codeErr = mfa.error instanceof AuthError ? mfa.error : null
    return (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          mfa.mutate(code.replace(/\s/g, ''), { onSuccess: (r) => navigate(landingForMe(r), { replace: true }) })
        }}
      >
        <p className="text-sm text-muted">Open your authenticator app and type the 6-digit code.</p>
        <Field label="Code" error={codeErr?.fields.code ?? (codeErr && !Object.keys(codeErr.fields).length ? codeErr.message : undefined)}>
          {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="Enter the 6-digit code" className="h-[52px] rounded-xl px-4 text-base" />}
        </Field>
        <Button type="submit" size="lg" loading={mfa.isPending} disabled={code.trim().length < 6} className="h-[52px] w-full bg-gradient-to-r from-[#ff9418] to-[#f26a00] text-base font-bold shadow-[0_10px_26px_rgba(242,106,0,0.24)] hover:brightness-95">
          Verify and log in
        </Button>
        <Button type="button" variant="ghost" onClick={() => (setStep('password'), setCode(''), mfa.reset())}>
          Back
        </Button>
      </form>
    )
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        // Warm the most common destination (a learner's page) while the server verifies
        // the password; each role is then sent to its own dashboard on success.
        void import('@/pages/MyLearningPage')
        login.mutate({ email, password }, { onSuccess: (r) => (r === 'mfa' ? setStep('code') : navigate(landingForMe(r), { replace: true })) })
      }}
    >
      {generalError ? (
        <p role="alert" className={cn('rounded-md px-3 py-2.5 text-sm', err?.pendingVerification ? 'bg-info-soft text-info' : 'bg-danger-soft text-danger')}>
          {generalError}
        </p>
      ) : null}
      <Field label="Email" error={err?.fields.email}>
        {(p) => <Input {...p} icon={<Mail />} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="h-[52px] rounded-xl pr-4 pl-12 text-base shadow-sm" />}
      </Field>
      <Field label="Password" error={err?.fields.password}>
        {(p) => <PasswordInput {...p} icon={<LockKeyhole />} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className="h-[52px] rounded-xl pl-12 text-base shadow-sm" />}
      </Field>
      <div className="-mt-1 text-right">
        <Link to="/account/password/reset" className="text-[15px] font-semibold text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" size="lg" loading={login.isPending} className="mt-1 h-[52px] w-full bg-gradient-to-r from-[#ff9418] to-[#f26a00] text-base font-bold shadow-[0_10px_26px_rgba(242,106,0,0.24)] hover:brightness-95">
        Log in
      </Button>
    </form>
  )
}

function SignupForm() {
  const navigate = useNavigate()
  const signup = useSignup()
  const { settings } = usePublicSettings()
  const minLength = settings['security.password_min_length']
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const err = signup.error instanceof AuthError ? signup.error : null

  if (!settings['access.registration_enabled']) {
    return <p className="rounded-md bg-surface-2/60 px-3 py-4 text-center text-sm text-muted">Sign-ups are closed right now. If you already have an account, you can still log in.</p>
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text">
          <MailCheck className="size-6" />
        </span>
        <p className="mt-4 text-sm">
          We sent a confirmation link to <span className="font-medium">{email}</span>. Open it to finish creating your account.
        </p>
        <p className="mt-3 text-xs text-muted">Nothing there? Check your junk folder.</p>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        signup.mutate({ email, password }, { onSuccess: (r) => (r === 'verify-email' ? setSent(true) : navigate('/learn', { replace: true })) })
      }}
    >
      {err && !Object.keys(err.fields).length ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {err.message}
        </p>
      ) : null}
      <Field label="Email" error={err?.fields.email}>
        {(p) => <Input {...p} icon={<Mail />} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="h-[52px] rounded-xl pr-4 pl-12 text-base shadow-sm" />}
      </Field>
      <div className="grid gap-2">
        <Field label="Password" hint={`At least ${minLength} characters, not a common password.`} error={err?.fields.password}>
          {(p) => <PasswordInput {...p} icon={<LockKeyhole />} autoComplete="new-password" required minLength={minLength} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" className="h-[52px] rounded-xl pl-12 text-base shadow-sm" />}
        </Field>
        <PasswordStrength password={password} minLength={minLength} />
      </div>
      <Button type="submit" size="lg" loading={signup.isPending} className="mt-1 h-[52px] w-full bg-gradient-to-r from-[#ff9418] to-[#f26a00] text-base font-bold shadow-[0_10px_26px_rgba(242,106,0,0.24)] hover:brightness-95">
        Create account
      </Button>
      <p className="text-center text-xs text-muted">
        By creating an account you agree to the <Link to="/terms" className="font-medium text-primary hover:underline">terms of use</Link> and{' '}
        <Link to="/privacy" className="font-medium text-primary hover:underline">privacy policy</Link>.
      </p>
    </form>
  )
}

/** The tabbed log-in / create-account card, for use inside the navbar/hero dialog. */
export function AuthTabs({ initialTab = 'login' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <div className="relative isolate overflow-hidden px-6 py-7 sm:px-10 sm:py-8">
      <div aria-hidden className="pointer-events-none absolute -top-44 -left-40 size-80 rounded-full border-[42px] border-primary/10" />
      <div aria-hidden className="pointer-events-none absolute -right-36 -bottom-48 size-96 rounded-full border-[48px] border-primary/10" />
      <div aria-hidden className="pointer-events-none absolute top-16 right-24 hidden text-primary sm:block">
        <Sparkles className="size-8" strokeWidth={2.5} />
      </div>

      <div className="relative mx-auto max-w-[500px] [&_label]:text-sm [&_label]:font-bold">
        <div className="mb-5 text-center">
          <h2 className="text-[28px] font-extrabold tracking-tight text-text sm:text-[30px]">Welcome to LearnHub</h2>
          <p className="mt-1.5 text-[15px] text-muted sm:text-base">Log in or create an account to get started.</p>
        </div>

        <div role="tablist" aria-label="Log in or create an account" className="mb-6 grid grid-cols-2 rounded-full border border-primary/15 bg-[#fff8f1] p-1 shadow-inner">
          {(['login', 'signup'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-full px-4 py-2.5 text-base font-bold transition-all',
                tab === t
                  ? 'bg-gradient-to-r from-[#ff9418] to-[#f26a00] text-white shadow-[0_8px_24px_rgba(242,106,0,0.25)] ring-1 ring-white/70'
                  : 'text-muted hover:bg-white/60 hover:text-text',
              )}
            >
              {t === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>
        {tab === 'login' ? <LoginForm /> : <SignupForm />}
      </div>
    </div>
  )
}
