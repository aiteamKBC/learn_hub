/** The shopper's currency: what they picked on this browser, their saved preference, or
 * Settings > default currency for a new visitor.
 * Prices always come from the server in that currency (never converted here). */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

import { api } from '@/api/client'
import { useMe } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'

const KEY = 'currency'
const listeners = new Set<() => void>()
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function useCurrency() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const picked = useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), read, () => null)
  const fallback = usePublicSettings().settings['general.default_currency']
  const code = picked || me?.preferred_currency || fallback || undefined

  const setCurrency = useCallback(
    async (next: string) => {
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* private mode: this visit only */
      }
      listeners.forEach((l) => l())
      if (me) await api.PATCH('/api/v1/identity/me', { body: { preferred_currency: next } })
      void qc.invalidateQueries({ predicate: (q) => ['courses', 'course', 'cart', 'wishlist', 'plans', 'me'].includes(String(q.queryKey[0])) })
    },
    [me, qc],
  )
  return { code, setCurrency }
}
