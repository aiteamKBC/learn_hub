import { Download, Gauge, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type Kpi, useKpis } from '@/features/pms/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

import { RecordDialog } from './KpisPage'
import { CreateProposalDialog } from './ProposalsPage'

type Scope = 'department' | 'individual'
const displayName = (name: string) => name.replace(/^\[WORKFORCE DEMO\]\s*/, '')

function RelatedCourse({ source, title }: { source: string; title: string }) {
  const slug = source.startsWith('/courses/') ? source.slice('/courses/'.length) : ''
  return slug ? <Link to={`/courses/${slug}`} className="text-primary underline">{title || 'Related course'}</Link> : <>{source || '—'}</>
}

function quarter(kpi: Kpi, index: number) {
  return kpi.cadence === 'quarterly' ? index : kpi.cadence === 'monthly' ? Math.ceil(index / 3) : Math.ceil(index / 13)
}

function attainment(kpi: Kpi, actual: number | null) {
  if (actual == null || kpi.target == null) return null
  const target = Number(kpi.target)
  const baseline = kpi.baseline == null ? null : Number(kpi.baseline)
  if (baseline != null) return Math.round(Math.max(0, Math.min(100, target === baseline ? (actual === target ? 100 : 0) : (actual - baseline) / (target - baseline) * 100)))
  if (kpi.higher_better) return target === 0 ? (actual >= 0 ? 100 : 0) : Math.round(Math.max(0, Math.min(100, actual / target * 100)))
  return actual <= 0 ? 100 : Math.round(Math.max(0, Math.min(100, target / actual * 100)))
}

function status(pct: number | null) {
  return pct == null ? 'No reading' : pct >= 90 ? 'On track' : pct >= 60 ? 'At risk' : 'Off track'
}

function colour(pct: number | null) {
  return pct == null ? 'var(--border-strong)' : pct >= 90 ? 'var(--chart-2)' : pct >= 60 ? 'var(--chart-3)' : 'var(--chart-4)'
}

type Row = { kpi: Kpi; actual: number | null; pct: number | null; owner: string; improving: boolean | null }

