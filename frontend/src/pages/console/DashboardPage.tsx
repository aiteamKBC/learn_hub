import { BarChart3, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/ui/misc'
import { useRangeParam } from '@/features/console/ui'
import { cn } from '@/lib/cn'

import { CommercialDashboard } from './CommercialDashboard'
import { PeoplePerformanceDashboard, PeoplePerformanceFilters } from './PeoplePerformanceDashboard'

/**
 * The Admin home has two focused workspaces. People & performance contains the
 * workforce view; Business & commercial mirrors the approved commercial-home
 * composition. Operational cards live on their dedicated console pages instead
 * of being repeated here.
 */
export function ConsoleDashboardPage() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'commercial' ? 'commercial' : 'people'
  const [department, setDepartment] = useState('all')
  const [quarter, setQuarter] = useState('Q4 2026')
  const [range, setRange] = useRangeParam()

  const setView = (nextView: 'people' | 'commercial') => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (nextView === 'people') next.delete('view')
      else next.set('view', nextView)
      return next
    }, { replace: true, preventScrollReset: true })
  }

  return (
    <>
      <PageHeader
        title={view === 'people' ? <><span className="mb-1 block font-mono text-[10px] font-semibold tracking-[.16em] text-primary uppercase">Good evening, Sam</span>Your people. Their potential.</> : 'Commercial home'}
        description={view === 'people' ? 'Cross-tenant workforce, learning and performance signals in one connected view.' : 'External course sales, platform revenue and the full customer funnel.'}
        actions={view === 'people'
          ? <PeoplePerformanceFilters department={department} quarter={quarter} onDepartmentChange={setDepartment} onQuarterChange={setQuarter} />
          : undefined}
      />

      <div className="mb-5 flex justify-end">
        <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-surface p-1 shadow-sm" role="tablist" aria-label="Admin dashboard view">
          <button type="button" role="tab" aria-selected={view === 'people'} onClick={() => setView('people')} className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-4', view === 'people' ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-text')}>
            <UsersRound /> People &amp; performance
          </button>
          <button type="button" role="tab" aria-selected={view === 'commercial'} onClick={() => setView('commercial')} className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-4', view === 'commercial' ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-text')}>
            <BarChart3 /> Business &amp; commercial
          </button>
        </div>
      </div>

      {view === 'people'
        ? <PeoplePerformanceDashboard department={department} quarter={quarter} />
        : <CommercialDashboard range={range} onRangeChange={setRange} />}
    </>
  )
}
