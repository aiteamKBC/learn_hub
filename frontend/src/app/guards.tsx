import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'

export function PageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="size-7 animate-spin text-primary" />
    </div>
  )
}

/** Signed-in only; visitors go to log in and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading, isFetching } = useMe()
  const { pathname, search } = useLocation()
  // a cached "visitor" answer may be refreshing right after sign-in: wait for it
  if (isLoading || (!me && isFetching)) return <PageSpinner />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
  return children
}

/** Company pages: needs a company you manage to be selected. The server checks again;
 * this only avoids showing a page that would fail. */
export function RequireManager({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const { org, memberships, switchTo, canManage } = useWorkspace()
  if (canManage) return children
  const managed = memberships.find((m) => ['owner', 'admin', 'manager'].includes(m.role))
  if (managed && !org) {
    switchTo(managed.org_id)
    return <PageSpinner />
  }
  return <Navigate to={me ? '/learn' : '/login'} replace />
}

export function RequireRole({ allowed, children }: { allowed: 'instructor' | 'staff'; children: ReactNode }) {
  const { data: me } = useMe()
  // staff open the course builder for platform-owned courses made in the console
  const ok = allowed === 'staff' ? me?.is_staff : me?.is_instructor || me?.is_staff
  // someone who isn't an approved instructor yet goes to the "teach" page (apply / pending)
  return ok ? children : <Navigate to={allowed === 'instructor' ? '/teach' : '/learn'} replace />
}
