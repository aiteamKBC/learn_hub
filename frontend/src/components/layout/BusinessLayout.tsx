import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/features/identity/workspace'
import { useCompany, useRoleCapabilities } from '@/features/org/api'
import { brandStyle, safeLogo } from '@/features/org/branding'
import { Link } from '@/lib/router'

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

/** Centred catalogue search, with a way back when staff preview a workforce. */
function BusinessHeader() {
  const { isPlatformAdminView } = useWorkspace()
  return (
    <div className="relative mx-auto w-full max-w-md">
      {isPlatformAdminView ? (
        <Button asChild variant="ghost" size="icon-sm" className="absolute top-1/2 right-full mr-2 -translate-y-1/2">
          <Link to="/console/workforce" aria-label="Back to admin workforce"><ArrowLeft /></Link>
        </Button>
      ) : null}
      <SearchBox className="w-full" />
    </div>
  )
}

/** Company workspace with role-scoped navigation and the centred catalogue search. */
export function BusinessLayout({ sections }: { sections: NavSection[] }) {
  const { data: company } = useCompany()
  const { org, isPlatformAdminView } = useWorkspace()
  const responsibilities = useRoleCapabilities()
  const admin = !!org && ['owner', 'admin'].includes(org.role)
  const roles = new Set(responsibilities.data?.responsibilities.map((item) => item.code) ?? [])
  const hr = roles.has('hr_admin')
  const executive = roles.has('executive')
  const scopedManager = roles.has('department_head') || roles.has('line_manager')
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
      area={isPlatformAdminView ? 'Admin · Workforce' : 'Business'}
      sections={visibleSections}
      art="contours"
      header={<BusinessHeader />}
      centerHeader
      style={brandStyle(company?.primary_color, company?.accent_color)}
    />
  )
}
