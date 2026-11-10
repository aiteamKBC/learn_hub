import { Check, CheckCircle2, Clapperboard, Link2, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchVideoFromLink, useCurriculum, useMediaStatus, useVideoDetails, type StudioLecture, type VideoDetails } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { duration } from '@/lib/format'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { cancelled, errText, fileSize, uploadErrText, uploadVideoFile, videoFileError } from './shared'
import { Subtitles } from './Subtitles'
import { ThumbnailPicker } from './ThumbnailPicker'
import { type PreviewPlayer, usePreviewPlayer, VideoParts } from './VideoParts'

type Source = 'upload' | 'link'
const SOURCES: { id: Source; title: string; body: string; Icon: typeof UploadCloud }[] = [
  { id: 'upload', title: 'Upload video', body: 'Upload a video from your device (recommended).', Icon: UploadCloud },
  { id: 'link', title: 'External video URL', body: 'Add a direct link to a video file.', Icon: Link2 },
]

/** A video lesson's media: upload (TUS straight to Bunny) or a direct link Bunny fetches,
 * then processing, the preview, qualities, subtitles, parts, key moments and thumbnail. */
export function VideoSource({ courseId, lecture, readOnly, onDirty }: { courseId: string; lecture: StudioLecture; readOnly?: boolean; onDirty?: (dirty: boolean) => void }) {
  const { updateLecture } = useCurriculum(courseId)
  const [source, setSource] = useState<Source>('upload')
  const [up, setUp] = useState<{ name: string; size: number; pct: number } | null>(null)
  const [lastFile, setLastFile] = useState<{ name: string; size: number } | null>(null)
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const assetId = lecture.video?.id
  const status = useMediaStatus(assetId)
  const media = status.data ?? (lecture.video ? { ...lecture.video, preview_url: null } : undefined)
  const frame = useRef<HTMLIFrameElement>(null)
  const player = usePreviewPlayer(frame, media?.preview_url)
  const processed = !!assetId && !!media && ['playable', 'ready'].includes(media.status)
  const details = useVideoDetails(assetId, processed)

  // the course tree (and its publish checklist) still has the old status: refresh it the
  // moment the video becomes playable, so "has no finished video" goes away straight away
  const qc = useQueryClient()
  const treeStatus = lecture.video?.status
  useEffect(() => {
    if (processed && treeStatus && !['playable', 'ready'].includes(treeStatus)) void qc.invalidateQueries({ queryKey: ['studio', 'course', courseId] })
  }, [processed, treeStatus, courseId, qc])

  const start = async (file: File | undefined) => {
    if (!file) return
    setError('')
    const bad = videoFileError(file)
    if (bad) return setError(bad)
    setUp({ name: file.name, size: file.size, pct: 0 })
    abort.current = new AbortController()
    try {
      const id = await uploadVideoFile({ courseId, title: lecture.title, file, signal: abort.current.signal, onProgress: (pct) => setUp({ name: file.name, size: file.size, pct }) })
      await updateLecture.mutateAsync({ lectureId: lecture.id, body: { video_id: id } })
      setLastFile({ name: file.name, size: file.size })
    } catch (e) {
      if (!cancelled(e)) setError(uploadErrText(e))
    } finally {
      setUp(null)
      abort.current = null
      if (input.current) input.current.value = ''
    }
  }

  const linkBad = !/^https:\/\/\S+\.\S+/.test(link.trim())
  const fetchLink = async () => {
    if (linkBad) return setError('Enter a full link starting with https://')
    setError('')
    setFetching(true)
    try {
      const r = await fetchVideoFromLink({ course_id: courseId, title: lecture.title, url: link.trim() })
      await updateLecture.mutateAsync({ lectureId: lecture.id, body: { video_id: r.asset_id } })
      setLink('')
      setLastFile(null)
    } catch (e) {
      setError(uploadErrText(e))
    } finally {
      setFetching(false)
    }
  }

  const removeVideo = () => {
    if (!window.confirm('Remove this video from the lesson? The video itself stays in your library.')) return
    setError('')
    updateLecture.mutate({ lectureId: lecture.id, body: { video_id: null } }, { onSuccess: () => setLastFile(null), onError: (e) => setError(errText(e)) })
  }

  const checked = SOURCES.findIndex((s) => s.id === source)

  return (
    <section aria-labelledby={`video-${lecture.id}`} className="grid gap-4">
      <h3 id={`video-${lecture.id}`} className="text-sm font-semibold">
        Video source{readOnly ? null : <span className="text-danger" aria-hidden> *</span>}
      </h3>

      {readOnly ? null : (
        <div role="radiogroup" aria-labelledby={`video-${lecture.id}`} className="grid gap-3 sm:grid-cols-2">
          {SOURCES.map((s, i) => {
            const on = s.id === source
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={radioTabIndex(i, checked)}
                onKeyDown={(e) => radioKeyDown(e, i, SOURCES.length, (j) => setSource(SOURCES[j]!.id))}
                onClick={() => (setSource(s.id), setError(''))}
                className={cn(
                  'relative grid justify-items-start gap-1.5 rounded-lg border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  on ? 'border-primary bg-primary-soft/40 ring-3 ring-primary/15' : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className={cn('absolute top-3 right-3 flex size-4 items-center justify-center rounded-full border-2 transition-colors', on ? 'border-primary' : 'border-border-strong')} aria-hidden>
                  <span className={cn('size-2 rounded-full bg-primary transition-transform duration-200', on ? 'scale-100' : 'scale-0')} />
                </span>
                <s.Icon className={cn('size-6', on ? 'text-primary' : 'text-muted')} aria-hidden />
                <span className="text-sm font-semibold">{s.title}</span>
                <span className="pr-4 text-xs text-muted">{s.body}</span>
              </button>
            )
          })}
        </div>
      )}

      {readOnly ? null : up ? (
        <div className="animate-reveal rounded-lg border border-border bg-surface-2/50 p-3" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">Uploading {up.name} · {fileSize(up.size)}</span>
            <span className="shrink-0 tabular text-muted">{up.pct}%</span>
          </div>
          <Progress value={up.pct} label={`Uploading ${up.name}`} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Keep this window open until the upload finishes.</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancel upload</Button>
          </div>
        </div>
      ) : source === 'upload' ? (
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), void start(e.dataTransfer.files[0]))}
          className={cn('grid place-items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors duration-200', over ? 'border-primary bg-primary-soft/40' : 'border-primary/30 bg-primary-soft/15')}
        >
          <UploadCloud className="size-7 text-primary" aria-hidden />
          <p className="text-sm">
            Drag and drop your video here, or{' '}
            <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => input.current?.click()}>
              click to browse
            </button>
          </p>
          <p className="text-xs text-muted">MP4, MOV, MKV or WebM · up to 20 GB{media ? ' · replaces the current video' : ''}</p>
          <input ref={input} type="file" accept="video/*" className="sr-only" aria-label="Choose a video file" onChange={(e) => void start(e.target.files?.[0])} />
        </div>
      ) : (
        // not a <form>: this sits inside the lesson's form
        <div className="grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
          <label htmlFor={`link-${lecture.id}`} className="text-sm font-medium">Link to the video file</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={`link-${lecture.id}`} type="url" inputMode="url" placeholder="https://example.com/lesson.mp4" value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void fetchLink())} className="min-w-0 flex-1" aria-describedby={`link-${lecture.id}-hint`} />
            <Button type="button" variant="secondary" loading={fetching} onClick={() => void fetchLink()} disabled={!link.trim()}>Add video</Button>
          </div>
          <p id={`link-${lecture.id}-hint`} className="text-xs text-muted">
            Use a direct link to a video file (for example one ending in .mp4). We copy it to our video service, so it plays and is protected like an upload. YouTube and Vimeo pages can't be used.
          </p>
        </div>
      )}

      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}

      {media ? (
        <div className="animate-reveal overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text"><Clapperboard className="size-4" aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{lastFile?.name || lecture.video?.filename || 'Lesson video'}</span>
              <span className="block text-xs text-muted tabular">
                {[lastFile ? fileSize(lastFile.size) : lecture.video?.size_bytes ? fileSize(lecture.video.size_bytes) : '', media.duration_sec ? duration(media.duration_sec) : ''].filter(Boolean).join(' · ') || 'Length not known yet'}
              </span>
            </span>
            <span aria-live="polite" className="shrink-0"><VideoStatus status={media.status} progress={media.encode_progress} /></span>
            {readOnly ? null : (
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove the video from this lesson" loading={updateLecture.isPending && updateLecture.variables?.body.video_id === null} onClick={removeVideo}><Trash2 /></Button>
            )}
          </div>
          {['ready', 'failed'].includes(media.status) ? null : <Progress value={Math.max(4, media.encode_progress)} className="rounded-none" label="Processing" />}
          {media.preview_url ? (
            <div className="aspect-video bg-black">
              <iframe ref={frame} src={media.preview_url} title={`Preview of ${lecture.title}`} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" />
            </div>
          ) : null}
          {processed ? <Qualities details={details.data} loading={details.isLoading} ready={media.status === 'ready'} /> : null}
        </div>
      ) : null}

      {processed && assetId ? <VideoExtras assetId={assetId} details={details} player={player} readOnly={readOnly} onDirty={onDirty} /> : null}
    </section>
  )
}

