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
export function usePurchases(poll = false) {
  return useQuery({
    queryKey: key('purchases'),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/purchases')),
    // after Stripe sends the buyer back, payment is confirmed by a webhook a moment later
    refetchInterval: (q) => (poll && q.state.data?.some((p) => p.status === 'pending') ? 4000 : false),
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
  return useQuery({ queryKey: key('requests'), queryFn: () => unwrap(api.GET('/api/v1/corporate/training-requests')), enabled })
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
    mutationFn: ({ offeringId, quantity }: { offeringId: string; quantity: number }) =>
      unwrap(api.POST('/api/v1/corporate/packages/{offering_id}/checkout', { params: { path: { offering_id: offeringId } }, body: { quantity } })),
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

export function useAllocate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { offering_id: string; user_id: string }) => unwrap(api.POST('/api/v1/corporate/allocations', { body })),
    onSuccess: () =>
      Promise.all(['allocations', 'inventory', 'dashboard', 'progress'].map((k) => qc.invalidateQueries({ queryKey: key(k) }))),
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
