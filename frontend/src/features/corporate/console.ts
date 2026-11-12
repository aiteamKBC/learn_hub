/** Platform console: corporate offerings, seat purchases, quotes, live groups, tutors,
 * cancellations, departure policies and reports. Staff only (the server checks). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

type S = components['schemas']
export type CnOffering = S['ConsoleOfferingOut']
export type CnPurchase = S['ConsoleSeatPurchaseOut']
export type CnAllocation = S['ConsoleSeatAllocationOut']
export type CnQuote = S['ConsoleQuoteOut']
export type CnRequest = S['ConsoleTrainingRequestOut']
export type CnCohort = S['ConsoleCohortOut']
export type CnCohortCompany = S['ConsoleCohortCompanyOut']
export type CnSession = S['ConsoleSessionOut']
export type CnTutor = S['ConsoleTutorOut']
export type CnAttendee = S['ConsoleLiveAttendeeOut']
export type CnCancellation = S['ConsoleCancellationOut']
export type CnPolicy = S['ConsoleDeparturePolicyOut']
export type CnAttendance = S['ConsoleAttendanceOut']

const K = ['console', 'corporate'] as const
const k = (...p: unknown[]) => [...K, ...p]
const LIMIT = 100

function useInvalidate() {
  const qc = useQueryClient()
  return (...groups: string[]) => Promise.all(groups.map((g) => qc.invalidateQueries({ queryKey: k(g) })))
}

// ---------------------------------------------------------------- packages
export function useCnOfferings() {
  return useQuery({
    queryKey: k('offerings'),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/offerings', {
          params: { query: { limit: LIMIT } },
        }),
      ),
  })
}
export function useCnCreateOffering() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleOfferingIn']) => unwrap(api.POST('/api/v1/console/corporate/offerings', { body })),
    onSuccess: () => inv('offerings'),
  })
}
export function useCnUpdateOffering() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleOfferingPatch'] & { id: string }) =>
      unwrap(
        api.PATCH('/api/v1/console/corporate/offerings/{offering_id}', {
          params: { path: { offering_id: id } },
          body,
        }),
      ),
    onSuccess: () => inv('offerings'),
  })
}
export function useCnPurchases(status: string) {
  return useQuery({
    queryKey: k('purchases', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/purchases', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnAllocations(purchaseId?: string) {
  return useQuery({
    queryKey: k('allocations', purchaseId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/allocations', {
          params: { query: { purchase_id: purchaseId, limit: LIMIT } },
        }),
      ),
    enabled: !!purchaseId,
  })
}
export function useCnReleaseSeat() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(api.POST('/api/v1/console/corporate/allocations/{allocation_id}/release', { params: { path: { allocation_id: id } }, body: { reason } })),
    onSuccess: () => inv('allocations', 'purchases'),
  })
}
export function useCnReassignSeat() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleReassignIn'] & { id: string }) =>
      unwrap(api.POST('/api/v1/console/corporate/allocations/{allocation_id}/reassign', { params: { path: { allocation_id: id } }, body })),
    onSuccess: () => inv('allocations', 'purchases'),
  })
}
export function useCnQuotes(status: string) {
  return useQuery({
    queryKey: k('quotes', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/quotes', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnCreateQuote() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleQuoteIn']) => unwrap(api.POST('/api/v1/console/corporate/quotes', { body })),
    onSuccess: () => inv('quotes'),
  })
}
export function useCnSendQuote() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/console/corporate/quotes/{quote_id}/send', {
          params: { path: { quote_id: id } },
        }),
      ),
    onSuccess: () => inv('quotes'),
  })
}
export function useCnVoidQuote() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/console/corporate/quotes/{quote_id}/void', {
          params: { path: { quote_id: id } },
        }),
      ),
    onSuccess: () => inv('quotes'),
  })
}

// ---------------------------------------------------------------- live
export function useCnRequests(status: string) {
  return useQuery({
    queryKey: k('requests', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/requests', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnUpdateRequest() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleRequestPatch'] & { id: string }) =>
      unwrap(
        api.PATCH('/api/v1/console/corporate/requests/{request_id}', {
          params: { path: { request_id: id } },
          body,
        }),
      ),
    onSuccess: () => inv('requests'),
  })
}
export function useCnCohorts(status: string) {
  return useQuery({
    queryKey: k('cohorts', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/cohorts', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnCreateCohort() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleCohortIn']) => unwrap(api.POST('/api/v1/console/corporate/cohorts', { body })),
    onSuccess: () => inv('cohorts'),
  })
}
export function useCnUpdateCohort() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleCohortPatch'] & { id: string }) =>
      unwrap(
        api.PATCH('/api/v1/console/corporate/cohorts/{cohort_id}', {
          params: { path: { cohort_id: id } },
          body,
        }),
      ),
    onSuccess: () => inv('cohorts'),
  })
}
export function useCnConfirmCohort() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, payment_deadline }: { id: string; payment_deadline: string }) =>
      unwrap(
        api.POST('/api/v1/console/corporate/cohorts/{cohort_id}/confirm', {
          params: { path: { cohort_id: id } },
          body: { payment_deadline },
        }),
      ),
    onSuccess: () => inv('cohorts', 'cohort-companies', 'requests'),
  })
}
export function useCnCohortCompanies(cohortId?: string) {
  return useQuery({
    queryKey: k('cohort-companies', cohortId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/cohorts/{cohort_id}/companies', {
          params: { path: { cohort_id: cohortId! } },
        }),
      ),
    enabled: !!cohortId,
  })
}
export function useCnAddCompany(cohortId: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleAddCompanyIn']) =>
      unwrap(
        api.POST('/api/v1/console/corporate/cohorts/{cohort_id}/companies', {
          params: { path: { cohort_id: cohortId } },
          body,
        }),
      ),
    onSuccess: () => inv('cohort-companies', 'cohorts', 'requests'),
  })
}
export function useCnRemoveCompany(cohortId: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (orgId: string) => unwrap(api.DELETE('/api/v1/console/corporate/cohorts/{cohort_id}/companies/{org_id}', { params: { path: { cohort_id: cohortId, org_id: orgId } } })),
    onSuccess: () => inv('cohort-companies', 'cohorts'),
  })
}
export function useCnSessions(cohortId?: string) {
  return useQuery({
    queryKey: k('sessions', cohortId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/cohorts/{cohort_id}/sessions', {
          params: { path: { cohort_id: cohortId! } },
        }),
      ),
    enabled: !!cohortId,
  })
}
export function useCnAddSession(cohortId: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleSessionIn']) =>
      unwrap(
        api.POST('/api/v1/console/corporate/cohorts/{cohort_id}/sessions', {
          params: { path: { cohort_id: cohortId } },
          body,
        }),
      ),
    onSuccess: () => inv('sessions'),
  })
}
export function useCnCancelSession() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/console/corporate/sessions/{session_id}', {
          params: { path: { session_id: id } },
        }),
      ),
    onSuccess: () => inv('sessions'),
  })
}
export function useCnUpdateSession() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleSessionPatch'] & { id: string }) =>
      unwrap(
        api.PATCH('/api/v1/console/corporate/sessions/{session_id}', {
          params: { path: { session_id: id } },
          body,
        }),
      ),
    onSuccess: () => inv('sessions'),
  })
}
export function useCnCohortAttendees(cohortId?: string) {
  return useQuery({
    queryKey: k('cohort-attendees', cohortId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/cohorts/{cohort_id}/attendees', {
          params: { path: { cohort_id: cohortId! } },
        }),
      ),
    enabled: !!cohortId,
  })
}
export function useCnTutors(status = '') {
  return useQuery({
    queryKey: k('tutors', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/tutors', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnCreateTutor() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: S['ConsoleTutorIn']) => unwrap(api.POST('/api/v1/console/corporate/tutors', { body })),
    onSuccess: () => inv('tutors'),
  })
}
export function useCnTutorAction() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'suspend' }) =>
      action === 'approve'
        ? unwrap(
            api.PATCH('/api/v1/console/corporate/tutors/{tutor_id}/approve', {
              params: { path: { tutor_id: id } },
            }),
          )
        : unwrap(
            api.PATCH('/api/v1/console/corporate/tutors/{tutor_id}/suspend', {
              params: { path: { tutor_id: id } },
            }),
          ),
    onSuccess: () => inv('tutors'),
  })
}
export function useCnAssignTutor() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ tutorId, cohortId }: { tutorId: string; cohortId: string }) =>
      unwrap(
        api.POST('/api/v1/console/corporate/tutors/{tutor_id}/assign', {
          params: { path: { tutor_id: tutorId } },
          body: { cohort_id: cohortId },
        }),
      ),
    onSuccess: () => inv('tutors', 'cohorts'),
  })
}

// ---------------------------------------------------------------- cancellations & departures
export function useCnCancellations(status: string) {
  return useQuery({
    queryKey: k('cancellations', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/cancellations', {
          params: { query: { status: status || undefined, limit: LIMIT } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnReviewCancellation() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleCancellationReview'] & { id: string }) =>
      unwrap(api.POST('/api/v1/console/corporate/cancellations/{cancellation_id}/review', { params: { path: { cancellation_id: id } }, body })),
    onSuccess: () => inv('cancellations'),
  })
}
export function useCnRefund() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: S['ConsoleRefundIn'] & { id: string }) =>
      unwrap(api.POST('/api/v1/console/corporate/cancellations/{cancellation_id}/refund', { params: { path: { cancellation_id: id } }, body })),
    onSuccess: () => inv('cancellations', 'purchases'),
  })
}
export function useCnPolicies() {
  return useQuery({
    queryKey: k('policies'),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/departure-policies', {
          params: { query: { limit: LIMIT } },
        }),
      ),
  })
}
export function useCnSetPolicy() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ orgId, ...body }: S['ConsoleDeparturePolicyIn'] & { orgId: string }) =>
      unwrap(
        api.PUT('/api/v1/console/corporate/departure-policies/{org_id}', {
          params: { path: { org_id: orgId } },
          body,
        }),
      ),
    onSuccess: () => inv('policies'),
  })
}
/** Records that someone left. Never ends paid access early, so nothing else is invalidated. */
export function useCnRecordDeparture() {
  return useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) =>
      unwrap(api.POST('/api/v1/console/corporate/departure-policies/{org_id}/apply', { params: { path: { org_id: orgId } }, body: { user_id: userId } })),
  })
}
export type CnDepartureResult = S['ConsoleDepartureResultOut']

