/** The SweetAlert-style popup's state (shown by <AuthAlertHost />): sign in and out,
 * and quick confirmations such as the cart. */
export type AuthAlert = {
  kind: 'success' | 'loading' | 'signed-out' | 'cart' | 'removed' | 'error' | 'info' | 'warning'
  title: string
  text?: string
  autoClose?: number
  /** a second button next to OK, e.g. "View cart" */
  action?: { label: string; onClick: () => void }
} | null

let current: AuthAlert = null
const listeners = new Set<() => void>()
const set = (a: AuthAlert) => {
  current = a
  listeners.forEach((l) => l())
}
export const authAlert = (a: NonNullable<AuthAlert>) => set(a)
export const closeAuthAlert = () => set(null)
export const getAuthAlert = () => current
export const subscribeAuthAlert = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
