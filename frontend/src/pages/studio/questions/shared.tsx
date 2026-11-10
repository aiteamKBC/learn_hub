import type { KeyboardEvent } from 'react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

/** A short preview of text that may hold (sanitised) markup. */
export function preview(text: string) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Two-option segmented control (a radio group with arrow keys). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const checked = options.findIndex((o) => o.value === value)
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-sm">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={radioTabIndex(i, checked)}
          onKeyDown={(e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, i, options.length, (j) => onChange(options[j]!.value))}
          onClick={() => onChange(o.value)}
          className={cn('h-8 rounded px-3 text-[13px] font-medium transition-colors', o.value === value ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="grid gap-3 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[76px]" />
      ))}
    </Card>
  )
}
