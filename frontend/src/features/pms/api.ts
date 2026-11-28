/** Performance management (PMS): KPIs and their measurements, KPI change proposals with a
 * multi-stage approval route, review cycles and the performance reviews inside them.
 * Every company query is keyed by the current org id, so switching company never leaks
 * another company's cached data. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type Kpi = S['PmsKpiOut']
export type Measurement = S['PmsMeasurementOut']
export type Proposal = S['PmsProposalOut']
export type ProposalIn = S['PmsProposalIn']
export type ProposalPatch = S['PmsProposalPatch']
export type HistoryEntry = S['PmsHistoryOut']
export type Cycle = S['PmsCycleOut']
export type CycleIn = S['PmsCycleIn']
export type Review = S['PmsReviewOut']
export type Objective = S['PmsObjectiveOut']
export type ReviewPatch = S['PmsReviewPatch']
export type ObjectiveIn = S['PmsObjectiveIn']
export type Analysis = S['PmsAnalysisOut']

const key = (...parts: unknown[]) => ['pms', currentOrgId(), ...parts]

// ---------------------------------------------------------------- KPIs
export function useKpis(scope: 'department' | 'individual' = 'department') {
  return useQuery({ queryKey: key('kpis', scope), queryFn: () => unwrap(api.GET('/api/v1/pms/kpis', { params: { query: { scope } } })) })
}

/** Create an active KPI directly, in one step (no approval chain). Admin only. */
export function useCreateKpi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProposalIn) => unwrap(api.POST('/api/v1/pms/kpis', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('kpis') }),
  })
}

export function useMeasurements(kpiId?: string) {
  return useQuery({
    queryKey: key('measurements', kpiId),
    queryFn: () => unwrap(api.GET('/api/v1/pms/kpis/{kpi_id}/measurements', { params: { path: { kpi_id: kpiId! } } })),
    enabled: !!kpiId,
  })
}

export function useRecordMeasurement(kpiId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['PmsMeasurementIn']) => unwrap(api.POST('/api/v1/pms/kpis/{kpi_id}/measurements', { params: { path: { kpi_id: kpiId } }, body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('measurements', kpiId) }), qc.invalidateQueries({ queryKey: key('kpis') })]),
  })
}

// ---------------------------------------------------------------- proposals
export function useProposals(stage?: string) {
  return useQuery({
    queryKey: key('proposals', stage ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/pms/kpis/proposals', { params: { query: { stage: stage || undefined } } })),
  })
}

export function useProposal(id?: string) {
  return useQuery({
    queryKey: key('proposal', id),
    queryFn: () => unwrap(api.GET('/api/v1/pms/kpis/proposals/{proposal_id}', { params: { path: { proposal_id: id! } } })),
    enabled: !!id,
  })
}

export function useProposalHistory(id?: string) {
  return useQuery({
    queryKey: key('proposal', id, 'history'),
    queryFn: () => unwrap(api.GET('/api/v1/pms/kpis/proposals/{proposal_id}/history', { params: { path: { proposal_id: id! } } })),
    enabled: !!id,
  })
}

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProposalIn) => unwrap(api.POST('/api/v1/pms/kpis/proposals', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('proposals') }),
  })
}

export function useUpdateProposal(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProposalPatch) => unwrap(api.PATCH('/api/v1/pms/kpis/proposals/{proposal_id}', { params: { path: { proposal_id: id } }, body })),
    onSuccess: () => invalidateProposal(qc, id),
  })
}

function invalidateProposal(qc: ReturnType<typeof useQueryClient>, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: key('proposal', id) }),
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'pms' && q.queryKey[2] === 'proposals' }),
    qc.invalidateQueries({ queryKey: key('kpis') }),
  ])
}

/** The approval route: submit → approve (advances the stage) → active; or request changes. */
export function useProposalAction(id: string, action: 'submit' | 'approve' | 'request-changes') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comment: string) =>
      unwrap(api.POST(`/api/v1/pms/kpis/proposals/{proposal_id}/${action}` as '/api/v1/pms/kpis/proposals/{proposal_id}/submit', { params: { path: { proposal_id: id } }, body: { comment } })),
    onSuccess: () => invalidateProposal(qc, id),
  })
}

// ---------------------------------------------------------------- cycles
export function useCycles() {
  return useQuery({ queryKey: key('cycles'), queryFn: () => unwrap(api.GET('/api/v1/pms/review-cycles')) })
}

