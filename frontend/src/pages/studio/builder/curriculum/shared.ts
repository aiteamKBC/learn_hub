import { ClipboardCheck, Download, ExternalLink, FileText, ListChecks, PlayCircle, Radio, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { startVideoUpload, type LECTURE_KINDS } from '@/features/studio/api'

export type LectureKind = (typeof LECTURE_KINDS)[number]

/** Icon, plain label and one-line hint per lecture kind (menu order = LECTURE_KINDS). */
export const KIND_META: Record<LectureKind, { label: string; Icon: LucideIcon; hint: string; newTitle: string }> = {
  video: { label: 'Video', Icon: PlayCircle, hint: 'Upload a video lesson', newTitle: 'New video' },
  article: { label: 'Reading', Icon: FileText, hint: 'Text, lists and links', newTitle: 'New reading' },
  external_link: { label: 'External link', Icon: ExternalLink, hint: 'Send learners to a web page', newTitle: 'New link' },
  live_session: { label: 'Live session', Icon: Radio, hint: 'A scheduled online class', newTitle: 'New live session' },
  download: { label: 'Download', Icon: Download, hint: 'Files learners download', newTitle: 'New download' },
  quiz: { label: 'Quiz', Icon: ListChecks, hint: 'Questions with automatic marking', newTitle: 'New quiz' },
  assignment: { label: 'Assignment', Icon: ClipboardCheck, hint: 'Work you mark by hand', newTitle: 'New assignment' },
}

export const kindMeta = (kind: string) => KIND_META[kind as LectureKind] ?? KIND_META.article

/** The message to show for a failed call: the API's own words where it gave some. */
export function errText(e: unknown, fallback = 'That did not work. Try again.') {
  if (e instanceof ApiError || e instanceof Error) return e.message || fallback
  return fallback
}

/** Plain text from server-cleaned HTML (for list rows and previews). */
export function textOf(html: string) {
  if (!html) return ''
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
}

/** ISO date-time <-> the value of an <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export const timeZoneName = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function fileSize(bytes?: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export const DISCARD = 'You have unsaved changes. Leave without saving them?'

/** While `dirty`: warn on tab close / reload, and before in-app navigation. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(DISCARD)) blocker.proceed()
    else blocker.reset()
  }, [blocker])
}

/** Move one item of a list from one index to another (returns a new array). */
export function moved<T>(list: T[], from: number, to: number) {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!)
  return next
}

// ---------------------------------------------------------------- Bunny (TUS) upload
const b64 = (s: string) => {
  let bin = ''
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte)
  return btoa(bin)
}

export const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const abortError = () => new DOMException('The upload was cancelled.', 'AbortError')

/** Uploads a video straight to Bunny with the TUS protocol (create, then one PATCH with
 * the whole file). Auth headers are the per-video signature the API returned; the
 * Bunny key itself never reaches the browser. `signal` cancels it (AbortError). */
export async function tusUpload(
  session: { endpoint: string; headers: Record<string, string> },
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortError()
  const create = await fetch(session.endpoint, {
    method: 'POST',
    signal,
    headers: {
      ...session.headers,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.size),
      'Upload-Metadata': `filetype ${b64(file.type || 'video/mp4')},title ${b64(file.name)}`,
    },
  }).catch((e) => {
    if (cancelled(e)) throw e
    throw new Error('Could not reach the video service. Check your connection.')
  })
  const location = create.headers.get('Location')
  if (!create.ok || !location) throw new Error(`The video service refused the upload (${create.status}).`)
  const target = new URL(location, session.endpoint).toString()
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const xhr = new XMLHttpRequest()
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.onabort = () => reject(abortError())
    xhr.open('PATCH', target)
    for (const [k, v] of Object.entries(session.headers)) xhr.setRequestHeader(k, v)
    xhr.setRequestHeader('Tus-Resumable', '1.0.0')
    xhr.setRequestHeader('Upload-Offset', '0')
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The video upload failed (${xhr.status}). Try again.`)))
    xhr.onerror = () => reject(new Error('The video upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
}

export const VIDEO_MAX_BYTES = 20 * 1024 ** 3

/** Why this file can't be uploaded as a video, or '' when it can. */
export function videoFileError(file: File) {
  if (!file.type.startsWith('video/')) return 'Choose a video file (MP4, MOV, MKV or WebM).'
  if (file.size > VIDEO_MAX_BYTES) return 'Videos can be up to 20 GB.'
  return ''
}

/** Ticket from the API, then the file straight to Bunny. Returns the new media asset id;
 * the caller attaches it to a lesson. */
export async function uploadVideoFile(opts: { courseId: string; title: string; file: File; onProgress?: (pct: number) => void; signal?: AbortSignal }) {
  const { courseId, title, file, onProgress, signal } = opts
  const ticket = await startVideoUpload({ course_id: courseId, title, filename: file.name, size_bytes: file.size })
  await tusUpload(ticket.upload, file, onProgress, signal)
  return ticket.asset_id
}

/** The message for a failed video upload. */
export const uploadErrText = (e: unknown) => (e instanceof ApiError && e.status === 503 ? 'Video uploads are not set up on this server yet.' : errText(e))

/** Seconds <-> hours, minutes, seconds (for the duration fields). */
export function splitSeconds(total: number) {
  const s = Math.max(0, Math.floor(total))
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}
