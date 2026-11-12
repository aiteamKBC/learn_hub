/** Company agreements: seat inventory, agreed programme length, instalment plans (staff),
 * purchase files (staff and company owners/admins) and the employee's own programmes.
 * Payment is only ever confirmed by Stripe's signed webhook on the server; nothing here
 * marks anything paid. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type CnInventory = S['ConsoleInventoryOut']
export type CnInventorySeat = S['ConsoleInventorySeatOut']
export type CnPlan = S['ConsoleInstalmentPlanOut']
export type CnInstalment = S['ConsoleInstalmentOut']
export type CnPlanIn = S['ConsoleInstalmentPlanIn']
export type FileRow = S['ConsoleAttachmentOut'] | S['CorporateAttachmentOut']
export type MyProgramme = S['MyProgrammeOut']
type UploadTicket = { attachment_id: string; upload_url: string; method: string; headers: Record<string, string> }

const cn = (...p: unknown[]) => ['console', 'corporate', ...p]
const co = (...p: unknown[]) => ['corporate', currentOrgId(), ...p]

// ---------------------------------------------------------------- labels
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'primary'
export const ENTITLEMENT: Record<string, { label: string; tone: Tone }> = {
  paid_in_full: { label: 'Paid in full', tone: 'success' },
  active: { label: 'Paid', tone: 'success' },
  expired: { label: 'Paid period ended', tone: 'danger' },
  not_covered: { label: 'Not covered', tone: 'warning' },
  unpaid: { label: 'Not paid', tone: 'warning' },
}
export const PROGRAMME: Record<string, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  ended: { label: 'Programme ended', tone: 'neutral' },
}
export const INSTALMENT: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Not sent', tone: 'neutral' },
  sent: { label: 'Invoice sent', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Payment failed', tone: 'danger' },
  overdue: { label: 'Overdue', tone: 'warning' },
  void: { label: 'Cancelled', tone: 'neutral' },
}
export const PLAN_LABEL: Record<string, string> = { full: 'Paid in full', instalments: 'Instalments' }

// ---------------------------------------------------------------- storage
/** Straight to Azure with a short-lived write-only link (the file never passes through
 * our servers). fetch() cannot report upload progress, so this uses XHR. */
function put(ticket: UploadTicket, file: File, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(ticket.method, ticket.upload_url)
    for (const [h, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(h, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
}
export type Upload = { file: File; onProgress?: (pct: number) => void }

// ---------------------------------------------------------------- console: inventory + agreements
export function useCnInventory(orgId: string, q: string, status: string) {
  return useQuery({
    queryKey: cn('inventory', orgId, q, status),
    queryFn: () => unwrap(api.GET('/api/v1/console/corporate/inventory', { params: { query: { org_id: orgId || undefined, q, status } } })),
    placeholderData: keepPreviousData,
  })
}
export function useCnSetProgramme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ purchaseId, months }: { purchaseId: string; months: number | null }) =>
      unwrap(api.PATCH('/api/v1/console/corporate/purchases/{purchase_id}/programme', { params: { path: { purchase_id: purchaseId } }, body: { programme_months: months } })),
    onSuccess: () => Promise.all(['purchases', 'plan', 'inventory'].map((g) => qc.invalidateQueries({ queryKey: cn(g) }))),
  })
}
export function useCnPlan(purchaseId?: string) {
  return useQuery({
    queryKey: cn('plan', purchaseId),
    enabled: Boolean(purchaseId),
    queryFn: () => unwrap(api.GET('/api/v1/console/corporate/purchases/{purchase_id}/plan', { params: { path: { purchase_id: purchaseId! } } })),
  })
}
function usePlanChange() {
  const qc = useQueryClient()
  return () => Promise.all(['plan', 'purchases', 'inventory'].map((g) => qc.invalidateQueries({ queryKey: cn(g) })))
}
export function useCnCreatePlan() {
  const done = usePlanChange()
  return useMutation({ mutationFn: (body: CnPlanIn) => unwrap(api.POST('/api/v1/console/corporate/instalment-plans', { body })), onSuccess: done })
}
export function useCnSendInstalment() {
  const done = usePlanChange()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/corporate/instalments/{instalment_id}/send', { params: { path: { instalment_id: id } } })),
    onSuccess: done,
  })
}
export function useCnCover() {
  const done = usePlanChange()
  return useMutation({
    mutationFn: ({ id, allocationIds }: { id: string; allocationIds: string[] }) =>
      unwrap(api.POST('/api/v1/console/corporate/instalments/{instalment_id}/cover', { params: { path: { instalment_id: id } }, body: { allocation_ids: allocationIds } })),
    onSuccess: done,
  })
}
export function useCnUncover() {
  const done = usePlanChange()
  return useMutation({
    mutationFn: ({ id, allocationId }: { id: string; allocationId: string }) =>
      unwrap(api.DELETE('/api/v1/console/corporate/instalments/{instalment_id}/cover/{allocation_id}', { params: { path: { instalment_id: id, allocation_id: allocationId } } })),
    onSuccess: done,
  })
}

