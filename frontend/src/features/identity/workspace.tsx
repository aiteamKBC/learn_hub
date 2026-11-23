import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { currentOrgId, currentStaffOrgWorkspace, setCurrentOrgId, setStaffOrgWorkspace, type StaffOrgWorkspace } from '@/lib/workspace'

import { useMe } from './auth'

const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn))

/** The active space: personal learning or one of the user's companies. Switching
 * clears cached data so nothing from one company shows in another. */
export function useWorkspace() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const stored = useSyncExternalStore(subscribe, currentOrgId, () => null)
  const memberships = useMemo(() => me?.memberships ?? [], [me])
  const membership = memberships.find((m) => m.org_id === stored) ?? null
  const staffWorkspace = me?.is_staff ? currentStaffOrgWorkspace() : null
  const platformOrg = staffWorkspace?.org_id === stored
    ? { ...staffWorkspace, role: 'owner', logo_url: '', primary_color: '' }
    : null
  const org = membership ?? platformOrg

  const switchTo = useCallback(
    (orgId: string | null) => {
      setStaffOrgWorkspace(null)
      setCurrentOrgId(orgId)
      listeners.forEach((l) => l())
      // reset (not just remove): what is on screen loads again for the new space at once
      void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth-config' })
    },
    [qc],
  )

  const switchToStaffOrg = useCallback(
    (workspace: StaffOrgWorkspace) => {
      setStaffOrgWorkspace(workspace)
      setCurrentOrgId(workspace.org_id)
      listeners.forEach((l) => l())
      void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth-config' })
    },
    [qc],
  )

  return { org, memberships, switchTo, switchToStaffOrg, isPlatformAdminView: !!platformOrg, canManage: !!org && ['owner', 'admin', 'manager'].includes(org.role) }
}