export function useCreateCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CycleIn) => unwrap(api.POST('/api/v1/pms/review-cycles', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('cycles') }),
  })
}

export function useCycleState(id: string, action: 'open' | 'close') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST(`/api/v1/pms/review-cycles/{cycle_id}/${action}` as '/api/v1/pms/review-cycles/{cycle_id}/open', { params: { path: { cycle_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('cycles') }),
  })
}

export function useCycleReviews(cycleId?: string) {
  return useQuery({
    queryKey: key('cycle', cycleId, 'reviews'),
    queryFn: () => unwrap(api.GET('/api/v1/pms/review-cycles/{cycle_id}/reviews', { params: { path: { cycle_id: cycleId! } } })),
    enabled: !!cycleId,
  })
}

// ---------------------------------------------------------------- reviews
export function useReview(id?: string) {
  return useQuery({
    queryKey: key('review', id),
    queryFn: () => unwrap(api.GET('/api/v1/pms/reviews/{review_id}', { params: { path: { review_id: id! } } })),
    enabled: !!id,
  })
}

export function useMyReviews() {
  return useQuery({ queryKey: key('my-reviews'), queryFn: () => unwrap(api.GET('/api/v1/pms/me/reviews')) })
}

export function useCreateReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['PmsReviewCreateIn']) => unwrap(api.POST('/api/v1/pms/reviews', { body })),
    onSuccess: (r) => Promise.all([qc.invalidateQueries({ queryKey: key('cycle', r.cycle_id, 'reviews') }), qc.invalidateQueries({ queryKey: key('cycles') })]),
  })
}

export function useUpdateReview(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ReviewPatch) => unwrap(api.PATCH('/api/v1/pms/reviews/{review_id}', { params: { path: { review_id: id } }, body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('review', id) }), qc.invalidateQueries({ queryKey: key('my-reviews') }), qc.invalidateQueries({ queryKey: key('cycle') })]),
  })
}

export function useAddObjective(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ObjectiveIn) => unwrap(api.POST('/api/v1/pms/reviews/{review_id}/objectives', { params: { path: { review_id: reviewId } }, body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('review', reviewId) }), qc.invalidateQueries({ queryKey: key('my-reviews') }), qc.invalidateQueries({ queryKey: key('cycle') })]),
  })
}

export function useSubmitReview(reviewId: string, cycleId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/pms/reviews/{review_id}/submit', { params: { path: { review_id: reviewId } } })),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: key('review', reviewId) }),
        qc.invalidateQueries({ queryKey: key('my-reviews') }),
        cycleId ? qc.invalidateQueries({ queryKey: key('cycle', cycleId, 'reviews') }) : Promise.resolve(),
      ]),
  })
}

export function useAcknowledgeReview(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/pms/reviews/{review_id}/acknowledge', { params: { path: { review_id: reviewId } } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('review', reviewId) }), qc.invalidateQueries({ queryKey: key('my-reviews') })]),
  })
}

export function useAnalysis(reviewId?: string) {
  return useQuery({
    queryKey: key('review', reviewId, 'analysis'),
    queryFn: async () => {
      try {
        return await unwrap(api.GET('/api/v1/pms/reviews/{review_id}/analysis', { params: { path: { review_id: reviewId! } } }))
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: !!reviewId,
  })
}

export function useGenerateAnalysis(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/pms/reviews/{review_id}/analysis', { params: { path: { review_id: reviewId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('review', reviewId, 'analysis') }),
  })
}

// ---------------------------------------------------------------- shared labels
export const PROPOSAL_STAGE: Record<string, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'primary' | 'danger' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  hod_review: { label: 'Head of dept review', tone: 'info' },
  hr_alignment: { label: 'HR alignment', tone: 'info' },
  exec_approval: { label: 'Executive approval', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

/** Which stage a draft/approval moves to next (used to word the approve button). */
export const NEXT_STAGE_LABEL: Record<string, string> = {
  draft: 'Head of dept review',
  hod_review: 'HR alignment',
  hr_alignment: 'Executive approval',
  exec_approval: 'Active KPI',
}

export const CYCLE_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const REVIEW_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'primary' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  self_review: { label: 'Self review', tone: 'info' },
  manager_review: { label: 'Manager review', tone: 'info' },
  submitted: { label: 'Submitted', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const OBJECTIVE_STATUS: Record<string, string> = { open: 'Open', met: 'Met', missed: 'Missed', carried: 'Carried forward' }
export const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
