import { Check, Download, FileText, Paperclip, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { resourceDownloadUrl, uploadLectureFile, useCurriculum, type StudioLecture } from '@/features/studio/api'

import { errText, fileSize } from './shared'

const MAX_FILES = 20

/** Files attached to any lecture: straight to Azure with a progress bar, then rename,
 * download and delete. */
export function LectureFiles({ courseId, lecture, readOnly }: { courseId: string; lecture: StudioLecture; readOnly?: boolean }) {
  const qc = useQueryClient()
  const { renameResource, deleteResource } = useCurriculum(courseId)
  const input = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    for (const file of Array.from(files)) {
      setUpload({ name: file.name, pct: 0 })
      try {
        await uploadLectureFile(lecture.id, file, (pct) => setUpload({ name: file.name, pct }))
      } catch (e) {
        setError(e instanceof ApiError && e.status === 503 ? 'File uploads are not set up on this server yet, so files cannot be attached.' : errText(e))
        break
      }
    }
    setUpload(null)
    if (input.current) input.current.value = ''
    await qc.invalidateQueries({ queryKey: ['studio', 'course', courseId] })
  }

  const download = async (id: string) => {
    setError('')
    try {
      const { url } = await resourceDownloadUrl(id)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(errText(e))
    }
  }

  const saveTitle = async () => {
    if (!editing || !editing.title.trim()) return
    try {
      await renameResource.mutateAsync({ resourceId: editing.id, title: editing.title.trim() })
      setEditing(null)
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <section aria-labelledby={`files-${lecture.id}`} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id={`files-${lecture.id}`} className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="size-4 text-muted" aria-hidden /> Lecture files</h3>
          <p className="text-[13px] text-muted">Slides, worksheets or templates learners can download.</p>
        </div>
        {readOnly ? null : (
          <>
            <input ref={input} type="file" multiple className="sr-only" id={`file-in-${lecture.id}`} onChange={(e) => void onFiles(e.target.files)} disabled={!!upload} />
            <Button type="button" variant="secondary" size="sm" disabled={!!upload || lecture.resources.length >= MAX_FILES} onClick={() => input.current?.click()}>
              <Upload /> Add files
            </Button>
          </>
        )}
      </div>

      {upload ? (
        <div className="animate-reveal rounded-lg border border-border bg-surface-2/50 p-3" aria-live="polite">
          <div className="mb-2 flex justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">Uploading {upload.name}</span>
            <span className="shrink-0 tabular text-muted">{upload.pct}%</span>
          </div>
          <Progress value={upload.pct} label={`Uploading ${upload.name}`} />
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}

      {lecture.resources.length ? (
        <ul className="stagger grid gap-2">
          {lecture.resources.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
              {editing?.id === r.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Input aria-label="File name" value={editing.title} maxLength={200} autoFocus className="h-8" onChange={(e) => setEditing({ id: r.id, title: e.target.value })} onKeyDown={(e) => {
                      // this sits inside the lecture form: Enter saves the name, not the lecture
                      if (e.key === 'Enter') (e.preventDefault(), void saveTitle())
                      if (e.key === 'Escape') (e.stopPropagation(), setEditing(null))
                    }} />
                  <Button type="button" size="icon-sm" variant="soft" aria-label="Save name" loading={renameResource.isPending} onClick={() => void saveTitle()}><Check /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}><X /></Button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title || r.filename}</p>
                    <p className="truncate text-xs text-muted">{r.filename}{r.size_bytes ? ` · ${fileSize(r.size_bytes)}` : ''}</p>
                  </div>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Download ${r.title || r.filename}`} onClick={() => void download(r.id)}><Download /></Button>
                  {readOnly ? null : (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Rename ${r.title || r.filename}`} onClick={() => setEditing({ id: r.id, title: r.title || r.filename })}><Pencil /></Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${r.title || r.filename}`}
                        onClick={() => window.confirm(`Delete "${r.title || r.filename}"?`) && deleteResource.mutate(r.id, { onError: (e) => setError(errText(e)) })}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : upload ? null : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted">No files yet.</p>
      )}
    </section>
  )
}
