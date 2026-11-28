/**
 * Development only: switch between test actors without the login screen.
 *
 * Talks to /api/v1/dev/*, which the backend mounts only with DEBUG + DEV_ACTOR_SWITCH
 * (config/settings/dev.py). That route is not in the production API schema, so this file
 * uses a small fetch instead of the typed client. Everything here is behind
 * `import.meta.env.DEV`, so Vite drops it from production builds.
 *
 * Each actor is a real seeded account signed in with a real session: permissions and
 * company isolation still apply.
 */
import { UserRoundCog } from 'lucide-react'
import { useEffect, useState } from 'react'

import { csrfToken } from '@/api/client'
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/cn'
import { setCurrentOrgId } from '@/lib/workspace'

export const DEV_SWITCH = import.meta.env.DEV

type Actor = { key: string; label: string; email: string; org_name: string | null; home: string; available: boolean }
const KEY = 'devActor'
const DEFAULT = 'employer'
const LABELS: Record<string, string> = { b2b_learner: 'Learner B2B', b2c_learner: 'Learner B2C', employer: 'Employer', admin: 'Admin' }

function stored(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT
  } catch {
    return DEFAULT
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/dev/${path}`, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken(), ...init?.headers } })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Dev switch failed (${res.status})`)
  return res.json() as Promise<T>
}

/** Sign in as `key`, pick its company workspace, then reload on its landing page (or `next`). */
export async function switchActor(key: string, next?: string) {
  const actor = await call<Actor>('switch', { method: 'POST', body: JSON.stringify({ actor: key }) })
  try {
    localStorage.setItem(KEY, key)
  } catch {
    /* private window: the default actor is used next time */
  }
  let org: string | null = null
  if (actor.org_name) {
    const me = await fetch('/api/v1/identity/me', { credentials: 'include' }).then((r) => r.json())
    org = me?.memberships?.find((m: { name: string; org_id: string }) => m.name === actor.org_name)?.org_id ?? null
  }
  setCurrentOrgId(org)
  // a full reload drops every cached query from the previous actor
  window.location.assign(next && next !== '/login' ? next : actor.home)
}

/** In development, a visitor is signed in as the last used actor instead of seeing login. */
export function useDevAutoSignIn(active: boolean, next?: string) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!DEV_SWITCH || !active) return
    switchActor(stored(), next).catch((e: Error) => setError(e.message))
  }, [active, next])
  return error
}

export function ActorSwitcher({ className }: { className?: string }) {
  const [actors, setActors] = useState<Actor[] | null>(null)
  const [busy, setBusy] = useState(false)
  const current = stored()
  if (!DEV_SWITCH) return null
  return (
    <Menu onOpenChange={(o) => o && !actors && call<Actor[]>('actors').then(setActors).catch(() => setActors([]))}>
      <MenuTrigger className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-primary/60 px-2.5 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10', className)} aria-label="Switch test actor (development only)" title="Switch test actor">
        <UserRoundCog className="size-4" />
        <span className="whitespace-nowrap">{LABELS[current] ?? 'Actor'}</span>
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel>Test actor · development only</MenuLabel>
        <MenuSeparator />
        {!actors ? (
          <p className="px-2 py-1.5 text-sm text-muted">Loading…</p>
        ) : !actors.length ? (
          <p className="px-2 py-1.5 text-sm text-danger">Switcher is off on this server.</p>
        ) : (
          <MenuRadioGroup value={current} onValueChange={(k) => (setBusy(true), switchActor(k).catch(() => setBusy(false)))}>
            {actors.map((a) => (
              <MenuRadioItem key={a.key} value={a.key} disabled={!a.available || busy}>
                <span className="grid">
                  <span className="font-medium">{a.label}</span>
                  <span className="truncate text-xs text-muted">{a.available ? a.email : 'Demo account missing'}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
      </MenuContent>
    </Menu>
  )
}
