import { useSyncExternalStore } from 'react'

/**
 * Bunny Stream's player is an iframe; its player.js bridge reports the playhead so we can
 * resume where the learner left off and count real watch time.
 * https://docs.bunny.net/docs/playback-control-api
 */
type Handler = (data?: { seconds?: number; duration?: number }) => void
export interface BunnyPlayer {
  on(event: 'ready' | 'play' | 'pause' | 'ended' | 'timeupdate', fn: Handler): void
  off(event: string): void
  setCurrentTime(sec: number): void
  play?(): void
  supports(kind: 'method' | 'event', name: string): boolean
}
declare global {
  interface Window {
    playerjs?: { Player: new (el: HTMLIFrameElement) => BunnyPlayer }
  }
}

const SRC = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js'
let loading: Promise<void> | null = null

/** Loads player.js once, on the first video only (it is never in the main bundle). */
export function loadPlayerJs(): Promise<void> {
  if (window.playerjs) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('player.js failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** The embed URL with resume time and the options we want (keeps the signed token). */
export function embedUrl(url: string, startSec: number, exact = false) {
  const u = new URL(url)
  u.searchParams.set('autoplay', 'false')
  u.searchParams.set('preload', 'true')
  u.searchParams.set('responsive', 'true')
  // resuming skips the first few seconds; an exact time (a note's ?t=) is always honoured
  if (startSec > 5 || (exact && startSec > 0)) u.searchParams.set('t', String(Math.floor(startSec)))
  return u.toString()
}

/** Where the current video is, so a note can be pinned to that moment. */
export const playhead = { key: '', sec: 0 }

// The video stage registers its player here once player.js is ready, so parts, key
// moments and notes under the video can jump to a second without reloading the page.
let active: { key: string; player: BunnyPlayer } | null = null
const listeners = new Set<() => void>()

export function registerPlayer(key: string, player: BunnyPlayer) {
  active = { key, player }
  return () => {
    if (active?.player === player) active = null
  }
}

/** Seeks the open lecture's video (and plays it). False when that lecture isn't playing here. */
export function seekTo(key: string, sec: number): boolean {
  if (!active || active.key !== key) return false
  active.player.setCurrentTime(Math.max(0, sec))
  if (active.player.play && active.player.supports('method', 'play')) active.player.play()
  emitPlayhead(key, sec)
  return true
}

/** Called on every player time update; notifies subscribers (they read whole seconds). */
export function emitPlayhead(key: string, sec: number) {
  const changed = playhead.key !== key || Math.floor(playhead.sec) !== Math.floor(sec)
  playhead.key = key
  playhead.sec = sec
  if (changed) listeners.forEach((fn) => fn())
}

export function subscribePlayhead(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The current whole second of this lecture's video, or null while another one plays. */
export function usePlayheadSec(lectureKey: string): number | null {
  return useSyncExternalStore(subscribePlayhead, () => (playhead.key === lectureKey ? Math.floor(playhead.sec) : null))
}

/** What a new note is pinned to: the live playhead (default), a typed time, or nothing. */
export type Pin = { mode: 'live' } | { mode: 'fixed'; sec: number } | { mode: 'none' }

export function pinnedSecond(pin: Pin, live: number | null): number | null {
  return pin.mode === 'fixed' ? pin.sec : pin.mode === 'live' ? (live ?? 0) : null
}

/** `75` -> `1:15`, `3725` -> `1:02:05` */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** `1:15` / `01:02:05` / `90` -> seconds, or null when it isn't a time. */
export function parseClock(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,5}(:\d{1,2}){0,2}$/.test(t)) return null
  const parts = t.split(':').map(Number)
  if (parts.slice(1).some((n) => n > 59)) return null
  const sec = parts.reduce((acc, n) => acc * 60 + n, 0)
  return sec <= 86400 ? sec : null
}
