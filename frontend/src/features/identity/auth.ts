/** Sign-in through django-allauth's headless API (browser client: session cookie + CSRF).
 * https://docs.allauth.org/en/latest/headless/openapi-specification/ */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, csrfToken, unwrap } from '@/api/client'
import { forgetInvite } from '@/lib/next'

const BASE = '/_allauth/browser/v1'

type AllauthResponse = {
  status: number
  data?: Record<string, unknown> & { flows?: { id: string; is_pending?: boolean }[] }
  meta?: { is_authenticated?: boolean }
  errors?: { message: string; code: string; param?: string }[]
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<AllauthResponse> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({ status: res.status }))) as AllauthResponse
  return { ...json, status: res.status }
}

export type Me = Awaited<ReturnType<typeof fetchMe>>
const fetchMe = () => unwrap(api.GET('/api/v1/identity/me'))

/** The signed-in person (with their company memberships), or null for visitors. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await fetchMe()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => (await call('GET', '/config')).data as { socialaccount?: { providers: { id: string; name: string }[] } },
    staleTime: Infinity,
  })
}

export class AuthError extends Error {
  fields: Record<string, string>
  pendingVerification: boolean
  constructor(message: string, fields: Record<string, string> = {}, pendingVerification = false) {
    super(message)
    this.fields = fields
    this.pendingVerification = pendingVerification
  }
}

function raise(r: AllauthResponse): never {
  const fields: Record<string, string> = {}
  for (const e of r.errors ?? []) if (e.param) fields[e.param] = e.message
  const pending = r.status === 401 && !!r.data?.flows?.some((f) => f.id === 'verify_email' && f.is_pending)
  throw new AuthError(
    pending ? 'Check your inbox: confirm your email address to finish signing in.' : (r.errors?.[0]?.message ?? 'Something went wrong. Please try again.'),
    fields,
    pending,
  )
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { email: string; password: string }): Promise<'signed-in' | 'mfa'> => {
      const r = await call('POST', '/auth/login', v)
      // 2-step sign-in: the password was right, now the code from the authenticator app
      if (r.status === 401 && r.data?.flows?.some((f) => f.id === 'mfa_authenticate' && f.is_pending)) return 'mfa'
      if (r.status !== 200) raise(r)
      return 'signed-in'
    },
    // refetch even when no screen is showing the user yet (the sign-in page), so the
    // next page already knows who is signed in
    onSuccess: (r) => (r === 'signed-in' ? qc.refetchQueries({ queryKey: ['me'], type: 'all' }) : undefined),
  })
}

/** Second step of sign-in: a 6-digit code from the app, or one of the recovery codes. */
export function useMfaAuthenticate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const r = await call('POST', '/auth/2fa/authenticate', { code })
      if (r.status !== 200) raise(r)
    },
    onSuccess: () => qc.refetchQueries({ queryKey: ['me'], type: 'all' }),
  })
}

// ---------------------------------------------------------------- 2-step sign-in (account)
export type Totp = { type: 'totp'; created_at: number; last_used_at: number | null }

/** The person's authenticators: whether 2-step sign-in is on, and recovery codes left. */
export function useAuthenticators(enabled = true) {
  return useQuery({
    queryKey: ['mfa', 'authenticators'],
    queryFn: async () => {
      const r = await call('GET', '/account/authenticators')
      if (r.status !== 200) raise(r)
      const list = (r.data as unknown as { type: string; unused_code_count?: number; total_code_count?: number }[]) ?? []
      return { totp: list.some((a) => a.type === 'totp'), recoveryLeft: list.find((a) => a.type === 'recovery_codes')?.unused_code_count ?? null }
    },
    enabled,
  })
}

/** A new secret to add to the authenticator app (only while 2-step sign-in is off). */
export async function startTotp(): Promise<{ secret: string; totp_url: string }> {
  const r = await call('GET', '/account/authenticators/totp')
  const meta = (r as unknown as { meta?: { secret?: string; totp_url?: string } }).meta
  if (r.status === 404 && meta?.secret) return { secret: meta.secret, totp_url: meta.totp_url ?? '' }
  raise(r)
}

/** allauth asks for the password again before security changes. */
export async function reauthenticate(password: string) {
  const r = await call('POST', '/auth/reauthenticate', { password })
  if (r.status !== 200) raise(r)
}

