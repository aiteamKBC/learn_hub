/**
 * Home "Get started" section: a real log-in / create-account card driven by the
 * existing auth hooks (useLogin, useSignup, useMfaAuthenticate) — no new backend.
 *
 * NOTE (see docs/NEEDS-USER.md, UI-2): the account-type (Individual / Company) and
 * role chooser (Student / Instructor / Company / Coach / Admin / Other) are VISUAL
 * ONLY. The backend sign-up accepts email + password and assigns the default role;
 * the chosen role is not sent anywhere yet. Kept at the user's explicit request for
 * the demo, to be wired when the backend supports roles.
 */
import { MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PasswordInput, PasswordStrength } from '@/components/ui/password'
import { AuthError, useLogin, useMfaAuthenticate, useSignup } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'
import { cn } from '@/lib/cn'
import { Link, useNavigate } from '@/lib/router'

type Tab = 'login' | 'signup'

const ROLES = ['Student', 'Company', 'Instructor', 'Admin'] as const
type Role = (typeof ROLES)[number]
const ROLE_HOME: Record<Role, string> = {
  Student: '/learn',
  Company: '/business',
  Instructor: '/studio',
  Admin: '/console',
}

function LoginForm({ role }: { role: Role }) {
  const navigate = useNavigate()
  const login = useLogin()
  const mfa = useMfaAuthenticate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [code, setCode] = useState('')
  const err = login.error instanceof AuthError ? login.error : null
  const destination = ROLE_HOME[role]
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
          mfa.mutate(code.replace(/\s/g, ''), { onSuccess: () => navigate(destination, { replace: true }) })
        }}
      >
        <p className="text-sm text-muted">Open your authenticator app and type the 6-digit code.</p>
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
    )
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        // Prepare the destination while the server verifies the password so the
        // next screen does not add another sequential wait after sign-in.
        if (role === 'Student') void import('@/pages/MyLearningPage')
        login.mutate({ email, password }, { onSuccess: (r) => (r === 'mfa' ? setStep('code') : navigate(destination, { replace: true })) })
      }}
    >
      {generalError ? (
        <p role="alert" className={cn('rounded-md px-3 py-2.5 text-sm', err?.pendingVerification ? 'bg-info-soft text-info' : 'bg-danger-soft text-danger')}>
          {generalError}
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
        // the chosen role is not sent to the backend yet (visual only — see NEEDS-USER UI-2)
        signup.mutate({ email, password }, { onSuccess: (r) => (r === 'verify-email' ? setSent(true) : navigate('/learn', { replace: true })) })
      }}
    >
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
          {(p) => <PasswordInput {...p} autoComplete="new-password" required minLength={minLength} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <PasswordStrength password={password} minLength={minLength} />
      </div>
      <Button type="submit" size="lg" loading={signup.isPending} className="w-full">
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
  const [role, setRole] = useState<Role>('Student')

  return (
    <div>
      {/* Shared by the desktop and mobile dialog. Keep the selected account type
          visible when logging in as well as when creating an account. */}
      <div className="mb-5">
        <span className="text-[13px] font-medium text-text">I'm a</span>
        <div role="radiogroup" aria-label="Role" className="mt-1.5 grid grid-cols-4 gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn('min-w-0 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors min-[380px]:px-1.5 min-[380px]:text-xs sm:px-2 sm:text-[13px]', role === r ? 'border-primary bg-primary-soft text-primary-soft-text' : 'border-border text-muted hover:text-text')}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div role="tablist" aria-label="Log in or create an account" className="mb-6 grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2/60 p-1">
        {(['login', 'signup'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', tab === t ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-text')}
          >
            {t === 'login' ? 'Log in' : 'Create account'}
          </button>
        ))}
      </div>
      {tab === 'login' ? <LoginForm role={role} /> : <SignupForm />}
    </div>
  )
}
