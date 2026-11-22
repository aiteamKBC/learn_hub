/**
 * Site-wide smooth scrolling (Lenis) wired to the GSAP ticker so Lenis and ScrollTrigger
 * stay in sync. Mounted once at the app root. Disabled when the viewer prefers reduced
 * motion. Inner scroll areas opt out with `data-lenis-prevent`.
 */
import type Lenis from 'lenis'
import { useEffect } from 'react'

import 'lenis/dist/lenis.css'

import { reducedMotion } from '@/lib/motion'

// Module singleton so links/anchors can scroll through Lenis (falls back to native).
let lenis: Lenis | null = null

const prefersNativeTouchScroll = () =>
  typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)

/** Jump to the top of the page at once (no animation) — used on navigation so a new
 * route opens at its top. Goes through Lenis when it's running, else native. */
export function scrollToTopInstant() {
  if (lenis) {
    lenis.scrollTo(0, { immediate: true })
    return
  }
  window.scrollTo(0, 0)
}

/** Jump to a given Y position at once (no animation) — used to restore the scroll
 * position on Back/Forward navigation. Goes through Lenis when it's running, else native. */
export function scrollToInstant(y: number) {
  if (lenis) {
    lenis.scrollTo(y, { immediate: true })
    return
  }
  window.scrollTo(0, y)
}

/** Smooth-scroll to an element (or the top), honouring the sticky header offset. */
export function smoothScrollTo(target: Element | number, offset = -72) {
  if (lenis) {
    lenis.scrollTo(target as HTMLElement, { offset })
    return
  }
  if (typeof target === 'number') window.scrollTo({ top: target, behavior: 'smooth' })
  else target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Smooth-scroll to a section by id and *stay locked on it* while the page settles.
 * Sections above the target (e.g. the async course lists) can grow after the first
 * scroll and shove the target away, which used to land you on the wrong section. So
 * we wait for the section to exist, then re-aim a few times over ~1s. Any real user
 * scroll (wheel / touch / arrow keys) cancels it immediately, so it never fights you.
 * Returns a cleanup function.
 */
export function scrollToAnchor(id: string): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout>

  const cancel = () => {
    cancelled = true
    clearTimeout(timer)
    window.removeEventListener('wheel', cancel)
    window.removeEventListener('touchmove', cancel)
    window.removeEventListener('keydown', cancel)
  }
  window.addEventListener('wheel', cancel, { passive: true })
  window.addEventListener('touchmove', cancel, { passive: true })
  window.addEventListener('keydown', cancel)

  // Re-aim at these elapsed times (ms); the gaps cover async content loading in.
  const marks = [0, 150, 400, 750, 1100]
  let i = 0
  let waited = 0

  const step = () => {
    if (cancelled) return
    const el = document.getElementById(id)
    if (!el) {
      // section not mounted yet (navigated in from another page): keep waiting
      if ((waited += 100) > 3000) return cancel()
      timer = setTimeout(step, 100)
      return
    }
    smoothScrollTo(el)
    i += 1
    if (i < marks.length) {
      timer = setTimeout(step, marks[i]! - marks[i - 1]!)
    } else {
      cancel()
    }
  }
  step()
  return cancel
}

export function SmoothScroll() {
  useEffect(() => {
    // Native touch scrolling avoids delayed gestures and unnecessary animation work on
    // phones and tablets. Desktop keeps the enhanced wheel-scrolling experience.
    if (reducedMotion() || prefersNativeTouchScroll()) return
    let disposed = false
    let destroy = () => {}
    void Promise.all([import('lenis'), import('gsap'), import('gsap/ScrollTrigger')]).then(([lenisModule, gsapModule, triggerModule]) => {
      if (disposed) return
      const LenisConstructor = lenisModule.default
      const { gsap } = gsapModule
      const { ScrollTrigger } = triggerModule
      gsap.registerPlugin(ScrollTrigger)
      const l = new LenisConstructor({
        duration: 1.25,
      // Gentle expo ease-out: quick to respond, long calm settle — a clearly "smooth" feel.
        easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1,
      })
      lenis = l
      l.on('scroll', ScrollTrigger.update)
      const onTick = (time: number) => l.raf(time * 1000)
      gsap.ticker.add(onTick)
      gsap.ticker.lagSmoothing(0)
      destroy = () => {
        gsap.ticker.remove(onTick)
        l.destroy()
        if (lenis === l) lenis = null
      }
    })
    return () => {
      disposed = true
      destroy()
    }
  }, [])
  return null
}
