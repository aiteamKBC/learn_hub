import { useId, useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import { useFill, useInView } from '@/lib/motion'

/** A round axis top just above the largest value (e.g. 1,840 → 2,000). */
export function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * p >= v)!
  return step * p
}

export type SeriesPoint = { day: string; value: number }

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * A daily line with a soft fill (mockups 26, 22, 20, 02). Draws itself in when it scrolls
 * into view; hover or focus shows the value of a day. `format` turns a value into text
 * (money, counts). The table-free summary for screen readers is the aria-label.
 */
export function AreaChart({ points, format, height = 220, label, color = 'var(--chart-1)' }: { points: SeriesPoint[]; format: (v: number) => string; height?: number; label: string; color?: string }) {
  const id = useId()
  const [ref, seen] = useInView<HTMLDivElement>()
  const k = useFill(1, seen)
  const [active, setActive] = useState<number | null>(null)
  const W = 640
  const H = 200
  const top = niceMax(Math.max(0, ...points.map((p) => p.value)))
  const ticks = [1, 0.5, 0]
  const xy = useMemo(
    () => points.map((p, i) => ({ x: points.length > 1 ? (i / (points.length - 1)) * W : W / 2, y: H - (p.value / top) * H })),
    [points, top],
  )
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = xy.length ? `${line} L${W} ${H} L0 ${H} Z` : ''
  const total = points.reduce((s, p) => s + p.value, 0)
  const every = Math.max(1, Math.ceil(points.length / 7))
  const a = active === null ? null : points[active]

  if (!points.length) return <p className="py-10 text-center text-sm text-muted">No data for this period yet.</p>
  return (
    <div ref={ref} className="relative" role="img" aria-label={`${label}: ${format(total)} in total over ${points.length} days.`}>
      <div className="flex gap-2" style={{ height }}>
        <div className="relative w-14 shrink-0 text-right text-[11px] text-subtle tabular" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
              {format(top * t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-border-strong' : 'border-dashed border-border')} style={{ top: `${(1 - t) * 100}%` }} aria-hidden />
          ))}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={`${id}f`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.28" />
                <stop offset="1" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
              <clipPath id={`${id}c`}>
                <rect x="0" y="-10" height={H + 20} width={W * k} className="transition-[width] duration-700 ease-out motion-reduce:transition-none" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${id}c)`}>
              <path d={area} fill={`url(#${id}f)`} />
              <path d={line} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          </svg>
          {/* hover targets, one per day */}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <button
                key={p.day}
                type="button"
                className="h-full min-w-0 flex-1 cursor-default outline-none focus-visible:bg-primary-soft/40"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${dayLabel(p.day)}: ${format(p.value)}`}
              />
            ))}
          </div>
          {a && active !== null ? (
            <>
              <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow" style={{ left: `${(xy[active]!.x / W) * 100}%`, top: `${(xy[active]!.y / H) * 100}%`, background: color }} aria-hidden />
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
                style={{ left: `${Math.min(88, Math.max(12, (xy[active]!.x / W) * 100))}%`, top: `${(xy[active]!.y / H) * 100 - 4}%` }}
              >
                <p className="text-muted">{dayLabel(a.day)}</p>
                <p className="font-semibold tabular">{format(a.value)}</p>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex pl-16 text-[11px] text-subtle" aria-hidden>
        {points.map((p, i) => (
          <span key={p.day} className="min-w-0 flex-1 truncate text-center">
            {i % every === 0 ? dayLabel(p.day) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

export type DonutSlice = { label: string; value: number; color: string; hint?: string }

/** A ring split into slices with a legend (mockups 22, 20, 02). Fills in on view. */
export function Donut({ slices, centre, centreLabel, format, size = 168 }: { slices: DonutSlice[]; centre: string; centreLabel: string; format: (v: number) => string; size?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const k = useFill(1, seen)
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = 15.9155 // circumference 100
  let offset = 0
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${centreLabel}: ${centre}. ${slices.map((s) => `${s.label} ${format(s.value)}`).join(', ')}.`}>
        <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="4.2" />
          {total > 0
            ? slices.map((s) => {
                const share = (Math.max(0, s.value) / total) * 100 * k
                const el = <circle key={s.label} cx="18" cy="18" r={r} fill="none" stroke={s.color} strokeWidth="4.2" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none" />
                offset += (Math.max(0, s.value) / total) * 100 * k
                return el
              })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-semibold tabular">{centre}</span>
          <span className="text-[11px] text-muted">{centreLabel}</span>
        </div>
      </div>
      <ul className="grid min-w-0 flex-1 gap-2 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="font-medium tabular">{format(s.value)}</span>
            <span className="w-12 text-right text-xs text-muted tabular">{total ? `${Math.round((Math.max(0, s.value) / total) * 100)}%` : '0%'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Horizontal bars for a short ranked list (top courses, by plan). */
export function BarList({ rows, format }: { rows: { label: string; value: number; hint?: string }[]; format: (v: number) => string }) {
  const [ref, seen] = useInView<HTMLUListElement>()
  const top = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul ref={ref} className="stagger grid gap-3">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-medium tabular">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: seen ? `${(r.value / top) * 100}%` : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
