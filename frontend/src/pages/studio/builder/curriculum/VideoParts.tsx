import { Bookmark, Clock, ListOrdered, Plus, Trash2 } from 'lucide-react'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type BunnyPlayer, loadPlayerJs } from '@/features/learning/bunny'
import { type VideoDetails, useSaveVideoParts } from '@/features/studio/api'

import { errText } from './shared'

// ---------------------------------------------------------------- time helpers
/** "75", "1:15" or "1:01:15" → seconds; null when it isn't a time. */
export function parseTime(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null
  const parts = t.split(':').map(Number)
  if (parts.slice(1).some((n) => n > 59)) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

// ---------------------------------------------------------------- the preview's player
/** player.js on the builder's preview iframe: the current second and seeking. Without
 * player.js (blocked script), times are simply typed by hand. */
export function usePreviewPlayer(frame: RefObject<HTMLIFrameElement | null>, src: string | null | undefined) {
  const player = useRef<BunnyPlayer | null>(null)
  const now = useRef(0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const el = frame.current
    if (!el || !src) return
    let alive = true
    setReady(false)
    loadPlayerJs()
      .then(() => {
        if (!alive || !window.playerjs) return
        const p = new window.playerjs.Player(el)
        p.on('ready', () => alive && setReady(true))
        p.on('timeupdate', (d) => {
          now.current = d?.seconds ?? now.current
        })
        player.current = p
      })
      .catch(() => undefined)
    return () => {
      alive = false
      player.current = null
    }
  }, [frame, src])
  return {
    ready,
    current: () => Math.floor(now.current),
    seek: (sec: number) => player.current?.setCurrentTime(sec),
  }
}

export type PreviewPlayer = ReturnType<typeof usePreviewPlayer>

// ---------------------------------------------------------------- editor
type Row = { id: number; name: string; time: string }
let nextId = 1
const rowsOf = <T,>(items: T[], name: (x: T) => string, at: (x: T) => number): Row[] => items.map((x) => ({ id: nextId++, name: name(x), time: formatTime(at(x)) }))
const byTime = (rows: Row[]) => [...rows].sort((a, b) => (parseTime(a.time) ?? Infinity) - (parseTime(b.time) ?? Infinity))
const norm = (rows: Row[]) => JSON.stringify(byTime(rows).map((r) => [r.name.trim(), parseTime(r.time)]))

