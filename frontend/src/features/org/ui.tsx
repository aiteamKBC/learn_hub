import { Check, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'
import { useFill, useInView } from '@/lib/motion'

import { ROLE_LABEL, ROLE_TONE, type Unit, unitLevel } from './api'

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? 'neutral'}>{ROLE_LABEL[role] ?? role}</Badge>
}

/** compliant / total as a small bar that fills in view, plus the overdue count. */
export function ComplianceMiniBar({ compliant, total, overdue }: { compliant: number; total: number; overdue: number }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const pct = total ? (compliant / total) * 100 : 0
  const shown = useFill(pct, seen)
  if (!total) return <span className="text-xs text-subtle">No requirements</span>
  const tone = overdue ? 'var(--chart-4)' : pct >= 85 ? 'var(--chart-2)' : 'var(--chart-3)'
  return (
    <div ref={ref} className="flex min-w-[120px] items-center gap-2">
      <Tooltip content={`${compliant} of ${total} requirements in date`}>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${compliant} of ${total} requirements in date`}>
          <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${shown}%`, background: tone }} />
        </div>
      </Tooltip>
      <span className="text-xs text-muted tabular">
        {compliant}/{total}
      </span>
      {overdue ? (
        <Badge tone="danger" className="px-1.5">
          {overdue} overdue
        </Badge>
      ) : null}
    </div>
  )
}

/** A searchable list of checkboxes (units, job roles, people). Keyboard: Tab to the
 * search, Tab through the boxes, Space toggles. */
export function CheckList<T>({
  items,
  selected,
  onToggle,
  getId,
  render,
  search,
  label,
  empty = 'Nothing to choose from yet.',
  loading,
  className,
}: {
  items: T[]
  selected: string[]
  onToggle: (id: string, on: boolean) => void
  getId: (t: T) => string
  render: (t: T) => ReactNode
  search?: { value: string; onChange: (v: string) => void; placeholder: string }
  label: string
  empty?: string
  loading?: boolean
  className?: string
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      {search ? <Input icon={<Search />} value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} /> : null}
      <ul role="group" aria-label={label} className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="px-3 py-2.5">
              <Skeleton className="h-5" />
            </li>
          ))
        ) : items.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted">{empty}</li>
        ) : (
          items.map((t) => {
            const id = getId(t)
            const on = selected.includes(id)
            return (
              <li key={id} className="border-b border-border last:border-b-0">
                <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/60', on && 'bg-primary-soft/40')}>
                  <Checkbox checked={on} onCheckedChange={(v) => onToggle(id, v === true)} />
                  <span className="min-w-0 flex-1">{render(t)}</span>
                </label>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

/** Units in tree order with indentation; the first chosen unit is the primary one. */
export function UnitPicker({ units, value, onChange, label = 'Units' }: { units: Unit[]; value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => (q ? units.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) : units), [q, units])
  return (
    <div className="grid gap-2">
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Chosen ${label.toLowerCase()}`}>
          {value.map((id, i) => {
            const u = units.find((x) => x.id === id)
            return (
              <li key={id}>
                <Badge tone={i === 0 ? 'primary' : 'neutral'} className="gap-1.5 py-1 pr-1">
                  {u?.name ?? 'Unknown unit'}
                  {i === 0 ? <span className="text-[10px] uppercase opacity-80">primary</span> : null}
                  <button type="button" className="rounded-full p-0.5 hover:bg-black/10" aria-label={`Remove ${u?.name ?? 'unit'}`} onClick={() => onChange(value.filter((v) => v !== id))}>
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : null}
      <CheckList
        label={label}
        items={shown}
        selected={value}
        getId={(u) => u.id}
        onToggle={(id, on) => onChange(on ? [...value, id] : value.filter((v) => v !== id))}
        search={units.length > 8 ? { value: q, onChange: setQ, placeholder: `Find a unit` } : undefined}
        render={(u) => (
          <span className="flex items-center gap-2" style={{ paddingLeft: unitLevel(u, units) * 14 }}>
            <span className="truncate">{u.name}</span>
            <span className="text-xs text-subtle capitalize">{u.kind}</span>
          </span>
        )}
      />
    </div>
  )
}

/** Debounced copy of a value (search boxes). */
export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** A tick that pops in: confirmation of a saved change. */
export function SavedTick() {
  return (
    <span className="inline-flex animate-pop items-center gap-1 text-xs font-medium text-success">
      <Check className="size-3.5" /> Saved
    </span>
  )
}
