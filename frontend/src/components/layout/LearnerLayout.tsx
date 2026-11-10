import { Award, Bell, BookOpen, ClipboardCheck, Compass, Heart, LifeBuoy, ReceiptText, Settings, Trophy } from 'lucide-react'
import { Outlet } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { usePageArt } from '@/lib/page-art'
import { NavLink } from '@/lib/router'

const items = [
  { to: '/learn', label: 'My learning', Icon: BookOpen, end: true },
  { to: '/learn/required', label: 'Required training', Icon: ClipboardCheck, company: true },
  { to: '/courses', label: 'Browse courses', Icon: Compass },
  { to: '/wishlist', label: 'Wishlist', Icon: Heart },
  { to: '/learn/certificates', label: 'Certificates', Icon: Award },
  { to: '/learn/achievements', label: 'Achievements', Icon: Trophy },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/account/orders', label: 'Purchase history', Icon: ReceiptText },
  { to: '/support', label: 'Help & support', Icon: LifeBuoy },
  { to: '/account', label: 'Settings', Icon: Settings, end: true },
]

/** The learner's own area, inside the public header: light sidebar on desktop
 * (as in the mockups); on phones the public layout's bottom navigation takes over. */
export function LearnerLayout() {
  const art = usePageArt('path')
  const { data: me } = useMe()
  const inCompany = !!me?.memberships.length
  return (
    <div className="relative isolate">
      <Backdrop key={art} variant={art} height={420} className="animate-fade-in" />
    <div className="relative mx-auto flex max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:py-8">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav aria-label="My learning" className="sticky top-24 grid gap-0.5">
          {items.filter((i) => !i.company || inCompany).map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn('flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:bg-surface-2 hover:text-text')
              }
            >
              <Icon className="size-[18px]" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
    </div>
  )
}
