import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'

import { useWorkspace } from '@/features/identity/workspace'
import { useCompany, useRoleCapabilities } from '@/features/org/api'
import { brandStyle, safeLogo } from '@/features/org/branding'
import { useNavigate } from '@/lib/router'

import { SearchBox } from './SearchBox'
import { type NavSection, WorkspaceLayout } from './WorkspaceLayout'

/** The company's logo (https only) or its initial, framed in the brand accent colour. */
export function CompanyMark({ name, logoUrl, className = 'size-8' }: { name: string; logoUrl?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  const logo = safeLogo(logoUrl)
  if (logo && !broken) {
    return <img src={logo} alt={`${name} logo`} onError={() => setBroken(true)} className={`${className} shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-border`} />
  }
  return (
    <span
      aria-hidden
      className={`${className} flex shrink-0 items-center justify-center rounded-md text-sm font-semibold`}
      style={{ background: 'var(--brand-accent, var(--primary))', color: 'var(--brand-accent-text, var(--on-primary))' }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Centred catalogue search for the company workspace. */
function BusinessHeader() {
  return <SearchBox className="mx-auto w-full max-w-md" />
}

/** Company workspace with role-scoped navigation and the centred catalogue search. */
export function BusinessLayout({ sections }: { sections: NavSection[] }) {
  const navigate = useNavigate()
  const { data: company } = useCompany()
  const { org, isPlatformAdminView, staffPreviewRole, switchTo } = useWorkspace()
  const responsibilities = useRoleCapabilities()
  const admin = !!org && ['owner', 'admin'].includes(org.role)
  const roles = new Set(responsibilities.data?.responsibilities.map((item) => item.code) ?? [])
  const hr = roles.has('hr_admin') || staffPreviewRole === 'hr_admin'
  const executive = roles.has('executive') || staffPreviewRole === 'executive'
  const scopedManager = roles.has('department_head') || roles.has('line_manager') || staffPreviewRole === 'department_head' || staffPreviewRole === 'line_manager'
  const previewRoleLabel = staffPreviewRole === 'hr_admin'
    ? 'HR'
    : staffPreviewRole === 'executive'
      ? 'Executive'
      : staffPreviewRole === 'department_head'
        ? 'Department head'
        : staffPreviewRole === 'line_manager'
          ? 'Line manager'
          : 'Company admin'
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (admin) return true
        const to = item.to
        if (to.startsWith('/business/hcm/') || to.startsWith('/business/frameworks/')) return hr
        if (to === '/business/governance/questions') return hr
        if (to.startsWith('/business/governance/')) return hr || executive
        if (to.startsWith('/business/pms/')) return hr || executive
        if (to === '/business/billing' || to === '/business/settings' || to === '/business/invites') return false
        return hr || executive || scopedManager || (!!org && org.role === 'manager')
      }),
    }))
    .filter((section) => section.items.length)

  return (
    <WorkspaceLayout
      area={isPlatformAdminView ? `Admin · ${previewRoleLabel}` : 'Business'}
      sections={visibleSections}
      art="contours"
      header={<BusinessHeader />}
      sidebarTop={isPlatformAdminView && org ? (
        <button
          type="button"
          onClick={() => {
            // Return to this company's role chooser before clearing the preview;
            // changing workspace while still under /business triggers its route guard.
            navigate(`/console/companies?company=${encodeURIComponent(org.org_id)}`, { replace: true, flushSync: true })
            switchTo(null)
          }}
          aria-label="Back to company roles"
          title="Back to company roles"
          className="group inline-flex h-9 items-center gap-2 px-1 text-[13px] font-semibold text-nav-text transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-5 transition-transform group-hover:-translate-x-0.5" strokeWidth={2.2} />
          <span className="border-b border-nav-text/55 pb-0.5 transition-colors group-hover:border-primary">Admin · {previewRoleLabel}</span>
        </button>
      ) : undefined}
      centerHeader
      style={brandStyle(company?.primary_color, company?.accent_color)}
    />
  )
}
