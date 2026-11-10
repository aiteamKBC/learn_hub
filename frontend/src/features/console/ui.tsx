import { CalendarRange, Download } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { csrfToken } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { StatCard } from '@/components/ui/misc'
import { API_BASE_URL } from '@/lib/env'
import { money } from '@/lib/format'

// ---------------------------------------------------------------- money
/** Console money is GBP pence unless a row says otherwise. */
export const gbp = (minor: number) => money(Math.round(minor), 'GBP')
/** Whole pounds for chart axes and KPI tiles (£24,860). */
export const gbpShort = (minor: number) => money(Math.round(minor / 100) * 100, 'GBP').replace(/\.00$/, '')

// ---------------------------------------------------------------- date range (URL state)
export type RangeKey = '7d' | '30d' | '90d' | '12m' | 'custom'
export type RangeQuery = { range: RangeKey; start?: string; end?: string }

const RANGE_LABEL: Record<RangeKey, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months', custom: 'Custom dates' }

/** The page's date range lives in the URL (?range=30d or ?range=custom&start=…&end=…),
 * so a reload or a shared link keeps it. Pass the result straight to the API query. */
export function useRangeParam(): [RangeQuery, (r: RangeQuery) => void] {
  const [params, setParams] = useSearchParams()
  const range = (params.get('range') as RangeKey) || '30d'
  const value: RangeQuery = range === 'custom' ? { range, start: params.get('start') ?? undefined, end: params.get('end') ?? undefined } : { range }
  const set = (r: RangeQuery) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('range', r.range)
        next.delete('start')
        next.delete('end')
        if (r.range === 'custom' && r.start && r.end) (next.set('start', r.start), next.set('end', r.end))
        return next
      },
      { replace: true },
    )
  return [value, set]
}

export function rangeLabel(r: RangeQuery) {
  return r.range === 'custom' && r.start && r.end ? `${r.start} to ${r.end}` : RANGE_LABEL[r.range]
}

/** 7 / 30 / 90 days, 12 months or custom dates (mockups 26, 22, 02). */
export function DateRangeSelect({ value, onChange }: { value: RangeQuery; onChange: (r: RangeQuery) => void }) {
  const [custom, setCustom] = useState(false)
  const [start, setStart] = useState(value.start ?? '')
  const [end, setEnd] = useState(value.end ?? '')
  return (
    <>
      <div className="relative w-full sm:w-48">
        <CalendarRange className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <NativeSelect
          className="pl-9"
          aria-label="Date range"
          value={value.range}
          onChange={(e) => {
            const r = e.target.value as RangeKey
            if (r === 'custom') setCustom(true)
            else onChange({ range: r })
          }}
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>
              {k === 'custom' && value.range === 'custom' ? rangeLabel(value) : RANGE_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Dialog open={custom} onOpenChange={setCustom}>
        <DialogContent title="Custom dates" description="Choose up to two years.">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!start || !end || end < start) return toast.error('Choose a start date before the end date.')
              onChange({ range: 'custom', start, end })
              setCustom(false)
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="range-start">From</Label>
                <Input id="range-start" type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="range-end">To</Label>
                <Input id="range-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCustom(false)}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------- KPIs
export type Kpi = { value: number; previous: number; change_pct: number | null }

/** A StatCard with "▲ 12% vs previous period" from a {value, previous, change_pct} KPI. */
export function KpiCard({ label, kpi, icon, tone, format, lowerIsBetter }: { label: string; kpi: Kpi; icon: ReactNode; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info'; format?: (v: number) => string; lowerIsBetter?: boolean }) {
  const c = kpi.change_pct
  return (
    <StatCard
      label={label}
      value={format ? format(kpi.value) : kpi.value}
      icon={icon}
      tone={tone}
      trend={c === null ? undefined : { value: `${Math.abs(c)}%`, up: c >= 0, good: lowerIsBetter ? c <= 0 : c >= 0 }}
      hint={c === null ? 'no earlier data' : 'vs previous period'}
    />
  )
}

// ---------------------------------------------------------------- status pills
const TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'> = {
  active: 'success', published: 'success', paid: 'success', approved: 'success', valid: 'success', resolved: 'success',
  verified: 'success', succeeded: 'success', actioned: 'success', live: 'success', trialing: 'info',
  pending: 'warning', in_review: 'warning', scheduled: 'info', draft: 'neutral', open: 'warning', progress: 'info',
  waiting: 'info', changes_requested: 'warning', partially_refunded: 'warning', past_due: 'warning', held: 'warning',
  unlisted: 'neutral', archived: 'neutral', ended: 'neutral', closed: 'neutral', expired: 'neutral', dismissed: 'neutral',
  canceled: 'neutral', cancelled: 'neutral', retired: 'neutral', trial: 'info',
  rejected: 'danger', failed: 'danger', refunded: 'danger', revoked: 'danger', suspended: 'danger', disputed: 'danger',
  hidden: 'danger', unpaid: 'danger', incomplete: 'neutral',
}

const words = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** A coloured status badge; pass `label` when the API's code is not the right words. */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={TONES[status] ?? 'neutral'} dot>
      {label ?? (status === 'progress' ? 'In progress' : words(status))}
    </Badge>
  )
}

