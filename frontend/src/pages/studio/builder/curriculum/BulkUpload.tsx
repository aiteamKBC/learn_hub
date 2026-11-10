import { CheckCircle2, Clapperboard, Loader2, UploadCloud, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { useCurriculum, type StudioSection } from '@/features/studio/api'
import { cn } from '@/lib/cn'

import { cancelled, fileSize, uploadErrText, uploadVideoFile, videoFileError } from './shared'

const AT_ONCE = 2

type State = 'queued' | 'creating' | 'uploading' | 'attaching' | 'done' | 'failed' | 'cancelled'
type Item = { key: string; file: File; title: string; state: State; pct: number; error: string }

/** "Lesson 3 - Setting_up.mp4" → "Lesson 3 Setting up". */
function titleOf(name: string) {
  const t = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 200) || 'New video'
}

/** Several videos at once: each becomes a video lesson in the chosen module, named after
 * its file, and uploads straight to Bunny (two at a time). */
export function BulkUploadDialog({ courseId, sections, defaultSectionId, open, onClose }: { courseId: string; sections: StudioSection[]; defaultSectionId?: string; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  const close = () => {
    if (busy) {
      if (!window.confirm('Uploads are still running. Stop them and close?')) return
      stop.current?.()
    }
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {open ? (
        <DialogContent title="Bulk upload videos" description="Each video becomes a new video lesson, named after its file. You can rename them afterwards." className="max-w-2xl">
          <BulkUploadForm courseId={courseId} sections={sections} defaultSectionId={defaultSectionId} onBusy={setBusy} stopRef={stop} onClose={close} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function BulkUploadForm({ courseId, sections, defaultSectionId, onBusy, stopRef, onClose }: {
  courseId: string
  sections: StudioSection[]
  defaultSectionId?: string
  onBusy: (b: boolean) => void
  stopRef: RefObject<(() => void) | null>
  onClose: () => void
}) {
  const c = useCurriculum(courseId)
  const [sectionId, setSectionId] = useState(defaultSectionId && sections.some((s) => s.id === defaultSectionId) ? defaultSectionId : (sections[0]?.id ?? ''))
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const ctrls = useRef(new Map<string, AbortController>())
  const skipped = useRef(new Set<string>())

  useEffect(() => onBusy(running), [running, onBusy])
  useEffect(() => {
    const all = ctrls.current
    const skip = skipped.current
    stopRef.current = () => {
      setItems((xs) => xs.map((x) => (x.state === 'queued' ? (skip.add(x.key), { ...x, state: 'cancelled' }) : x)))
      for (const ctrl of all.values()) ctrl.abort()
    }
    return () => {
      for (const ctrl of all.values()) ctrl.abort()
    }
  }, [stopRef])

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const bad: string[] = []
    const fresh: Item[] = []
    for (const file of Array.from(files)) {
      const err = videoFileError(file)
      if (err) bad.push(`${file.name}: ${err}`)
      else fresh.push({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, title: titleOf(file.name), state: 'queued', pct: 0, error: '' })
    }
    setRejected(bad)
    setItems((xs) => [...xs, ...fresh])
    if (input.current) input.current.value = ''
  }

  const run = async (item: Item, target: string) => {
    const ctrl = new AbortController()
    ctrls.current.set(item.key, ctrl)
    let lectureId: string | null = null
    const title = item.title.trim() || titleOf(item.file.name)
    try {
      patch(item.key, { state: 'creating' })
      lectureId = (await c.addLecture.mutateAsync({ sectionId: target, kind: 'video', title })).id
      if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError')
      patch(item.key, { state: 'uploading' })
      const assetId = await uploadVideoFile({ courseId, title, file: item.file, signal: ctrl.signal, onProgress: (pct) => patch(item.key, { pct }) })
      patch(item.key, { state: 'attaching', pct: 100 })
      await c.updateLecture.mutateAsync({ lectureId, body: { video_id: assetId } })
      patch(item.key, { state: 'done' })
    } catch (e) {
      if (cancelled(e) || ctrl.signal.aborted) {
        patch(item.key, { state: 'cancelled' })
        // the empty lesson made for it goes again
        if (lectureId) c.deleteLecture.mutate(lectureId)
      } else {
        patch(item.key, { state: 'failed', error: lectureId ? `${uploadErrText(e)} The lesson was added without a video.` : uploadErrText(e) })
      }
    } finally {
      ctrls.current.delete(item.key)
    }
  }

  const start = async () => {
    if (!sectionId) return
    const queue = items.filter((x) => x.state === 'queued')
    if (!queue.length) return
    setRunning(true)
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++]!
        if (skipped.current.has(item.key)) continue
        await run(item, sectionId)
      }
    }
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
    setRunning(false)
  }

  const cancelItem = (item: Item) => {
    if (item.state === 'queued') {
      if (running) {
        skipped.current.add(item.key)
        patch(item.key, { state: 'cancelled' })
      } else setItems((xs) => xs.filter((x) => x.key !== item.key))
    } else ctrls.current.get(item.key)?.abort()
  }

  const queued = items.filter((x) => x.state === 'queued').length
  const done = items.filter((x) => x.state === 'done').length
  const finished = !running && items.length > 0 && queued === 0

  return (
    <div className="grid gap-4">
      <Field label="Add to module">
        {(p) => (
          <NativeSelect {...p} value={sectionId} disabled={running} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s, i) => <option key={s.id} value={s.id}>Module {i + 1}: {s.title}</option>)}
          </NativeSelect>
        )}
      </Field>

      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), addFiles(e.dataTransfer.files))}
        className={cn('grid place-items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors duration-200', over ? 'border-primary bg-primary-soft/40' : 'border-primary/30 bg-primary-soft/15')}
      >
        <UploadCloud className="size-7 text-primary" aria-hidden />
        <p className="text-sm">
          Drag and drop videos here, or{' '}
          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => input.current?.click()}>
            click to browse
          </button>
        </p>
        <p className="text-xs text-muted">MP4, MOV, MKV or WebM · up to 20 GB each · {AT_ONCE} upload at a time</p>
        <input ref={input} type="file" accept="video/*" multiple className="sr-only" aria-label="Choose video files" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {rejected.length ? (
        <ul role="alert" className="grid gap-0.5 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {rejected.map((r) => <li key={r} className="break-words">{r}</li>)}
        </ul>
      ) : null}

      {items.length ? (
        <ul className="stagger grid max-h-[46vh] gap-2 overflow-y-auto pr-0.5" aria-label="Videos to upload">
          {items.map((it) => (
            <li key={it.key} className="grid gap-2 rounded-lg border border-border bg-surface p-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text"><Clapperboard className="size-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  {it.state === 'queued' && !running ? (
                    <Input aria-label={`Lesson title for ${it.file.name}`} value={it.title} maxLength={200} className="h-8" onChange={(e) => patch(it.key, { title: e.target.value })} />
                  ) : (
                    <p className="truncate text-sm font-medium">{it.title}</p>
                  )}
                  <p className="mt-0.5 truncate text-xs text-muted">{it.file.name} · {fileSize(it.file.size)}</p>
                </div>
                <ItemStatus item={it} />
                {['queued', 'creating', 'uploading'].includes(it.state) ? (
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`${it.state === 'queued' && !running ? 'Remove' : 'Cancel'} ${it.file.name}`} onClick={() => cancelItem(it)}><X /></Button>
                ) : null}
              </div>
              {it.state === 'uploading' || it.state === 'attaching' ? <Progress value={it.pct} label={`Uploading ${it.file.name}`} /> : null}
              {it.error ? <p className="text-[13px] text-danger">{it.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="sr-only" aria-live="polite">{running ? `Uploading. ${done} of ${items.length} done.` : finished ? `${done} of ${items.length} videos added.` : ''}</p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {running ? <p className="mr-auto text-[13px] text-muted">Keep this window open until the uploads finish.</p> : finished ? <p className="mr-auto text-[13px] text-muted">{done} of {items.length} {items.length === 1 ? 'video' : 'videos'} added.</p> : null}
        {running ? (
          <Button type="button" variant="ghost" onClick={() => stopRef.current?.()}>Cancel all</Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>{finished ? 'Close' : 'Cancel'}</Button>
        )}
        {finished ? null : (
          <Button type="button" loading={running} disabled={!queued || !sectionId} onClick={() => void start()}>
            <UploadCloud /> Upload {queued || ''} {queued === 1 ? 'video' : 'videos'}
          </Button>
        )}
      </div>
    </div>
  )
}

function ItemStatus({ item }: { item: Item }) {
  const base = 'inline-flex shrink-0 items-center gap-1 text-xs font-medium'
  switch (item.state) {
    case 'queued':
      return <span className={cn(base, 'text-muted')}>Waiting</span>
    case 'creating':
      return <span className={cn(base, 'text-muted')}><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Adding lesson</span>
    case 'uploading':
      return <span className={cn(base, 'text-muted tabular')}>{item.pct}%</span>
    case 'attaching':
      return <span className={cn(base, 'text-muted')}><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Finishing</span>
    case 'done':
      return <span className={cn(base, 'text-success')}><CheckCircle2 className="size-3.5" aria-hidden /> Added</span>
    case 'failed':
      return <span className={cn(base, 'text-danger')}><XCircle className="size-3.5" aria-hidden /> Failed</span>
    default:
      return <span className={cn(base, 'text-muted')}>Cancelled</span>
  }
}
