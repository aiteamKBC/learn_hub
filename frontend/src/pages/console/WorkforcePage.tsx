import { ArrowRight, BookOpenCheck, Building2, Gauge, Layers, Search, Users } from 'lucide-react'
import { useState } from 'react'

import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { COMPANY_STATUSES, useCompanies, type ConsoleCompany } from '@/features/console/companies'
import { StatusPill } from '@/features/console/ui'
import { useWorkspace } from '@/features/identity/workspace'
import { useDebounced } from '@/features/org/ui'
import { useNavigate } from '@/lib/router'

const capabilities = [
  { label: 'Courses & content', to: '/studio/courses', Icon: BookOpenCheck },
  { label: 'People & HR', to: '/business/people', Icon: Users },
  { label: 'Frameworks', to: '/business/frameworks/competencies', Icon: Layers },
  { label: 'Performance', to: '/business/pms/kpis', Icon: Gauge },
  { label: 'Governance', to: '/business/governance/strategies', Icon: BookOpenCheck },
]

function CompanyWorkforceCard({ company }: { company: ConsoleCompany }) {
  const { switchToStaffOrg } = useWorkspace()
  const navigate = useNavigate()
  const open = () => {
    switchToStaffOrg({ org_id: company.id, name: company.name, slug: company.slug })
    navigate('/business')
  }

  return (
    <Card className="flex h-full flex-col">
      <CardBody className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text">
            <Building2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold">{company.name}</h2>
              <StatusPill status={company.status} label={COMPANY_STATUSES[company.status]} />
            </div>
            <p className="mt-0.5 text-xs text-muted">{company.members.toLocaleString('en-GB')} people · /{company.slug}</p>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-2" aria-label={`Manage ${company.name} workforce areas`}>
          {capabilities.map(({ label, to, Icon }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => {
                  switchToStaffOrg({ org_id: company.id, name: company.name, slug: company.slug })
                  navigate(to)
                }}
                className="flex w-full items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-left text-xs text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Icon className="size-3.5 shrink-0 text-primary" aria-hidden /> {label}
              </button>
            </li>
          ))}
        </ul>
        <Button className="mt-auto w-full" onClick={open}>
          Open workforce workspace <ArrowRight />
        </Button>
      </CardBody>
    </Card>
  )
}

/** Platform admins choose the customer here, then enter the same company workspace
 * its admins use. This keeps all workforce tools in one place without adding the
 * platform admin as an employee of the customer. */
export function WorkforcePage() {
  const [search, setSearch] = useState('')
  const query = useCompanies({ q: useDebounced(search).trim() })

  return (
    <>
      <PageHeader
        title="Workforce"
        description="Choose a company to manage its HR, competency frameworks, performance and governance."
      />
      <div className="grid gap-5">
        <Input
          icon={<Search />}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className="max-w-lg"
        />
        {query.error ? (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-56" />)}
          </div>
        ) : !query.data?.length ? (
          <EmptyState
            icon={<Building2 />}
            title={search.trim() ? 'No companies match' : 'No companies yet'}
            body={search.trim() ? 'Try another company name.' : 'Add a company first, then its workforce workspace will appear here.'}
          />
        ) : (
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {query.data.map((company) => <CompanyWorkforceCard key={company.id} company={company} />)}
          </div>
        )}
      </div>
    </>
  )
}
