import createClient, { type Middleware } from 'openapi-fetch'

import { API_BASE_URL } from '@/lib/env'
import { currentOrgId, isStaffOrgAccess } from '@/lib/workspace'

import type { paths } from './schema'

export function csrfToken(): string {
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)
  return match ? decodeURIComponent(match[1]!) : ''
}

/** The backend's one error shape: {"error": {"code", "message", "details"}}. */
export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const auth: Middleware = {
  onRequest({ request }) {
    if (request.method !== 'GET') request.headers.set('X-CSRFToken', csrfToken())
    // a request may pin its own space (e.g. personal billing passes X-Org-Id: "")
    const orgId = currentOrgId()
    if (orgId && !request.headers.has('X-Org-Id')) request.headers.set('X-Org-Id', orgId)
    if (orgId && isStaffOrgAccess()) request.headers.set('X-Platform-Org-Access', 'on')
    return request
  },
}

/** Typed API client: paths and payloads come from Django Ninja's OpenAPI schema. */
export const api = createClient<paths>({ baseUrl: API_BASE_URL, credentials: 'include' })
api.use(auth)

/** Unwrap an openapi-fetch result: data, or a thrown ApiError React Query can show. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p
  if (response.ok) return data as T
  const e = (error as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error
  throw new ApiError(response.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${response.status}).`, e?.details)
}