// ---------------------------------------------------------------- reports
export function useCnOverview(range: string) {
  return useQuery({
    queryKey: k('overview', range),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/reports/overview', {
          params: { query: { range } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnRevenueSeries(range: string) {
  return useQuery({
    queryKey: k('revenue', range),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/reports/revenue-series', {
          params: { query: { range } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnRankings() {
  return useQuery({
    queryKey: k('rankings'),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/reports/company-rankings', {
          params: { query: { limit: 10 } },
        }),
      ),
  })
}
export function useCnAttendance(matchStatus: string) {
  return useQuery({
    queryKey: k('attendance', matchStatus),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/console/corporate/reports/attendance', {
          params: {
            query: { match_status: matchStatus || undefined, limit: LIMIT },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}
export function useCnAttendanceAction() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'verify' | 'reject' }) =>
      action === 'verify'
        ? unwrap(api.POST('/api/v1/console/corporate/reports/attendance/{attendance_id}/verify', { params: { path: { attendance_id: id } } }))
        : unwrap(api.POST('/api/v1/console/corporate/reports/attendance/{attendance_id}/reject', { params: { path: { attendance_id: id } } })),
    onSuccess: () => inv('attendance'),
  })
}

export const COHORT_STATUS: Record<
  string,
  {
    label: string
    tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'primary'
  }
> = {
  forming: { label: 'Forming', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'primary' },
  pending_pay: { label: 'Awaiting payments', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'primary' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const TUTOR_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'neutral' },
}
export const POLICY_LABEL: Record<string, string> = {
  admin_decides: 'We decide each case',
  preserve_completed: 'Keep finished courses (older setting)',
  revoke_all: 'End company training (older setting)',
}