function exportCsv(rows: Row[], period: string) {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = [
    ['KPI', 'Level', 'Department', 'Owner', 'Weight', 'Baseline', 'Target', 'Actual', 'Unit', 'Attainment %', 'Status', 'Period', 'Objective'].join(','),
    ...rows.map(({ kpi, actual, pct, owner }) => [kpi.name, kpi.scope, kpi.dept, owner, kpi.weight, kpi.baseline, kpi.target, actual, kpi.unit, pct, status(pct), period, kpi.objective_code].map(quote).join(',')),
  ]
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `learnhub-${rows[0]?.kpi.scope ?? 'kpis'}-kpis.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function KpiBoardPage({ initialScope = 'department' }: { initialScope?: Scope }) {
  const admin = useIsOrgAdmin()
  const department = useKpis('department')
  const individual = useKpis('individual')
  const scope = initialScope
  const [dept, setDept] = useState('all')
  const [person, setPerson] = useState('all')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const all = scope === 'department' ? department.data ?? [] : individual.data ?? []
  const departments = [...new Set((department.data ?? []).map((k) => k.dept).filter(Boolean))].sort()
  const people = [...new Set((individual.data ?? []).map((k) => k.owner_id).filter((id): id is string => !!id))]
  const peopleNames = new Map((individual.data ?? []).filter((k) => k.owner_id).map((k) => [k.owner_id, k.owner_name]))
  const periods = [...new Set([...(department.data ?? []), ...(individual.data ?? [])].flatMap((k) => k.series.map((p) => `${p.period_year} Q${quarter(k, p.period_index)}`)))].sort().reverse()
  const period = selectedPeriod && periods.includes(selectedPeriod) ? selectedPeriod : periods[0] ?? ''
  const parentNames = new Map((department.data ?? []).map((k) => [k.id, displayName(k.name)]))
  const rows: Row[] = all.filter((k) => k.status === 'active' && (dept === 'all' || k.dept === dept) && (person === 'all' || scope === 'department' || k.owner_id === person)).map((kpi) => {
    const points = kpi.series.filter((p) => `${p.period_year} Q${quarter(kpi, p.period_index)}` === period)
    const point = points.at(-1)
    const actual = point ? Number(point.value) : null
    const pct = attainment(kpi, actual)
    const previous = point ? kpi.series[kpi.series.findIndex((p) => p.period_year === point.period_year && p.period_index === point.period_index) - 1] : undefined
    const improving = previous && actual != null ? (kpi.higher_better ? actual >= Number(previous.value) : actual <= Number(previous.value)) : null
    return { kpi, actual, pct, owner: kpi.owner_name, improving }
  })
  const counts = { on: rows.filter((r) => status(r.pct) === 'On track').length, risk: rows.filter((r) => status(r.pct) === 'At risk').length, off: rows.filter((r) => status(r.pct) === 'Off track').length }
  const chartData = rows.map((r, index) => ({ label: `KPI ${index + 1}`, full: displayName(r.kpi.name), pct: r.pct ?? 0, fill: colour(r.pct) }))
  const error = department.error || individual.error
  const loading = department.isLoading || individual.isLoading

  return <>
    <PageHeader title={scope === 'department' ? 'Department KPIs' : 'Individual KPIs'} description="Department results and individual goals linked to strategic objectives, with targets, weights and recorded actuals." actions={admin ? <CreateProposalDialog defaultScope={scope} label="Add KPI" /> : null} />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button asChild variant={scope === 'department' ? 'primary' : 'secondary'}><Link to="/business/pms/kpis">Department KPIs ({department.data?.length ?? 0})</Link></Button>
      <Button asChild variant={scope === 'individual' ? 'primary' : 'secondary'}><Link to="/business/pms/individual-kpis">Individual KPIs ({individual.data?.length ?? 0})</Link></Button>
      <Button asChild variant="ghost"><Link to="/business/pms/proposals">Approval queue</Link></Button>
    </div>
    {error ? <ErrorState message={(error as Error).message} onRetry={() => { void department.refetch(); void individual.refetch() }} /> : loading ? <Skeleton className="h-96 rounded-lg" /> : <div className="animate-reveal grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{period} · {counts.on} on track · {counts.risk} at risk · {counts.off} off track</p>
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="Department" className="w-48" value={dept} onChange={(e) => setDept(e.target.value)}><option value="all">All departments</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</NativeSelect>
          {scope === 'individual' ? <NativeSelect aria-label="Person" className="w-48" value={person} onChange={(e) => setPerson(e.target.value)}><option value="all">All people</option>{people.map((id) => <option key={id} value={id}>{peopleNames.get(id) ?? 'Team member'}</option>)}</NativeSelect> : null}
          <NativeSelect aria-label="Period" className="w-32" value={period} onChange={(e) => setSelectedPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect>
          <Button variant="secondary" onClick={() => exportCsv(rows, period)}><Download /> Export CSV</Button>
        </div>
      </div>
      {rows.length === 0 ? <Card><EmptyState icon={<Gauge />} title="No KPIs for this selection" body="Try another period, person or department, or add a KPI proposal." /></Card> : <>
        {scope === 'individual' && person !== 'all' ? <Card className="p-4 text-sm"><span className="font-semibold">{peopleNames.get(person) ?? 'Team member'}</span> · total goal weight <strong>{rows.reduce((sum, row) => sum + row.kpi.weight, 0)}%</strong>{rows.reduce((sum, row) => sum + row.kpi.weight, 0) !== 100 ? ' · adjust approved goals to total 100%' : ''}</Card> : null}
        <Card className="p-5">
          <h2 className="font-semibold">Attainment vs target</h2><p className="mb-3 text-xs text-muted">100% means the target was reached. Progress is measured from baseline to target.</p>
          <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [`${value}%`, 'Attainment']} labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''} /><ReferenceLine y={100} stroke="var(--chart-3)" strokeDasharray="4 4" /><Bar dataKey="pct" radius={[5, 5, 0, 0]}>{chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Card>
        <Card className="overflow-hidden"><Table className="min-w-[1080px]"><thead><Tr><Th>KPI / objective</Th><Th>Department</Th><Th>{scope === 'individual' ? 'Person' : 'Owner'}</Th><Th>Weight</Th><Th>Target</Th><Th>Actual</Th><Th>Trend</Th><Th>Status</Th><Th>History</Th></Tr></thead><tbody>{rows.map(({ kpi, actual, pct, owner, improving }) => <Tr key={kpi.id}>
          <Td className="min-w-64"><p className="font-medium">{displayName(kpi.name)}</p><p className="mt-0.5 text-xs text-muted">{kpi.objective_code} · {kpi.objective_title} · baseline {kpi.baseline ?? '—'} {kpi.unit}</p>{kpi.parent_kpi_id ? <p className="mt-1 text-xs text-primary">Parent: {parentNames.get(kpi.parent_kpi_id) ?? 'Department KPI'}</p> : null}<p className="mt-1 text-xs"><RelatedCourse source={kpi.source} title={kpi.source_title} /></p></Td>
          <Td>{kpi.dept}</Td><Td className="min-w-32">{owner}</Td><Td className="tabular">{kpi.weight}%</Td><Td className="whitespace-nowrap font-medium tabular">{kpi.target ?? '—'} {kpi.unit}</Td><Td className="whitespace-nowrap font-semibold tabular">{actual ?? '—'} {actual == null ? '' : kpi.unit}</Td>
          <Td>{improving == null ? '—' : improving ? <TrendingUp className="size-4 text-success" aria-label="Improving" /> : <TrendingDown className="size-4 text-danger" aria-label="Declining" />}</Td>
          <Td><Badge tone={pct == null ? 'neutral' : pct >= 90 ? 'success' : pct >= 60 ? 'warning' : 'danger'}>{status(pct)}{pct == null ? '' : ` · ${pct}%`}</Badge></Td>
          <Td><RecordDialog kpi={kpi} admin={admin} /></Td>
        </Tr>)}</tbody></Table></Card>
      </>}
    </div>}
  </>
}

export function IndividualKpisPage() {
  return <KpiBoardPage initialScope="individual" />
}
