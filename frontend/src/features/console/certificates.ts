import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { putToAzure } from '@/features/studio/api'

// Console > Certificates (mockup 30). Keys start with ['console', 'certificates', …].

export type IssuedFilters = { q?: string; status?: string; course?: string }

const fetchTemplates = () => unwrap(api.GET('/api/v1/console/certificates/templates'))
export type CertTemplate = Awaited<ReturnType<typeof fetchTemplates>>[number]
export type CertLayout = CertTemplate['layout']
const fetchIssued = (f: IssuedFilters, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/certificates/issued', { params: { query: { q: f.q || undefined, status: f.status || undefined, course: f.course || undefined, cursor, limit: 25 } } }))
export type IssuedCert = Awaited<ReturnType<typeof fetchIssued>>['items'][number]

export const DEFAULT_LAYOUT: CertLayout = {
  style: 'classic',
  primary: '#4F46E5',
  accent: '#F59E0B',
  heading: 'Certificate of Completion',
  intro: 'This is to certify that',
  completion: 'has successfully completed the course',
  show_platform: true,
  show_seal: true,
  show_cpd: true,
  show_instructor: true,
}

export function useCertOverview() {
  return useQuery({ queryKey: ['console', 'certificates', 'overview'], queryFn: () => unwrap(api.GET('/api/v1/console/certificates/overview')) })
}

export function useCertTemplates() {
  return useQuery({ queryKey: ['console', 'certificates', 'templates'], queryFn: fetchTemplates })
}

export function useIssuedCerts(f: IssuedFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'certificates', 'issued', f],
    queryFn: ({ pageParam }) => fetchIssued(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function issuedCsvPath(f: IssuedFilters) {
  const q = new URLSearchParams()
  if (f.q) q.set('q', f.q)
  if (f.status) q.set('status', f.status)
  if (f.course) q.set('course', f.course)
  return `/api/v1/console/certificates/issued.csv${q.size ? `?${q}` : ''}`
}

export const certificatePdfPath = (id: string) => `/api/v1/console/certificates/${id}/pdf`
export const templatePreviewPath = (id: string) => `/api/v1/console/certificates/templates/${id}/preview.pdf`

export function useVerifyCertificate() {
  return useMutation({ mutationFn: (code: string) => unwrap(api.GET('/api/v1/console/certificates/verify', { params: { query: { code } } })) })
}

function useCertsChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'certificates'] })
    void qc.invalidateQueries({ queryKey: ['console', 'approvals'] })
    void qc.invalidateQueries({ queryKey: ['console', 'nav-counts'] })
    void qc.invalidateQueries({ queryKey: ['console', 'courses'] })
  }
}

export type TemplateInput = { name: string; layout: CertLayout; signatory_name: string; signatory_title: string; signature_image_url: string; show_qr_code: boolean }

export function useSaveTemplate() {
  const done = useCertsChanged()
  return useMutation({
    mutationFn: ({ id, ...body }: TemplateInput & { id?: string }) =>
      id
        ? unwrap(api.PATCH('/api/v1/console/certificates/templates/{template_id}', { params: { path: { template_id: id } }, body: { ...body, layout: { ...body.layout, style: body.layout.style as 'classic' } } }))
        : unwrap(api.POST('/api/v1/console/certificates/templates', { body: { ...body, layout: { ...body.layout, style: body.layout.style as 'classic' } } })),
    onSuccess: done,
  })
}

export type TemplateAction = 'duplicate' | 'default' | 'archive'

export function useTemplateAction() {
  const done = useCertsChanged()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TemplateAction }): Promise<unknown> => {
      const p = { params: { path: { template_id: id } } }
      if (action === 'duplicate') return unwrap(api.POST('/api/v1/console/certificates/templates/{template_id}/duplicate', p))
      if (action === 'default') return unwrap(api.POST('/api/v1/console/certificates/templates/{template_id}/default', p))
      return unwrap(api.POST('/api/v1/console/certificates/templates/{template_id}/archive', p))
    },
    onSuccess: done,
  })
}

export function useRevokeCertificate() {
  const done = useCertsChanged()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/console/certificates/{certificate_id}/revoke', { params: { path: { certificate_id: id } }, body: { reason } })),
    onSuccess: done,
  })
}

export function useSetExpiry() {
  const done = useCertsChanged()
  return useMutation({
    mutationFn: ({ id, expires_at }: { id: string; expires_at: string | null }) =>
      unwrap(api.PUT('/api/v1/console/certificates/{certificate_id}/expiry', { params: { path: { certificate_id: id } }, body: { expires_at } })),
    onSuccess: done,
  })
}

/** Switch the design a course's certificates are drawn with (null = the platform default). */
export function useSetCourseTemplate() {
  const done = useCertsChanged()
  return useMutation({
    mutationFn: ({ courseId, templateId }: { courseId: string; templateId: string | null }) =>
      unwrap(api.PUT('/api/v1/console/courses/{course_id}/certificate-template', { params: { path: { course_id: courseId } }, body: { template_id: templateId } })),
    onSuccess: done,
  })
}

/** Signature image: 1) a write-only link, 2) PUT to storage, 3) the URL to save on the template. */
export async function uploadSignature(file: File) {
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/jpeg' ? 'image/jpeg' : null
  if (!type) throw new Error('Use a PNG or JPEG image.')
  if (file.size > 1_000_000) throw new Error('The image can be up to 1 MB.')
  const ticket = await unwrap(api.POST('/api/v1/console/certificates/signature-upload', { body: { filename: file.name, size_bytes: file.size, content_type: type } }))
  await putToAzure(ticket, file)
  return ticket.url
}
