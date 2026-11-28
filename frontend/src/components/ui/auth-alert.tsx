import * as D from '@radix-ui/react-dialog'
import { AlertTriangle, Check, Info, Loader2, LogOut, ShoppingCart, Trash2, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { closeAuthAlert, getAuthAlert, subscribeAuthAlert } from '@/lib/auth-alert'
import { cn } from '@/lib/cn'

/** The single visual language for feedback across the product. Every toast and account
 * alert is routed here so success, error, warning and information messages all share
 * the same EvidRise dialog instead of mixing browser alerts and floating toasts. */
const ICON = {
  success: { Icon: Check, ring: 'bg-success/10 text-success ring-success/20' },
  'signed-out': { Icon: LogOut, ring: 'bg-primary-soft text-primary ring-primary/20' },
  loading: { Icon: Loader2, ring: 'bg-surface-2 text-muted ring-border/80' },
  cart: { Icon: ShoppingCart, ring: 'bg-success/10 text-success ring-success/20' },
  removed: { Icon: Trash2, ring: 'bg-danger-soft text-danger ring-danger/20' },
  error: { Icon: X, ring: 'bg-danger-soft text-danger ring-danger/20' },
  info: { Icon: Info, ring: 'bg-info-soft text-info ring-info/20' },
  warning: { Icon: AlertTriangle, ring: 'bg-warning-soft text-warning ring-warning/20' },
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
        <D.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[3px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <D.Content
          aria-busy={busy || undefined}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-[60] grid w-[calc(100vw-32px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 animate-pop-in justify-items-center overflow-hidden rounded-[24px] border border-white/70 bg-surface px-6 py-7 text-center shadow-[0_24px_70px_rgba(0,0,0,.26)] focus:outline-none sm:px-8 sm:py-8 data-[state=closed]:animate-pop-out"
        >
          <span aria-hidden className="pointer-events-none absolute -top-24 -left-24 size-48 rounded-full border-[18px] border-primary/[.055]" />
          <span aria-hidden className="pointer-events-none absolute -top-14 -left-14 size-32 rounded-full border-[12px] border-primary/[.045]" />
          <span aria-hidden className="pointer-events-none absolute -right-28 -bottom-28 size-56 rounded-full border-[18px] border-primary/[.055]" />
          <span aria-hidden className="pointer-events-none absolute -right-16 -bottom-16 size-36 rounded-full border-[12px] border-primary/[.045]" />

          {!busy ? (
            <D.Close className="absolute top-3.5 right-3.5 z-20 flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="Close alert">
              <X className="size-5" strokeWidth={1.9} />
            </D.Close>
          ) : null}

          <span className={cn('relative z-10 flex size-16 items-center justify-center rounded-full ring-[5px] sm:size-[72px]', ring, !busy && 'motion-safe:animate-[pop-in_300ms_ease-out]')}>
            <Icon className={cn('size-8 sm:size-9', busy && 'animate-spin motion-reduce:animate-none')} strokeWidth={2.25} />
          </span>
          <D.Title className="relative z-10 mt-4 max-w-[380px] text-balance text-xl font-semibold tracking-[-0.02em] text-text sm:text-2xl sm:leading-tight">{a?.title}</D.Title>
          {a?.text ? <D.Description className="relative z-10 mt-1.5 max-w-[390px] text-pretty text-sm leading-6 text-muted sm:text-[15px]">{a.text}</D.Description> : <D.Description className="sr-only">{a?.title}</D.Description>}
          {busy ? null : (
            <div className="relative z-10 mt-5 flex w-full max-w-[340px] flex-col-reverse justify-center gap-2.5 sm:flex-row">
              <D.Close asChild>
                <Button variant={a?.action ? 'secondary' : 'primary'} className={cn('h-11 rounded-full px-7 text-sm font-semibold', !a?.action && 'w-full bg-gradient-to-r from-[#ff8a1f] to-[#f36b00] text-white shadow-[0_8px_20px_rgba(247,111,13,.2)] hover:from-[#f98017] hover:to-[#e96300] sm:min-w-48')}>
                  {a?.action ? 'Keep browsing' : 'Continue'}
                </Button>
              </D.Close>
              {a?.action ? (
                <Button
                  className="h-11 rounded-full bg-gradient-to-r from-[#ff8a1f] to-[#f36b00] px-7 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(247,111,13,.2)] hover:from-[#f98017] hover:to-[#e96300]"
                  onClick={() => {
                    const go = a.action!.onClick
                    closeAuthAlert()
                    go()
                  }}
                >
                  {a.action.label}
                </Button>
              ) : null}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