// ---------------------------------------------------------------- right-hand detail panel
/** The detail panel of mockups 05, 22, 45: a right sheet on every screen size. */
export function DetailSheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} side="right" className="w-[min(720px,100vw)]">
        <div className="p-4 sm:p-5">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- confirmations
/**
 * Every destructive or money action asks first (brief: rules specific to M5). With
 * `reason`, a reason is required (min 3 characters) and passed to `onConfirm`. With
 * `phrase`, the person must type it exactly (irreversible actions, e.g. "DELETE").
 */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, tone = 'danger', reason, reasonLabel = 'Reason', phrase, loading, onConfirm }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  body?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  reason?: 'required' | 'optional'
  reasonLabel?: string
  phrase?: string
  loading?: boolean
  onConfirm: (reason: string) => void
}) {
  const [text, setText] = useState('')
  const [typed, setTyped] = useState('')
  const reasonOk = reason !== 'required' || text.trim().length >= 3
  const phraseOk = !phrase || typed.trim() === phrase
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || (setText(''), setTyped('')))}>
      <DialogContent title={title}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (reasonOk && phraseOk) onConfirm(text.trim())
          }}
        >
          {body ? <div className="text-sm text-muted">{body}</div> : null}
          {reason ? (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-reason">
                {reasonLabel}
                {reason === 'optional' ? <span className="font-normal text-muted"> (optional)</span> : null}
              </Label>
              <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} required={reason === 'required'} aria-describedby="confirm-reason-hint" />
              <p id="confirm-reason-hint" className="text-right text-xs text-muted tabular">
                {text.length} / 300
              </p>
            </div>
          ) : null}
          {phrase ? (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-phrase">
                Type <span className="font-mono font-semibold">{phrase}</span> to confirm
              </Label>
              <Input id="confirm-phrase" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={tone} loading={loading} disabled={!reasonOk || !phraseOk}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- tabs in the URL
/** The page's tab lives in ?tab= so links (search results, notifications) can open one. */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as T | null
  const tab = raw && tabs.includes(raw) ? raw : fallback
  const set = (t: T) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (t === fallback) next.delete('tab')
        else next.set('tab', t)
        return next
      },
      { replace: true },
    )
  return [tab, set]
}

/** One query parameter as state (e.g. ?user=<id> opens that person's panel). */
export function useParam(name: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const set = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set(name, v)
        else next.delete(name)
        return next
      },
      { replace: true },
    )
  return [params.get(name) ?? '', set]
}

// ---------------------------------------------------------------- CSV export
/** Downloads a CSV the API builds (`path` under /api/v1/console/…, with its query). The
 * browser saves it with the server's file name; failures show a toast. */
export async function downloadCsv(path: string, fallbackName: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { 'X-CSRFToken': csrfToken() } })
  if (!res.ok) {
    toast.error('The export failed. Try again.')
    return
  }
  const blob = await res.blob()
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000) // Firefox and Safari need the link alive a moment longer
}

export function ExportButton({ path, filename, label = 'Export' }: { path: string; filename: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadCsv(path, filename)
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? null : <Download />} {label}
    </Button>
  )
}

/** "Showing 25 · Load more" footer for keyset lists. */
export function LoadMore({ shown, noun, hasMore, loading, onMore }: { shown: number; noun: string; hasMore: boolean; loading: boolean; onMore: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
      <span className="tabular">
        Showing {shown} {noun}
      </span>
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loading} onClick={onMore}>
          Load more
        </Button>
      ) : (
        <span>That's all</span>
      )}
    </div>
  )
}

/** A label / value row for detail panels. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  )
}
