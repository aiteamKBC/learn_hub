/** Corporate packages for a company (recorded seats and live training) and the
 * employee's own live training. Every company query is keyed by the org id, so switching
 * company never shows another company's cached data. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type Package = S['PackageOut']
export type Purchase = S['PurchaseOut']
export type Quote = S['QuoteOut']
export type InventoryRow = S['InventoryOut']
export type TrainingRequest = S['TrainingRequestOut']
export type LiveBooking = S['LiveBookingOut']
export type BookingSession = S['SessionOut']
export type Allocation = S['CorporateAllocationOut']
export type Attendee = S['LiveAttendeeOut']
export type Cancellation = S['CancellationOut']
export type EmployeeProgress = S['EmployeeProgressOut']
export type AttendanceRow = S['AttendanceSummaryOut']
export type MyLiveCohort = S['MyLiveCohortOut']

const key = (...parts: unknown[]) => ['corporate', currentOrgId(), ...parts]

export function useCorporateDashboard() {
  return useQuery({ queryKey: key('dashboard'), queryFn: () => unwrap(api.GET('/api/v1/corporate/dashboard')) })
}
export function usePackages(enabled = true) {
  return useQuery({ queryKey: key('packages'), queryFn: () => unwrap(api.GET('/api/v1/corporate/packages')), enabled })
}
export function usePurchases(poll = false, purchaseId?: string | null) {
  return useQuery({
    queryKey: key('purchases'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/purchases')),
    // after Stripe sends the buyer back, payment is confirmed by a webhook a moment later
    refetchInterval: (q) => (poll && q.state.data?.some((p) => p.status === 'pending' && (!purchaseId || p.id === purchaseId)) ? 4000 : false),
  })
}
export function useStagePlan(purchaseId?: string, enabled = true) {
  return useQuery({
    queryKey: key('stage-plan', purchaseId),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/purchases/{purchase_id}/stage-plan', { params: { path: { purchase_id: purchaseId! } } })),
    enabled: !!purchaseId && enabled,
  })
}
export function useQuotes(enabled = true) {
  return useQuery({ queryKey: key('quotes'), queryFn: () => unwrap(api.GET('/api/v1/corporate/quotes')), enabled })
}
export function useInventory() {
  return useQuery({ queryKey: key('inventory'), queryFn: () => unwrap(api.GET('/api/v1/corporate/inventory')) })
}
export function useAllocations(offeringId?: string) {
  return useQuery({
    queryKey: key('allocations', offeringId ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/allocations', { params: { query: { offering_id: offeringId } } })),
  })
}
export function useTrainingRequests(enabled = true) {
  return useQuery({ queryKey: key('requests'), queryFn: () => unwrap(api.GET('/api/v1/corporate/training-requests')), enabled, refetchInterval: 30_000 })
}
export function useLiveBookings(poll = false) {
  return useQuery({
    queryKey: key('bookings'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/live-bookings')),
    refetchInterval: (q) => (poll && q.state.data?.some((b) => b.status === 'pending_pay') ? 4000 : false),
  })
}
export function useBookingSchedule(ccId?: string) {
  return useQuery({
    queryKey: key('schedule', ccId),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/live-bookings/{cc_id}/schedule', { params: { path: { cc_id: ccId! } } })),
    enabled: !!ccId,
  })
}
export function useAttendees(ccId?: string) {
  return useQuery({
    queryKey: key('attendees', ccId),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/live-bookings/{cc_id}/attendees', { params: { path: { cc_id: ccId! } } })),
    enabled: !!ccId,
  })
}
export function useEmployeeProgress(offeringId?: string) {
  return useQuery({
    queryKey: key('progress', offeringId ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/employee-progress', { params: { query: { offering_id: offeringId } } })),
  })
}
export function useAttendanceSummary(cohortId?: string) {
  return useQuery({
    queryKey: key('attendance', cohortId ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/attendance-summary', { params: { query: { cohort_id: cohortId } } })),
  })
}
export function useCancellations(enabled = true) {
  return useQuery({ queryKey: key('cancellations'), queryFn: () => unwrap(api.GET('/api/v1/corporate/cancellation-requests')), enabled })
}

// ---------------------------------------------------------------- mutations

/** Stripe Checkout: the server prices it; the page only follows the returned link. */
export function useRecordedCheckout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ offeringId, quantity, employees = [], source = 'manual' }: { offeringId: string; quantity: number; employees?: SeatEmployee[]; source?: 'manual' | 'csv' }) =>
      unwrap(api.POST('/api/v1/corporate/packages/{offering_id}/checkout', { params: { path: { offering_id: offeringId } }, body: { quantity, employees, employees_source: source } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('purchases') }),
  })
}

export function useLiveCheckout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ccId: string) => unwrap(api.POST('/api/v1/corporate/live-bookings/{cc_id}/checkout', { params: { path: { cc_id: ccId } } })),
    // a passed deadline closes the booking on the server: show that, not a stale offer
    onSettled: () => qc.invalidateQueries({ queryKey: key('bookings') }),
  })
}

export function useAcceptIncludedLiveBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ccId: string) => unwrap(api.POST('/api/v1/corporate/live-bookings/{cc_id}/accept-included', { params: { path: { cc_id: ccId } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: key('bookings') }),
  })
}

export function useAllocate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { offering_id: string; user_id: string }) => unwrap(api.POST('/api/v1/corporate/allocations', { body })),
    onSuccess: () =>
      Promise.all(['allocations', 'inventory', 'dashboard', 'progress'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
  })
}

/** Seats held for people invited by email who have not joined yet (owners and admins). */
export function usePendingSeats(offeringId?: string, enabled = true) {
  return useQuery({
    queryKey: key('pending-seats', offeringId ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/pending-seats', { params: { query: { offering_id: offeringId } } })),
    enabled,
  })
}
export type PendingSeat = S['PendingSeatOut']

export type SeatEmployee = { email: string; full_name: string; job_title: string }
export type SeatRequest = S['SeatRequestOut']

/** Send a list of employees for paid seats (typed in or read from a CSV file). */
export function useSubmitSeatRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { offering_id: string; source: 'manual' | 'csv'; employees: SeatEmployee[] }) => unwrap(api.POST('/api/v1/corporate/seat-requests', { body })),
    onSuccess: () =>
      Promise.all(['allocations', 'inventory', 'dashboard', 'progress', 'pending-seats', 'seat-requests'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
  })
}

export function useSeatRequests(offeringId?: string, enabled = true) {
  return useQuery({
    queryKey: key('seat-requests', offeringId ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/seat-requests', { params: { query: { offering_id: offeringId } } })),
    enabled,
  })
}

/** Console: employee lists waiting for (or past) platform approval. */
export function useConsoleSeatRequests(status: string) {
  return useQuery({
    queryKey: ['console', 'seat-requests', status],
    queryFn: () => unwrap(api.GET('/api/v1/console/seat-requests', { params: { query: { status } } })),
  })
}

export function useReviewSeatRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      approve
        ? unwrap(api.POST('/api/v1/console/seat-requests/{request_id}/approve', { params: { path: { request_id: id } }, body: { note: note ?? '' } }))
        : unwrap(api.POST('/api/v1/console/seat-requests/{request_id}/reject', { params: { path: { request_id: id } }, body: { note: note ?? '' } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['console', 'seat-requests'] }),
  })
}

export function useCancelPendingSeat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/corporate/pending-seats/{pending_id}/cancel', { params: { path: { pending_id: id } } })),
    onSuccess: () => Promise.all(['inventory', 'dashboard', 'pending-seats', 'seat-requests'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
  })
}

export function useSubmitTrainingRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['TrainingRequestIn']) => unwrap(api.POST('/api/v1/corporate/training-requests', { body })),
    onSuccess: () => Promise.all(['requests', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
  })
}

export function useCancelTrainingRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/corporate/training-requests/{request_id}', { params: { path: { request_id: id } } })),
    onSuccess: () => Promise.all(['requests', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
  })
}

export function useAddAttendee(ccId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(api.POST('/api/v1/corporate/live-bookings/{cc_id}/attendees', { params: { path: { cc_id: ccId } }, body: { user_id: userId } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('attendees', ccId) }), qc.invalidateQueries({ queryKey: key('bookings') })]),
  })
}

export function useRemoveAttendee(ccId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attendeeId: string) =>
      unwrap(api.DELETE('/api/v1/corporate/live-bookings/{cc_id}/attendees/{attendee_id}', { params: { path: { cc_id: ccId, attendee_id: attendeeId } } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('attendees', ccId) }), qc.invalidateQueries({ queryKey: key('bookings') })]),
  })
}

export function useSubmitCancellation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['CancellationIn']) => unwrap(api.POST('/api/v1/corporate/cancellation-requests', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('cancellations') }),
  })
}

// ---------------------------------------------------------------- the employee's own live training

/** Not tied to a company space: an employee sees their live training from anywhere. */
export function useMyLive() {
  return useQuery({
    queryKey: ['corporate', 'my-live'],
    queryFn: () => unwrap(api.GET('/api/v1/corporate/my/live', { headers: { 'X-Org-Id': '' } })),
    // join links open 15 minutes before a session: check again every minute
    refetchInterval: 60_000,
  })
}

// ---------------------------------------------------------------- shared labels

export const DELIVERY_LABEL: Record<string, string> = { recorded: 'Recorded course', live: 'Live training' }
export const MODE_LABEL: Record<string, string> = { online: 'Online', in_person: 'In person', hybrid: 'Hybrid' }

export const PURCHASE_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  pending: { label: 'Waiting for payment', tone: 'warning' },
  partial_paid: { label: 'Partly paid', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  partial: { label: 'Partly refunded', tone: 'info' },
  expired: { label: 'Payment not finished', tone: 'neutral' },
  voided: { label: 'Cancelled', tone: 'neutral' },
}

