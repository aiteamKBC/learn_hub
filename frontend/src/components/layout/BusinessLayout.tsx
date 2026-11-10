import { Search } from 'lucide-react'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { useCompany } from '@/features/org/api'
import { brandStyle, safeLogo } from '@/features/org/branding'
import { useNavigate } from '@/lib/router'

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
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <div className="flex min-w-0 items-center gap-3">
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
  return <WorkspaceLayout area="Business" sections={sections} art="contours" header={<BusinessHeader />} style={brandStyle(company?.primary_color, company?.accent_color)} />
}
