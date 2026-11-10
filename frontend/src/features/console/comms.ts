import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Communications: tickets, notifications log, broadcasts, announcements and
// notification templates. Keys start with ['console', 'comms', …].

export type TicketFilters = { status?: string; category?: string; priority?: string; q?: string; mine?: boolean }

const fetchTickets = (f: TicketFilters, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/tickets', { params: { query: { ...f, status: f.status || undefined, category: f.category || undefined, priority: f.priority || undefined, q: f.q || undefined, cursor, limit: 25 } } }))
export type ConsoleTicketRow = Awaited<ReturnType<typeof fetchTickets>>['items'][number]
const fetchTicket = (id: string) => unwrap(api.GET('/api/v1/console/tickets/{ticket_id}', { params: { path: { ticket_id: id } } }))
export type ConsoleTicket = Awaited<ReturnType<typeof fetchTicket>>
const fetchTemplates = () => unwrap(api.GET('/api/v1/console/templates'))
export type ConsoleTemplate = Awaited<ReturnType<typeof fetchTemplates>>[number]
const fetchBroadcasts = (kind: string) => unwrap(api.GET('/api/v1/console/broadcasts', { params: { query: { kind } } }))
export type ConsoleBroadcast = Awaited<ReturnType<typeof fetchBroadcasts>>[number]

export const TICKET_CATEGORIES: Record<string, string> = {
  account: 'Account and sign-in', payment: 'Payments and refunds', course: 'Course content', technical: 'Technical problem', business: 'Business account', instructor: 'Teaching and payouts',
}
export const TICKET_STATUSES: Record<string, string> = { open: 'Open', progress: 'In progress', waiting: 'Waiting for customer', resolved: 'Resolved', closed: 'Closed' }
export const PRIORITIES: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const AUDIENCES: Record<string, string> = { everyone: 'Everyone', learners: 'Learners', instructors: 'Instructors', company_admins: 'Company admins', company: 'One company' }

export function useTicketKpis() {
  return useQuery({ queryKey: ['console', 'comms', 'kpis'], queryFn: () => unwrap(api.GET('/api/v1/console/tickets/kpis')) })
}

export function useTickets(f: TicketFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'comms', 'tickets', f],
    queryFn: ({ pageParam }) => fetchTickets(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useConsoleTicket(id: string) {
  return useQuery({ queryKey: ['console', 'comms', 'ticket', id], queryFn: () => fetchTicket(id), enabled: !!id })
}

function useTicketInvalidate() {
  const qc = useQueryClient()
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['console', 'comms', 'tickets'] })
    void qc.invalidateQueries({ queryKey: ['console', 'comms', 'kpis'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
    if (id) void qc.invalidateQueries({ queryKey: ['console', 'comms', 'ticket', id] })
  }
}

export function useStaffReply(id: string) {
  const done = useTicketInvalidate()
  return useMutation({
    mutationFn: (body: { body: string; internal: boolean; attachment_id?: string | null }) => unwrap(api.POST('/api/v1/console/tickets/{ticket_id}/messages', { params: { path: { ticket_id: id } }, body })),
    onSuccess: () => done(id),
  })
}

export function useUpdateTicket(id: string) {
  const done = useTicketInvalidate()
  return useMutation({
    mutationFn: (body: { status?: string; priority?: string; assign_to_me?: boolean }) => unwrap(api.PATCH('/api/v1/console/tickets/{ticket_id}', { params: { path: { ticket_id: id } }, body: { assign_to_me: false, ...body } })),
    onSuccess: () => done(id),
  })
}

export function useCreateTicket() {
  const done = useTicketInvalidate()
  return useMutation({
    mutationFn: (body: { user_email: string; subject: string; category: string; priority: string; body: string }) => unwrap(api.POST('/api/v1/console/tickets', { body })),
    onSuccess: () => done(),
  })
}

/** Uploads straight to storage with a short-lived link; returns the file id for the reply. */
export async function uploadTicketFile(ticketId: string, file: File, onProgress?: (pct: number) => void): Promise<string> {
  const t = await unwrap(api.POST('/api/v1/console/tickets/{ticket_id}/uploads', { params: { path: { ticket_id: ticketId } }, body: { filename: file.name, size_bytes: file.size } }))
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(t.method, t.upload_url)
    for (const [k, v] of Object.entries(t.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection.'))
    xhr.send(file)
  })
  return t.asset_id
}

export async function openTicketFile(ticketId: string, messageId: string) {
  const r = await unwrap(api.GET('/api/v1/console/tickets/{ticket_id}/messages/{message_id}/file', { params: { path: { ticket_id: ticketId, message_id: messageId } } }))
  window.open(r.url, '_blank', 'noopener')
}

// ---------------------------------------------------------------- notifications
export function useNotificationStats() {
  return useQuery({ queryKey: ['console', 'comms', 'notification-stats'], queryFn: () => unwrap(api.GET('/api/v1/console/notifications/stats')) })
}

export function useNotificationLog(f: { kind?: string; q?: string }) {
  return useInfiniteQuery({
    queryKey: ['console', 'comms', 'notifications', f],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/console/notifications', { params: { query: { kind: f.kind || undefined, q: f.q || undefined, cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useBroadcasts(kind: 'broadcast' | 'announcement') {
  return useQuery({ queryKey: ['console', 'comms', 'broadcasts', kind], queryFn: () => fetchBroadcasts(kind) })
}

export function useAudienceCount(audience: string, orgId?: string) {
  return useQuery({
    queryKey: ['console', 'comms', 'audience', audience, orgId ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/console/broadcasts/audience', { params: { query: { audience, org_id: orgId || undefined } } })),
    enabled: !!audience && (audience !== 'company' || !!orgId),
  })
}

export function useBroadcastCompanies(enabled: boolean) {
  return useQuery({ queryKey: ['console', 'comms', 'companies'], queryFn: () => unwrap(api.GET('/api/v1/console/broadcasts/companies')), enabled, staleTime: 5 * 60_000 })
}

export type BroadcastInput = {
  kind: 'broadcast' | 'announcement'
  title: string
  body: string
  audience: string
  org_id?: string | null
  send_in_app: boolean
  send_email: boolean
  url?: string
  show_as_banner?: boolean
  banner_starts_at?: string | null
  banner_ends_at?: string | null
}

export function useSendBroadcast() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BroadcastInput) => unwrap(api.POST('/api/v1/console/broadcasts', { body: { url: '', show_as_banner: false, ...body } })),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['console', 'comms', 'broadcasts', b.kind] })
      void qc.invalidateQueries({ queryKey: ['console', 'comms', 'notifications'] })
      void qc.invalidateQueries({ queryKey: ['console', 'comms', 'notification-stats'] })
      void qc.invalidateQueries({ queryKey: ['platform', 'banner'] })
    },
  })
}