/** What the employer sees (never "waiting for enough people"). */
export const BOOKING_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'primary' }> = {
  interested: { label: 'Scheduling', tone: 'info' },
  offered: { label: 'Payment required', tone: 'warning' },
  pending_pay: { label: 'Payment in progress', tone: 'warning' },
  included: { label: 'Included in Team plan', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
  active: { label: 'In training', tone: 'primary' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
}

export const REQUEST_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'primary' }> = {
  submitted: { label: 'Under review', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  scheduling: { label: 'Scheduling', tone: 'info' },
  offered: { label: 'Offer ready', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const QUOTE_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  sent: { label: 'Waiting for payment', tone: 'warning' },
  accepted: { label: 'Paid', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'neutral' },
  voided: { label: 'Withdrawn', tone: 'neutral' },
}

export const CANCEL_TYPE: Record<string, string> = {
  recorded_refund: 'Refund for recorded seats',
  cohort_cancel: 'Cancel live training',
  postponement: 'Postpone live training',
}

export const CANCEL_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  submitted: { label: 'Sent', tone: 'info' },
  under_review: { label: 'Being reviewed', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  processed: { label: 'Refunded', tone: 'success' },
}

// ---- bundles and multi-course purchases
export type Bundle = S['BundleOut']
export type ConsoleBundle = S['ConsoleBundleOut']
export type BasketLine = { course_id: string; quantity: number; employees: SeatEmployee[] }

/** Public list of bundles on sale (home page and the company catalogue). */
export function useBundles() {
  return useQuery({ queryKey: key('bundles'), queryFn: () => unwrap(api.GET('/api/v1/corporate/bundles')) })
}

/** Seats in several courses, one Stripe payment (bundleId: every seat at the bundle price). */
export function useBasketCheckout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lines, bundleId, source = 'manual' }: { lines: BasketLine[]; bundleId?: string; source?: 'manual' | 'csv' }) =>
      unwrap(api.POST('/api/v1/corporate/basket/checkout', { body: { lines, bundle_id: bundleId ?? null, employees_source: source } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('purchases') }),
  })
}

export function useConsoleBundles() {
  return useQuery({ queryKey: ['console', 'bundles'], queryFn: () => unwrap(api.GET('/api/v1/console/corporate/bundles')) })
}

export function useSaveBundle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { title: string; description: string; seat_price_minor: number; is_active: boolean; course_ids: string[] } }) =>
      id ? unwrap(api.PUT('/api/v1/console/corporate/bundles/{bundle_id}', { params: { path: { bundle_id: id } }, body })) : unwrap(api.POST('/api/v1/console/corporate/bundles', { body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['console', 'bundles'] }), qc.invalidateQueries({ queryKey: key('bundles') })]),
  })
}

/** Recorded courses the company can buy, as basket options. */
export function recordedOptions(packages: Package[]): { course_id: string; title: string; price_minor: number }[] {
  return packages.filter((p) => p.delivery_type === 'recorded').map((p) => ({ course_id: p.course_id, title: p.course_title, price_minor: p.price_gbp_minor }))
}

// ---- live courses: book seats in the next intake, pay the deposit
export function useLiveOffer(courseId: string) {
  return useQuery({ queryKey: key('live-offer', courseId), queryFn: () => unwrap(api.GET('/api/v1/corporate/live/offer/{course_id}', { params: { path: { course_id: courseId } } })), retry: false })
}

export function useLiveBook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { course_id: string; quantity: number; employees: SeatEmployee[]; employees_source: 'manual' | 'csv' }) => unwrap(api.POST('/api/v1/corporate/live/book', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('live-bookings') }),
  })
}

export function useLivePayNext() {
  return useMutation({
    mutationFn: (bookingId: string) => unwrap(api.POST('/api/v1/corporate/live/bookings/{booking_id}/pay-next', { params: { path: { booking_id: bookingId } } })),
    onSuccess: (r) => window.location.assign(r.checkout_url),
  })
}

export function useLiveSeatBookings() {
  return useQuery({ queryKey: key('live-bookings'), queryFn: () => unwrap(api.GET('/api/v1/corporate/live/bookings')) })
}

// ---------------------------------------------------------------- private live intakes
export function usePrivateIntakes() {
  return useQuery({ queryKey: key('private-intakes'), queryFn: () => unwrap(api.GET('/api/v1/corporate/live/private-intakes')) })
}

export function useAskPrivateIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { course_id: string; expected_people?: number | null; message: string }) => unwrap(api.POST('/api/v1/corporate/live/private-intakes', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('private-intakes') }),
  })
}

export function useWithdrawPrivateIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/corporate/live/private-intakes/{req_id}/withdraw', { params: { path: { req_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('private-intakes') }),
  })
}

export function useBookPrivateIntake() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; employees: SeatEmployee[]; employees_source: 'manual' | 'csv' }) =>
      unwrap(api.POST('/api/v1/corporate/live/private-intakes/{req_id}/book', { params: { path: { req_id: id } }, body })),
    onSuccess: (r) => window.location.assign(r.checkout_url),
  })
}
