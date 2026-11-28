import {
  AlertTriangle,
  Award,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleGauge,
  Clock3,
  FileCheck2,
  Layers3,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/cn'

const departments = ['Planned', 'Fire', 'Retrofits', 'Contracts', 'Residential', 'SHEQ', 'Commercial', 'People']

const kpis = [
  { label: 'Workforce', value: '84', note: 'people', delta: '', icon: <UsersRound />, tone: 'primary' },
  { label: 'Training completion', value: '73%', note: '', delta: '+4pt', icon: <BookOpenCheck />, tone: 'slate' },
  { label: 'Learning hrs / person', value: '10.9', note: 'this quarter', delta: '+1.6', icon: <Clock3 />, tone: 'primary' },
  { label: 'Certificates', value: '314', note: '', delta: '+29', icon: <Award />, tone: 'amber' },
  { label: 'KPI attainment', value: '94%', note: '', delta: '+4pt', icon: <Target />, tone: 'primary' },
  { label: 'Competence coverage', value: '88%', note: '', delta: '+2pt', icon: <CircleGauge />, tone: 'slate' },
  { label: 'Maturity score', value: '3.4/5', note: '', delta: '+0.3', icon: <Layers3 />, tone: 'primary' },
] as const

const toneClass = {
  primary: 'bg-primary-soft text-primary-soft-text',
  slate: 'bg-chart-5/12 text-chart-5',
  amber: 'bg-chart-3/15 text-warning',
} as const

function PeopleKpi({ item }: { item: (typeof kpis)[number] }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-muted">{item.label}</p>
        <span className={cn('flex size-8 items-center justify-center rounded-lg [&_svg]:size-4', toneClass[item.tone])}>{item.icon}</span>
      </div>
      <p className="mt-2 text-[24px] leading-none font-semibold tracking-tight tabular text-text">{item.value}</p>
      <div className="mt-2 flex min-h-4 items-center justify-between gap-2 text-[10px] text-subtle">
        <span>{item.note}</span>
        {item.delta ? <span className="rounded bg-success-soft px-1.5 py-0.5 font-semibold text-success">{item.delta}</span> : null}
      </div>
    </Card>
  )
}

function SectionLink({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline">
      {children} <span aria-hidden>→</span>
    </button>
  )
}

const strategyRows = [
  ['S01', 'Safe, right-first-time refurbishment', '8 KPIs · 102 staff KPIs', 94],
  ['S02', 'Reliable programme delivery', '3 KPIs · 45 staff KPIs', 97],
  ['S03', 'Respectful resident experience', '4 KPIs · 24 staff KPIs', 97],
  ['S04', 'Skilled workforce & apprenticeships', '5 KPIs · 24 staff KPIs', 97],
  ['S05', 'Sustainable, energy-efficient delivery', '2 KPIs · 20 staff KPIs', 92],
  ['S06', 'Commercial stewardship', '4 KPIs · 36 staff KPIs', 91],
] as const

