import { useMatches } from 'react-router-dom'

import type { BackdropVariant } from '@/components/art/backdrops'

/** Each page names its own artwork in its route: `handle: { art: 'guilloche' }`. The
 * deepest match wins; layouts pass their area's default. */
export function usePageArt(fallback: BackdropVariant): BackdropVariant {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i--) {
    const art = (matches[i]!.handle as { art?: BackdropVariant } | undefined)?.art
    if (art) return art
  }
  return fallback
}
