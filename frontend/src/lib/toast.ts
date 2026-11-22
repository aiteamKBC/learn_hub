import type { ReactNode } from 'react'

import { authAlert } from '@/lib/auth-alert'

/** Same call shape as sonner's `toast`, but every message shows as the SweetAlert-style
 * popup (<AuthAlertHost />). Success and info close by themselves; errors and warnings
 * stay until the person presses OK. */
type Opts = { description?: ReactNode; action?: { label: string; onClick: () => void }; duration?: number }
type Kind = 'success' | 'error' | 'info' | 'warning'

const AUTO: Record<Kind, number | undefined> = { success: 2200, info: 3000, error: undefined, warning: undefined }

function show(kind: Kind, title: ReactNode, o: Opts = {}) {
  authAlert({
    kind,
    title: String(title ?? ''),
    text: typeof o.description === 'string' ? o.description : undefined,
    action: o.action,
    autoClose: o.action ? undefined : (o.duration ?? AUTO[kind]),
  })
}

export const toast = Object.assign((title: ReactNode, o?: Opts) => show('info', title, o), {
  success: (title: ReactNode, o?: Opts) => show('success', title, o),
  error: (title: ReactNode, o?: Opts) => show('error', title, o),
  info: (title: ReactNode, o?: Opts) => show('info', title, o),
  warning: (title: ReactNode, o?: Opts) => show('warning', title, o),
})
