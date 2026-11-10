import { BookOpen, GraduationCap, LifeBuoy, Loader2, Receipt, ScrollText, Search, Users } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { useNavigate } from '@/lib/router'

import { useConsoleSearch } from './api'

const ICONS = { students: Users, instructors: GraduationCap, courses: BookOpen, orders: Receipt, tickets: LifeBuoy, certificates: ScrollText } as const

/**
 * The console header search (mockup 26): users, instructors, courses, orders, tickets and
 * certificates in groups. A combobox: arrow keys move through the results, Enter opens
 * one, Escape closes the list.
 */
export function ConsoleSearch() {
  const navigate = useNavigate()
  const listId = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(q, 200)
  const { data, isFetching } = useConsoleSearch(debounced)
  const box = useRef<HTMLDivElement>(null)

  const flat = useMemo(() => (data && debounced.trim().length >= 2 ? data.groups.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.key }))) : []), [data, debounced])
  useEffect(() => setActive(0), [debounced])
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function go(url: string) {
    setOpen(false)
    setQ('')
    navigate(url)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') return setOpen(false)
    if (!flat.length) return
    if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => (a + 1) % flat.length))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => (a - 1 + flat.length) % flat.length))
    else if (e.key === 'Enter') (e.preventDefault(), go(flat[active]!.url))
  }

  const showList = open && debounced.trim().length >= 2
  let i = -1
  return (
    <div ref={box} className="relative" role="search">
      <Input
        icon={isFetching ? <Loader2 className="animate-spin" /> : <Search />}
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search users, courses, orders or tickets"
        aria-label="Search the console"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && flat.length ? `${listId}-${active}` : undefined}
        className="bg-surface-2/60"
      />
      {showList ? (
        <div id={listId} role="listbox" aria-label="Search results" className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[70vh] min-w-[min(28rem,90vw)] animate-pop-in overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-lg">
          {data && !data.groups.length && !isFetching ? <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{debounced.trim()}”.</p> : null}
          {data?.groups.map((g) => {
            const Icon = ICONS[g.key as keyof typeof ICONS] ?? Search
            return (
              <div key={g.key} role="group" aria-label={g.label} className="py-1">
                <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-subtle uppercase">{g.label}</p>
                {g.hits.map((h) => {
                  i += 1
                  const idx = i
                  return (
                    <div
                      key={h.id}
                      id={`${listId}-${idx}`}
                      role="option"
                      aria-selected={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => (e.preventDefault(), go(h.url))}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm', idx === active ? 'bg-primary-soft text-primary-soft-text' : 'hover:bg-surface-2')}
                    >
                      <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{h.title}</span>
                        <span className="block truncate text-xs text-muted">{h.subtitle}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
