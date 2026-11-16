/**
 * Star Border (React Bits–style): a thin animated gradient ring that travels around a
 * rounded element. Decorative wrapper — put the real button inside. Still under reduced
 * motion (the ring just doesn't move).
 */
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function StarBorder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-flex rounded-full p-[1.5px]', className)}>
      <span aria-hidden className="absolute inset-0 overflow-hidden rounded-full">
        <span
          className="absolute top-1/2 left-1/2 size-[220%] -translate-x-1/2 -translate-y-1/2 opacity-90 motion-safe:animate-[star-spin_4s_linear_infinite]"
          style={{ background: 'conic-gradient(from 0deg, transparent 0 62%, #f3a964 78%, #ffffff 85%, #ea802d 92%, transparent 100%)' }}
        />
      </span>
      <span className="relative z-10 inline-flex rounded-full">{children}</span>
    </span>
  )
}
