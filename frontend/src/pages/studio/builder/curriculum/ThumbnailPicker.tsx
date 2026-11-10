import { ImageIcon, ImageOff } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type VideoDetails, useSetVideoThumbnail } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { errText } from './shared'

// Bunny's CDN serves these images only to requests that carry a referrer (our site).
const REFERRER = 'strict-origin-when-cross-origin'

/** An image that shows a neutral placeholder when Bunny hasn't made it yet. */
function Thumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (broken)
    return (
      <span className={cn('flex aspect-video items-center justify-center bg-surface-2 text-subtle', className)} role="img" aria-label={`${alt} (not available yet)`}>
        <ImageOff className="size-5" aria-hidden />
      </span>
    )
  return <img src={src} alt={alt} referrerPolicy={REFERRER} loading="lazy" onError={() => setBroken(true)} className={cn('aspect-video w-full bg-surface-2 object-cover', className)} />
}

/** Choose the video's thumbnail: one of Bunny's 5 frames, or an https image link. */
export function ThumbnailPicker({ assetId, details, readOnly }: { assetId: string; details: VideoDetails; readOnly?: boolean }) {
  const set = useSetVideoThumbnail(assetId)
  const frames = details.thumbnails.frames
  const [choice, setChoice] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [version, setVersion] = useState(0) // cache-busts the current thumbnail after a change
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const checked = frames.findIndex((f) => f.name === choice)
  const value = link.trim() || choice

  const submit = async () => {
    setError('')
    setDone(false)
    if (link.trim() && !link.trim().startsWith('https://')) return setError('Use an image link that starts with https://')
    if (!value) return
    try {
      await set.mutateAsync(value)
      setVersion(Date.now())
      setChoice(null)
      setLink('')
      setDone(true)
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <section className="grid gap-3" aria-label="Thumbnail">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon className="size-4 text-muted" aria-hidden /> Thumbnail
        </h4>
        <p className="mt-0.5 text-[13px] text-muted">The picture learners see before the video starts.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <figure className="min-w-0">
          <Thumb key={version} src={version ? `${details.thumbnails.current}?v=${version}` : details.thumbnails.current} alt="Current thumbnail" className="rounded-lg border border-border" />
          <figcaption className="mt-1 text-xs text-muted">Current</figcaption>
        </figure>
        {readOnly ? null : (
          <div className="grid min-w-0 gap-3">
            <div role="radiogroup" aria-label="Frames from the video" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {frames.map((f, i) => {
                const on = f.name === choice && !link.trim()
                return (
                  <button
                    key={f.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Frame ${i + 1}`}
                    tabIndex={radioTabIndex(i, checked)}
                    onClick={() => (setChoice(f.name), setLink(''), setDone(false))}
                    onKeyDown={(e) => radioKeyDown(e, i, frames.length, (j) => (setChoice(frames[j]!.name), setLink('')))}
                    className={cn('overflow-hidden rounded-md border-2 transition-[border-color,transform] duration-150 active:scale-[0.97]', on ? 'border-primary' : 'border-transparent hover:border-border')}
                  >
                    <Thumb src={f.url} alt="" />
                  </button>
                )
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input value={link} onChange={(e) => (setLink(e.target.value), setDone(false))} placeholder="Or use an image link: https://…" aria-label="Use an image link" inputMode="url" className="h-9 min-w-0 flex-1" />
              <Button size="sm" onClick={() => void submit()} disabled={!value} loading={set.isPending}>
                Set thumbnail
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : done ? (
              <p role="status" className="text-[13px] text-success">
                Thumbnail updated. It can take a minute to change everywhere.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
