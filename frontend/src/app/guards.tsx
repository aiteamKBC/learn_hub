import { Building2, Loader2 } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { useRoleCapabilities } from '@/features/org/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, NativeSelect } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { Link } from '@/lib/router'

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

/** Visitor-only pages such as log in. Signed-in people return to the public home. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { data: me, isLoading, isFetching } = useMe()
  if (isLoading || (!me && isFetching)) return <PageSpinner />
  return me ? <Navigate to="/" replace /> : children
}

/** Company pages: needs a company you manage to be selected. The server checks again;
 * this only avoids showing a page that would fail. */
export function RequireManager({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const { org, memberships, switchTo, canManage } = useWorkspace()
  const roleCapabilities = useRoleCapabilities()
  if (canManage) return children
  if (roleCapabilities.data?.can_manage_responsibilities) return children
  if (roleCapabilities.isLoading && org) return <PageSpinner />
  const managed = memberships.find((m) => ['owner', 'admin', 'manager'].includes(m.role)) ?? (memberships.length === 1 ? memberships[0] : undefined)
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

/** Employee records need a company context, including for ordinary learners.
 * A single membership can be selected automatically; multiple companies stay explicit.
 */
export function RequireCompanyMember({ children }: { children: ReactNode }) {
  const { org, memberships, switchTo } = useWorkspace()
  const singleOrgId = memberships.length === 1 ? memberships[0]?.org_id : undefined
  useEffect(() => {
    if (!org && singleOrgId) switchTo(singleOrgId)
  }, [org, singleOrgId, switchTo])

  if (!memberships.length) return <EmptyState icon={<Building2 />} title="A company membership is needed" body="Your work profile, development and policies belong to a company workspace." action={<Button asChild><Link to="/learn">Back to my learning</Link></Button>} />
  if (!org && singleOrgId) return <PageSpinner />
  return (
    <>
      <Card className="mb-5">
        <CardBody>
          <Field label="Company workspace" hint="Your work records are shown for this company.">
            {(p) => <NativeSelect {...p} value={org?.org_id ?? ''} onChange={(e) => switchTo(e.target.value || null)}>
              <option value="" disabled>Choose a company</option>
              {memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.name}</option>)}
            </NativeSelect>}
          </Field>
        </CardBody>
      </Card>
      {org ? <div key={org.org_id}>{children}</div> : <EmptyState icon={<Building2 />} title="Choose your company" body="Select the company whose work records you want to view." />}
    </>
  )
}
