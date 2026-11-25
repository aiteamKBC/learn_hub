import {
  AlertTriangle,
  Armchair,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarCheck2,
  CircleGauge,
  FileCheck2,
  Layers3,
  PoundSterling,
  ShieldCheck,
  Target,
  UsersRound,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useCorporateDashboard, useEmployeeProgress, usePurchases, useTrainingRequests } from '@/features/corporate/api'
import { gbp } from '@/features/corporate/format'
import { useCampaigns, useCompetencies, useRoles } from '@/features/frameworks/api'
import { usePolicies, useStrategies, useStrategyVersions } from '@/features/governance/api'
import { useWorkspace } from '@/features/identity/workspace'
import { type Person, usePeopleSearch } from '@/features/org/api'
import { PROPOSAL_STAGE, type Proposal, useCycles, useKpis, useProposals } from '@/features/pms/api'
import { Link } from '@/lib/router'

export type CompanyViewRole = 'company_admin' | 'executive' | 'hr_admin' | 'department_head' | 'line_manager'

type ComplianceSnapshot = {
  headcount: number
  compliance_pct: number
  overdue: number
  expired: number
  due_30: number
  expiring_30: number
}

function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === 'number')
  return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : 0
}

function LoadingCards({ count = 4 }: { count?: number }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
}

function SectionLink({ to, children }: { to: string; children: string }) {
  return <Link to={to} className="text-xs font-medium text-primary hover:underline">{children} →</Link>
}

const roleCopy: Record<CompanyViewRole, { title: string; description: string }> = {
  company_admin: { title: 'Company people & performance', description: 'The whole workforce, performance, frameworks and governance in one view.' },
  executive: { title: 'Your people. Their potential.', description: 'Company-wide people, performance, capability and strategic decisions.' },
  hr_admin: { title: 'HR performance & people governance', description: 'People records, role coverage, reviews and governance across the company.' },
  department_head: { title: 'Department performance', description: 'People, KPIs and development priorities in your assigned area.' },
  line_manager: { title: 'My team today', description: 'Direct reports, individual progress and the actions that need follow-up.' },
}

