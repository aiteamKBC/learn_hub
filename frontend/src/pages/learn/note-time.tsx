import { Clock, Pencil, X } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { clock, parseClock, type Pin, pinnedSecond, seekTo, usePlayheadSec } from '@/features/learning/bunny'
import { type Note, useUpdateNote } from '@/features/learning/api'
import { cn } from '@/lib/cn'
import { useNavigate } from '@/lib/router'

import { lectureUrl } from './shared'



const chip =
  'inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-soft-text tabular transition-colors duration-200 hover:bg-primary hover:text-on-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none'

/** A small mm:ss field that accepts h:mm:ss too; Enter or leaving it applies, Escape cancels. */
function TimeInput({ initial, onApply, onCancel, label }: { initial: number; onApply: (sec: number) => void; onCancel: () => void; label: string }) {
  const [text, setText] = useState(clock(initial))
  const bad = parseClock(text) == null
  const apply = () => {
    const sec = parseClock(text)
    if (sec == null) return
    onApply(sec)
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => (bad ? onCancel() : apply())}
        aria-label={label}
        aria-invalid={bad}
        inputMode="numeric"
        placeholder="m:ss"
        className={cn('h-7 w-20 rounded-md border bg-surface px-2 text-xs tabular focus:outline-none focus-visible:ring-2', bad ? 'border-danger focus-visible:ring-danger' : 'border-border focus-visible:ring-primary')}
      />
      {bad ? <span className="text-xs text-danger">Use m:ss</span> : null}
    </span>
  )
}

/**
 * The composer's time: follows the video until the learner sets one by hand, or chooses
 * not to pin the note to a moment at all.
 */
export function PinControl({ lectureKey, pin, onChange }: { lectureKey: string; pin: Pin; onChange: (p: Pin) => void }) {
  const live = usePlayheadSec(lectureKey)
  const [editing, setEditing] = useState(false)
  const sec = pinnedSecond(pin, live)

  if (editing) {
    return <TimeInput initial={sec ?? live ?? 0} label="Pin the note to this time (m:ss)" onApply={(s) => (onChange({ mode: 'fixed', sec: s }), setEditing(false))} onCancel={() => setEditing(false)} />
  }
  if (pin.mode === 'none') {
    return (
      <button type="button" onClick={() => onChange({ mode: 'live' })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:border-primary hover:text-primary">
        <Clock className="size-3" /> Pin to a moment
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={() => setEditing(true)} className={chip} aria-label={`Pinned at ${clock(sec ?? 0)}. Change the time`}>
        <Clock className="size-3" /> {clock(sec ?? 0)}
        {pin.mode === 'live' ? <span className="font-normal opacity-75">now</span> : null}
      </button>
      {pin.mode === 'fixed' ? (
        <button type="button" onClick={() => onChange({ mode: 'live' })} className="rounded px-1 text-xs text-muted hover:text-primary">
          Follow video
        </button>
      ) : null}
      <button type="button" onClick={() => onChange({ mode: 'none' })} aria-label="Don't pin to a moment" className="rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-text">
        <X className="size-3.5" />
      </button>
    </span>
  )
}

/** A saved note's time: jumps the open video there, or opens that lecture at that second. */
export function NoteTimeChip({ note, currentKey, slug }: { note: Note; currentKey: string; slug: string }) {
  const navigate = useNavigate()
  if (note.timestamp_sec == null) return null
  const sec = note.timestamp_sec
  const go = () => {
    if (note.lecture_key === currentKey && seekTo(note.lecture_key, sec)) return
    navigate(`${lectureUrl(slug, note.lecture_key)}?t=${sec}`)
  }
  return (
    <button type="button" onClick={go} className={chip} aria-label={`Jump to ${clock(sec)} in the video`}>
      <Clock className="size-3" /> {clock(sec)}
    </button>
  )
}

/** Edit a saved note: its text, and the moment it is pinned to (or none). */
export function NoteEditor({ note, enrollmentId, isVideo, onDone }: { note: Note; enrollmentId: string; isVideo: boolean; onDone: () => void }) {
  const update = useUpdateNote(enrollmentId)
  const id = useId()
  const [body, setBody] = useState(note.body)
  const [sec, setSec] = useState<number | null>(note.timestamp_sec ?? null)
  const [editingTime, setEditingTime] = useState(false)

  const save = () => {
    const changes: { id: string; body?: string; timestamp_sec?: number; clear_timestamp?: boolean } = { id: note.id }
    if (body.trim() !== note.body) changes.body = body.trim()
    if (sec !== (note.timestamp_sec ?? null)) {
      if (sec == null) changes.clear_timestamp = true
      else changes.timestamp_sec = sec
    }
    if (Object.keys(changes).length === 1) return onDone()
    update.mutate(changes, { onSuccess: onDone, onError: (er) => toast.error(er.message) })
  }

  return (
    <div className="mt-2 grid gap-2">
      <label htmlFor={id} className="sr-only">
        Note
      </label>
      <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} className="min-h-20" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isVideo ? (
            editingTime ? (
              <TimeInput initial={sec ?? 0} label="Note time (m:ss)" onApply={(s) => (setSec(s), setEditingTime(false))} onCancel={() => setEditingTime(false)} />
            ) : sec != null ? (
              <>
                <button type="button" onClick={() => setEditingTime(true)} className={chip} aria-label={`Pinned at ${clock(sec)}. Change the time`}>
                  <Clock className="size-3" /> {clock(sec)} <Pencil className="size-3" />
                </button>
                <button type="button" onClick={() => setSec(null)} className="rounded px-1 text-muted hover:text-danger">
                  Remove time
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setEditingTime(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted hover:border-primary hover:text-primary">
                <Clock className="size-3" /> Add a time
              </button>
            )
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={update.isPending} disabled={!body.trim()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
