import { ChevronDown, Flag, ListVideo } from 'lucide-react'
import { useState } from 'react'

import { clock, seekTo, usePlayheadSec } from '@/features/learning/bunny'
import type { Lecture } from '@/features/learning/api'
import { cn } from '@/lib/cn'

const COLLAPSED = 4 // parts shown before "Show all"

/**
 * The video's parts (Bunny chapters) and key moments, set by the instructor, listed under
 * Bunny's own player. Clicking one jumps the video there; the part playing is highlighted.
 */
export function VideoMarks({ lecture }: { lecture: Lecture }) {
  const parts = lecture.parts ?? []
  const moments = lecture.moments ?? []
  const now = usePlayheadSec(lecture.key)
  const [open, setOpen] = useState(false)
  if (!parts.length && !moments.length) return null

  // the part playing: the last one that has started
  const current = now == null ? -1 : parts.reduce((at, p, i) => (p.start <= now ? i : at), -1)
  const many = parts.length > COLLAPSED
  const shown = many && !open ? parts.slice(0, COLLAPSED) : parts
  const jump = (sec: number) => void seekTo(lecture.key, sec)

  return (
    <div className="border-b border-border bg-surface px-4 py-3 sm:px-6">
      {parts.length ? (
        <section aria-label="Parts of this video">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <ListVideo className="size-3.5" /> Parts
          </h2>
          <ol className="stagger mt-2 grid gap-1 sm:grid-cols-2">
            {shown.map((p, i) => (
              <li key={`${p.start}-${i}`} className="min-w-0">
                <button
                  type="button"
                  onClick={() => jump(p.start)}
                  aria-label={`Jump to part ${i + 1}: ${p.title} at ${clock(p.start)}`}
                  aria-current={i === current ? 'step' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                    i === current && 'bg-primary-soft text-primary-soft-text hover:bg-primary-soft',
                  )}
                >
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular', i === current ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted')}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  <span className="shrink-0 text-xs tabular text-muted">{clock(p.start)}</span>
                </button>
              </li>
            ))}
          </ol>
          {many ? (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary hover:underline">
              <ChevronDown className={cn('size-3.5 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
              {open ? 'Show fewer' : `Show all ${parts.length} parts`}
            </button>
          ) : null}
        </section>
      ) : null}

      {moments.length ? (
        <section aria-label="Key moments" className={cn(parts.length && 'mt-3')}>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Flag className="size-3.5" /> Key moments
          </h2>
          <ul className="stagger mt-2 flex flex-wrap gap-1.5">
            {moments.map((m, i) => (
              <li key={`${m.timestamp}-${i}`} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => jump(m.timestamp)}
                  aria-label={`Jump to ${m.label} at ${clock(m.timestamp)}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs transition-colors duration-200 hover:border-primary hover:bg-primary-soft hover:text-primary-soft-text focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  <span className="font-semibold tabular text-primary">{clock(m.timestamp)}</span>
                  <span className="truncate">{m.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
