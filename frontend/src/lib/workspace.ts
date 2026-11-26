/** Which space the user is working in: their own learning (null) or a company (org id).
 * The API client sends it as X-Org-Id; the server checks membership every time. */
const KEY = 'orgId'
const STAFF_KEY = 'staffOrgWorkspace'

export type StaffPreviewRole = 'company_admin' | 'hr_admin' | 'executive' | 'department_head' | 'line_manager'
export type StaffOrgWorkspace = { org_id: string; name: string; slug: string; preview_role?: StaffPreviewRole }

export function currentOrgId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setCurrentOrgId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: falls back to personal space */
  }
}

/** A platform admin may inspect a company without becoming one of its employees.
 * This marker is deliberately separate from normal membership selection: the API
 * only grants the elevated company context when both values match. */
export function currentStaffOrgWorkspace(): StaffOrgWorkspace | null {
  try {
    const raw = localStorage.getItem(STAFF_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StaffOrgWorkspace>
    const previewRole = ['company_admin', 'hr_admin', 'executive', 'department_head', 'line_manager'].includes(value.preview_role ?? '')
      ? value.preview_role as StaffPreviewRole
      : undefined
    return value.org_id && value.name && typeof value.slug === 'string'
      ? { org_id: value.org_id, name: value.name, slug: value.slug, preview_role: previewRole }
      : null
  } catch {
    return null
  }
}

export function setStaffOrgWorkspace(value: StaffOrgWorkspace | null) {
  try {
    if (value) localStorage.setItem(STAFF_KEY, JSON.stringify(value))
    else localStorage.removeItem(STAFF_KEY)
  } catch {
    /* private mode: the admin chooses the company again next time */
  }
}

export function isStaffOrgAccess(): boolean {
  const selected = currentOrgId()
  return !!selected && currentStaffOrgWorkspace()?.org_id === selected
}
