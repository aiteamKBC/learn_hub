import { ArrowLeft, Search } from 'lucide-react'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCompany, useRoleCapabilities } from '@/features/org/api'
import { useWorkspace } from '@/features/identity/workspace'
import { brandStyle, safeLogo } from '@/features/org/branding'
import { Link, useNavigate } from '@/lib/router'

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

/** Header: the company (logo + name, underlined in its accent colour) and people search. */
function BusinessHeader() {
  const { data: company } = useCompany()
  const { isPlatformAdminView } = useWorkspace()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <div className="flex min-w-0 items-center gap-3">
      {isPlatformAdminView ? (
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/console/workforce" aria-label="Back to admin workforce"><ArrowLeft /></Link>
        </Button>
      ) : null}
      {company ? (
        <span className="hidden min-w-0 items-center gap-2 border-b-2 pb-0.5 lg:inline-flex" style={{ borderColor: 'var(--brand-accent, transparent)' }}>
          <CompanyMark name={company.name} logoUrl={company.logo_url} className="size-7" />
          <span className="max-w-[9rem] truncate text-sm font-semibold">{company.name}</span>
        </span>
      ) : null}
      <form
        role="search"
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) navigate(`/business/people?q=${encodeURIComponent(q.trim())}`)
        }}
      >
        <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people" className="bg-surface-2/60" />
      </form>
    </div>
  )
}

/** The company workspace: the shared workspace layout, tinted with the company's
 * branding, plus the header search for people. */
export function BusinessLayout({ sections }: { sections: NavSection[] }) {
  const { data: company } = useCompany()
  const { org, isPlatformAdminView } = useWorkspace()
  const responsibilities = useRoleCapabilities()
  const admin = !!org && ['owner', 'admin'].includes(org.role)
  const roles = new Set(responsibilities.data?.responsibilities.map((item) => item.code) ?? [])
  const hr = roles.has('hr_admin')
  const executive = roles.has('executive')
  const scopedManager = roles.has('department_head') || roles.has('line_manager')
  const visibleSections = sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (admin) return true
      const to = item.to
      if (to.startsWith('/business/hcm/') || to.startsWith('/business/frameworks/')) return hr
      if (to === '/business/governance/questions') return hr
      if (to.startsWith('/business/governance/')) return hr || executive
      if (to.startsWith('/business/pms/')) return hr || executive
      if (to === '/business/billing' || to === '/business/settings' || to === '/business/invites') return false
      return hr || executive || scopedManager || !!org && org.role === 'manager'
    }),
  })).filter((section) => section.items.length)
  return <WorkspaceLayout area={isPlatformAdminView ? 'Admin · Workforce' : 'Business'} sections={visibleSections} art="contours" header={<BusinessHeader />} style={brandStyle(company?.primary_color, company?.accent_color)} />
}
