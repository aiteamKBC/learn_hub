import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { useWorkspace } from '@/features/identity/workspace'
import { currentOrgId } from '@/lib/workspace'

// Shared reads for the business workspace. Each screen adds its own hooks and mutations
// below; every key starts with 'org' and carries the company id.
const fetchCompany = () => unwrap(api.GET('/api/v1/org/company'))
const fetchUnits = () => unwrap(api.GET('/api/v1/org/units'))
const fetchJobRoles = () => unwrap(api.GET('/api/v1/org/job-roles'))
const fetchLibrary = (source?: string) => unwrap(api.GET('/api/v1/org/library', { params: { query: { source: source || undefined } } }))

export type Company = Awaited<ReturnType<typeof fetchCompany>>
export type Unit = Awaited<ReturnType<typeof fetchUnits>>[number]
export type JobRole = Awaited<ReturnType<typeof fetchJobRoles>>[number]
export type LibraryCourse = Awaited<ReturnType<typeof fetchLibrary>>[number]

export function useCompany() {
  return useQuery({ queryKey: ['org', 'company', currentOrgId()], queryFn: fetchCompany })
}

export function useUnits() {
  return useQuery({ queryKey: ['org', 'units', currentOrgId()], queryFn: fetchUnits })
}

export function useJobRoles() {
  return useQuery({ queryKey: ['org', 'job-roles', currentOrgId()], queryFn: fetchJobRoles })
}

export function useLibrary(source?: string) {
  return useQuery({ queryKey: ['org', 'library', currentOrgId(), source ?? ''], queryFn: () => fetchLibrary(source) })
}

/** Admins (and owners) may change things; managers only read and remind inside their
 * units. The API enforces this; the UI just doesn't offer what would be refused. */
export function useIsOrgAdmin() {
  const { org } = useWorkspace()
  return !!org && (org.role === 'owner' || org.role === 'admin')
}

// A unit is a root of the list when its parent isn't in it: the company for admins, the
// top of each managed branch for managers (the API only returns their own units).
// Levels per list, worked out once (the lists come from the query cache, so they're stable)
const levelCache = new WeakMap<Unit[], Map<string, number>>()
function levels(units: Unit[]) {
  let m = levelCache.get(units)
  if (!m) {
    m = new Map()
    // sorted by path, so a parent always comes before its children
    for (const u of units) m.set(u.id, u.parent_id && m.has(u.parent_id) ? m.get(u.parent_id)! + 1 : 0)
    levelCache.set(units, m)
  }
  return m
}

/** How deep a unit sits in this list: its roots are 0 (so a manager's tree starts at the
 * left edge, not at the depth it has in the whole company). */
export function unitLevel(u: Unit, units: Unit[]) {
  return levels(units).get(u.id) ?? 0
}

/** Units as an indented list in tree order (the API returns them sorted by path). */
export function unitLabel(u: Unit, units: Unit[]) {
  return `${' '.repeat(unitLevel(u, units))}${u.name}`
}

