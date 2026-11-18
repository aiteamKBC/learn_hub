import { Award, Bell, BookOpen, ClipboardCheck, Coins, Compass, Crown, Heart, LifeBuoy, Package, ReceiptText, Settings, Trophy } from 'lucide-react'
import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { NavLink } from '@/lib/router'

import { LearnerHeaderSlotContext } from './learner-header'

const items = [
  { to: '/learn', label: 'My learning', Icon: BookOpen, end: true },
  { to: '/learn/required', label: 'Required training', Icon: ClipboardCheck, company: true },
  { to: '/courses', label: 'Browse courses', Icon: Compass },
  { to: '/wishlist', label: 'Wishlist', Icon: Heart },
  { to: '/learn/certificates', label: 'Certificates', Icon: Award },
  { to: '/learn/achievements', label: 'Achievements', Icon: Trophy },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/account/orders', label: 'Purchase history', Icon: ReceiptText },
  { to: '/wallet', label: 'Token wallet', Icon: Coins },
  { to: '/subscription', label: 'Unlimited plan', Icon: Crown },
  { to: '/packages', label: 'Packages', Icon: Package },
  { to: '/support', label: 'Help & support', Icon: LifeBuoy },
  { to: '/account', label: 'Settings', Icon: Settings, end: true },
]

/** The learner's own area, inside the public header: light sidebar on desktop
 * (as in the mockups); on phones the public layout's bottom navigation takes over.
 *
 * Laid out as a grid so the page title sits in a band across the top (right of
 * the sidebar), and the sidebar card lines up with the first content card below
 * it. Pages feed the band through <LearnerHeader> / <PageHeader>. */
export function LearnerLayout() {
  const { data: me } = useMe()
  const inCompany = !!me?.memberships.length
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <div className="relative isolate min-h-[calc(100dvh-4rem)]">
      {/* Fixed to the viewport so the warm artwork sits behind the frosted header too,
          letting the nav bar blend into the background instead of being a white strip. */}
      <DashboardBackdrop className="animate-fade-in fixed inset-0 -z-10" />
      <div className="relative mx-auto grid max-w-[90rem] grid-cols-1 gap-x-8 px-4 py-6 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:py-8">
        {/* Page-title band: row 1 of the content column, above the sidebar. */}
        <div ref={setSlot} className="md:col-start-2 md:row-start-1" />
        <aside className="hidden md:col-start-1 md:row-start-2 md:block">
          <nav aria-label="My learning" className="sticky top-24 grid gap-1 rounded-2xl border border-border bg-surface/80 p-2 shadow-sm backdrop-blur-sm">
            {items.filter((i) => !i.company || inCompany).map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn('flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:bg-surface-2 hover:text-text')
                }
              >
                <Icon className="size-[18px]" /> {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 md:col-start-2 md:row-start-2">
          <LearnerHeaderSlotContext.Provider value={slot}>
            <Outlet />
          </LearnerHeaderSlotContext.Provider>
        </div>
      </div>
    </div>
  )
}
