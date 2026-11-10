/** Q&A, reviews, announcements, notifications, badges and support tickets. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { useMe } from '@/features/identity/auth'

export type Question = components['schemas']['QuestionOut']
export type QuestionDetail = components['schemas']['QuestionDetail']
export type Notification = components['schemas']['NotificationOut']
export type Ticket = components['schemas']['TicketOut']

// ---------------------------------------------------------------- Q&A
export function useQuestions(courseId?: string, filter: { lectureKey?: string; q?: string; unanswered?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['questions', courseId, filter],
    queryFn: ({ pageParam }) =>
      unwrap(api.GET('/api/v1/engagement/courses/{course_id}/questions', { params: { path: { course_id: courseId! }, query: { lecture_key: filter.lectureKey, q: filter.q || undefined, unanswered: filter.unanswered || undefined, cursor: pageParam, limit: 10 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!courseId,
    placeholderData: keepPreviousData,
  })
}

export function useQuestion(id?: string | null) {
  return useQuery({
    queryKey: ['question', id],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/questions/{question_id}', { params: { path: { question_id: id! } } })),
    enabled: !!id,
  })
}

export function useAsk(courseId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; body: string; lecture_key?: string | null }) => unwrap(api.POST('/api/v1/engagement/courses/{course_id}/questions', { params: { path: { course_id: courseId! } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['questions', courseId] }),
  })
}

function useQuestionRefresh(id?: string | null) {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['question', id] }), qc.invalidateQueries({ queryKey: ['questions'] })])
}

export function useAnswer(questionId?: string | null) {
  const refresh = useQuestionRefresh(questionId)
  return useMutation({
    mutationFn: (body: string) => unwrap(api.POST('/api/v1/engagement/questions/{question_id}/answers', { params: { path: { question_id: questionId! } }, body: { body } })),
    onSuccess: () => refresh(),
  })
}

export function useVote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/engagement/questions/{question_id}/vote', { params: { path: { question_id: id } } })),
    onSuccess: (_, id) => Promise.all([qc.invalidateQueries({ queryKey: ['question', id] }), qc.invalidateQueries({ queryKey: ['questions'] })]),
  })
}

export function useResolve(questionId?: string | null) {
  const refresh = useQuestionRefresh(questionId)
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/engagement/questions/{question_id}/resolve', { params: { path: { question_id: questionId! } } })),
    onSuccess: () => refresh(),
  })
}

// ---------------------------------------------------------------- reviews & announcements
export function useMyReview(courseId?: string) {
  return useQuery({
    queryKey: ['my-review', courseId],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/courses/{course_id}/my-review', { params: { path: { course_id: courseId! } } })),
    enabled: !!courseId,
  })
}

export function useWriteReview(courseId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { rating: number; body: string }) => unwrap(api.PUT('/api/v1/engagement/courses/{course_id}/review', { params: { path: { course_id: courseId! } }, body })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['my-review', 'reviews', 'course'].includes(String(q.queryKey[0])) }),
  })
}

export function useAnnouncements(courseId?: string) {
  return useQuery({
    queryKey: ['announcements', courseId],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/courses/{course_id}/announcements', { params: { path: { course_id: courseId! } } })),
    enabled: !!courseId,
  })
}

// ---------------------------------------------------------------- notifications
export function useUnreadCount() {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/notifications/unread-count')),
    enabled: !!me,
    refetchInterval: 60_000, // one indexed count a minute; paused in background tabs
    staleTime: 30_000,
  })
}

export function useNotifications(unreadOnly = false, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/engagement/notifications', { params: { query: { unread_only: unreadOnly, cursor: pageParam, limit: 15 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[] | null) => unwrap(api.POST('/api/v1/engagement/notifications/read', { body: { ids } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function usePreferences() {
  return useQuery({ queryKey: ['notification-preferences'], queryFn: () => unwrap(api.GET('/api/v1/engagement/notifications/preferences')) })
}

export function useSetPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: string; email: boolean; in_app: boolean }) => unwrap(api.PUT('/api/v1/engagement/notifications/preferences', { body })),
    // optimistic: the switch moves at once and rolls back if the server refuses
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['notification-preferences'] })
      const prev = qc.getQueryData<components['schemas']['PreferenceOut'][]>(['notification-preferences'])
      qc.setQueryData(['notification-preferences'], prev?.map((p) => (p.kind === body.kind ? { ...p, ...body } : p)))
      return { prev }
    },
    onError: (_e, _b, ctx) => qc.setQueryData(['notification-preferences'], ctx?.prev),
  })
}

export function useBadges() {
  return useQuery({ queryKey: ['badges'], queryFn: () => unwrap(api.GET('/api/v1/engagement/my/badges')) })
}

// ---------------------------------------------------------------- support
export function useTickets() {
  return useQuery({ queryKey: ['tickets'], queryFn: () => unwrap(api.GET('/api/v1/engagement/tickets')) })
}

export function useTicket(id?: string) {
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/tickets/{ticket_id}', { params: { path: { ticket_id: id! } } })),
    enabled: !!id,
  })
}

export function useOpenTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { subject: string; category: string; body: string }) => unwrap(api.POST('/api/v1/engagement/tickets', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useReplyTicket(id?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => unwrap(api.POST('/api/v1/engagement/tickets/{ticket_id}/messages', { params: { path: { ticket_id: id! } }, body: { body } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['ticket', id] }), qc.invalidateQueries({ queryKey: ['tickets'] })]),
  })
}

export function useCloseTicket(id?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/engagement/tickets/{ticket_id}/close', { params: { path: { ticket_id: id! } } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['ticket', id] }), qc.invalidateQueries({ queryKey: ['tickets'] })]),
  })
}

// ---------------------------------------------------------------- reporting content
export function useReportContent() {
  return useMutation({
    mutationFn: (body: { target_type: 'review' | 'question' | 'answer'; target_id: string; reason: string }) => unwrap(api.POST('/api/v1/engagement/reports', { body })),
  })
}

/** Opens a support-ticket attachment through a short-lived download link. */
export async function openTicketAttachment(ticketId: string, messageId: string) {
  const { url } = await unwrap(api.GET('/api/v1/engagement/tickets/{ticket_id}/messages/{message_id}/file', { params: { path: { ticket_id: ticketId, message_id: messageId } } }))
  window.open(url, '_blank', 'noopener')
}
