import * as P from '@radix-ui/react-progress'

import { cn } from '@/lib/cn'
import { useFill, useInView } from '@/lib/motion'

const tones = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }

/** Fills from empty when it scrolls into view. */
export function Progress({ value, tone = 'primary', className, label }: { value: number; tone?: keyof typeof tones; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  const [ref, seen] = useInView<HTMLDivElement>()
  const shown = useFill(v, seen)
  return (
    <P.Root ref={ref} value={v} aria-label={label} className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <P.Indicator className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tones[tone])} style={{ width: `${shown}%` }} />
    </P.Root>
  )
}
