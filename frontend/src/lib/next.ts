/** Only same-site paths are followed after sign-in (no open redirects). */
export function safeNext(v: string | null) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/learn'
}

// The confirmation email opens in a new tab and loses `?next=`, so an invite waiting for a
// new account is remembered in this browser until it is accepted.
const PENDING_INVITE = 'pending-invite'
export const rememberInvite = (path: string) => localStorage.setItem(PENDING_INVITE, path)
export const forgetInvite = () => localStorage.removeItem(PENDING_INVITE)
export function pendingInvite(): string | null {
  const v = localStorage.getItem(PENDING_INVITE)
  return v && v.startsWith('/invite/') ? v : null
}