// ---------------------------------------------------------------- helpers
/** Invalidate every cached query whose key starts with one of these prefixes. */
function refresh(qc: QueryClient, ...prefixes: string[][]) {
  return Promise.all(
    prefixes.map((p) =>
      qc.invalidateQueries({ predicate: (q) => p.every((part, i) => q.queryKey[i] === part) }),
    ),
  )
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', learner: 'Learner' }
export const ROLE_TONE: Record<string, 'primary' | 'info' | 'neutral'> = { owner: 'primary', admin: 'primary', manager: 'info', learner: 'neutral' }

/** Roles the signed-in person may give (the API refuses the rest): only owners hand out
 * admin. */
export function useAssignableRoles() {
  const { org } = useWorkspace()
  return org?.role === 'owner' ? ['learner', 'manager', 'admin'] : ['learner', 'manager']
}

// ---------------------------------------------------------------- people
export type PeopleFilters = { q?: string; unit_id?: string; job_role_id?: string; role?: string }
const fetchPeople = (f: PeopleFilters, cursor?: string, limit = 50) =>
  unwrap(api.GET('/api/v1/org/people', { params: { query: { q: f.q || undefined, unit_id: f.unit_id || undefined, job_role_id: f.job_role_id || undefined, role: f.role || undefined, cursor, limit } } }))
export type Person = Awaited<ReturnType<typeof fetchPeople>>['items'][number]

export function usePeople(f: PeopleFilters) {
  return useInfiniteQuery({
    queryKey: ['org', 'people', currentOrgId(), f.q ?? '', f.unit_id ?? '', f.job_role_id ?? '', f.role ?? ''],
    queryFn: ({ pageParam }) => fetchPeople(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

/** One page of people for pickers (search as you type). */
export function usePeopleSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: ['org', 'people', currentOrgId(), 'pick', q],
    queryFn: () => fetchPeople({ q }, undefined, 100),
    enabled,
    placeholderData: (prev) => prev,
  })
}

/** After a person changes: lists, unit/role counts and everything compliance shows. */
function personChanged(qc: QueryClient) {
  return refresh(qc, ['org', 'people'], ['org', 'units'], ['org', 'job-roles'], ['compliance'])
}

export type MemberPatch = components['schemas']['MemberPatch']

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { memberId: string; body: MemberPatch }) => unwrap(api.PATCH('/api/v1/org/people/{member_id}', { params: { path: { member_id: v.memberId } }, body: v.body })),
    onSuccess: () => personChanged(qc),
  })
}

export function useRemovePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => unwrap(api.DELETE('/api/v1/org/people/{member_id}', { params: { path: { member_id: memberId } } })),
    onSuccess: (_r, memberId) => {
      // drop the removed person's page first, so the still-open page doesn't refetch
      // them (a 404) before it navigates away
      const key = ['compliance', 'person', currentOrgId(), memberId]
      void qc.cancelQueries({ queryKey: key })
      qc.removeQueries({ queryKey: key })
      // the rest refresh in the background: the caller's navigation shouldn't wait
      void personChanged(qc)
      void refresh(qc, ['org', 'company'])
    },
  })
}

// ---------------------------------------------------------------- units and job roles
export const UNIT_KINDS = [
  { value: 'region', label: 'Region' },
  { value: 'site', label: 'Site' },
  { value: 'department', label: 'Department' },
  { value: 'team', label: 'Team' },
] as const

export function useCreateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { parent_id: string; kind: string; name: string; code?: string }) => unwrap(api.POST('/api/v1/org/units', { body: { ...body, code: body.code ?? '' } })),
    onSuccess: () => refresh(qc, ['org', 'units']),
  })
}

export function useUpdateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { unitId: string; name?: string; code?: string }) => unwrap(api.PATCH('/api/v1/org/units/{unit_id}', { params: { path: { unit_id: v.unitId } }, body: { name: v.name ?? null, code: v.code ?? null } })),
    // unit names show in people lists and compliance views too
    onSuccess: () => refresh(qc, ['org', 'units'], ['org', 'people'], ['compliance']),
  })
}

export function useArchiveUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (unitId: string) => unwrap(api.DELETE('/api/v1/org/units/{unit_id}', { params: { path: { unit_id: unitId } } })),
    onSuccess: () => refresh(qc, ['org', 'units'], ['compliance']),
  })
}

export function useSetUnitManagers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { unitId: string; memberIds: string[] }) => unwrap(api.PUT('/api/v1/org/units/{unit_id}/managers', { params: { path: { unit_id: v.unitId } }, body: { member_ids: v.memberIds } })),
    // learners who become managers get the manager role (shown on the person page and
    // the matrix sheet too)
    onSuccess: () => refresh(qc, ['org', 'units'], ['org', 'people'], ['compliance']),
  })
}

export function useCreateJobRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => unwrap(api.POST('/api/v1/org/job-roles', { body: { name, code: '' } })),
    onSuccess: () => refresh(qc, ['org', 'job-roles']),
  })
}

export function useRenameJobRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { roleId: string; name: string; code: string }) => unwrap(api.PATCH('/api/v1/org/job-roles/{role_id}', { params: { path: { role_id: v.roleId } }, body: { name: v.name, code: v.code } })),
    onSuccess: () => refresh(qc, ['org', 'job-roles'], ['org', 'people'], ['compliance']),
  })
}

