import { cn } from '@/lib/cn'

const DELIVERY_TABS = [['', 'All courses'], ['recorded', 'Recorded courses'], ['live', 'Live courses'], ['both', 'Recorded and live']] as const

/** All / Recorded / Live: how the platform admin offers each course (a course can be both). */
export function DeliveryTabs({ value, onChange, className }: { value: string; onChange: (v: '' | 'recorded' | 'live' | 'both') => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Course type" className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface/85 p-1 shadow-sm backdrop-blur-sm', className)}>
      {DELIVERY_TABS.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 sm:px-4', value === v ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-text')}>
          {label}
        </button>
      ))}
    </div>
  )
}
