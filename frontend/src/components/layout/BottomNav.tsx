import { Compass, GraduationCap, Heart, Home, User } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useMe } from '@/features/identity/auth'
import { NavLink } from '@/lib/router'

const items = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/courses', label: 'Explore', Icon: Compass },
  { to: '/learn', label: 'My Learning', Icon: GraduationCap },
  { to: '/wishlist', label: 'Wishlist', Icon: Heart },
  { to: '/account', label: 'Account', Icon: User },
]

/** Learner navigation on phones (approved: balanced bottom navigation, five tabs). */
export function BottomNav() {
  const company = !!useMe().data?.memberships.length // company accounts have no wishlist
  const shown = company ? items.filter((i) => i.to !== '/wishlist') : items
  return (
    <nav aria-label="Main" className="vt-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className={cn('grid', shown.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
        {shown.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) => cn('flex h-13 flex-col items-center justify-center gap-0.5 text-[10px] font-medium', isActive ? 'text-primary' : 'text-muted')}
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
