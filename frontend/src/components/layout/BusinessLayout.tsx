import { useState } from 'react'

import { useCompany } from '@/features/org/api'
import { brandStyle, safeLogo } from '@/features/org/branding'

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

/** The company workspace: the shared workspace layout, tinted with the company's
 * branding, plus the marketplace catalogue search. */
export function BusinessLayout({ sections }: { sections: NavSection[] }) {
  const { data: company } = useCompany()
  return <WorkspaceLayout area="Business" sections={sections} art="contours" header={<BusinessHeader />} centerHeader style={brandStyle(company?.primary_color, company?.accent_color)} />
}
