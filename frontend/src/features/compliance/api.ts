import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { API_BASE_URL } from '@/lib/env'
import { currentOrgId } from '@/lib/workspace'

export type Dashboard = Awaited<ReturnType<typeof fetchDashboard>>
export type RequirementSummary = Awaited<ReturnType<typeof fetchSummary>>[number]
export type MatrixPage = Awaited<ReturnType<typeof fetchMatrix>>
export type MatrixRow = MatrixPage['rows'][number]
export type MatrixCell = MatrixRow['cells'][string]
export type PersonCompliance = Awaited<ReturnType<typeof fetchPerson>>
export type PersonStatus = PersonCompliance['requirements'][number]
export type PersonRecord = PersonCompliance['records'][number]
export type PersonExemption = PersonCompliance['exemptions'][number]
export type Requirement = Awaited<ReturnType<typeof fetchRequirements>>[number]
export type RequirementInput = components['schemas']['RequirementIn']
export type RequirementChanges = components['schemas']['RequirementPatch']
export type TargetInput = components['schemas']['TargetIn']
export type AuditEntry = Awaited<ReturnType<typeof fetchAudit>>['items'][number]

export type MatrixFilters = { unit?: string; role?: string; status?: string; req?: string; q?: string }

const fetchDashboard = () => unwrap(api.GET('/api/v1/compliance/dashboard'))
const fetchSummary = (unitId?: string) => unwrap(api.GET('/api/v1/compliance/summary', { params: { query: { unit_id: unitId || undefined } } }))
const fetchMatrix = (f: MatrixFilters, cursor?: string) =>
  unwrap(
    api.GET('/api/v1/compliance/matrix', {
      params: { query: { unit_id: f.unit || undefined, job_role_id: f.role || undefined, status: f.status || undefined, requirement_id: f.req || undefined, q: f.q || undefined, cursor, limit: 40 } },
    }),
  )
const fetchPerson = (memberId: string) => unwrap(api.GET('/api/v1/compliance/people/{member_id}', { params: { path: { member_id: memberId } } }))
const fetchRequirements = () => unwrap(api.GET('/api/v1/compliance/requirements'))
const fetchAudit = (action?: string, cursor?: string) => unwrap(api.GET('/api/v1/org/audit', { params: { query: { action: action || undefined, cursor, limit: 30 } } }))

// ---------------------------------------------------------------- reads
export function useDashboard() {
  return useQuery({ queryKey: ['compliance', 'dashboard', currentOrgId()], queryFn: fetchDashboard })
}

/** Per-requirement counts; optionally for one unit (and the units below it). */
export function useSummary(unitId?: string) {
  return useQuery({ queryKey: ['compliance', 'summary', currentOrgId(), unitId ?? ''], queryFn: () => fetchSummary(unitId), placeholderData: keepPreviousData })
}

/** People x requirements, one keyset page at a time. */
export function useMatrix(filters: MatrixFilters) {
  return useInfiniteQuery({
    queryKey: ['compliance', 'matrix', currentOrgId(), filters],
    queryFn: ({ pageParam }) => fetchMatrix(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

/** Everything about one person's required training (statuses, records, exemptions). */
export function usePersonCompliance(memberId: string | undefined) {
  return useQuery({
    queryKey: ['compliance', 'person', currentOrgId(), memberId],
    queryFn: () => fetchPerson(memberId!),
    enabled: !!memberId,
  })
}

export function useRequirements() {
  return useQuery({ queryKey: ['compliance', 'requirements', currentOrgId()], queryFn: fetchRequirements })
}

/** The company audit trail (admins only), newest first. `action` is a prefix. */
export function useAudit(action?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['org', 'audit', currentOrgId(), action ?? ''],
    queryFn: ({ pageParam }) => fetchAudit(action, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  })
}

// ---------------------------------------------------------------- writes
/** After a change to someone's training: their page, the matrix, the headline numbers,
 * the requirement list, the people list (it shows counts) and the audit trail.
 * Only the list the change was made from is awaited (the person's page, or the
 * requirement list), so the sheet closes on fresh data; the rest refetch in the
 * background rather than holding up the toast. */
function useComplianceRefresh() {
  const qc = useQueryClient()
  return (memberId?: string) => {
    const org = currentOrgId()
    const main = memberId ? ['compliance', 'person', org, memberId] : ['compliance', 'requirements', org]
    for (const key of [
      ['compliance', 'matrix', org],
      ['compliance', 'dashboard', org],
      ['compliance', 'summary', org],
      ['compliance', 'requirements', org],
      ['org', 'people', org],
      ['org', 'audit', org],
    ])
      if (key[1] !== main[1]) void qc.invalidateQueries({ queryKey: key })
    return qc.invalidateQueries({ queryKey: main })
  }
}

export function useExtend(memberId: string) {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: ({ statusId, dueAt }: { statusId: string; dueAt: string }) => unwrap(api.POST('/api/v1/compliance/statuses/{status_id}/extend', { params: { path: { status_id: statusId } }, body: { due_at: dueAt } })),
    onSuccess: () => refresh(memberId),
  })
}

export function useExempt(memberId: string) {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: ({ statusId, reason, endsAt }: { statusId: string; reason: string; endsAt?: string | null }) =>
      unwrap(api.POST('/api/v1/compliance/statuses/{status_id}/exempt', { params: { path: { status_id: statusId } }, body: { reason, ends_at: endsAt ?? null } })),
    onSuccess: () => refresh(memberId),
  })
}