function needsReauth(r: AllauthResponse) {
  return r.status === 401 && !!r.data?.flows?.some((f) => f.id === 'reauthenticate')
}
export class ReauthNeeded extends Error {}

export function useActivateTotp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const r = await call('POST', '/account/authenticators/totp', { code })
      if (needsReauth(r)) throw new ReauthNeeded('Enter your password to continue.')
      if (r.status !== 200) raise(r)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfa'] }),
  })
}

export function useDeactivateTotp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await call('DELETE', '/account/authenticators/totp')
      if (needsReauth(r)) throw new ReauthNeeded('Enter your password to continue.')
      if (r.status !== 200) raise(r)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfa'] }),
  })
}

/** Recovery codes: shown once after they are made; making new ones replaces the old. */
export async function recoveryCodes(regenerate = false): Promise<string[]> {
  const r = regenerate ? await call('POST', '/account/authenticators/recovery-codes') : await call('GET', '/account/authenticators/recovery-codes')
  if (needsReauth(r)) throw new ReauthNeeded('Enter your password to continue.')
  if (r.status !== 200) raise(r)
  return ((r.data as { unused_codes?: string[] } | undefined)?.unused_codes ?? []) as string[]
}

export function useSignup() {
  return useMutation({
    mutationFn: async (v: { email: string; password: string }) => {
      const r = await call('POST', '/auth/signup', v)
      if (r.status === 200) return 'signed-in'
      if (r.status === 401 && r.data?.flows?.some((f) => f.id === 'verify_email')) return 'verify-email'
      raise(r)
    },
  })
}

/** Forgot password: email a reset link. Answers the same whether or not the address has
 * an account (no account probing), so the page always says "check your inbox". */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const r = await call('POST', '/auth/password/request', { email })
      if (r.status !== 200) raise(r)
    },
  })
}

/** Is the reset link still good? (expired, used or changed links are refused) */
export function useResetKey(key: string) {
  return useQuery({
    queryKey: ['password-reset-key', key],
    queryFn: async () => (await call('GET', '/auth/password/reset', undefined, { 'X-Password-Reset-Key': key })).status === 200,
    retry: false,
    staleTime: Infinity,
  })
}

/** Set the new password from the emailed link. allauth answers 401 when the password was
 * changed but the person still has to log in (we don't sign in from a reset link). */
export function useResetPassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { key: string; password: string }): Promise<'signed-in' | 'log-in'> => {
      const r = await call('POST', '/auth/password/reset', v)
      if (r.status === 200) return 'signed-in'
      if (r.status === 401) return 'log-in'
      raise(r)
    },
    onSuccess: (r) => (r === 'signed-in' ? qc.refetchQueries({ queryKey: ['me'], type: 'all' }) : undefined),
  })
}

export function useVerifyEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await call('POST', '/auth/email/verify', { key })
      if (r.status !== 200 && r.status !== 401) raise(r)
      return r.status === 200
    },
    // refetch even when no screen is showing the user yet (the sign-in page), so the
    // next page already knows who is signed in
    onSuccess: () => qc.refetchQueries({ queryKey: ['me'], type: 'all' }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => call('DELETE', '/auth/session'),
    onSettled: () => {
      // an invitation waiting in this browser belongs to whoever was signed in
      forgetInvite()
      qc.clear()
      void qc.invalidateQueries()
    },
  })
}

/** Google / Microsoft: allauth expects a real form POST so the browser follows the redirect. */
export function providerRedirect(provider: string, next = '/') {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${BASE}/auth/provider/redirect`
  const fields = { provider, process: 'login', callback_url: `${location.origin}/account/provider/callback?next=${encodeURIComponent(next)}`, csrfmiddlewaretoken: csrfToken() }
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

/** Whether the account has a password yet (people who joined with Google or Microsoft may not). */
export function useHasPassword() {
  return useQuery({
    queryKey: ['has-password'],
    queryFn: async () => {
      const r = await call('GET', '/auth/session')
      return (r.data?.user as { has_usable_password?: boolean } | undefined)?.has_usable_password ?? true
    },
    staleTime: 5 * 60_000,
  })
}

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { current_password?: string; new_password: string }) => {
      const r = await call('POST', '/account/password/change', v)
      if (r.status !== 200) raise(r)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['has-password'] }),
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { full_name?: string | null; timezone?: string | null; preferred_currency?: string | null }) => unwrap(api.PATCH('/api/v1/identity/me', { body })),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  })
}