export function useArchiveJobRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roleId: string) => unwrap(api.DELETE('/api/v1/org/job-roles/{role_id}', { params: { path: { role_id: roleId } } })),
    onSuccess: () => refresh(qc, ['org', 'job-roles']),
  })
}

// ---------------------------------------------------------------- invites
const fetchInvites = () => unwrap(api.GET('/api/v1/org/invites'))
export type Invite = Awaited<ReturnType<typeof fetchInvites>>[number]

export function useInvites(enabled = true) {
  return useQuery({ queryKey: ['org', 'invites', currentOrgId()], queryFn: fetchInvites, enabled })
}

export function useCreateInvite() {
  return useMutation({
    mutationFn: (body: { email: string; role: string; unit_id?: string | null; job_role_id?: string | null }) =>
      unwrap(api.POST('/api/v1/org/invites', { body: { email: body.email, role: body.role, unit_id: body.unit_id || null, job_role_id: body.job_role_id || null } })),
    // the page sends several at once and refreshes the list when all are done
  })
}

export function useRefreshInvites() {
  const qc = useQueryClient()
  return () => refresh(qc, ['org', 'invites'])
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => unwrap(api.DELETE('/api/v1/org/invites/{invite_id}', { params: { path: { invite_id: inviteId } } })),
    onSuccess: () => refresh(qc, ['org', 'invites']),
  })
}

// The public accept page: these run before the person belongs to the company, so they
// never send the selected workspace.
const NO_ORG = { 'X-Org-Id': '' }

export function useInvitation(token: string) {
  return useQuery({
    queryKey: ['org', 'invitation', token],
    queryFn: () => unwrap(api.GET('/api/v1/org/invitations/{token}', { params: { path: { token } }, headers: NO_ORG })),
    retry: false,
  })
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (token: string) => unwrap(api.POST('/api/v1/org/invitations/{token}/accept', { params: { path: { token } }, headers: NO_ORG })),
  })
}

// ---------------------------------------------------------------- assigning training
export function useAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AssignTarget) => unwrap(api.POST('/api/v1/org/assign', { body: { ...body, dry_run: false } })),
    onSuccess: () => refresh(qc, ['org', 'library'], ['org', 'assignments'], ['compliance']),
  })
}

export type AssignTarget = { course_id: string; member_ids: string[]; unit_ids: string[] }
export type AssignResult = components['schemas']['AssignOut']

/** The exact counts an assignment would give (the API's dry run writes nothing). */
export function useAssignPreview(body: AssignTarget | null) {
  return useQuery({
    queryKey: ['org', 'assign-preview', currentOrgId(), body],
    queryFn: () => unwrap(api.POST('/api/v1/org/assign', { body: { ...body!, dry_run: true } })),
    enabled: !!body,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useAssignments(courseId: string | null) {
  return useQuery({
    queryKey: ['org', 'assignments', currentOrgId(), courseId],
    queryFn: () => unwrap(api.GET('/api/v1/org/assignments', { params: { query: { course_id: courseId! } } })),
    enabled: !!courseId,
  })
}

// ---------------------------------------------------------------- billing and branding
/** The company's subscriptions (admins only: the API refuses managers). */
export function useCompanySubscriptions(enabled: boolean) {
  return useQuery({
    queryKey: ['org', 'subscriptions', currentOrgId()],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/subscriptions')),
    enabled,
  })
}

export function useCompanyInvoices(enabled: boolean) {
  return useQuery({
    queryKey: ['org', 'invoices', currentOrgId()],
    queryFn: () => unwrap(api.GET('/api/v1/commerce/invoices')),
    enabled,
  })
}

/** Stripe's billing portal for the company (the default X-Org-Id is the company). */
export function useCompanyBillingPortal() {
  return useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/commerce/billing-portal')) })
}

export function useSaveBranding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { logo_url: string; primary_color: string; accent_color: string }) => unwrap(api.PUT('/api/v1/org/company/branding', { body })),
    // the header reads the company; the workspace switcher reads memberships from 'me'
    onSuccess: () => Promise.all([refresh(qc, ['org', 'company']), qc.invalidateQueries({ queryKey: ['me'] })]),
  })
}
