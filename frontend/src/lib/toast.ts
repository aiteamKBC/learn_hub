import type { ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'

import { authAlert } from '@/lib/auth-alert'

/** Outcomes that need acknowledgement use the centred EvidRise dialog. Passive information
 * stays a small non-blocking toast so ordinary navigation and status updates never interrupt. */
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

function notice(title: ReactNode, o: Opts = {}) {
  return sonnerToast(title, {
    description: o.description,
    action: o.action,
    duration: o.duration ?? AUTO.info,
  })
}

export const toast = Object.assign((title: ReactNode, o?: Opts) => notice(title, o), {
  success: (title: ReactNode, o?: Opts) => show('success', title, o),
  error: (title: ReactNode, o?: Opts) => show('error', title, o),
  info: (title: ReactNode, o?: Opts) => notice(title, o),
  message: (title: ReactNode, o?: Opts) => notice(title, o),
  warning: (title: ReactNode, o?: Opts) => show('warning', title, o),
})
