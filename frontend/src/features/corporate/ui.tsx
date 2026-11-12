/** Shared pieces for the corporate pages: status badges, a person picker and one
 * loading / error / empty wrapper so every list behaves the same. */
import { Search, UserRound } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input, Label } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounced } from '@/features/org/ui'
import { usePeopleSearch } from '@/features/org/api'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'primary'

export function StatusBadge({ map, status }: { map: Record<string, { label: string; tone: Tone }>; status: string }) {
  const s = map[status] ?? { label: status.replaceAll('_', ' '), tone: 'neutral' as const }
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  )
}

/** Loading → skeleton, error → retry, empty → message, then the content cross-fades in. */
export function QueryBlock<T>({
  query,
  empty,
  rows = 4,
  children,
}: {
  query: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }
  empty?: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }
  rows?: number
  children: (data: T) => ReactNode
}) {
  if (query.error) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  if (query.isLoading || query.data === undefined)
    return (
      <div className="grid gap-3 p-5" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  if (empty && Array.isArray(query.data) && query.data.length === 0) return <EmptyState {...empty} />
  return <div className="animate-reveal">{children(query.data)}</div>
}

/** Search the company's people and pick one (returns their user id). */
export function PersonPicker({
  label,
  exclude = [],
  onPick,
  disabled,
}: {
  label: string
  exclude?: string[]
  onPick: (p: { user_id: string; name: string; email: string }) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim())
  const people = usePeopleSearch(term, !disabled)
  const list = (people.data?.items ?? []).filter((p) => !exclude.includes(p.user_id)).slice(0, 8)
  const inputId = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" disabled={disabled} autoComplete="off" />
      <ul className="grid max-h-64 gap-1 overflow-y-auto" aria-label="Matching people" aria-live="polite">
        {people.isLoading ? (
          <li>
            <Skeleton className="h-10" />
          </li>
        ) : list.length === 0 ? (
          <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
            <UserRound className="size-4" /> {term ? 'Nobody matches that search.' : 'Nobody else to add.'}
          </li>
        ) : (
          list.map((p) => (
            <li key={p.user_id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick({ user_id: p.user_id, name: p.name, email: p.email })}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150',
                  'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-50',
                )}
              >
                <Avatar name={p.name || p.email} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name || p.email}</span>
                  <span className="block truncate text-xs text-muted">{p.email}</span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

