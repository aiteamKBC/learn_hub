import { AlertTriangle, Star } from 'lucide-react'
import type { ReactNode } from 'react'

import { LearnerHeader } from '@/components/layout/learner-header'
import { cn } from '@/lib/cn'

import { Button } from './button'
import { CountUp } from './count-up'
import { Card } from './card'

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <LearnerHeader>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {back}
          <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[26px]">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </LearnerHeader>
  )
}

const statTones = {
  primary: 'bg-primary-soft text-primary-soft-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

/** A KPI tile: label, big number, optional context line and trend. */
export function StatCard({ label, value, icon, tone = 'primary', hint, trend }: { label: string; value: ReactNode; icon: ReactNode; tone?: keyof typeof statTones; hint?: ReactNode; trend?: { value: string; up: boolean; good?: boolean } }) {
  const good = trend ? (trend.good ?? trend.up) : undefined
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={cn('flex size-9 items-center justify-center rounded-lg [&_svg]:size-[18px]', statTones[tone])}>{icon}</span>
      </div>
      <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight text-text tabular">{typeof value === 'number' ? <CountUp value={value} /> : value}</p>
      {trend || hint ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {trend ? <span className={cn('font-medium', good ? 'text-success' : 'text-danger')}>{trend.up ? '▲' : '▼'} {trend.value}</span> : null}
          {hint}
        </p>
      ) : null}
    </Card>
  )
}

export function EmptyState({ icon, title, body, action, className }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text [&_svg]:size-6">{icon}</span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message = 'Something went wrong loading this.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="Couldn't load this"
      body={message}
      action={onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : undefined}
    />
  )
}

export function Rating({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <span className="font-semibold text-warning tabular">{value ? value.toFixed(1) : 'New'}</span>
      {value ? (
        <span className="flex" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={cn(s, i <= Math.round(value) ? 'fill-warning text-warning' : 'fill-border text-border')} />
          ))}
        </span>
      ) : null}
      {count !== undefined && value ? <span className="text-muted tabular">({count.toLocaleString('en-GB')})</span> : null}
    </span>
  )
}
