import * as T from '@radix-ui/react-tabs'
import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

export const Tabs = T.Root

type TabsListProps = ComponentProps<typeof T.List> & {
  /** Set to false when the page uses a static underline on each trigger. */
  indicator?: boolean
}

/** The active underline slides between tabs instead of jumping. */
export function TabsList({ className, children, indicator = true, ...props }: TabsListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const list = ref.current
    if (!list) return
    const place = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (active) setBar({ left: active.offsetLeft, width: active.offsetWidth })
    }
    place()
    const mo = new MutationObserver(place)
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] })
    const ro = new ResizeObserver(place)
    ro.observe(list)
    return () => (mo.disconnect(), ro.disconnect())
  }, [])
  return (
    <T.List ref={ref} className={cn('relative flex gap-1 overflow-x-auto border-b border-border scrollbar-none', className)} {...props}>
      {children}
      {indicator && bar ? <span aria-hidden className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-[left,width] duration-250 ease-out" style={{ left: bar.left, width: bar.width }} /> : null}
    </T.List>
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-10 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-text data-[state=active]:text-primary [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('animate-reveal pt-5 focus-visible:outline-none', className)} {...props} />
}
