import { SkipForward } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { skipHeroIntro, useHeroIntroSkipped } from '@/lib/hero-intro'
import { reducedMotion } from '@/lib/motion'

/**
 * The intro clip played full-bleed over the hero when the landing page first loads.
 * The `tr=` transform makes ImageKit serve H.264/AVC — raw uploads are often HEVC, which most
 * browsers (Chrome, Firefox) cannot decode in a <video> tag, so it must not be used directly.
 */
const INTRO_VIDEO = 'https://ik.imagekit.io/bmjbddbgyi/web%20(1).mp4?tr=w-1600,q-72'

/**
 * Full-bleed intro video that plays once when the landing page first loads, then fades away
 * to reveal the hero underneath — the galeed.shop pattern. A "Skip" button (and Escape, and
 * the clip ending) all dismiss it. It never replays within the same session, and it steps
 * aside entirely for reduced-motion users so nothing autoplays at them.
 */
export function HeroIntro() {
  const alreadySkipped = useHeroIntroSkipped()
  // Decide once, on first render, whether the intro should ever show. Reduced-motion users
  // (and anyone who already dismissed it this session) go straight to the hero.
  const [active, setActive] = useState(() => !alreadySkipped && !reducedMotion())
  const [closing, setClosing] = useState(false)
  const [ready, setReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Fade out, then hand the hero over to the rest of the page via the shared flag.
  const close = useCallback(() => {
    setClosing((was) => {
      if (was) return was
      window.setTimeout(() => {
        skipHeroIntro()
        setActive(false)
      }, 480)
      return true
    })
  }, [])

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

  // Lock background scroll while the intro is on top.
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])

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
        'fixed inset-0 z-[100] flex items-center justify-center bg-[#1f262e] transition-opacity duration-[480ms] ease-out',
        closing ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onEnded={close}
        onError={close}
        className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out', ready ? 'opacity-100' : 'opacity-0')}
      >
        <source src={INTRO_VIDEO} type="video/mp4" />
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