function StrategyAlignment() {
  return (
    <Card className="lg:col-span-8">
      <CardHeader title="Strategy alignment" description="Approved strategy v1 · objectives → active department KPIs → staff KPIs" action={<SectionLink>Strategy map</SectionLink>} />
      <CardBody className="pt-4">
        <ul className="grid gap-2.5">
          {strategyRows.map(([code, name, detail, score]) => (
            <li key={code} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[12px] sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(8rem,.7fr)_5rem]">
              <Badge tone="primary" className="rounded-md px-2 font-mono text-[10px]">{code}</Badge>
              <span className="truncate font-medium text-text" title={name}>{name}</span>
              <span className="hidden truncate text-[10px] text-muted sm:block">{detail}</span>
              <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
                </span>
                <span className="w-7 text-right text-[10px] font-semibold tabular">{score}%</span>
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

function ApprovalQueue() {
  return (
    <Card className="lg:col-span-4">
      <CardHeader title="Strategic approval queue" description="1 awaiting Executive" />
      <CardBody className="pt-4">
        <button type="button" className="group flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning"><FileCheck2 className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-text">KP-104 Hold-point checks recorded before mobilisation</span>
            <span className="mt-1 block text-[10px] text-muted">Retrofit & Energy Efficiency · S05 · KPI awaiting Executive approval</span>
          </span>
          <ChevronRight className="mt-2 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
        </button>
      </CardBody>
    </Card>
  )
}

const performance = [
  { planned: 1, fire: 2, retrofits: 1, contracts: 1, residential: 3, sheq: 1, commercial: 2, people: 2 },
  { planned: 2, fire: 1, retrofits: 2, contracts: 2, residential: 1, sheq: 3, commercial: 1, people: 1 },
]

function ChartFrame({ children, labels = departments, max = '100' }: { children: ReactNode; labels?: string[]; max?: string }) {
  return (
    <div className="mt-4">
      <div className="relative h-44 border-b border-l border-border">
        {[0, 25, 50, 75, 100].map((v) => <span key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${v}%` }} aria-hidden />)}
        <span className="absolute -top-2 -left-1 -translate-x-full text-[9px] text-subtle">{max}</span>
        <div className="absolute inset-x-2 inset-y-0 flex items-end justify-around gap-1">{children}</div>
      </div>
      <div className="ml-1 grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }} aria-hidden>
        {labels.map((label) => <span key={label} className="truncate pt-2 text-center text-[8px] text-subtle">{label}</span>)}
      </div>
    </div>
  )
}

function KpiStatusChart() {
  return (
    <Card className="lg:col-span-6">
      <CardHeader title="All-department KPI status" description="Count of active KPIs by status this quarter" action={<SectionLink>KPI board</SectionLink>} />
      <CardBody className="pt-0">
        <ChartFrame max="4">
          {departments.map((name, i) => {
            const onTrack = performance[0]![name.toLowerCase() as keyof (typeof performance)[number]]
            const atRisk = performance[1]![name.toLowerCase() as keyof (typeof performance)[number]]
            const offTrack = i === 6 ? 1 : 0
            return <div key={name} className="flex h-full w-7 flex-col justify-end"><span className="bg-chart-3" style={{ height: `${offTrack * 25}%` }} /><span className="bg-primary" style={{ height: `${atRisk * 25}%` }} /><span className="bg-chart-5" style={{ height: `${onTrack * 25}%` }} /></div>
          })}
        </ChartFrame>
        <Legend items={[['On track', 'bg-chart-5'], ['At risk', 'bg-primary'], ['Off track', 'bg-chart-3']]} />
      </CardBody>
    </Card>
  )
}

const capability = [70, 68, 72, 69, 70, 71, 70, 69]
const competence = [72, 70, 69, 73, 72, 70, 71, 73]
const maturity = [85, 88, 91, 88, 90, 88, 89, 87]

function CapabilityChart() {
  return (
    <Card className="lg:col-span-6">
      <CardHeader title="Maturity · capability · competence by department" description="Maturity scaled ×20 to 0–100 for comparison" action={<SectionLink>Frameworks</SectionLink>} />
      <CardBody className="pt-0">
        <ChartFrame>
          {departments.map((name, i) => (
            <div key={name} className="flex h-full items-end gap-0.5">
              <span className="w-2 rounded-t bg-primary" style={{ height: `${maturity[i]}%` }} />
              <span className="w-2 rounded-t bg-chart-5" style={{ height: `${capability[i]}%` }} />
              <span className="w-2 rounded-t bg-chart-3" style={{ height: `${competence[i]}%` }} />
            </div>
          ))}
        </ChartFrame>
        <Legend items={[['Maturity', 'bg-primary'], ['Capability', 'bg-chart-5'], ['Competence', 'bg-chart-3']]} />
      </CardBody>
    </Card>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="mt-3 flex flex-wrap justify-center gap-3 text-[9px] text-muted">{items.map(([label, color]) => <span key={label} className="inline-flex items-center gap-1"><span className={cn('size-2 rounded-full', color)} />{label}</span>)}</div>
}

const learningPoints = [188, 208, 190, 205, 236, 244, 237, 240, 270, 304, 270]

function points(values: number[], width = 640, height = 160) {
  const min = Math.min(...values) - 20
  const max = Math.max(...values) + 20
  return values.map((value, i) => ({ x: (i / (values.length - 1)) * width, y: height - ((value - min) / (max - min)) * height }))
}

function LearningHoursChart() {
  const id = useId()
  const p = points(learningPoints)
  const line = p.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
  const area = `${line} L640,160 L0,160 Z`
  return (
    <Card className="lg:col-span-8">
      <CardHeader title="Learning hours by month" description="Total hours logged in LearnHub, 2026" action={<SectionLink>Report</SectionLink>} />
      <CardBody className="pt-2">
        <div className="relative h-48 border-b border-l border-border">
          {[0, 33, 66, 100].map((v) => <span key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${v}%` }} />)}
          <svg viewBox="0 0 640 160" preserveAspectRatio="none" className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]" aria-label="Learning hours trend rising from January to October before easing in November" role="img">
            <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-primary)" stopOpacity=".28" /><stop offset="1" stopColor="var(--color-primary)" stopOpacity=".02" /></linearGradient></defs>
            <path d={area} fill={`url(#${id})`} />
            <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="grid grid-cols-11 pt-2 text-center text-[8px] text-subtle">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov'].map((m) => <span key={m}>{m}</span>)}</div>
      </CardBody>
    </Card>
  )
}

