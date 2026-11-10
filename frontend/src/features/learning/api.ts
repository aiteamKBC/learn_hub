/** The learner's courses, the course player, quizzes, assignments, notes and certificates. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { API_BASE_URL } from '@/lib/env'

export type Player = components['schemas']['PlayerOut']
export type PlayerLecture = components['schemas']['PlayerLecture']
export type Lecture = components['schemas']['LectureContent']
export type Attempt = components['schemas']['AttemptOut']
export type LearnerQuestion = components['schemas']['LearnerQuestion']
export type ReviewItem = components['schemas']['ReviewItem']
export type Note = components['schemas']['NoteOut']
export type Certificate = components['schemas']['CertificateOut']
export type Submission = components['schemas']['SubmissionOut']

/** A quiz answer, in the shape the server grades (see learning/grading.py). */
export type Answer = string | string[] | Record<string, string>

export function useMyCourses(status = 'all') {
  return useQuery({ queryKey: ['my-courses', status], queryFn: () => unwrap(api.GET('/api/v1/learning/my/courses', { params: { query: { status, limit: 24 } } })) })
}

/** The player addresses courses by slug (nice URLs); the API by enrolment. */
export function useEnrollmentId(slug: string) {
  const q = useQuery({
    queryKey: ['my-courses', 'slug', slug],
    queryFn: () => unwrap(api.GET('/api/v1/learning/my/courses', { params: { query: { slug, limit: 1 } } })),
    staleTime: 5 * 60_000,
  })
  const item = q.data?.items[0]
  // never decide "not enrolled" from a stale answer (e.g. just after enrolling)
  return { ...q, enrollmentId: item?.enrollment_id, notEnrolled: q.isSuccess && !q.isFetching && !item }
}

export function usePlayer(enrollmentId?: string) {
  return useQuery({
    queryKey: ['player', enrollmentId],
    queryFn: () => unwrap(api.GET('/api/v1/learning/enrollments/{enrollment_id}', { params: { path: { enrollment_id: enrollmentId! } } })),
    enabled: !!enrollmentId,
  })
}

export function useLecture(enrollmentId?: string, key?: string) {
  return useQuery({
    queryKey: ['lecture', enrollmentId, key],
    queryFn: () => unwrap(api.GET('/api/v1/learning/enrollments/{enrollment_id}/lectures/{lecture_key}', { params: { path: { enrollment_id: enrollmentId!, lecture_key: key! } } })),
    enabled: !!enrollmentId && !!key,
    // signed video links last 2 hours; refetching on focus keeps them fresh without reloads
    staleTime: 10 * 60_000,
  })
}

/** After anything that can change progress: the sidebar ticks, the % and "My learning". */
function useProgressRefresh(enrollmentId?: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['player', enrollmentId] }),
      qc.invalidateQueries({ queryKey: ['lecture', enrollmentId] }),
      qc.invalidateQueries({ queryKey: ['my-courses'] }),
      qc.invalidateQueries({ queryKey: ['my-requirements'] }),
      qc.invalidateQueries({ queryKey: ['certificates'] }),
    ])
}

export function useCompleteLecture(enrollmentId?: string) {
  const refresh = useProgressRefresh(enrollmentId)
  return useMutation({
    mutationFn: (key: string) => unwrap(api.POST('/api/v1/learning/enrollments/{enrollment_id}/lectures/{lecture_key}/complete', { params: { path: { enrollment_id: enrollmentId!, lecture_key: key } } })),
    onSuccess: () => refresh(),
  })
}

export function sendHeartbeat(enrollmentId: string, body: { lecture_key: string; position_sec: number; watched_sec: number; ended?: boolean }, keepalive = false) {
  // keepalive lets the last beat leave while the tab closes
  return api.POST('/api/v1/learning/enrollments/{enrollment_id}/heartbeat', { params: { path: { enrollment_id: enrollmentId } }, body: { ...body, ended: body.ended ?? false }, keepalive })
}

export function useRefreshProgress(enrollmentId?: string) {
  return useProgressRefresh(enrollmentId)
}

export function useDownloadResource(enrollmentId?: string, key?: string) {
  return useMutation({
    mutationFn: (resourceId: string) =>
      unwrap(api.GET('/api/v1/learning/enrollments/{enrollment_id}/lectures/{lecture_key}/resources/{resource_id}/download', { params: { path: { enrollment_id: enrollmentId!, lecture_key: key!, resource_id: resourceId } } })),
  })
}

