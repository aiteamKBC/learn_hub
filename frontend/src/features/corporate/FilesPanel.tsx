import { Download, File as FileIcon, FileArchive, FileImage, FileText, Paperclip, Trash2, Upload as UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ConfirmDialog } from '@/features/console/ui'

import type { FileRow, Upload } from './agreements'
import { fullDate } from './format'
import { QueryBlock } from './ui'

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.rtf,.zip,.png,.jpg,.jpeg,.webp'

function kindIcon(mime: string) {
  if (mime.startsWith('image/')) return <FileImage className="size-4 text-info" />
  if (mime.includes('zip')) return <FileArchive className="size-4 text-warning" />
  if (mime.includes('pdf') || mime.includes('word') || mime.startsWith('text/')) return <FileText className="size-4 text-primary" />
  return <FileIcon className="size-4 text-muted" />
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Files kept with one purchase. The server decides who may see, add and delete them;
 * can_delete comes from it, so the buttons only mirror what it allows. */
export function FilesPanel({
  query,
  upload,
  remove,
  download,
}: {
  query: { data?: FileRow[]; isLoading: boolean; error: unknown; refetch: () => unknown }
  upload: { mutateAsync: (u: Upload) => Promise<unknown>; isPending: boolean }
  remove: { mutate: (id: string, o: { onSuccess: () => void; onError: (e: unknown) => void }) => void; isPending: boolean }
  download: (id: string) => Promise<string>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<FileRow | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setPct(0)
    try {
      await upload.mutateAsync({ file, onProgress: setPct })
      toast.success(`${file.name} uploaded`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPct(null)
      if (input.current) input.current.value = ''
    }
  }
  const open = async (id: string) => {
    try {
      window.open(await download(id), '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <section className="grid gap-3" aria-label="Files">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4" /> Files
        </h3>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a file to upload" onChange={(e) => void pick(e.target.files?.[0])} />
        <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
          <UploadIcon /> Upload a file
        </Button>
      </div>
      {pct != null ? <Progress value={pct} label={`Uploading, ${pct}%`} /> : null}
      <QueryBlock query={query} rows={2} empty={{ icon: <Paperclip />, title: 'No files yet', body: 'Contracts, purchase orders and other papers for this purchase.' }}>
        {(rows) => (
          <ul className="stagger grid gap-2">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  {kindIcon(f.mime_type)}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.filename}</p>
                    <p className="text-xs text-muted">
                      {size(f.size_bytes)} · {f.uploaded_by_staff ? 'LearnHub' : f.uploaded_by_name} · {fullDate(f.uploaded_at)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Download ${f.filename}`} onClick={() => void open(f.id)}>
                    <Download />
                  </Button>
                  {f.can_delete ? (
                    <Button size="sm" variant="ghost" aria-label={`Delete ${f.filename}`} onClick={() => setDeleting(f)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryBlock>
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this file?"
        body={deleting ? `${deleting.filename} will be removed for everyone. This cannot be undone.` : undefined}
        confirmLabel="Delete file"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => (toast.success('File deleted'), setDeleting(null)),
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
    </section>
  )
}
