import { ArrowRight, BookOpen, Search, Tag, UserRound, X } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { type SearchIn, useCourses } from '@/features/catalog/api'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { useNavigate } from '@/lib/router'

const SCOPES: { k: SearchIn; label: string; Icon: typeof BookOpen; placeholder: string }[] = [
  { k: 'courses', label: 'Courses', Icon: BookOpen, placeholder: 'Search course names' },
  { k: 'instructors', label: 'Instructors', Icon: UserRound, placeholder: 'Search by instructor name' },
  { k: 'topics', label: 'Topics', Icon: Tag, placeholder: 'Search by topic, e.g. Design' },
]
const isScope = (v: string | null): v is SearchIn => SCOPES.some((s) => s.k === v)

/** The header search. Pick what to search (courses, instructors or topics), then type:
 * matching courses show straight away from the real catalogue. Arrow keys move, Enter
 * opens the highlighted course, or the full results page when nothing is highlighted. */
export function SearchBox({ className, autoFocus, overlay, placeholder }: { className?: string; autoFocus?: boolean; overlay?: boolean; placeholder?: string }) {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [scope, setScope] = useState<SearchIn>(isScope(params.get('in')) ? (params.get('in') as SearchIn) : 'courses')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const navigate = useNavigate()
  const wrap = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const term = useDebounced(q.trim(), 250)
  const enabled = term.length >= 1
  const { data, isPending, isError } = useCourses({ q: term, search_in: scope, limit: 6 }, enabled, false)
  const items = enabled ? (data?.items ?? []) : []
  const current = SCOPES.find((s) => s.k === scope)!

  useEffect(() => setActive(-1), [term, scope])
  useEffect(() => {
    const away = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  const all = () => go(q.trim() ? `/courses?q=${encodeURIComponent(q.trim())}&in=${scope}` : '/courses')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (open && active >= 0 && items[active]) go(`/courses/${items[active].slug}`)
    else all()
  }
  const pick = (k: SearchIn) => {
    setScope(k)
    input.current?.focus()
  }
  // the line under a course title says why it matched
  const why = (c: (typeof items)[number]) =>
    scope === 'instructors' ? c.instructors.filter((n) => n.toLowerCase().includes(term.toLowerCase())).join(', ') || c.instructors.join(', ') : scope === 'topics' ? c.category : null

  return (
    <form ref={wrap} role="search" onSubmit={submit} className={cn('relative', className)}>
      <div className="group relative">
        <Search aria-hidden className={cn('pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 transition-colors', overlay ? 'text-white/70' : 'text-muted group-focus-within:text-primary')} />
        <input
          ref={input}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setOpen(false)
            if (!open || !items.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % items.length)
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
            }
          }}
          placeholder={open ? current.placeholder : placeholder ?? 'Search for courses, topics or instructors'}
          aria-label={`Search ${current.label.toLowerCase()}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          className={cn(
            'h-10 w-full rounded-full border pr-10 pl-10 text-sm transition-[box-shadow,border-color,background-color] duration-200 outline-none focus:ring-4 focus:ring-primary/15',
            overlay ? 'border-white/25 bg-white/10 text-white placeholder:text-white/60 focus:border-white/60' : 'border-border bg-surface-2/80 text-text placeholder:text-subtle focus:border-primary focus:bg-surface',
          )}
        />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => (setQ(''), input.current?.focus())} className={cn('absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors', overlay ? 'text-white/70 hover:bg-white/15' : 'text-muted hover:bg-surface-2 hover:text-text')}>
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute inset-x-0 top-full z-50 mt-2 animate-pop-in overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-xl">
          <div role="radiogroup" aria-label="Search in" className="flex items-center gap-1.5 border-b border-border p-2">
            <span className="px-1.5 text-xs font-medium text-subtle">Search in</span>
            {SCOPES.map(({ k, label, Icon }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={scope === k}
                onClick={() => pick(k)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200',
                  scope === k ? 'border-primary bg-primary-soft text-primary-soft-text' : 'border-border text-muted hover:border-text/30 hover:text-text',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          <ul id={listId} role="listbox" aria-label={`Matching ${current.label.toLowerCase()}`} className="max-h-[60vh] overflow-y-auto p-1.5">
            {!enabled ? (
              <li className="px-3 py-4 text-center text-sm text-muted">Start typing to search {current.label.toLowerCase()}.</li>
            ) : isPending ? (
              [0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-10 w-16 rounded-md" />
                  <Skeleton className="h-3.5 flex-1" />
                </li>
              ))
            ) : isError ? (
              <li className="px-3 py-4 text-center text-sm text-muted">Search is not working right now. Press Enter to try the full list.</li>
            ) : !items.length ? (
              <li className="px-3 py-4 text-center text-sm text-muted">
                No {current.label.toLowerCase()} match <span className="font-medium text-text">“{term}”</span>.
              </li>
            ) : (
              items.map((c, i) => {
                const sub = why(c)
                return (
                  <li
                    key={c.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={active === i}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => go(`/courses/${c.slug}`)}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={cn('flex animate-reveal cursor-pointer items-center gap-3 rounded-xl p-2 transition-colors', active === i ? 'bg-primary-soft' : 'hover:bg-surface-2')}
                  >
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                        <current.Icon className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      {sub ? <p className="truncate text-xs text-muted">{sub}</p> : null}
                    </div>
                  </li>
                )
              })
            )}
          </ul>
          {enabled ? (
            <button type="button" onClick={all} className="flex w-full items-center justify-between border-t border-border px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-surface-2">
              See all {current.label.toLowerCase()} results for “{q.trim()}” <ArrowRight className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
