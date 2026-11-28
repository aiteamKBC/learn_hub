import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({ title, description, children, className, side, hideHeader = false }: { title: string; description?: string; children: ReactNode; className?: string; side?: 'left' | 'right'; hideHeader?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
      <D.Content
        data-lenis-prevent
        className={cn(
          'fixed z-50 bg-surface shadow-lg focus:outline-none',
          side
            ? cn('inset-y-0 flex w-[min(320px,86vw)] flex-col', side === 'left' ? 'left-0 animate-slide-in-left border-r border-border data-[state=closed]:animate-slide-out-left' : 'right-0 animate-slide-in-right border-l border-border data-[state=closed]:animate-slide-out-right')
            : 'top-1/2 left-1/2 w-[calc(100vw-32px)] max-w-[640px] max-h-[calc(100dvh-32px)] overflow-y-auto -translate-x-1/2 -translate-y-1/2 animate-pop-in rounded-xl data-[state=closed]:animate-pop-out border border-border p-6',
          className,
        )}
      >
        <div className={cn('flex items-start justify-between gap-4', side && 'border-b border-border p-4', hideHeader && 'contents')}>
          <div className={cn(hideHeader && 'sr-only')}>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className={cn('-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text', hideHeader && 'absolute top-5 right-5 z-20 m-0 flex size-11 items-center justify-center rounded-full bg-[#f7f0ea] p-0 text-text shadow-sm hover:bg-primary-soft')} aria-label="Close">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className={cn(side ? 'flex-1 overflow-y-auto' : hideHeader ? 'mt-0' : 'mt-5')}>{children}</div>
      </D.Content>
    </D.Portal>
  )
}
