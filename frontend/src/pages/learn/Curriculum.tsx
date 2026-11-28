import { CheckCircle2, ChevronDown, Circle, FolderOpen, Lock, PlayCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Player } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

import { kindOf, lectureUrl, minutes } from './shared'

/** The course outline beside the player: where you are, what's done, what's next. */
export function Curriculum({ player, current, onPick, appearance = 'plain' }: { player: Player; current?: string; onPick?: () => void; appearance?: 'plain' | 'card' }) {
  const holding = player.sections.find((s) => s.lectures.some((l) => l.key === current))?.id
  const [open, setOpen] = useState<Set<string>>(() => new Set(holding ? [holding] : player.sections.slice(0, 1).map((s) => s.id)))
  const active = useRef<HTMLAnchorElement>(null)

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
    <nav aria-label="Course content" className={cn('divide-y divide-border', appearance === 'card' && 'px-3 pb-3')}>
      {player.sections.map((section, index) => {
        const done = section.lectures.filter((lecture) => lecture.completed).length
        const total = section.lectures.reduce((sum, lecture) => sum + lecture.duration_sec, 0)
        const isOpen = open.has(section.id)
        const complete = done === section.lectures.length && section.lectures.length > 0

        return (
          <section key={section.id} className={cn(appearance === 'card' && 'py-1.5 first:pt-0')}>
            <button
              type="button"
              onClick={() => toggle(section.id)}
              aria-expanded={isOpen}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                appearance === 'card'
                  ? cn('items-center rounded-xl hover:bg-surface-2', isOpen && 'bg-primary-soft/65')
                  : 'bg-surface-2/60 hover:bg-surface-2',
              )}
            >
              {appearance === 'card' ? <FolderOpen className="size-6 shrink-0 text-primary" strokeWidth={1.8} /> : null}
              <span className="min-w-0 flex-1">
                <span className={cn('block font-semibold', appearance === 'card' ? 'text-[15px]' : 'text-[13px]')}>
                  {appearance === 'card' ? 'Module' : 'Section'} {index + 1}: {section.title}
                </span>
                <span className={cn('mt-0.5 block text-xs text-muted tabular', appearance === 'card' && 'text-[13px]')}>
                  {done} / {section.lectures.length}{appearance === 'card' ? ' lessons' : ''}
                  {total ? ` · ${minutes(total)}` : ''}
                </span>
              </span>
              {appearance === 'card' && complete ? <CheckCircle2 className="size-5 shrink-0 fill-success text-white" /> : null}
              <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted transition-transform duration-200', isOpen && 'rotate-180')} />
            </button>

            <div className={cn('grid transition-[grid-template-rows] duration-250 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
              <ul className="overflow-hidden">
                {section.lectures.map((lecture) => {
                  const here = lecture.key === current
                  const { Icon, label } = kindOf(lecture.kind)
                  return (
                    <li key={lecture.key}>
                      <Link
                        ref={here ? active : undefined}
                        to={lectureUrl(player.slug, lecture.key)}
                        onClick={onPick}
                        aria-current={here ? 'page' : undefined}
                        tabIndex={isOpen ? undefined : -1}
                        className={cn(
                          'relative flex gap-3 px-4 py-2.5 text-sm transition-colors',
                          appearance === 'card' && 'mx-3 my-1 rounded-xl py-3',
                          here ? 'bg-primary-soft text-text' : 'hover:bg-surface-2',
                        )}
                      >
                        {here && appearance !== 'card' ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" /> : null}
                        <span className="mt-0.5 shrink-0" aria-label={lecture.completed ? 'Completed' : lecture.locked ? 'Locked' : 'Not completed'}>
                          {lecture.completed ? <CheckCircle2 className="size-[18px] fill-success text-white" /> : lecture.locked ? <Lock className="size-[18px] text-muted" /> : here ? <PlayCircle className="size-[18px] text-primary" /> : <Circle className="size-[18px] text-border-strong" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block leading-snug', here && 'font-semibold')}>{lecture.title}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <Icon className="size-3.5" /> {label}
                            {lecture.duration_sec ? ` · ${minutes(lecture.duration_sec)}` : ''}
                          </span>
                          {lecture.locked && lecture.prerequisite_title ? <span className="mt-0.5 block text-xs text-muted">Finish “{lecture.prerequisite_title}” first</span> : null}
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
