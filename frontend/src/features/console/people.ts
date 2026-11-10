import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// Console > Students and Instructors (mockup 05). Keys start with ['console', 'people', …].

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>

export type StudentFilters = { q?: string; status?: '' | 'active' | 'suspended' | 'deleted'; enrolment?: '' | 'none' | 'any' | 'active' | 'completed' }
export type InstructorFilters = { q?: string; status?: string; permission?: '' | 'publish_without_review' | 'no_coupons' | 'drm' | 'course_limit' | 'custom' }

const fetchStudents = (f: StudentFilters, cursor?: string) => unwrap(api.GET('/api/v1/console/people/students', { params: { query: { ...clean(f), cursor, limit: 25 } } }))
export type StudentRow = Awaited<ReturnType<typeof fetchStudents>>['items'][number]
const fetchStudent = (id: string) => unwrap(api.GET('/api/v1/console/people/students/{user_id}', { params: { path: { user_id: id } } }))
export type StudentDetail = Awaited<ReturnType<typeof fetchStudent>>
const fetchInstructors = (f: InstructorFilters, cursor?: string) => unwrap(api.GET('/api/v1/console/people/instructors', { params: { query: { ...clean(f), cursor, limit: 25 } } }))
export type InstructorRow = Awaited<ReturnType<typeof fetchInstructors>>['items'][number]
const fetchInstructor = (id: string) => unwrap(api.GET('/api/v1/console/people/instructors/{user_id}', { params: { path: { user_id: id } } }))
export type InstructorDetail = Awaited<ReturnType<typeof fetchInstructor>>
export type InstructorPermissions = components['schemas']['ConsoleInstructorPermissionsIn']
const fetchApplications = () => unwrap(api.GET('/api/v1/console/instructors', { params: { query: { status: 'pending' } } }))
export type Application = Awaited<ReturnType<typeof fetchApplications>>[number]

export const fetchStudentsExport = (f: StudentFilters) => unwrap(api.GET('/api/v1/console/people/students/export', { params: { query: clean(f) } }))
export const fetchInstructorsExport = (f: InstructorFilters) => unwrap(api.GET('/api/v1/console/people/instructors/export', { params: { query: clean(f) } }))

const page = { initialPageParam: undefined as string | undefined, getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined, placeholderData: keepPreviousData }

export function useStudentKpis() {
  return useQuery({ queryKey: ['console', 'people', 'students', 'kpis'], queryFn: () => unwrap(api.GET('/api/v1/console/people/students/kpis')) })
}

export function useStudents(f: StudentFilters) {
  return useInfiniteQuery({ queryKey: ['console', 'people', 'students', 'list', f], queryFn: ({ pageParam }) => fetchStudents(f, pageParam), ...page })
}

export function useStudent(id: string) {
  return useQuery({ queryKey: ['console', 'people', 'students', 'detail', id], queryFn: () => fetchStudent(id), enabled: !!id })
}

export function useInstructorKpis() {
  return useQuery({ queryKey: ['console', 'people', 'instructors', 'kpis'], queryFn: () => unwrap(api.GET('/api/v1/console/people/instructors/kpis')) })
}

export function useInstructors(f: InstructorFilters) {
  return useInfiniteQuery({ queryKey: ['console', 'people', 'instructors', 'list', f], queryFn: ({ pageParam }) => fetchInstructors(f, pageParam), ...page })
}

export function useInstructor(id: string) {
  return useQuery({ queryKey: ['console', 'people', 'instructors', 'detail', id], queryFn: () => fetchInstructor(id), enabled: !!id })
}

export function useApplications() {
  return useQuery({ queryKey: ['console', 'people', 'applications'], queryFn: fetchApplications })
}

/** People changed: lists, KPIs, details and the sidebar/dashboard counts. */
function usePeopleChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'people'] })
    void qc.invalidateQueries({ queryKey: ['console', 'commissions'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
  }
}

export function useEditAccount() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; full_name?: string; email?: string }) => unwrap(api.PATCH('/api/v1/console/people/accounts/{user_id}', { params: { path: { user_id: v.id } }, body: { full_name: v.full_name, email: v.email } })),
    onSuccess: done,
  })
}

export function useSuspendAccount() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/people/accounts/{user_id}/suspend', { params: { path: { user_id: v.id } }, body: { reason: v.reason } })),
    onSuccess: done,
  })
}

export function useReactivateAccount() {
  const done = usePeopleChanged()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/people/accounts/{user_id}/reactivate', { params: { path: { user_id: id } } })), onSuccess: done })
}

export function useDeleteAccount() {
  const done = usePeopleChanged()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/users/{user_id}/anonymize', { params: { path: { user_id: id } } })), onSuccess: done })
}

export function useSetPermissions() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; body: InstructorPermissions }) => unwrap(api.PUT('/api/v1/console/people/instructors/{user_id}/permissions', { params: { path: { user_id: v.id } }, body: v.body })),
    onSuccess: done,
  })
}

export function useEditInstructor() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; body: components['schemas']['ConsoleInstructorPatch'] }) => unwrap(api.PATCH('/api/v1/console/people/instructors/{user_id}', { params: { path: { user_id: v.id } }, body: v.body })),
    onSuccess: done,
  })
}

export function useSuspendInstructor() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/people/instructors/{user_id}/suspend', { params: { path: { user_id: v.id } }, body: { reason: v.reason } })),
    onSuccess: done,
  })
}

export function useReactivateInstructor() {
  const done = usePeopleChanged()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/people/instructors/{user_id}/reactivate', { params: { path: { user_id: id } } })), onSuccess: done })
}

const invitesKey = ['console', 'people', 'invites']

export function useInviteInstructor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; name: string }) => unwrap(api.POST('/api/v1/console/people/instructors/invite', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  })
}

/** Invitations to teach not yet accepted or cancelled. */
export function usePendingInvites() {
  return useQuery({ queryKey: invitesKey, queryFn: () => unwrap(api.GET('/api/v1/console/people/instructors/invites')) })
}

export function useResendInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/people/instructors/invites/{invite_id}/resend', { params: { path: { invite_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  })
}

export function useCancelInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/people/instructors/invites/{invite_id}/cancel', { params: { path: { invite_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  })
}

export function useDecideApplication() {
  const done = usePeopleChanged()
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason?: string }) => unwrap(api.POST('/api/v1/console/instructors/{user_id}/decision', { params: { path: { user_id: v.id } }, body: { approve: v.approve, reason: v.reason ?? '' } })),
    onSuccess: done,
  })
}

// ---------------------------------------------------------------- CSV (built in the browser from typed rows)
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // a leading = + - @ would run as a formula in Excel: neutralise it
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Saves rows as a CSV file (UTF-8 with BOM so Excel shows £ and accents). */
export function saveCsv(filename: string, header: string[], rows: unknown[][]) {
  const text = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