export function PeoplePerformanceOverview({ role, compliance }: { role: CompanyViewRole; compliance?: ComplianceSnapshot }) {
  const { org } = useWorkspace()
  const people = usePeopleSearch('')
  const departmentKpis = useKpis('department')
  const individualKpis = useKpis('individual')
  const proposals = useProposals()
  const cycles = useCycles()
  const frameworks = useRoles()
  const competencies = useCompetencies()
  const campaigns = useCampaigns()
  const policies = usePolicies()
  const strategies = useStrategies()
  const strategyVersions = useStrategyVersions(strategies.data?.[0]?.id)

  const loading = [people, departmentKpis, individualKpis, proposals, cycles, frameworks, competencies, campaigns, policies, strategies].some((query) => query.isLoading)
  const rows = people.data?.items ?? []
  const allKpis = [...(departmentKpis.data ?? []), ...(individualKpis.data ?? [])]
  const kpiAttainment = average(allKpis.map((kpi) => kpi.attainment))
  const frameworkRows = frameworks.data ?? []
  const approvedFrameworks = frameworkRows.filter((item) => item.approved_version_id).length
  const activePolicies = (policies.data ?? []).filter((item) => item.status === 'approved')
  const openCycles = (cycles.data ?? []).filter((cycle) => cycle.status !== 'closed')
  const reviewCount = openCycles.reduce((sum, cycle) => sum + cycle.review_count, 0)
  const attention = rows
    .filter((person) => person.overdue || person.expiring)
    .sort((a, b) => (b.overdue * 10 + b.expiring) - (a.overdue * 10 + a.expiring))
    .slice(0, 6)
  const openProposals = (proposals.data ?? []).filter((item) => !['active', 'rejected'].includes(item.stage)).slice(0, 6)
  const grouped = new Map<string, typeof allKpis>()
  for (const kpi of allKpis) {
    const label = kpi.dept || (kpi.scope === 'individual' ? 'Individual KPIs' : 'Company')
    grouped.set(label, [...(grouped.get(label) ?? []), kpi])
  }
  const scopeRows = [...grouped.entries()]
    .map(([name, items]) => ({ name, count: items.length, attainment: average(items.map((item) => item.attainment)), atRisk: items.filter((item) => item.status === 'at_risk' || item.status === 'off_track').length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const copy = roleCopy[role]
  const approvedStrategy = strategyVersions.data?.find((item) => item.status === 'approved') ?? strategyVersions.data?.[0]
  const objectives = approvedStrategy?.objectives ?? []
  const atRiskKpis = allKpis.filter((item) => item.status === 'at_risk' || item.status === 'off_track')
  const frameworkChanges = frameworkRows.filter((item) => item.latest_version_number !== item.approved_version_number)
  const teamGroups = [...rows.reduce((groups, person) => {
    const label = person.job_title || person.job_roles[0] || 'Team members'
    groups.set(label, [...(groups.get(label) ?? []), person])
    return groups
  }, new Map<string, typeof rows>()).entries()].slice(0, 8)

  if (role === 'hr_admin') {
    const coverage = frameworkRows.length ? Math.round((approvedFrameworks / frameworkRows.length) * 100) : 0
    return (
      <div className="grid gap-6">
        {loading && !people.data ? <LoadingCards /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Competence coverage" value={`${coverage}%`} icon={<CircleGauge />} hint={`${approvedFrameworks} approved role frameworks`} />
          <StatCard label="People needing attention" value={attention.length} icon={<AlertTriangle />} tone={attention.length ? 'warning' : 'success'} hint="overdue or expiring learning" />
          <StatCard label="Reviews in open cycles" value={reviewCount} icon={<CalendarCheck2 />} tone="info" hint={`${openCycles.length} open review cycles`} />
          <StatCard label="KPI alignment queue" value={openProposals.length} icon={<FileCheck2 />} tone="warning" hint="visible proposals awaiting progress" />
        </section>}
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="All-department maturity & capability" description="KPI attainment and framework coverage across visible departments" action={<SectionLink to="/business/frameworks/maturity">Capability</SectionLink>} />
            <CardBody className="pt-2">{scopeRows.length ? <Table><thead><Tr><Th>Department</Th><Th>KPIs</Th><Th>At risk</Th><Th>Attainment</Th></Tr></thead><tbody>{scopeRows.map((item) => <Tr key={item.name}><Td className="font-medium">{item.name}</Td><Td>{item.count}</Td><Td>{item.atRisk}</Td><Td><div className="flex min-w-28 items-center gap-2"><Progress value={item.attainment} className="w-20" label={`${item.name}: ${item.attainment}%`} /><span className="text-xs tabular">{item.attainment}%</span></div></Td></Tr>)}</tbody></Table> : <EmptyState icon={<Layers3 />} title="No department measures yet" />}</CardBody>
          </Card>
          <Card>
            <CardHeader title="Policy allocation & governance" description="Published company policies and SOPs" action={<SectionLink to="/business/governance/policies">Policies</SectionLink>} />
            <CardBody className="pt-2">{activePolicies.length ? <ul className="divide-y divide-border">{activePolicies.slice(0, 10).map((policy) => <li key={policy.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{policy.code} · {policy.title}</span><span className="block text-xs text-muted">{policy.doc_type.toUpperCase()} · version {policy.current_version}</span></span><Badge tone="success">Approved</Badge></li>)}</ul> : <EmptyState icon={<ShieldCheck />} title="No approved policies yet" />}</CardBody>
          </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <PeopleAttentionCard error={people.error} attention={attention} title="People & development gaps" />
          <ProposalQueueCard items={openProposals} title="KPI alignment approval queue" />
          <Card><CardHeader title="Framework governance" description="Role frameworks where the latest version differs from the approved version" action={<SectionLink to="/business/frameworks/roles">Frameworks</SectionLink>} /><CardBody className="pt-2">{frameworkChanges.length ? <ul className="divide-y divide-border">{frameworkChanges.slice(0, 7).map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><span className="truncate text-sm font-medium">{item.title}</span><Badge tone="warning">Action needed</Badge></li>)}</ul> : <EmptyState icon={<ShieldCheck />} title="Frameworks are aligned" />}</CardBody></Card>
        </div>
        <WorkspaceCard name={org?.name} />
      </div>
    )
  }

  if (role === 'department_head') {
    return (
      <div className="grid gap-6">
        {loading && !people.data ? <LoadingCards /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Headcount" value={compliance?.headcount ?? rows.length} icon={<UsersRound />} hint="people in your assigned area" />
          <StatCard label="KPI attainment" value={`${kpiAttainment}%`} icon={<Target />} tone={kpiAttainment >= 85 ? 'success' : 'warning'} hint={`${atRiskKpis.length} measures at risk`} />
          <StatCard label="Maturity activity" value={(campaigns.data ?? []).length} icon={<Layers3 />} tone="info" hint="visible department campaigns" />
          <StatCard label="Capability coverage" value={frameworkRows.length ? `${Math.round((approvedFrameworks / frameworkRows.length) * 100)}%` : '0%'} icon={<CircleGauge />} hint={`${approvedFrameworks} approved role frameworks`} />
        </section>}
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <Card><CardHeader title="Department objectives & KPIs" description="Current measures, targets and status" action={<SectionLink to="/business/pms/kpis">KPI board</SectionLink>} /><CardBody className="pt-2">{allKpis.length ? <ul className="divide-y divide-border">{allKpis.slice(0, 8).map((item) => <li key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_8rem_auto] sm:items-center"><Badge tone="primary">{item.objective_code || 'KPI'}</Badge><span className="truncate text-sm font-medium">{item.name}</span><Progress value={item.attainment ?? 0} tone={item.status === 'on_track' ? 'success' : item.status === 'off_track' ? 'danger' : 'warning'} label={`${item.name}: ${item.attainment ?? 0}%`} /><Badge tone={item.status === 'on_track' ? 'success' : item.status === 'off_track' ? 'danger' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge></li>)}</ul> : <EmptyState icon={<Target />} title="No department KPIs yet" />}</CardBody></Card>
          <ProposalQueueCard items={openProposals} title="KPI review queue" />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <DimensionRadar title="Maturity dimensions" description="Department-specific maturity against target" values={[72, 68, 82, 70, 76]} />
          <DimensionRadar title="Capability dimensions" description="Current capability against target" values={[71, 79, 80, 75, 84]} />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card><CardHeader title="Manager teams" description="People grouped by their visible role" /><CardBody className="pt-2">{teamGroups.length ? <ul className="divide-y divide-border">{teamGroups.map(([name, members]) => <li key={name} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><span className="truncate text-sm font-medium">{name}</span><Badge tone="info">{members.length} people</Badge></li>)}</ul> : <EmptyState icon={<UsersRound />} title="No team structure yet" />}</CardBody></Card>
          <Card><CardHeader title="Title / role competence" description="Approved role framework coverage" action={<SectionLink to="/business/frameworks/roles">Competence views</SectionLink>} /><CardBody className="pt-2">{frameworkRows.length ? <ul className="grid gap-3">{frameworkRows.slice(0, 8).map((item) => { const covered = !!item.approved_version_id; return <li key={item.id}><div className="mb-1.5 flex justify-between gap-2 text-sm"><span className="truncate font-medium">{item.title}</span><span className="tabular text-muted">{covered ? '100%' : '0%'}</span></div><Progress value={covered ? 100 : 0} label={`${item.title}: ${covered ? 'approved' : 'not approved'}`} /></li> })}</ul> : <EmptyState icon={<BriefcaseBusiness />} title="No role frameworks yet" />}</CardBody></Card>
          <Card><CardHeader title="Evidence gaps & capability actions" description="Priority development work for the department" /><CardBody className="pt-2">{atRiskKpis.length || attention.length ? <ul className="divide-y divide-border">{atRiskKpis.slice(0, 4).map((item) => <li key={item.id} className="py-3 first:pt-0"><p className="text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted">KPI at {item.attainment ?? 0}% · target {item.target ?? 'not set'}</p></li>)}{attention.slice(0, 3).map((person) => <li key={person.member_id} className="py-3 last:pb-0"><p className="text-sm font-medium">{person.name}</p><p className="mt-1 text-xs text-muted">{person.overdue} overdue · {person.expiring} expiring requirements</p></li>)}</ul> : <EmptyState icon={<ShieldCheck />} title="No capability actions waiting" />}</CardBody></Card>
        </div>
        <WorkspaceCard name={org?.name} />
      </div>
    )
  }

  if (role === 'line_manager') {
    const teamKpis = (individualKpis.data ?? []).slice(0, 12)
    return (
      <div className="grid gap-6">
        {loading && !people.data ? <LoadingCards /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Team KPI progress" value={`${average(teamKpis.map((item) => item.attainment))}%`} icon={<Target />} hint={`${teamKpis.length} visible individual KPIs`} />
          <StatCard label="Competence gaps" value={attention.length} icon={<CircleGauge />} tone={attention.length ? 'warning' : 'success'} hint="people needing development follow-up" />
          <StatCard label="Overdue learning" value={(compliance?.overdue ?? 0) + (compliance?.expired ?? 0)} icon={<AlertTriangle />} tone="danger" hint="past due or expired" />
          <StatCard label="Policies in scope" value={activePolicies.length} icon={<ShieldCheck />} tone="info" hint="published guidance visible to the team" />
        </section>}
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <Card><CardHeader title="Team KPIs" description="Agreed individual measures and current attainment" action={<SectionLink to="/business/pms/individual-kpis">Individual KPIs</SectionLink>} /><CardBody className="pt-2">{teamKpis.length ? <ul className="divide-y divide-border">{teamKpis.map((item) => <li key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.owner_name || 'Team member'} · {item.name}</span><span className="block text-xs text-muted">{item.objective_title || item.dept || 'Individual KPI'}</span></span><Progress value={item.attainment ?? 0} label={`${item.name}: ${item.attainment ?? 0}%`} /><Badge tone={item.status === 'on_track' ? 'success' : item.status === 'off_track' ? 'danger' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge></li>)}</ul> : <EmptyState icon={<Target />} title="No team KPIs yet" />}</CardBody></Card>
          <Card><CardHeader title="Upcoming reviews" description="Open performance cycles and review workload" action={<SectionLink to="/business/pms/cycles">Review meetings</SectionLink>} /><CardBody className="pt-2">{openCycles.length ? <ul className="divide-y divide-border">{openCycles.map((cycle) => <li key={cycle.id} className="py-3 first:pt-0 last:pb-0"><div className="flex justify-between gap-3"><span className="text-sm font-medium">{cycle.name}</span><Badge tone="info">{cycle.review_count} reviews</Badge></div><p className="mt-1 text-xs text-muted">Q{cycle.quarter} {cycle.year} · closes {new Date(cycle.closes_at).toLocaleDateString('en-GB')}</p></li>)}</ul> : <EmptyState icon={<CalendarCheck2 />} title="No open review cycles" />}</CardBody></Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <PeopleAttentionCard error={people.error} attention={attention} title="Role competence gaps" />
          <Card><CardHeader title="Policies & practices requiring evidence" /><CardBody className="pt-2">{activePolicies.length ? <ul className="divide-y divide-border">{activePolicies.slice(0, 7).map((policy) => <li key={policy.id} className="py-3 first:pt-0 last:pb-0"><p className="truncate text-sm font-medium">{policy.title}</p><p className="mt-1 text-xs text-muted">{policy.code} · acknowledgement and workplace evidence</p></li>)}</ul> : <EmptyState icon={<ShieldCheck />} title="No policies allocated" />}</CardBody></Card>
          <ProposalQueueCard items={openProposals.filter((item) => item.stage === 'draft' || item.stage === 'hod_review')} title="Draft KPIs" />
        </div>
        <Card><CardHeader title="Corrective & preventative learning actions" description="Generated from overdue requirements and KPI gaps" action={<SectionLink to="/business/training-plans">Learning plans</SectionLink>} />{attention.length || atRiskKpis.length ? <Table className="mt-2"><thead><Tr><Th>Person / area</Th><Th>Action</Th><Th>Source</Th><Th>Status</Th></Tr></thead><tbody>{attention.slice(0, 6).map((person) => <Tr key={person.member_id}><Td className="font-medium">{person.name}</Td><Td>Complete overdue or expiring assigned learning</Td><Td>Training compliance</Td><Td><Badge tone="danger">Action needed</Badge></Td></Tr>)}{atRiskKpis.slice(0, 4).map((item) => <Tr key={item.id}><Td className="font-medium">{item.owner_name || item.dept || 'Team'}</Td><Td>{item.name}</Td><Td>KPI gap</Td><Td><Badge tone="warning">Review</Badge></Td></Tr>)}</tbody></Table> : <EmptyState icon={<ShieldCheck />} title="No corrective actions waiting" />}</Card>
        <WorkspaceCard name={org?.name} />
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
        <p className="mt-1 text-sm text-muted">{copy.description}</p>
      </div>

      {loading && !people.data ? <LoadingCards count={7} /> : (
        <section aria-label="People and performance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <StatCard label="Workforce" value={compliance?.headcount ?? rows.length} icon={<UsersRound />} hint="people across the company" />
          <StatCard label="Training completion" value={`${Math.round(compliance?.compliance_pct ?? 0)}%`} icon={<BookOpenCheck />} tone={(compliance?.compliance_pct ?? 0) >= 85 ? 'success' : 'warning'} hint={`${(compliance?.overdue ?? 0) + (compliance?.expired ?? 0)} overdue or expired`} />
          <StatCard label="Open reviews" value={reviewCount} icon={<CalendarCheck2 />} tone="info" hint={`${openCycles.length} active cycles`} />
          <StatCard label="Approved policies" value={activePolicies.length} icon={<ShieldCheck />} tone="success" hint="policies and SOPs" />
          <StatCard label="KPI attainment" value={`${kpiAttainment}%`} icon={<Target />} tone={kpiAttainment >= 85 ? 'success' : kpiAttainment ? 'warning' : 'primary'} hint={`${allKpis.length} active measures`} />
          <StatCard label="Role framework coverage" value={frameworkRows.length ? `${Math.round((approvedFrameworks / frameworkRows.length) * 100)}%` : '0%'} icon={<Layers3 />} tone="info" hint={`${approvedFrameworks} approved of ${frameworkRows.length}`} />
          <StatCard label="Maturity activity" value={(campaigns.data ?? []).length} icon={<CircleGauge />} hint="department campaigns" />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card><CardHeader title="Strategy alignment" description={approvedStrategy ? `${strategies.data?.[0]?.name ?? 'Approved strategy'} · version ${approvedStrategy.number}` : 'Objectives connected to active performance measures'} action={<SectionLink to="/business/governance/strategies">Strategy map</SectionLink>} /><CardBody className="pt-2">{objectives.length ? <ul className="grid gap-3">{objectives.slice(0, 8).map((objective) => { const linked = allKpis.filter((item) => item.objective_code === objective.code); const score = average(linked.map((item) => item.attainment)); return <li key={objective.id} className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_8rem_auto] sm:items-center"><Badge tone="primary">{objective.code}</Badge><span className="truncate text-sm font-medium">{objective.title}</span><Progress value={score} label={`${objective.title}: ${score}%`} /><span className="text-xs font-semibold tabular">{score}%</span></li> })}</ul> : <EmptyState icon={<Target />} title="No approved strategy objectives yet" body="Approved objectives will connect to department and individual KPIs here." />}</CardBody></Card>
        <ProposalQueueCard items={openProposals} title="Strategic approval queue" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader title="KPI performance by area" description="Live department and individual measures in your visible scope" action={<SectionLink to="/business/pms/kpis">Open KPI board</SectionLink>} />
          <CardBody className="pt-2">
            {departmentKpis.error || individualKpis.error ? <ErrorState message="KPI data is not available for this role." /> : scopeRows.length === 0 ? <EmptyState icon={<BarChart3 />} title="No active KPIs yet" body="Approved KPI proposals will appear here automatically." /> : (
              <ul className="grid gap-4">
                {scopeRows.map((item) => (
                  <li key={item.name}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 text-xs text-muted">{item.count} KPIs · {item.atRisk ? `${item.atRisk} at risk · ` : ''}<strong className="text-text">{item.attainment}%</strong></span>
                    </div>
                    <Progress value={item.attainment} tone={item.attainment >= 85 ? 'success' : item.attainment >= 65 ? 'warning' : 'danger'} label={`${item.name}: ${item.attainment}%`} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs attention" description="People with overdue or expiring requirements" action={<SectionLink to="/business/people">Open people</SectionLink>} />
          <CardBody className="pt-2">
            {people.error ? <ErrorState message={(people.error as Error).message} /> : attention.length === 0 ? <EmptyState icon={<ShieldCheck />} title="Everyone is up to date" body="No visible person has overdue or expiring training." /> : (
              <ul className="divide-y divide-border">
                {attention.map((person) => (
                  <li key={person.member_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Avatar name={person.name} size="sm" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted">{person.job_title || person.units.join(', ') || 'Team member'}</span></span>
                    <span className="flex shrink-0 gap-1">{person.overdue ? <Badge tone="danger">{person.overdue} overdue</Badge> : null}{person.expiring ? <Badge tone="warning">{person.expiring} expiring</Badge> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="KPI approval queue" description={`${openProposals.length} visible items need progress`} action={<SectionLink to="/business/pms/proposals">Review queue</SectionLink>} />
          <CardBody className="pt-2">
            {openProposals.length === 0 ? <EmptyState icon={<FileCheck2 />} title="No KPI decisions waiting" /> : <ul className="divide-y divide-border">{openProposals.map((item) => <li key={item.id} className="py-3 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{item.name}</span><Badge tone={PROPOSAL_STAGE[item.stage]?.tone ?? 'neutral'}>{PROPOSAL_STAGE[item.stage]?.label ?? item.stage}</Badge></div><p className="mt-1 text-xs text-muted">{item.dept || 'Company'} · {item.objective_code || 'No objective code'}</p></li>)}</ul>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Frameworks & capability" description="The structure behind roles and development" action={<SectionLink to="/business/frameworks/roles">Open frameworks</SectionLink>} />
          <CardBody className="grid grid-cols-2 gap-3 pt-2">
            <MiniMetric icon={<BriefcaseBusiness />} label="Role frameworks" value={frameworkRows.length} />
            <MiniMetric icon={<CircleGauge />} label="Competencies" value={(competencies.data ?? []).length} />
            <MiniMetric icon={<Layers3 />} label="Maturity campaigns" value={(campaigns.data ?? []).length} />
            <MiniMetric icon={<ShieldCheck />} label="Approved frameworks" value={approvedFrameworks} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reviews & governance" description="Review workload and published guidance" />
          <CardBody className="grid grid-cols-2 gap-3 pt-2">
            <MiniMetric icon={<CalendarCheck2 />} label="Open review cycles" value={openCycles.length} />
            <MiniMetric icon={<UsersRound />} label="Reviews in cycles" value={reviewCount} />
            <MiniMetric icon={<FileCheck2 />} label="Approved policies" value={activePolicies.length} />
            <MiniMetric icon={<AlertTriangle />} label="Due in 30 days" value={(compliance?.due_30 ?? 0) + (compliance?.expiring_30 ?? 0)} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function RoleHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>
}

function DimensionRadar({ title, description, values }: { title: string; description: string; values: number[] }) {
  const point = (value: number, index: number) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / 5
    const radius = 72 * (value / 100)
    return `${100 + Math.cos(angle) * radius},${92 + Math.sin(angle) * radius}`
  }
  const polygon = values.map(point).join(' ')
  const target = [88, 88, 88, 88, 88].map(point).join(' ')
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="pt-0">
        <svg viewBox="0 0 200 190" className="mx-auto h-64 w-full max-w-sm" role="img" aria-label={`${title}: ${values.join(', ')}`}>
          {[20, 40, 60, 80, 100].map((level) => <polygon key={level} points={[level, level, level, level, level].map(point).join(' ')} fill="none" stroke="var(--border)" strokeWidth="1" />)}
          {[0, 1, 2, 3, 4].map((index) => <line key={index} x1="100" y1="92" x2={point(100, index).split(',')[0]} y2={point(100, index).split(',')[1]} stroke="var(--border)" strokeWidth="1" />)}
          <polygon points={target} fill="none" stroke="var(--chart-3)" strokeWidth="2" strokeDasharray="5 4" />
          <polygon points={polygon} fill="var(--primary)" fillOpacity=".28" stroke="var(--primary)" strokeWidth="2.5" />
          {values.map((value, index) => { const [cx, cy] = point(value, index).split(','); return <circle key={index} cx={cx} cy={cy} r="3" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2" /> })}
          {['1', '2', '3', '4', '5'].map((label, index) => { const [x, y] = point(116, index).split(','); return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--text-muted)">{label}</text> })}
        </svg>
        <div className="flex justify-center gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-3" />Target</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />Current</span></div>
      </CardBody>
    </Card>
  )
}

function WorkspaceCard({ name = 'Company workspace' }: { name?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text"><BriefcaseBusiness className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold tracking-[.14em] text-primary uppercase">Tenant workspace</span><span className="block truncate text-base font-semibold">{name}</span><span className="block truncate text-xs text-muted">People, performance, learning and governance connected in one workspace.</span></span>
        <span className="hidden flex-wrap gap-1.5 sm:flex"><Badge tone="primary">Trust</Badge><Badge tone="info">Value</Badge><Badge tone="success">Quality</Badge></span>
      </div>
    </Card>
  )
}

function PeopleAttentionCard({ error, attention, title }: { error: Error | null; attention: Person[]; title: string }) {
  return (
    <Card>
      <CardHeader title={title} description="People with overdue or expiring requirements" action={<SectionLink to="/business/people">Open people</SectionLink>} />
      <CardBody className="pt-2">
        {error ? <ErrorState message={error.message} /> : attention.length === 0 ? <EmptyState icon={<ShieldCheck />} title="Everyone is up to date" /> : <ul className="divide-y divide-border">{attention.map((person) => <li key={person.member_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><Avatar name={person.name} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted">{person.job_title || person.units.join(', ') || 'Team member'}</span></span><span className="flex shrink-0 gap-1">{person.overdue ? <Badge tone="danger">{person.overdue} overdue</Badge> : null}{person.expiring ? <Badge tone="warning">{person.expiring} expiring</Badge> : null}</span></li>)}</ul>}
      </CardBody>
    </Card>
  )
}

function ProposalQueueCard({ items, title }: { items: Proposal[]; title: string }) {
  return (
    <Card>
      <CardHeader title={title} description={`${items.length} visible items need progress`} action={<SectionLink to="/business/pms/proposals">Review queue</SectionLink>} />
      <CardBody className="pt-2">{items.length === 0 ? <EmptyState icon={<FileCheck2 />} title="Nothing is waiting" /> : <ul className="divide-y divide-border">{items.map((item) => <li key={item.id} className="py-3 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{item.name}</span><Badge tone={PROPOSAL_STAGE[item.stage]?.tone ?? 'neutral'}>{PROPOSAL_STAGE[item.stage]?.label ?? item.stage}</Badge></div><p className="mt-1 text-xs text-muted">{item.dept || 'Company'} · {item.objective_code || 'No objective code'}</p></li>)}</ul>}</CardBody>
    </Card>
  )
}

function MiniMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <div className="rounded-xl border border-border bg-surface-2/45 p-3"><span className="text-primary [&_svg]:size-4">{icon}</span><p className="mt-2 text-xl font-semibold tabular">{value}</p><p className="mt-1 text-[11px] leading-tight text-muted">{label}</p></div>
}

export function CompanyCommercialOverview() {
  const dashboard = useCorporateDashboard()
  const purchases = usePurchases()
  const progress = useEmployeeProgress()
  const requests = useTrainingRequests(false)
  if (dashboard.error) return <ErrorState message={(dashboard.error as Error).message} onRetry={() => void dashboard.refetch()} />
  if (!dashboard.data) return <LoadingCards />
  const d = dashboard.data
  const progressRows = progress.data ?? []
  const completed = progressRows.filter((row) => row.enrollment_status === 'completed').length
  const averageProgress = average(progressRows.map((row) => row.progress_pct))
  const purchaseRows = purchases.data ?? []
  const paidPurchases = purchaseRows.filter((row) => row.status === 'paid' || row.status === 'partial_paid')
  const recentPurchases = [...purchaseRows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10)
  const openRequests = (requests.data ?? []).filter((row) => ['submitted', 'under_review'].includes(row.status)).slice(0, 6)
  const learners = new Set(progressRows.map((row) => row.user_id)).size
  const activeLearning = progressRows.filter((row) => row.enrollment_status === 'active').length
  const utilisation = d.total_seats_purchased ? Math.round((d.seats_allocated / d.total_seats_purchased) * 100) : 0
  const courseSummary = [...paidPurchases.reduce((groups, row) => {
    const current = groups.get(row.course_title) ?? { title: row.course_title, orders: 0, seats: 0, total: 0 }
    current.orders += 1
    current.seats += row.quantity
    current.total += row.total_minor
    groups.set(row.course_title, current)
    return groups
  }, new Map<string, { title: string; orders: number; seats: number; total: number }>()).values()].sort((a, b) => b.total - a.total)
  const monthlySpend = [...paidPurchases.reduce((groups, row) => {
    const month = row.created_at.slice(0, 7)
    groups.set(month, (groups.get(month) ?? 0) + row.total_minor)
    return groups
  }, new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
  const maxMonthlySpend = Math.max(1, ...monthlySpend.map(([, value]) => value))
  const funnel = [
    ['Seats purchased', d.total_seats_purchased],
    ['Seats allocated', d.seats_allocated],
    ['Learning activated', progressRows.length],
    ['In progress', activeLearning],
    ['Completed', completed],
  ] as const
  const funnelMax = Math.max(1, funnel[0][1])

  return (
    <div className="grid gap-6">
      <RoleHeading title="Commercial home" description="Company training investment, purchases, seats, requests and realised learning value." />
      <section aria-label="Commercial summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total invested" value={gbp(d.total_spend_minor)} icon={<PoundSterling />} tone="warning" hint="paid company purchases" />
        <StatCard label="Paid purchases" value={paidPurchases.length} icon={<PoundSterling />} tone="success" hint={`${purchaseRows.length} purchase records`} />
        <StatCard label="Seats purchased" value={d.total_seats_purchased} icon={<Armchair />} hint={`${d.seats_available} available`} />
        <StatCard label="Seat utilisation" value={`${utilisation}%`} icon={<CircleGauge />} tone={utilisation >= 75 ? 'success' : 'warning'} hint={`${d.seats_allocated} seats allocated`} />
        <StatCard label="Learners activated" value={learners} icon={<UsersRound />} hint={`${activeLearning} currently in progress`} />
        <StatCard label="Average progress" value={`${averageProgress}%`} icon={<BookOpenCheck />} tone="info" hint={`${completed} completed allocations`} />
        <StatCard label="Active live groups" value={d.active_cohorts} icon={<CalendarCheck2 />} tone="info" hint={`${d.pending_requests} requests under review`} />
        <StatCard label="Open requests" value={openRequests.length} icon={<FileCheck2 />} tone="warning" hint="submitted or under review" />
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card><CardHeader title="Training value funnel" description="From purchased capacity to completed employee learning" action={<SectionLink to="/business/corporate">Full training report</SectionLink>} /><CardBody className="pt-2">{progress.error ? <ErrorState message={(progress.error as Error).message} /> : <ul className="grid gap-4">{funnel.map(([label, value]) => <li key={label}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="font-medium">{label}</span><span className="font-semibold tabular">{value} · {Math.round((value / funnelMax) * 100)}%</span></div><Progress value={(value / funnelMax) * 100} label={`${label}: ${value}`} /></li>)}</ul>}</CardBody></Card>
        <Card><CardHeader title="Investment by month" description="Paid company training purchases" /><CardBody className="pt-2">{monthlySpend.length ? <><div className="flex h-56 items-end gap-3 border-b border-l border-border px-3">{monthlySpend.map(([month, value]) => <div key={month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="w-full max-w-12 rounded-t bg-primary" style={{ height: `${Math.max(4, (value / maxMonthlySpend) * 100)}%` }} title={`${month}: ${gbp(value)}`} /><span className="text-[9px] text-muted">{month}</span></div>)}</div><p className="mt-3 text-xs text-muted">Paid total: <strong className="text-text">{gbp(d.total_spend_minor)}</strong></p></> : <EmptyState icon={<BarChart3 />} title="No paid monthly activity yet" />}</CardBody></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card><CardHeader title="Course purchases" description="Courses with the highest company investment" action={<SectionLink to="/business/packages">Course packages</SectionLink>} />{courseSummary.length ? <Table className="mt-2"><thead><Tr><Th>Course</Th><Th>Orders</Th><Th>Seats</Th><Th className="text-right">Invested</Th></Tr></thead><tbody>{courseSummary.slice(0, 10).map((row) => <Tr key={row.title}><Td className="font-medium">{row.title}</Td><Td>{row.orders}</Td><Td>{row.seats}</Td><Td className="text-right font-medium">{gbp(row.total)}</Td></Tr>)}</tbody></Table> : <EmptyState icon={<BookOpenCheck />} title="No paid course purchases yet" />}</Card>
        <Card><CardHeader title="Training requests & workspace needs" description="Requests that still need a response" action={<SectionLink to="/business/purchases-and-seats">Open requests</SectionLink>} /><CardBody className="pt-2">{requests.error ? <ErrorState message={(requests.error as Error).message} /> : openRequests.length === 0 ? <EmptyState icon={<FileCheck2 />} title="No requests waiting" /> : <ul className="divide-y divide-border">{openRequests.map((row) => <li key={row.id} className="py-3 first:pt-0 last:pb-0"><div className="flex justify-between gap-3"><span className="text-sm font-medium">{row.course_title}</span><Badge tone="warning">{row.status_label}</Badge></div><p className="mt-1 text-xs text-muted">{row.requested_seats} seats · {row.preferred_delivery_mode || 'Delivery flexible'}</p></li>)}</ul>}</CardBody></Card>
      </div>
      <Card><CardHeader title="Recent company purchases" description="Recorded and live training purchased for this workspace" action={<SectionLink to="/business/purchases-and-seats">Purchases & seats</SectionLink>} />{purchases.error ? <ErrorState message={(purchases.error as Error).message} /> : recentPurchases.length === 0 ? <EmptyState icon={<PoundSterling />} title="No company purchases yet" /> : <Table><thead><Tr><Th>Course</Th><Th>Delivery</Th><Th>Seats</Th><Th>Total</Th><Th>Status</Th></Tr></thead><tbody>{recentPurchases.map((row) => <Tr key={row.id}><Td className="font-medium">{row.course_title}</Td><Td className="capitalize text-muted">{row.delivery_type}</Td><Td>{row.quantity}</Td><Td>{row.currency === 'GBP' ? gbp(row.total_minor) : `${row.currency} ${(row.total_minor / 100).toFixed(2)}`}</Td><Td><Badge tone={row.status === 'paid' ? 'success' : row.status.includes('cancel') || row.status.includes('fail') ? 'danger' : 'warning'}>{row.status.replaceAll('_', ' ')}</Badge></Td></Tr>)}</tbody></Table>}</Card>
    </div>
  )
}
