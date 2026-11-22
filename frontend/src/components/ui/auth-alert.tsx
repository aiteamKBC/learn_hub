import * as D from '@radix-ui/react-dialog'
import { AlertTriangle, Check, Info, Loader2, LogOut, ShoppingCart, Trash2, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { closeAuthAlert, getAuthAlert, subscribeAuthAlert } from '@/lib/auth-alert'
import { cn } from '@/lib/cn'

/** A SweetAlert-style popup for signing in and out: a big round icon, a title, a line of
 * text and one button. Built on the Radix dialog we already use (no new library), in
 * our colours, light and dark, and it respects reduced motion. Call `authAlert(...)`
 * from anywhere; <AuthAlertHost /> (in the app providers) shows it. */
const ICON = {
  success: { Icon: Check, ring: 'bg-success/15 text-success ring-success/30' },
  'signed-out': { Icon: LogOut, ring: 'bg-primary-soft text-primary-soft-text ring-primary/30' },
  loading: { Icon: Loader2, ring: 'bg-surface-2 text-muted ring-border' },
  cart: { Icon: ShoppingCart, ring: 'bg-success/15 text-success ring-success/30' },
  removed: { Icon: Trash2, ring: 'bg-danger-soft text-danger ring-danger/25' },
  error: { Icon: X, ring: 'bg-danger-soft text-danger ring-danger/25' },
  info: { Icon: Info, ring: 'bg-info-soft text-info ring-info/25' },
  warning: { Icon: AlertTriangle, ring: 'bg-warning-soft text-warning ring-warning/25' },
}

export function AuthAlertHost() {
  const a = useSyncExternalStore(subscribeAuthAlert, getAuthAlert)
  useEffect(() => {
    if (!a?.autoClose) return
    const t = window.setTimeout(closeAuthAlert, a.autoClose)
    return () => window.clearTimeout(t)
  }, [a])
  const { Icon, ring } = ICON[a?.kind ?? 'success']
  const busy = a?.kind === 'loading'
  return (
    <D.Root open={!!a} onOpenChange={(o) => !o && !busy && closeAuthAlert()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <D.Content
          aria-busy={busy || undefined}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-[60] grid w-[calc(100vw-32px)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 animate-pop-in justify-items-center gap-3 rounded-2xl border border-border bg-surface p-7 text-center shadow-lg focus:outline-none data-[state=closed]:animate-pop-out"
        >
          <span className={cn('flex size-16 items-center justify-center rounded-full ring-4', ring, !busy && 'motion-safe:animate-[pop-in_300ms_ease-out]')}>
            <Icon className={cn('size-8', busy && 'animate-spin motion-reduce:animate-none')} strokeWidth={2.5} />
          </span>
          <D.Title className="text-lg font-semibold">{a?.title}</D.Title>
          {a?.text ? <D.Description className="text-sm text-muted">{a.text}</D.Description> : <D.Description className="sr-only">{a?.title}</D.Description>}
          {busy ? null : (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {a?.action ? (
                <Button
                  onClick={() => {
                    const go = a.action!.onClick
                    closeAuthAlert()
                    go()
                  }}
                >
                  {a.action.label}
                </Button>
              ) : null}
              <D.Close asChild>
                <Button variant={a?.action ? 'secondary' : 'primary'} className="min-w-28">
                  {a?.action ? 'Keep browsing' : 'OK'}
                </Button>
              </D.Close>
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