export function useRevokeExemption(memberId: string) {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: (exemptionId: string) => unwrap(api.DELETE('/api/v1/compliance/exemptions/{exemption_id}', { params: { path: { exemption_id: exemptionId } } })),
    onSuccess: () => refresh(memberId),
  })
}

export function useRecordCompletion(memberId: string) {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: ({ statusId, completedAt, note }: { statusId: string; completedAt: string; note: string }) =>
      unwrap(api.POST('/api/v1/compliance/statuses/{status_id}/records', { params: { path: { status_id: statusId } }, body: { completed_at: completedAt, note } })),
    onSuccess: () => refresh(memberId),
  })
}

export function useVoidRecord(memberId: string) {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: ({ recordId, reason }: { recordId: string; reason: string }) => unwrap(api.POST('/api/v1/compliance/records/{record_id}/void', { params: { path: { record_id: recordId } }, body: { reason } })),
    onSuccess: () => refresh(memberId),
  })
}

/** A reminder changes no status, so it only refreshes the audit trail. */
export function useRemind() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (statusId: string) => unwrap(api.POST('/api/v1/compliance/statuses/{status_id}/remind', { params: { path: { status_id: statusId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', 'audit', currentOrgId()] }),
  })
}

export function useCreateRequirement() {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: (body: RequirementInput) => unwrap(api.POST('/api/v1/compliance/requirements', { body })),
    onSuccess: () => refresh(),
  })
}

export function useUpdateRequirement() {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RequirementChanges }) => unwrap(api.PATCH('/api/v1/compliance/requirements/{requirement_id}', { params: { path: { requirement_id: id } }, body })),
    onSuccess: () => refresh(),
  })
}

export function useArchiveRequirement() {
  const refresh = useComplianceRefresh()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/compliance/requirements/{requirement_id}', { params: { path: { requirement_id: id } } })),
    onSuccess: () => refresh(),
  })
}

/** CSV export needs the X-Org-Id header, so it is fetched and saved rather than linked.
 * With a unit, only that unit (and the units below it) is exported. */
export async function downloadExport(unitId?: string) {
  const url = new URL(`${API_BASE_URL}/api/v1/compliance/export.csv`, window.location.origin)
  if (unitId) url.searchParams.set('unit_id', unitId)
  const res = await fetch(url, { credentials: 'include', headers: { 'X-Org-Id': currentOrgId() ?? '' } })
  if (!res.ok) throw new Error('The export could not be created.')
  const blobUrl = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: `compliance-${new Date().toISOString().slice(0, 10)}.csv` })
  // Firefox and Safari need the link in the page, and cancel the download if the URL is
  // revoked in the same task
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

export const STATUS = {
  compliant: { label: 'Compliant', tone: 'success', color: 'var(--success)' },
  expiring_soon: { label: 'Expiring soon', tone: 'warning', color: 'var(--chart-3)' },
  in_progress: { label: 'In progress', tone: 'info', color: 'var(--chart-5)' },
  not_started: { label: 'Not started', tone: 'neutral', color: 'var(--border-strong)' },
  overdue: { label: 'Overdue', tone: 'danger', color: 'var(--chart-4)' },
  expired: { label: 'Expired', tone: 'danger', color: 'var(--danger)' },
  exempt: { label: 'Exempt', tone: 'outline', color: 'var(--text-subtle)' },
} as const
export type StatusKey = keyof typeof STATUS
export const STATUS_ORDER: StatusKey[] = ['compliant', 'expiring_soon', 'in_progress', 'not_started', 'overdue', 'expired', 'exempt']

export const statusOf = (s: string) => STATUS[s as StatusKey] ?? STATUS.not_started

/** Colour band for a compliance percentage (same bands as the overview). */
export const complianceTone = (pct: number) => (pct >= 85 ? 'success' : pct >= 65 ? 'warning' : 'danger') as 'success' | 'warning' | 'danger'
export const TONE_FILL = { success: 'var(--chart-2)', warning: 'var(--chart-3)', danger: 'var(--chart-4)' } as const
export const TONE_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const

// how urgent a status is, for "worst status" summaries (higher is worse)
const SEVERITY: Record<StatusKey, number> = { exempt: 0, compliant: 1, expiring_soon: 2, in_progress: 3, not_started: 4, overdue: 5, expired: 6 }
export function worstStatus(statuses: string[]): StatusKey | null {
  let worst: StatusKey | null = null
  for (const s of statuses) {
    const k = (s in SEVERITY ? s : 'not_started') as StatusKey
    if (worst === null || SEVERITY[k] > SEVERITY[worst]) worst = k
  }
  return worst
}

/** The learner's required training in one company (each company is asked separately). */
export function useMyRequirements(orgId: string) {
  return useQuery({
    queryKey: ['my-requirements', orgId],
    queryFn: () => unwrap(api.GET('/api/v1/compliance/my', { headers: { 'X-Org-Id': orgId } })),
  })
}