// ---------------------------------------------------------------- files (console)
export function useCnFiles(purchaseId: string) {
  return useQuery({
    queryKey: cn('files', purchaseId),
    queryFn: () => unwrap(api.GET('/api/v1/console/corporate/purchases/{purchase_id}/attachments', { params: { path: { purchase_id: purchaseId } } })),
  })
}
export function useCnUpload(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, onProgress }: Upload) => {
      const ticket = await unwrap(api.POST('/api/v1/console/corporate/purchases/{purchase_id}/attachments', { params: { path: { purchase_id: purchaseId } }, body: { filename: file.name, size_bytes: file.size } }))
      await put(ticket, file, onProgress)
      return unwrap(api.POST('/api/v1/console/corporate/attachments/{attachment_id}/confirm', { params: { path: { attachment_id: ticket.attachment_id } } }))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cn('files', purchaseId) }),
  })
}
export function useCnDeleteFile(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/console/corporate/attachments/{attachment_id}', { params: { path: { attachment_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: cn('files', purchaseId) }),
  })
}
export const cnDownload = (id: string) => unwrap(api.GET('/api/v1/console/corporate/attachments/{attachment_id}/download', { params: { path: { attachment_id: id } } })).then((r) => r.url)

// ---------------------------------------------------------------- files (company owner/admin)
export function useCompanyFiles(purchaseId: string) {
  return useQuery({
    queryKey: co('files', purchaseId),
    queryFn: () => unwrap(api.GET('/api/v1/corporate/purchases/{purchase_id}/attachments', { params: { path: { purchase_id: purchaseId } } })),
  })
}
export function useCompanyUpload(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, onProgress }: Upload) => {
      const ticket = await unwrap(api.POST('/api/v1/corporate/purchases/{purchase_id}/attachments', { params: { path: { purchase_id: purchaseId } }, body: { filename: file.name, size_bytes: file.size } }))
      await put(ticket, file, onProgress)
      return unwrap(api.POST('/api/v1/corporate/attachments/{attachment_id}/confirm', { params: { path: { attachment_id: ticket.attachment_id } } }))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: co('files', purchaseId) }),
  })
}
export function useCompanyDeleteFile(purchaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/corporate/attachments/{attachment_id}', { params: { path: { attachment_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: co('files', purchaseId) }),
  })
}
export const companyDownload = (id: string) => unwrap(api.GET('/api/v1/corporate/attachments/{attachment_id}/download', { params: { path: { attachment_id: id } } })).then((r) => r.url)

// ---------------------------------------------------------------- the employee
export function useMyProgrammes() {
  return useQuery({
    queryKey: ['corporate', 'me', 'programmes'],
    queryFn: () => unwrap(api.GET('/api/v1/corporate/my/programmes', { headers: { 'X-Org-Id': '' } })),
  })
}
