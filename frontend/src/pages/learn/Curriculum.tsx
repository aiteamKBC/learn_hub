import { CheckCircle2, ChevronDown, Circle, Lock, PlayCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Player } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

import { kindOf, lectureUrl, minutes } from './shared'

/** The course outline beside the player: where you are, what's done, what's next. */
export function Curriculum({ player, current, onPick }: { player: Player; current?: string; onPick?: () => void }) {
  const holding = player.sections.find((s) => s.lectures.some((l) => l.key === current))?.id
  const [open, setOpen] = useState<Set<string>>(() => new Set(holding ? [holding] : player.sections.slice(0, 1).map((s) => s.id)))
  const active = useRef<HTMLAnchorElement>(null)

  // follow the learner: opening the next section and keeping the current row in view
  useEffect(() => {
    if (holding) setOpen((prev) => (prev.has(holding) ? prev : new Set(prev).add(holding)))
  }, [holding])
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <nav aria-label="Course content" className="divide-y divide-border">
      {player.sections.map((s, n) => {
        const done = s.lectures.filter((l) => l.completed).length
        const total = s.lectures.reduce((t, l) => t + l.duration_sec, 0)
        const isOpen = open.has(s.id)
        return (
          <section key={s.id}>
            <button type="button" onClick={() => toggle(s.id)} aria-expanded={isOpen} className="flex w-full items-start gap-3 bg-surface-2/60 px-4 py-3 text-left transition-colors hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">
                  Section {n + 1}: {s.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted tabular">
                  {done} / {s.lectures.length}
                  {total ? ` · ${minutes(total)}` : ''}
                </span>
              </span>
              <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted transition-transform duration-200', isOpen && 'rotate-180')} />
            </button>
            <div className={cn('grid transition-[grid-template-rows] duration-250 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
              <ul className="overflow-hidden">
                {s.lectures.map((l) => {
                  const here = l.key === current
                  const { Icon, label } = kindOf(l.kind)
                  return (
                    <li key={l.key}>
                      <Link
                        ref={here ? active : undefined}
                        to={lectureUrl(player.slug, l.key)}
                        onClick={onPick}
                        aria-current={here ? 'page' : undefined}
                        tabIndex={isOpen ? undefined : -1}
                        className={cn('relative flex gap-3 px-4 py-2.5 text-sm transition-colors', here ? 'bg-primary-soft text-text' : 'hover:bg-surface-2')}
                      >
                        {here ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" /> : null}
                        <span className="mt-0.5 shrink-0" aria-label={l.completed ? 'Completed' : l.locked ? 'Locked' : 'Not completed'}>
                          {l.completed ? <CheckCircle2 className="size-[18px] fill-success text-surface" /> : l.locked ? <Lock className="size-[18px] text-muted" /> : here ? <PlayCircle className="size-[18px] text-primary" /> : <Circle className="size-[18px] text-border-strong" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block leading-snug', here && 'font-medium')}>{l.title}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <Icon className="size-3.5" /> {label}
                            {l.duration_sec ? ` · ${minutes(l.duration_sec)}` : ''}
                          </span>
                          {l.locked && l.prerequisite_title ? <span className="mt-0.5 block text-xs text-muted">Finish “{l.prerequisite_title}” first</span> : null}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        )
      })}
    </nav>
  )
}