// ---------------------------------------------------------------- quizzes
export function useStartAttempt(enrollmentId?: string, key?: string) {
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/learning/enrollments/{enrollment_id}/quizzes/{lecture_key}/attempts', { params: { path: { enrollment_id: enrollmentId!, lecture_key: key! } } })),
  })
}

export function useAttempt(id?: string | null) {
  return useQuery({
    queryKey: ['attempt', id],
    queryFn: () => unwrap(api.GET('/api/v1/learning/attempts/{attempt_id}', { params: { path: { attempt_id: id! } } })),
    enabled: !!id,
  })
}

export function useSubmitAttempt(enrollmentId?: string) {
  const qc = useQueryClient()
  const refresh = useProgressRefresh(enrollmentId)
  return useMutation({
    mutationFn: (v: { id: string; answers: Record<string, Answer> }) => unwrap(api.POST('/api/v1/learning/attempts/{attempt_id}/submit', { params: { path: { attempt_id: v.id } }, body: { answers: v.answers } })),
    onSuccess: (data) => {
      qc.setQueryData(['attempt', data.id], data)
      return refresh()
    },
  })
}

// ---------------------------------------------------------------- assignments
export function useSubmitAssignment(enrollmentId?: string, key?: string) {
  const refresh = useProgressRefresh(enrollmentId)
  return useMutation({
    mutationFn: (body: { text: string; url: string; asset_ids: string[] }) => unwrap(api.POST('/api/v1/learning/enrollments/{enrollment_id}/assignments/{lecture_key}/submissions', { params: { path: { enrollment_id: enrollmentId!, lecture_key: key! } }, body })),
    onSuccess: () => refresh(),
  })
}

/** Hands one file to storage: a write-only link from the API, then a straight PUT to
 * Azure (the file never passes through our servers). Resolves with its asset id. */
export async function uploadSubmissionFile(enrollmentId: string, key: string, file: File, onProgress?: (pct: number) => void): Promise<string> {
  const ticket = await unwrap(api.POST('/api/v1/learning/enrollments/{enrollment_id}/assignments/{lecture_key}/uploads', { params: { path: { enrollment_id: enrollmentId, lecture_key: key } }, body: { filename: file.name, size_bytes: file.size } }))
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest() // fetch() cannot report upload progress
    xhr.open(ticket.method, ticket.upload_url)
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
  return ticket.asset_id
}

// ---------------------------------------------------------------- notes
export function useNotes(enrollmentId?: string, lectureKey?: string) {
  return useQuery({
    queryKey: ['notes', enrollmentId, lectureKey ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/v1/learning/enrollments/{enrollment_id}/notes', { params: { path: { enrollment_id: enrollmentId! }, query: { lecture_key: lectureKey } } })),
    enabled: !!enrollmentId,
    placeholderData: keepPreviousData,
  })
}

export function useAddNote(enrollmentId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { lecture_key: string; body: string; timestamp_sec?: number | null }) => unwrap(api.POST('/api/v1/learning/enrollments/{enrollment_id}/notes', { params: { path: { enrollment_id: enrollmentId! } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', enrollmentId] }),
  })
}

export function useDeleteNote(enrollmentId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/learning/notes/{note_id}', { params: { path: { note_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', enrollmentId] }),
  })
}

export function useUpdateNote(enrollmentId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; timestamp_sec?: number; clear_timestamp?: boolean; body?: string }) =>
      unwrap(api.PATCH('/api/v1/learning/notes/{note_id}', { params: { path: { note_id: v.id } }, body: { timestamp_sec: v.timestamp_sec, clear_timestamp: v.clear_timestamp ?? false, body: v.body } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', enrollmentId] }),
  })
}

// ---------------------------------------------------------------- certificates
export function useMyCertificates() {
  return useQuery({ queryKey: ['certificates'], queryFn: () => unwrap(api.GET('/api/v1/learning/my/certificates')) })
}

export function useVerifyCertificate(code: string) {
  return useQuery({
    queryKey: ['verify', code],
    queryFn: () => unwrap(api.GET('/api/v1/learning/verify/{code}', { params: { path: { code } } })),
    retry: false,
  })
}

/** The PDF is streamed by Django with the session cookie: a plain link downloads it. */
export const certificatePdfUrl = (id: string) => `${API_BASE_URL}/api/v1/learning/certificates/${id}/pdf`
