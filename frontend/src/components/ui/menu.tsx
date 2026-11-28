import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronRight } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

export const Menu = M.Root
export const MenuTrigger = M.Trigger
export const MenuGroup = M.Group
export const MenuSub = M.Sub

export function MenuContent({ className, align = 'end', ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={8}
        className={cn('z-50 min-w-52 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-border bg-surface p-1 shadow-lg data-[state=closed]:animate-menu-out data-[state=open]:animate-menu-in', className)}
        {...props}
      />
    </M.Portal>
  )
}

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted',
        className,
      )}
      {...props}
    />
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2.5 py-1.5 text-xs font-medium text-subtle', className)} {...props} />
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />
}

export function MenuSubTrigger({ className, children, ...props }: ComponentProps<typeof M.SubTrigger>) {
  return (
    <M.SubTrigger
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none data-[state=open]:bg-surface-2 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </M.SubTrigger>
  )
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent
        sideOffset={6}
        alignOffset={-5}
        className={cn('z-[60] min-w-56 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-border bg-surface p-1 shadow-lg data-[state=closed]:animate-menu-out data-[state=open]:animate-menu-in', className)}
        {...props}
      />
    </M.Portal>
  )
}

export const MenuRadioGroup = M.RadioGroup
export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem
      className={cn('flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-primary [&_svg]:size-4', className)}
      {...props}
    >
      {children}
    </M.RadioItem>
  )
}
