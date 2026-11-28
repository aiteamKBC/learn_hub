import { Award, BookOpen, Flame, GraduationCap, Heart, Lock, type LucideIcon, Medal, MessageCircle, Rocket, Star, Target, Trophy, Zap } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useBadges } from '@/features/engagement/api'
import { cn } from '@/lib/cn'
import { useCountUp, useFill } from '@/lib/motion'
import { shortDate } from '@/lib/format'

/** Badge icons are stored as lucide names; only this set is bundled (unknown → award). */
const BADGE_ICONS: Record<string, LucideIcon> = {
  award: Award, 'book-open': BookOpen, flame: Flame, 'graduation-cap': GraduationCap, heart: Heart, medal: Medal,
  'message-circle': MessageCircle, rocket: Rocket, star: Star, target: Target, trophy: Trophy, zap: Zap,
}
function BadgeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = BADGE_ICONS[name] ?? Award
  return <Icon className={className} />
}

export function AchievementsPage() {
  const q = useBadges()
  const earned = q.data?.filter((b) => b.earned_at).length ?? 0
  const total = q.data?.length ?? 0
  const n = useCountUp(earned, !!q.data)
  const fill = useFill(total ? (earned / total) * 100 : 0, !!q.data)

  return (
    <>
      <PageHeader title="Achievements" description="Badges for finishing courses, earning certificates and helping others." />
      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !total ? (
        <Card>
          <EmptyState icon={<Trophy />} title="No badges yet" body="Badges will appear here as they are introduced." />
        </Card>
      ) : (
        <>
          <Card className="mb-7 grid gap-5 rounded-2xl px-6 py-5 shadow-sm sm:grid-cols-[minmax(290px,0.45fr)_minmax(0,1fr)] sm:items-center sm:px-7 sm:py-6">
            <div className="flex min-w-0 items-center gap-5">
              <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-warning-soft text-primary">
                <Trophy className="size-10" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-medium text-muted">Achievements unlocked</p>
                <p className="mt-1 text-3xl font-medium tracking-tight tabular">
                  {Math.round(n)} <span className="text-muted">of {total}</span>
                </p>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-5">
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-gradient-to-r from-chart-3 to-primary transition-[width] duration-700 ease-out" style={{ width: `${fill}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-lg font-medium text-muted tabular">{Math.round(fill)}%</span>
              </div>
              <p className="mt-3 text-base text-muted">
                {earned === 0 ? 'Complete learning activities to unlock your first badge.' : earned === total ? 'You have unlocked every available achievement.' : `Keep learning — ${total - earned} achievement${total - earned === 1 ? '' : 's'} left to unlock.`}
              </p>
            </div>
          </Card>
          <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {q.data!.map((b) => {
              const got = !!b.earned_at
              return (
                <li key={b.code} className={cn('group flex flex-col items-center rounded-xl border bg-surface p-5 text-center shadow-sm transition-all', got ? 'border-chart-3/40 hover:-translate-y-0.5 hover:shadow' : 'border-dashed border-border')}>
                  <span className={cn('relative flex size-16 items-center justify-center [clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0_50%)] transition-transform duration-300', got ? 'bg-gradient-to-br from-chart-3 to-primary text-white group-hover:scale-110' : 'bg-surface-2 text-subtle')}>
                    <BadgeIcon name={b.icon} className="size-7" />
                  </span>
                  <p className={cn('mt-3 text-sm font-semibold', !got && 'text-muted')}>{b.name}</p>
                  <p className="mt-1 text-xs text-muted">{b.description}</p>
                  <p className="mt-auto pt-3 text-[11px] font-medium">
                    {got ? (
                      <span className="text-success">Earned {shortDate(b.earned_at!)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-subtle">
                        <Lock className="size-3" /> Not yet
                      </span>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
