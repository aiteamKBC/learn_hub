const STORAGE_PREFIX = 'evidrise:home-intro:v2:'

function storageKey(viewerId?: string | null) {
  return `${STORAGE_PREFIX}${viewerId || 'guest'}`
}

/** The intro is remembered per signed-in account, or once for this browser's guest. */
export function hasSeenHeroIntro(viewerId?: string | null) {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(storageKey(viewerId)) === 'seen'
  } catch {
    return false
  }
}

export function markHeroIntroSeen(viewerId?: string | null) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(viewerId), 'seen')
  } catch {
    // Storage can be unavailable in strict/private browser modes; the intro still closes.
  }
}