function VideoStatus({ status, progress }: { status: string; progress: number }) {
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'ready') return <span className={cn(pill, 'bg-success-soft text-success')}><Check className="size-3.5" aria-hidden /> Processing complete</span>
  if (status === 'failed') return <span className={cn(pill, 'bg-danger-soft text-danger')}><XCircle className="size-3.5" aria-hidden /> Failed. Upload it again.</span>
  if (status === 'playable') return <span className={cn(pill, 'bg-success-soft text-success')}><CheckCircle2 className="size-3.5" aria-hidden /> Playable · {progress}%</span>
  if (status === 'awaiting_upload') return <span className={cn(pill, 'bg-surface-2 text-muted')}><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Waiting for upload</span>
  return <span className={cn(pill, 'bg-surface-2 text-muted')}><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Processing {progress}%</span>
}

/** The qualities Bunny made for adaptive streaming. */
function Qualities({ details, loading, ready }: { details?: VideoDetails; loading: boolean; ready: boolean }) {
  const list = [...(details?.resolutions ?? [])].sort((a, b) => parseInt(b) - parseInt(a))
  return (
    <div className="grid gap-2 border-t border-border bg-surface-2/40 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-medium">Processed versions <span className="font-normal text-muted">(adaptive streaming)</span></span>
        {ready ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><Check className="size-3.5" aria-hidden /> Ready for streaming</span> : <span className="text-xs text-muted">Higher qualities still processing</span>}
      </div>
      {loading ? (
        <div className="flex gap-2" aria-busy="true"><Skeleton className="h-7 w-16" /><Skeleton className="h-7 w-16" /><Skeleton className="h-7 w-16" /></div>
      ) : list.length ? (
        <ul className="stagger flex flex-wrap gap-2" aria-label="Processed versions">
          {list.map((r) => (
            <li key={r} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium tabular">
              {r} <Check className="size-3.5 text-success" aria-hidden />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Not reported yet.</p>
      )}
    </div>
  )
}

/** Subtitles, parts, key moments and thumbnail, once Bunny has the video. */
function VideoExtras({ assetId, details, player, readOnly, onDirty }: { assetId: string; details: ReturnType<typeof useVideoDetails>; player: PreviewPlayer; readOnly?: boolean; onDirty?: (dirty: boolean) => void }) {
  if (details.isLoading)
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  if (details.error || !details.data) return <ErrorState message={errText(details.error, "We couldn't load this video's details.")} onRetry={() => void details.refetch()} />
  return (
    <div className="animate-reveal grid gap-4">
      <Subtitles assetId={assetId} captions={details.data.captions} readOnly={readOnly} />
      <div className="grid gap-6 rounded-lg border border-border bg-surface-2/40 p-3 sm:p-4">
        <VideoParts assetId={assetId} details={details.data} player={player} readOnly={readOnly} onDirty={onDirty} />
        <ThumbnailPicker assetId={assetId} details={details.data} readOnly={readOnly} />
      </div>
    </div>
  )
}
