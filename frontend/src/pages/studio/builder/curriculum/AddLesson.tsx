import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { useCurriculum } from '@/features/studio/api'

import { KIND_META, errText, type LectureKind } from './shared'

export type Adding = { sectionId: string; kind: LectureKind }

/** Title (and the link, for an external link) for a new lesson; then it opens for editing. */
export function AddLessonDialog({ courseId, adding, onClose, onCreated }: { courseId: string; adding: Adding | null; onClose: () => void; onCreated: (id: string) => void }) {
  const meta = adding ? KIND_META[adding.kind] : null
  return (
    <Dialog open={!!adding} onOpenChange={(o) => !o && onClose()}>
      {adding && meta ? (
        <DialogContent title={`Add ${meta.label.toLowerCase()} lesson`} description={meta.hint}>
          <AddLessonForm key={`${adding.sectionId}-${adding.kind}`} courseId={courseId} adding={adding} onClose={onClose} onCreated={onCreated} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function AddLessonForm({ courseId, adding, onClose, onCreated }: { courseId: string; adding: Adding; onClose: () => void; onCreated: (id: string) => void }) {
  const c = useCurriculum(courseId)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const { kind } = adding
  const meta = KIND_META[kind]
  const needsUrl = kind === 'external_link'
  const urlBad = needsUrl && !/^https:\/\/\S+\.\S+/.test(url.trim())

  const submit = () => {
    if (!title.trim() || urlBad) return
    setError('')
    c.addLecture.mutate(
      { sectionId: adding.sectionId, kind, title: title.trim(), external_url: needsUrl ? url.trim() : undefined },
      { onSuccess: (r) => onCreated(r.id), onError: (e) => setError(errText(e)) },
    )
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), submit())}>
      <Field label="Title">{(p) => <Input {...p} autoFocus value={title} maxLength={200} placeholder={meta.newTitle} onChange={(e) => setTitle(e.target.value)} />}</Field>
      {needsUrl ? (
        <Field label="Link" hint="A full address starting with https://" error={url && urlBad ? 'Enter a full link starting with https://' : undefined}>
          {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={c.addLecture.isPending} disabled={!title.trim() || urlBad}>Add and edit</Button>
      </div>
    </form>
  )
}