export function useEndBanner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/broadcasts/{broadcast_id}/end-banner', { params: { path: { broadcast_id: id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'comms', 'broadcasts', 'announcement'] })
      void qc.invalidateQueries({ queryKey: ['platform', 'banner'] })
    },
  })
}

// ---------------------------------------------------------------- templates
export function useTemplates() {
  return useQuery({ queryKey: ['console', 'comms', 'templates'], queryFn: fetchTemplates })
}

export function usePreviewTemplate(code: string) {
  return useMutation({ mutationFn: (body: { title: string; body: string }) => unwrap(api.POST('/api/v1/console/templates/{code}/preview', { params: { path: { code } }, body })) })
}

export function useSaveTemplate(code: string) {
  const qc = useQueryClient()
  const put = (rows: ConsoleTemplate[] | undefined, t: ConsoleTemplate) => rows?.map((r) => (r.code === t.code ? t : r))
  return {
    save: useMutation({
      mutationFn: (body: { title: string; body: string; email_enabled: boolean; is_active: boolean }) => unwrap(api.PUT('/api/v1/console/templates/{code}', { params: { path: { code } }, body })),
      onSuccess: (t) => qc.setQueryData<ConsoleTemplate[]>(['console', 'comms', 'templates'], (rows) => put(rows, t)),
    }),
    reset: useMutation({
      mutationFn: () => unwrap(api.POST('/api/v1/console/templates/{code}/reset', { params: { path: { code } } })),
      onSuccess: (t) => qc.setQueryData<ConsoleTemplate[]>(['console', 'comms', 'templates'], (rows) => put(rows, t)),
    }),
  }
}
