import { SkipForward } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { skipHeroIntro, useHeroIntroSkipped } from '@/lib/hero-intro'
import { reducedMotion } from '@/lib/motion'

/**
 * The intro clip played full-bleed over the hero when the landing page first loads.
 * Served as the original WebM (no ImageKit re-encode) so the full clip plays.
 */
const INTRO_VIDEO = 'https://ik.imagekit.io/bmjbddbgyi/evidrise_hero_ending.webm?tr=orig-true'

/**
 * Full-bleed intro video that plays once when the landing page first loads, then fades away
 * to reveal the hero underneath — the galeed.shop pattern. A "Skip" button (and Escape, and
 * the clip ending) all dismiss it. It never replays within the same session, and it steps
 * aside entirely for reduced-motion users so nothing autoplays at them.
 */
/** Phones skip the full-screen intro clip entirely (data + a cleaner first paint on mobile). */
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

export function HeroIntro() {
  const alreadySkipped = useHeroIntroSkipped()
  // Decide once, on first render, whether the intro should ever show. Reduced-motion users,
  // phone viewers, and anyone who already dismissed it this session go straight to the hero.
  const [active, setActive] = useState(() => !alreadySkipped && !reducedMotion() && !isPhone())
  const [closing, setClosing] = useState(false)
  const [ready, setReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const endTimer = useRef<number | undefined>(undefined)

  // Fade the overlay out, then hand the hero over to the rest of the page via the shared flag.
  // No scroll is forced here: the page is already at the top (we never scrolled while the intro
  // covered it), and snapping the scroll on close caused a visible jump/lag as the hero appeared.
  const close = useCallback(() => {
    setClosing((was) => {
      if (was) return was
      window.clearTimeout(endTimer.current)
      window.setTimeout(() => {
        skipHeroIntro()
        setActive(false)
      }, 650)
      return true
    })
  }, [])

  // Once the clip's length is known, arm an absolute fallback: close shortly after it should
  // have finished. If playback ever stalls near the end (so `ended` never fires), the intro
  // still steps aside instead of freezing on screen.
  const armFallback = useCallback(() => {
    setReady(true)
    const d = videoRef.current?.duration
    if (d && Number.isFinite(d)) {
      window.clearTimeout(endTimer.current)
      endTimer.current = window.setTimeout(close, (d + 2) * 1000)
    }
  }, [close])

  // If the store gets skipped from elsewhere (e.g. the header control), close in step.
  useEffect(() => {
    if (alreadySkipped && active) close()
  }, [alreadySkipped, active, close])

  // Escape dismisses the intro, like any overlay.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, close])

  // We deliberately do NOT lock body scroll (no `overflow: hidden`). Hiding the scrollbar while
  // the intro plays and restoring it on close made the scrollbar flash back in — an ugly pop as
  // the hero appeared. Leaving the scrollbar untouched keeps it steady, and the hero already has
  // its own "Scroll" cue. The full-bleed fixed overlay still covers the page while it plays.
  // Instead we just swallow scroll gestures so the page stays put behind the intro.
  useEffect(() => {
    if (!active) return
    const block = (e: Event) => e.preventDefault()
    window.addEventListener('wheel', block, { passive: false })
    window.addEventListener('touchmove', block, { passive: false })
    return () => {
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
    }
  }, [active])

  // Drop the fallback timer if the intro unmounts for any reason.
  useEffect(() => () => window.clearTimeout(endTimer.current), [])

  // Nudge playback to start. Muted autoplay is allowed, but some browsers only honour it
  // once we ask explicitly, so call play() as soon as the element is mounted.
  useEffect(() => {
    if (!active) return
    videoRef.current?.play().catch(() => {})
  }, [active])

  // Safety net: if the file never becomes playable (bad codec, blocked, offline), don't
  // trap the visitor — reveal the hero after a grace period.
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => {
      if (!videoRef.current || videoRef.current.readyState < 2) close()
    }, 6000)
    return () => window.clearTimeout(t)
  }, [active, close])

  if (!active) return null

  return (
    <div
      role="dialog"
      aria-label="Intro"
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center bg-[#1f262e] transition-opacity duration-[650ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
        closing ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={armFallback}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onTimeUpdate={() => {
          const v = videoRef.current
          // Close as soon as we reach the end, rather than relying only on `ended` (which some
          // clips/browsers don't fire reliably), so the hero is never left waiting behind a
          // paused final frame.
          if (v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.2) close()
        }}
        onEnded={close}
        onError={close}
        className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out', ready ? 'opacity-100' : 'opacity-0')}
      >
        <source src={INTRO_VIDEO} type="video/webm" />
      </video>

      {/* 40% charcoal shade over the clip. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(31,38,46,0.4)]" />
      {/* Soft veil so the Skip control stays legible over any frame of the clip. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_85%_10%,rgba(31,38,46,0.55),transparent_55%)]" />

      <Button
        size="lg"
        autoFocus
        onClick={close}
        className="absolute right-4 top-4 h-12 gap-2 rounded-full border border-white/25 bg-black/35 px-7 text-base text-white shadow-lg backdrop-blur-md hover:bg-black/55 sm:right-6 sm:top-6"
      >
        Skip <SkipForward className="size-5" />
      </Button>
    </div>
  )
}