/** Parts (Bunny chapters) and key moments (Bunny moments) of one video, saved together. */
export function VideoParts({ assetId, details, player, readOnly, onDirty }: { assetId: string; details: VideoDetails; player: PreviewPlayer; readOnly?: boolean; onDirty?: (dirty: boolean) => void }) {
  const save = useSaveVideoParts(assetId)
  const initialParts = useMemo(() => rowsOf(details.parts, (p) => p.title, (p) => p.start), [details.parts])
  const initialMoments = useMemo(() => rowsOf(details.moments, (m) => m.label, (m) => m.timestamp), [details.moments])
  const [parts, setParts] = useState(initialParts)
  const [moments, setMoments] = useState(initialMoments)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // a fresh copy from the server (after saving) restarts the form
  useEffect(() => setParts(initialParts), [initialParts])
  useEffect(() => setMoments(initialMoments), [initialMoments])

  const dirty = norm(parts) !== norm(initialParts) || norm(moments) !== norm(initialMoments)
  useEffect(() => onDirty?.(dirty), [dirty, onDirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const length = details.duration_sec
  const problem = (rows: Row[], what: string) => {
    for (const r of rows) {
      const at = parseTime(r.time)
      if (!r.name.trim()) return `Every ${what} needs a name.`
      if (at === null) return `“${r.name.trim()}”: write the time as m:ss, like 1:30.`
      if (length && at > length) return `“${r.name.trim()}” is after the video ends (${formatTime(length)}).`
    }
    return ''
  }
  const invalid = problem(parts, 'part') || problem(moments, 'key moment') || (new Set(parts.map((p) => parseTime(p.time))).size !== parts.length ? 'Two parts can’t start at the same time.' : '')

  const submit = async () => {
    setError('')
    setSaved(false)
    if (invalid) return setError(invalid)
    try {
      await save.mutateAsync({
        parts: byTime(parts).map((p) => ({ title: p.name.trim(), start: parseTime(p.time)! })),
        moments: byTime(moments).map((m) => ({ label: m.name.trim(), timestamp: parseTime(m.time)! })),
      })
      setSaved(true)
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <div className="grid gap-5">
      <RowList
        title="Parts of this video"
        hint="Split the video into named parts. Learners see them in the player and can jump to each part."
        icon={<ListOrdered className="size-4 text-muted" aria-hidden />}
        nameLabel="Part name"
        namePlaceholder={parts.length ? 'e.g. Setting up' : 'e.g. Introduction'}
        addLabel="Add a part"
        rows={parts}
        setRows={(r) => (setParts(r), setSaved(false))}
        player={player}
        readOnly={readOnly}
        suggestFirst
      />
      <RowList
        title="Key moments"
        hint="Mark important points, like a key formula. They show as markers in the player."
        icon={<Bookmark className="size-4 text-muted" aria-hidden />}
        nameLabel="Label"
        namePlaceholder="e.g. Key formula"
        addLabel="Add a key moment"
        rows={moments}
        setRows={(r) => (setMoments(r), setSaved(false))}
        player={player}
        readOnly={readOnly}
      />
      {readOnly ? null : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {error ? (
            <p role="alert" className="mr-auto text-[13px] text-danger">
              {error}
            </p>
          ) : saved && !dirty ? (
            <p role="status" className="mr-auto text-[13px] text-success">
              Saved. Learners see the changes in the player.
            </p>
          ) : dirty ? (
            <p className="mr-auto text-[13px] text-muted">Unsaved changes</p>
          ) : null}
          <Button size="sm" onClick={() => void submit()} disabled={!dirty} loading={save.isPending}>
            Save parts and moments
          </Button>
        </div>
      )}
    </div>
  )
}

function RowList({ title, hint, icon, nameLabel, namePlaceholder, addLabel, rows, setRows, player, readOnly, suggestFirst }: {
  title: string
  hint: string
  icon: React.ReactNode
  nameLabel: string
  namePlaceholder: string
  addLabel: string
  rows: Row[]
  setRows: (rows: Row[]) => void
  player: PreviewPlayer
  readOnly?: boolean
  suggestFirst?: boolean
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const edit = (id: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = () => {
    const at = suggestFirst && !rows.length ? 0 : player.ready ? player.current() : 0
    const row = { id: nextId++, name: '', time: formatTime(at) }
    setRows(byTime([...rows, row]))
    // focus the new row's name
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-row="${row.id}"]`)?.focus())
  }

  return (
    <section className="grid gap-2" aria-label={title}>
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          {icon} {title}
        </h4>
        <p className="mt-0.5 text-[13px] text-muted">{hint}</p>
      </div>
      {rows.length ? (
        <ul ref={listRef} className="stagger grid gap-2">
          {rows.map((r) => {
            const at = parseTime(r.time)
            return (
              <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border bg-surface p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-soft px-2.5 text-[13px] font-semibold text-primary-soft-text tabular transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-60"
                  onClick={() => at !== null && player.seek(at)}
                  disabled={at === null || !player.ready}
                  aria-label={at === null ? 'Time not set' : `Play the preview from ${formatTime(at)}`}
                  title={player.ready ? 'Play the preview from here' : undefined}
                >
                  <Clock className="size-3.5" aria-hidden /> {at === null ? '–' : formatTime(at)}
                </button>
                <Input
                  data-row={r.id}
                  value={r.name}
                  onChange={(e) => edit(r.id, { name: e.target.value })}
                  placeholder={namePlaceholder}
                  maxLength={255}
                  aria-label={nameLabel}
                  disabled={readOnly}
                  className="h-9"
                />
                <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
                  <Input
                    value={r.time}
                    onChange={(e) => edit(r.id, { time: e.target.value })}
                    onBlur={() => setRows(byTime(rows))}
                    inputMode="numeric"
                    placeholder="0:00"
                    aria-label={`${nameLabel} time (m:ss)`}
                    aria-invalid={at === null ? true : undefined}
                    disabled={readOnly}
                    className="h-9 w-20 tabular"
                  />
                  {readOnly ? null : (
                    <>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRows(byTime(rows.map((x) => (x.id === r.id ? { ...x, time: formatTime(player.current()) } : x))))} disabled={!player.ready} title={player.ready ? undefined : 'Play the preview to use its time'}>
                        Use current time
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.name.trim() || 'this row'}`}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[13px] text-muted">None yet.</p>
      )}
      {readOnly ? null : (
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={add}>
            <Plus /> {addLabel}
          </Button>
          {!player.ready ? <span className="ml-2 text-xs text-muted">Tip: play the preview, then add, to use its current time.</span> : null}
        </div>
      )}
    </section>
  )
}
