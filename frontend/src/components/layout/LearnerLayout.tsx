import { Award, Bell, BookOpen, ClipboardCheck, Coins, Compass, Crown, Heart, HeartPulse, LifeBuoy, Package, ReceiptText, ScrollText, Settings, Sparkles, Trophy, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { cn } from '@/lib/cn'
import { NavLink } from '@/lib/router'

import { LearnerHeaderSlotContext } from './learner-header'

// `company`: employee self-service, only while "Learning as" a company is active.
// `personal`: consumer shopping, hidden in company mode and for platform admins (who never buy).
const items = [
  { to: '/learn', label: 'My learning', Icon: BookOpen, end: true },
  { to: '/learn/required', label: 'Required training', Icon: ClipboardCheck, company: true },
  { to: '/learn/hr-profile', label: 'My HR profile', Icon: UserRound, company: true },
  { to: '/learn/wellbeing', label: 'Wellbeing', Icon: HeartPulse, company: true },
  { to: '/learn/cpd', label: 'CPD log', Icon: Award, company: true },
  { to: '/learn/competence', label: 'My competence', Icon: Sparkles, company: true },
  { to: '/learn/practise-ksbs', label: 'Practise your KSBs', Icon: Sparkles, company: true },
  { to: '/learn/reviews', label: 'My reviews', Icon: ClipboardCheck, company: true },
  { to: '/learn/policies', label: 'My policies', Icon: ScrollText, company: true },
  { to: '/courses', label: 'Browse courses', Icon: Compass },
  { to: '/wishlist', label: 'Wishlist', Icon: Heart, personal: true },
  { to: '/learn/certificates', label: 'Certificates', Icon: Award },
  { to: '/learn/achievements', label: 'Achievements', Icon: Trophy },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/account/orders', label: 'Purchase history', Icon: ReceiptText, personal: true },
  { to: '/wallet', label: 'Token wallet', Icon: Coins, personal: true },
  { to: '/subscription', label: 'Unlimited plan', Icon: Crown, personal: true },
  { to: '/packages', label: 'Packages', Icon: Package, personal: true },
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
  const { org } = useWorkspace()
  // "Learning as" a company is active; employee self-service belongs to this mode only.
  const inCompanyMode = !!org
  // Admins never self-purchase (platform staff, or owners/admins of any company); nobody
  // shops while acting for a company (the company bills through /business).
  const isAdmin = !!me?.is_staff || !!me?.memberships.some((m) => m.role === 'owner' || m.role === 'admin')
  const hidePersonal = isAdmin || inCompanyMode
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const { pathname } = useLocation()
  const visibleItems = items.filter((i) => {
    if (i.company) return inCompanyMode
    if (i.personal) return !hidePersonal
    return true
  })
  const links = visibleItems.map(({ to, label, Icon, end }) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) =>
      cn('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:bg-surface-2 hover:text-text')}>
      <Icon className="size-[18px] shrink-0" aria-hidden /> {label}
    </NavLink>
  ))
  return (
    <div className="relative isolate min-h-[calc(100dvh-4rem)]">
      {/* Fixed to the viewport so the warm artwork sits behind the frosted header too,
          letting the nav bar blend into the background instead of being a white strip. */}
      <DashboardBackdrop className="animate-fade-in fixed inset-0 -z-10" />
      <div className="relative mx-auto grid max-w-[90rem] grid-cols-1 gap-x-8 px-4 py-6 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:py-8">
        <details key={pathname} className="mb-5 rounded-xl border border-border bg-surface/90 p-2 shadow-sm md:hidden">
          <summary className="cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">Learning & work menu</summary>
          <nav aria-label="Learning and work" className="mt-2 grid gap-1">{links}</nav>
        </details>
        {/* Page-title band: row 1 of the content column, above the sidebar. */}
        <div ref={setSlot} className="md:col-start-2 md:row-start-1" />
        <aside className="hidden md:col-start-1 md:row-start-2 md:block">
          <nav data-lenis-prevent aria-label="My learning" className="sticky top-24 grid max-h-[calc(100dvh-7rem)] gap-1 overflow-y-auto rounded-2xl border border-border bg-surface/80 p-2 shadow-sm backdrop-blur-sm">
            {links}
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
