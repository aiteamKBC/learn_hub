import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Approvals (mockup 25). Keys start with ['console', 'approvals', …]. A decision
// also changes the nav badge, the courses list and the certificate templates.

export type QueueTab = 'all' | 'new' | 'changes' | 'templates'

const fetchQueue = (tab: QueueTab, q: string) => unwrap(api.GET('/api/v1/console/approvals', { params: { query: { tab, q: q || undefined } } }))
export type ApprovalQueue = Awaited<ReturnType<typeof fetchQueue>>
export type QueueItem = ApprovalQueue['items'][number]
const fetchReview = (id: string) => unwrap(api.GET('/api/v1/console/review/versions/{version_id}', { params: { path: { version_id: id } } }))
export type ReviewVersion = Awaited<ReturnType<typeof fetchReview>>

export function useApprovalQueue(tab: QueueTab, q: string) {
  return useQuery({ queryKey: ['console', 'approvals', 'queue', tab, q], queryFn: () => fetchQueue(tab, q), placeholderData: keepPreviousData })
}

export function useReviewVersion(id: string) {
  return useQuery({ queryKey: ['console', 'approvals', 'version', id], queryFn: () => fetchReview(id), enabled: !!id })
}

/** A signed player link for a lesson of the version under review (fetched on demand). */
export function useReviewPlayback(lectureId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['console', 'approvals', 'play', lectureId],
    queryFn: () => unwrap(api.GET('/api/v1/console/review/lectures/{lecture_id}/play', { params: { path: { lecture_id: lectureId! } } })),
    enabled: enabled && !!lectureId,
    staleTime: 60 * 60_000, // links last 2 hours
  })
}

function useAfterDecision() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'approvals'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
    void qc.invalidateQueries({ queryKey: ['console', 'courses'] })
    void qc.invalidateQueries({ queryKey: ['console', 'certificates'] })
    void qc.invalidateQueries({ queryKey: ['console', 'dashboard'] })
  }
}

export type CourseDecision = 'approve' | 'request-changes' | 'reject'

export function useCourseDecision() {
  const done = useAfterDecision()
  return useMutation({
    mutationFn: ({ versionId, decision, text }: { versionId: string; decision: CourseDecision; text: string }) => {
      const path = { params: { path: { version_id: versionId } } }
      if (decision === 'approve') return unwrap(api.POST('/api/v1/console/review/versions/{version_id}/approve', { ...path, body: { notes: text } }))
      if (decision === 'request-changes') return unwrap(api.POST('/api/v1/console/review/versions/{version_id}/request-changes', { ...path, body: { notes: text } }))
      return unwrap(api.POST('/api/v1/console/review/versions/{version_id}/reject', { ...path, body: { reason: text } }))
    },
    onSuccess: done,
  })
}

export function useTemplateDecision() {
  const done = useAfterDecision()
  return useMutation({
    mutationFn: ({ templateId, approve, reason }: { templateId: string; approve: boolean; reason?: string }) =>
      approve
        ? unwrap(api.POST('/api/v1/console/certificates/templates/{template_id}/approve', { params: { path: { template_id: templateId } } }))
        : unwrap(api.POST('/api/v1/console/certificates/templates/{template_id}/reject', { params: { path: { template_id: templateId } }, body: { reason: reason ?? '' } })),
    onSuccess: done,
  })
}
