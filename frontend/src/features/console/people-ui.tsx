import { GraduationCap, Users } from 'lucide-react'
import type { ReactNode } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

/** Students | Instructors switch in the page header (mockup 05: two workspaces, one place). */
export function PeopleSwitch({ active }: { active: 'students' | 'instructors' }) {
  const items = [
    { key: 'students', to: '/console/students', label: 'Students', Icon: Users },
    { key: 'instructors', to: '/console/instructors', label: 'Instructors', Icon: GraduationCap },
  ] as const
  return (
    <nav aria-label="People" className="inline-flex rounded-lg border border-border bg-surface p-1 shadow-sm">
      {items.map(({ key, to, label, Icon }) => (
        <Link
          key={key}
          to={to}
          aria-current={active === key ? 'page' : undefined}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150 [&_svg]:size-4',
            active === key ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:text-text',
          )}
        >
          <Icon aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  )
}

/** Avatar, name and email in one table cell. */
export function PersonCell({ name, email, extra }: { name: string; email: string; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name || email} size="sm" />
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate font-medium">
          <span className="truncate">{name || email}</span>
          {extra}
        </p>
        <p className="max-w-[16rem] truncate text-xs text-muted">{email}</p>
      </div>
    </div>
  )
}

/** "68%" with a small bar that fills in. */
export function ProgressCell({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-right text-xs tabular">{Math.round(value)}%</span>
      <Progress value={value} className="w-20" label={`${Math.round(value)}% average progress`} />
    </div>
  )
}

export const personStatus = (s: string) => ({ active: 'Active', suspended: 'Suspended', deleted: 'Deleted', approved: 'Active', pending: 'Applied', rejected: 'Rejected' })[s] ?? s
