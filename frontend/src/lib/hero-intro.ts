/**
 * Tiny shared flag for the home hero's intro video. The header's "Skip" button lives in
 * a different component tree from the hero, so they coordinate through this module store
 * rather than prop-drilling. `skipped` means the intro should not (or no longer) play.
 */
import { useSyncExternalStore } from 'react'

let skipped = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Hide the intro video and reveal the hero. Safe to call repeatedly. */
export function skipHeroIntro() {
  if (skipped) return
  skipped = true
  emit()
}

/** Let the intro play again (called when the hero mounts fresh). */
export function resetHeroIntro() {
  if (!skipped) return
  skipped = false
  emit()
}

export function useHeroIntroSkipped() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => skipped,
    () => skipped,
  )
}