function HumanCapitalIndex() {
  const series = [
    { label: 'HCI', values: [75, 82, 85, 86], color: 'var(--color-primary)' },
    { label: 'Competence', values: [82, 84, 87, 88], color: 'var(--color-chart-5)' },
    { label: 'Wellbeing', values: [70, 70, 76, 78], color: 'var(--color-chart-3)' },
  ]
  return (
    <Card className="lg:col-span-4">
      <CardHeader title="Human Capital Index" description="Illustrative composite · see formula in Reports" action={<Badge tone="primary">85/100</Badge>} />
      <CardBody className="pt-3">
        <div className="relative h-44 border-b border-l border-border">
          {[0, 33, 66, 100].map((v) => <span key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${v}%` }} />)}
          <svg viewBox="0 0 320 140" preserveAspectRatio="none" className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]" role="img" aria-label="Human Capital Index, competence and wellbeing all improve across four quarters">
            {series.map((s) => {
              const p = points(s.values, 320, 140)
              const d = p.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
              return <g key={s.label}><path d={d} fill="none" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" /><g>{p.map((point, i) => <circle key={i} cx={point.x} cy={point.y} r="3" fill="var(--color-surface)" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}</g></g>
            })}
          </svg>
        </div>
        <div className="grid grid-cols-4 pt-2 text-center text-[8px] text-subtle">{['Q1','Q2','Q3','Q4'].map((q) => <span key={q}>{q}</span>)}</div>
        <Legend items={series.map((s) => [s.label, s.label === 'HCI' ? 'bg-primary' : s.label === 'Competence' ? 'bg-chart-5' : 'bg-chart-3'])} />
      </CardBody>
    </Card>
  )
}

const departmentScores = [99, 93, 98, 95, 96, 91, 97, 94]
function DepartmentPerformance() {
  return (
    <Card className="lg:col-span-8">
      <CardHeader title="Department performance" description="KPI attainment and competence coverage · click a bar to open the department KPIs" />
      <CardBody className="pt-0">
        <ChartFrame>
          {departments.map((name, i) => <button type="button" key={name} title={`${name}: ${departmentScores[i]}%`} className={cn('w-8 rounded-t transition-opacity hover:opacity-75', i % 3 === 0 ? 'bg-primary' : i % 3 === 1 ? 'bg-chart-5' : 'bg-chart-3')} style={{ height: `${departmentScores[i]}%` }} />)}
        </ChartFrame>
        <Legend items={[['KPI attainment', 'bg-text'], ['Competence %', 'bg-primary']]} />
      </CardBody>
    </Card>
  )
}

const attention = [
  ['Liam Ali', 'Quarterly review', '19 Nov 2026', 'calendar'],
  ['Callum Ali', 'One-to-one', '19 Nov 2026', 'calendar'],
  ['Harvey Barker', 'Probation review', '19 Nov 2026', 'calendar'],
  ['Lottie Abara', 'Onboarding · 53% · started 2 Nov', '', 'onboarding'],
  ['Hugo Peddington', 'Onboarding · 78% · started 19 Oct', '', 'onboarding'],
  ['Aisha Patel', 'Department SKP overdue', '', 'warning'],
  ['Daniel Ali', 'Department SKP overdue', '', 'warning'],
  ['Daniel Brooks', 'Basic induction overdue', '', 'warning'],
] as const

function NeedsPeopleAttention() {
  return (
    <Card className="lg:col-span-4">
      <CardHeader title="Needs attention" description="Upcoming reviews, onboarding and training needs" />
      <CardBody className="pt-3">
        <ul className="grid gap-1">
          {attention.map(([name, task, date, kind]) => (
            <li key={`${name}-${task}`}>
              <button type="button" className="group flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-surface-2">
                <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-3.5', kind === 'warning' ? 'bg-danger-soft text-danger' : kind === 'onboarding' ? 'bg-primary-soft text-primary-soft-text' : 'bg-chart-5/12 text-chart-5')}>
                  {kind === 'warning' ? <AlertTriangle /> : kind === 'onboarding' ? <Sparkles /> : <CalendarDays />}
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">{name} · {task}</span>{date ? <span className="block text-[9px] text-muted">{date}</span> : null}</span>
                <ChevronRight className="size-3.5 text-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

const spotlight = [
  ['PROFILE', 'Maya Thompson · Decorating Supervisor, Planned Maintenance & Decorating'],
  ['COMPETENCE GAP', 'Surface preparation & quality inspection: level 2 of 3 · briefing follow-up 2 of 3'],
  ['ROLE KPI', 'First-time inspection pass rate: 89% vs 95% target'],
  ['REVIEW', 'Quarterly review · 9 Dec 2026'],
  ['LEARNING PLAN', 'PCM-13, PCM-06, ELM-05 and PCM-16 in plan'],
  ['CAREER', 'Target: Senior Site Supervisor → Contracts Manager'],
] as const

function DevelopmentSpotlight() {
  return (
    <Card className="lg:col-span-6">
      <CardHeader title="Spotlight: connected development" description="One person traced across competence, KPI, review and learning" />
      <CardBody className="pt-4">
        <ol className="relative ml-2 grid gap-4 border-l border-primary/35 pl-5">
          {spotlight.map(([label, text]) => <li key={label} className="relative"><span className="absolute top-1.5 -left-[24.5px] size-2 rounded-full border-2 border-surface bg-primary" /><p className="font-mono text-[9px] font-semibold tracking-[.12em] text-primary">{label}</p><p className="mt-0.5 text-[11px] text-text">{text}</p></li>)}
        </ol>
      </CardBody>
    </Card>
  )
}

const learners = [
  ['Anya Hale', 'Retrofit Assessor', '13.8 h'],
  ['Nathaniel Marsh', 'Finance Assistant', '13.8 h'],
  ['Yusuf Dean', 'Multi-trade Operative', '13.7 h'],
  ['Liam Ali', 'Painter & Decorator', '13.6 h'],
  ['Fatima Patel', 'Painter & Decorator', '13.5 h'],
] as const

function TopLearners() {
  return (
    <Card className="lg:col-span-6">
      <CardHeader title="Top learners this quarter" action={<SectionLink>Leaderboard</SectionLink>} />
      <CardBody className="pt-3">
        <ol className="grid gap-2">
          {learners.map(([name, role, hours], i) => <li key={name} className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg p-2 hover:bg-surface-2"><span className="text-center text-[10px] font-semibold text-muted">{i + 1}</span><Avatar name={name} size="sm" /><span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{name}</span><span className="block truncate text-[9px] text-muted">{role}</span></span><span className="text-[11px] font-semibold tabular">{hours}</span></li>)}
        </ol>
      </CardBody>
    </Card>
  )
}

function WorkspaceSummary({ orgName = 'Architectural Decorators LTD' }: { orgName?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary"><Building2 className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-semibold tracking-[.16em] text-primary">TENANT WORKSPACE</p>
          <h2 className="truncate text-[15px] font-semibold tracking-tight">{orgName}</h2>
          <p className="mt-0.5 text-[10px] text-muted">Part of AIC Construction Group · planned maintenance, fire safety and energy-efficient homes</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">Trust</Badge><Badge tone="neutral" className="bg-chart-5/12 text-chart-5">Value</Badge><Badge tone="primary">Quality</Badge><Badge tone="outline">Do it right, do it well</Badge>
        </div>
      </div>
    </Card>
  )
}

export function PeoplePerformanceDashboard({ department, quarter, orgName }: { department: string; quarter: string; orgName?: string }) {
  const scope = department === 'all' ? 'All departments' : department
  return (
    <div className="grid gap-5">
      <section aria-label="People and performance overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {kpis.map((item) => <PeopleKpi key={item.label} item={item} />)}
      </section>
      <WorkspaceSummary orgName={orgName} />
      <div className="grid gap-4 lg:grid-cols-12"><StrategyAlignment /><ApprovalQueue /></div>
      <div className="grid gap-4 lg:grid-cols-12"><KpiStatusChart /><CapabilityChart /></div>
      <div className="grid gap-4 lg:grid-cols-12"><LearningHoursChart /><HumanCapitalIndex /></div>
      <div className="grid gap-4 lg:grid-cols-12"><DepartmentPerformance /><NeedsPeopleAttention /></div>
      <div className="grid gap-4 lg:grid-cols-12"><DevelopmentSpotlight /><TopLearners /></div>
      <p className="flex items-center gap-2 text-[10px] text-subtle"><ShieldCheck className="size-3.5" /> Figures are illustrative demonstration records for {scope}, {quarter}. Workforce and performance data will use live console APIs when the cross-tenant endpoint is connected.</p>
    </div>
  )
}

export function PeoplePerformanceFilters({ department, quarter, onDepartmentChange, onQuarterChange }: { department: string; quarter: string; onDepartmentChange: (value: string) => void; onQuarterChange: (value: string) => void }) {
  return (
    <>
      <NativeSelect id="people-department" aria-label="Department" value={department} onChange={(e) => onDepartmentChange(e.target.value)} className="w-full sm:w-48">
        <option value="all">All departments</option>
        {departments.map((name) => <option key={name} value={name}>{name}</option>)}
      </NativeSelect>
      <NativeSelect id="people-quarter" aria-label="Quarter" value={quarter} onChange={(e) => onQuarterChange(e.target.value)} className="w-full sm:w-36">
        {['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'].map((value) => <option key={value}>{value}</option>)}
      </NativeSelect>
    </>
  )
}
