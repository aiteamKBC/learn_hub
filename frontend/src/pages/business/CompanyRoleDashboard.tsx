import { BarChart3, UsersRound } from 'lucide-react'
import { useState } from 'react'

import { PageHeader } from '@/components/ui/misc'
import { useWorkspace } from '@/features/identity/workspace'
import { useRoleCapabilities } from '@/features/org/api'
import { type RangeQuery } from '@/features/console/ui'
import { CommercialDashboard } from '@/pages/console/CommercialDashboard'
import { PeoplePerformanceDashboard, PeoplePerformanceFilters } from '@/pages/console/PeoplePerformanceDashboard'
import { cn } from '@/lib/cn'

import { CompanyCommercialOverview, type CompanyViewRole, PeoplePerformanceOverview } from './RolePerformanceOverview'

const copy: Record<CompanyViewRole, { title: string; description: string }> = {
  company_admin: { title: 'Commercial home', description: 'External course sales, company learning activity and commercial performance.' },
  executive: { title: 'Business & commercial', description: 'External course sales, company revenue and the full customer funnel.' },
  hr_admin: { title: 'HR performance & people governance', description: 'People, frameworks and governance across every department.' },
  department_head: { title: 'Department performance', description: 'Your department, objectives, KPIs, capability and development actions.' },
  line_manager: { title: 'My team today', description: 'Direct reports, team KPIs, competence gaps and learning actions.' },
}

export function CompanyRoleDashboard() {
  const { org, staffPreviewRole, isPlatformAdminView } = useWorkspace()
  const capabilities = useRoleCapabilities()
  const [department, setDepartment] = useState('all')
  const [quarter, setQuarter] = useState('Q4 2026')
  const [range, setRange] = useState<RangeQuery>({ range: '30d' })
  const [executiveView, setExecutiveView] = useState<'people' | 'commercial'>('commercial')
  const roles = new Set(capabilities.data?.responsibilities.map((item) => item.code) ?? [])
  const capabilityRole: CompanyViewRole = roles.has('executive')
    ? 'executive'
    : roles.has('hr_admin')
      ? 'hr_admin'
      : roles.has('department_head')
        ? 'department_head'
        : roles.has('line_manager')
          ? 'line_manager'
          : 'company_admin'
  // A platform admin explicitly chose this preview role in the company drawer,
  // so it must win over any capabilities returned for the signed-in account.
  const role: CompanyViewRole = staffPreviewRole ?? capabilityRole
  const heading = role === 'executive' && executiveView === 'people'
    ? { title: 'Your people. Their potential.', description: 'Company-wide people, performance, capability and strategic decisions.' }
    : copy[role]
  const executiveCommercial = role === 'executive' && executiveView === 'commercial'

  return (
    <>
      <PageHeader
        title={executiveCommercial ? <><span className="mb-1 block font-mono text-[10px] font-semibold tracking-[.16em] text-primary uppercase">AD Learning Academy</span>Business &amp; commercial</> : heading.title}
        description={executiveCommercial ? 'External course sales · internal staff learning is excluded from revenue.' : org ? `${org.name} · ${heading.description}` : heading.description}
        actions={role === 'executive' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {executiveView === 'people' ? <PeoplePerformanceFilters department={department} quarter={quarter} onDepartmentChange={setDepartment} onQuarterChange={setQuarter} /> : null}
            <div className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-sm" role="tablist" aria-label="Executive dashboard view">
              <button type="button" role="tab" aria-selected={executiveView === 'people'} onClick={() => setExecutiveView('people')} className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-4', executiveView === 'people' ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-text')}>
                <UsersRound /> People &amp; performance
              </button>
              <button type="button" role="tab" aria-selected={executiveView === 'commercial'} onClick={() => setExecutiveView('commercial')} className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-4', executiveView === 'commercial' ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-text')}>
                <BarChart3 /> Business &amp; commercial
              </button>
            </div>
          </div>
        ) : undefined}
      />
      {role === 'company_admin' ? (
        isPlatformAdminView ? <CommercialDashboard range={range} onRangeChange={setRange} /> : <CompanyCommercialOverview />
      ) : role === 'executive' ? (
        executiveView === 'commercial'
          ? <CommercialDashboard range={range} onRangeChange={setRange} />
          : <PeoplePerformanceDashboard department={department} quarter={quarter} orgName={org?.name} />
      ) : (
        <PeoplePerformanceOverview role={role} />
      )}
    </>
  )
}
