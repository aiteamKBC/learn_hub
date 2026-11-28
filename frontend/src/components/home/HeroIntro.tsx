import { useCallback, useEffect, useRef, useState } from 'react'

import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { hasSeenHeroIntro, markHeroIntroSeen } from '@/lib/hero-intro'
import { reducedMotion } from '@/lib/motion'

const INTRO_VIDEO = '/hero-intro.mp4'
const INTRO_SECONDS = 7
const FADE_MS = 600

/** A short, one-time brand intro shown only before the public homepage. */
export function HeroIntro() {
  const { data: me, isLoading } = useMe()
  if (isLoading) return null
  return <HeroIntroMedia viewerId={me?.id ?? 'guest'} />
}

function HeroIntroMedia({ viewerId }: { viewerId: string }) {
  const [shouldShow] = useState(() => !reducedMotion() && !hasSeenHeroIntro(viewerId))
  const videoRef = useRef<HTMLVideoElement>(null)
  const fallbackTimer = useRef<number | undefined>(undefined)
  const [active, setActive] = useState(shouldShow)
  const [closing, setClosing] = useState(false)
  const [ready, setReady] = useState(false)
  const [remaining, setRemaining] = useState(INTRO_SECONDS)

  const close = useCallback(() => {
    setClosing((alreadyClosing) => {
      if (alreadyClosing) return true
      window.clearTimeout(fallbackTimer.current)
      markHeroIntroSeen(viewerId)
      window.setTimeout(() => setActive(false), FADE_MS)
      return true
    })
  }, [viewerId])

  // Reduced-motion visitors never receive autoplay, and the decision is remembered.
  useEffect(() => {
    if (!shouldShow) markHeroIntroSeen(viewerId)
  }, [shouldShow, viewerId])

  // Escape and Enter both dismiss the intro immediately.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, close])

  // Keep the homepage fixed behind the full-screen intro without changing scrollbar width.
  useEffect(() => {
    if (!active) return
    const block = (event: Event) => event.preventDefault()
    window.addEventListener('wheel', block, { passive: false })
    window.addEventListener('touchmove', block, { passive: false })
    return () => {
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
    }
  }, [active])

  // Never trap a visitor if the media is blocked or cannot be decoded.
  useEffect(() => {
    if (!active) return
    fallbackTimer.current = window.setTimeout(close, 12_000)
    return () => window.clearTimeout(fallbackTimer.current)
  }, [active, close])

  if (!active) return null

  const prepareEnding = () => {
    const video = videoRef.current
    if (!video) return
    const duration = video.duration
    if (Number.isFinite(duration) && duration > INTRO_SECONDS) video.currentTime = Math.max(0, duration - INTRO_SECONDS)
    else {
      setReady(true)
      void video.play().catch(close)
    }
  }

  const beginPlayback = () => {
    const video = videoRef.current
    if (!video) return
    setReady(true)
    void video.play().catch(close)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="EvidRise introduction"
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#111a24] transition-opacity duration-[600ms] ease-out',
        closing ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={prepareEnding}
        onSeeked={beginPlayback}
        onCanPlay={() => {
          const video = videoRef.current
          if (video && video.currentTime > 0) beginPlayback()
        }}
        onTimeUpdate={() => {
          const video = videoRef.current
          if (!video || !Number.isFinite(video.duration)) return
          const secondsLeft = Math.max(0, video.duration - video.currentTime)
          setRemaining(Math.min(INTRO_SECONDS, Math.max(0, Math.ceil(secondsLeft))))
          if (secondsLeft <= 0.15) close()
        }}
        onEnded={close}
        onError={close}
        className={cn(
          'absolute inset-0 size-full object-cover object-center transition-opacity duration-300 ease-out',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      >
        <source src={INTRO_VIDEO} type="video/mp4" />
      </video>

      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(12,21,31,0.28)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_82%_10%,rgba(0,0,0,0.42),transparent_60%)]" />

      <button
        type="button"
        autoFocus
        onClick={close}
        className="absolute top-4 right-4 inline-flex h-12 items-center gap-3 rounded-full border border-white/30 bg-[#111a24]/65 px-4 text-sm font-semibold text-white shadow-xl backdrop-blur-md transition-colors hover:bg-[#111a24]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-6 sm:right-6"
      >
        <span className="font-bold text-primary tabular" aria-live="polite">({remaining}s)</span>
        <span aria-hidden className="h-5 w-px bg-white/25" />
        <span>Skip</span>
      </button>
    </div>
  )
}
