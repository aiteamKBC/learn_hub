import { Award, Bell, BookOpen, ClipboardCheck, Coins, Compass, Crown, Heart, HeartPulse, LifeBuoy, Package, PenTool, ReceiptText, ScrollText, Settings, Sparkles, Trophy, type LucideIcon, UserRound, Video } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { Logo } from '@/components/ui/logo'
import { useWorkspace } from '@/features/identity/workspace'
import { cn } from '@/lib/cn'
import { Link, NavLink } from '@/lib/router'

import { LearnerHeaderSlotContext } from './learner-header'

// `company`: employee self-service, only while "Learning as" a company is active.
// `personal`: consumer shopping, hidden only while the company learning workspace is active.
type LearnerNavItem = {
  to: string
  label: string
  Icon: LucideIcon
  end?: boolean
  company?: boolean
  personal?: boolean
}

type LearnerNavSection = { label: string; items: LearnerNavItem[] }

const sections: LearnerNavSection[] = [
  {
    label: 'Main learning',
    items: [
      { to: '/learn', label: 'My learning', Icon: BookOpen, end: true },
      { to: '/courses', label: 'Browse courses', Icon: Compass },
      { to: '/learn/required', label: 'Training plans', Icon: ClipboardCheck, company: true },
      { to: '/learn/live', label: 'Live sessions', Icon: Video },
      { to: '/learn/certificates', label: 'Certificates', Icon: Award },
      { to: '/learn/achievements', label: 'Achievements', Icon: Trophy },
    ],
  },
  {
    label: 'Professional development',
    items: [
      { to: '/teach', label: 'Teach on LearnHub', Icon: PenTool, end: true },
      { to: '/learn/hr-profile', label: 'My HR profile', Icon: UserRound, company: true },
      { to: '/learn/wellbeing', label: 'Wellbeing', Icon: HeartPulse, company: true },
      { to: '/learn/cpd', label: 'CPD log', Icon: Award, company: true },
      { to: '/learn/competence', label: 'My competence', Icon: Sparkles, company: true },
      { to: '/learn/practise-ksbs', label: 'Practise your KSBs', Icon: Sparkles, company: true },
      { to: '/learn/reviews', label: 'My reviews', Icon: ClipboardCheck, company: true },
      { to: '/learn/policies', label: 'My policies', Icon: ScrollText, company: true },
    ],
  },
  {
    label: 'Store & payments',
    items: [
      { to: '/wishlist', label: 'Wishlist', Icon: Heart, personal: true },
      { to: '/account/orders', label: 'Purchase history', Icon: ReceiptText, personal: true },
      { to: '/subscription', label: 'Unlimited plan', Icon: Crown, personal: true },
      { to: '/packages', label: 'Packages', Icon: Package, personal: true },
      { to: '/wallet', label: 'Token wallet', Icon: Coins, personal: true },
    ],
  },
  {
    label: 'Account & support',
    items: [
      { to: '/notifications', label: 'Notifications', Icon: Bell },
      { to: '/support', label: 'Help & support', Icon: LifeBuoy },
      { to: '/account', label: 'Settings', Icon: Settings, end: true },
    ],
  },
]

/** The learner's own area, inside the public header: the desktop sidebar follows
 * the same full-height navy treatment as the admin and business dashboards.
 *
 * Laid out as a grid so the page title sits in a band across the top (right of
 * the sidebar), and the sidebar card lines up with the first content card below
 * it. Pages feed the band through <LearnerHeader> / <PageHeader>. */
export function LearnerLayout() {
  const { org } = useWorkspace()
  // "Learning as" a company is active; employee self-service belongs to this mode only.
  const inCompanyMode = !!org
  // Personal shopping stays visible whenever the person is using their personal learner
  // workspace. It is hidden only while they are actively learning as a company member.
  const hidePersonal = inCompanyMode
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const { pathname } = useLocation()
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.company) return inCompanyMode
        if (item.personal) return !hidePersonal
        return true
      }),
    }))
    .filter((section) => section.items.length)
  const links = (dark = false) => visibleSections.map((section) => (
    <div key={section.label} className="grid gap-0.5">
      <p className={cn('px-3 pt-2.5 pb-0.5 text-[9px] font-semibold tracking-[0.08em] uppercase', dark ? 'text-nav-muted' : 'text-subtle')}>
        {section.label}
      </p>
      {section.items.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            dark
              ? cn(
                  'relative flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors',
                  isActive
                    ? "bg-nav-active text-nav-text-active before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-nav-active-bar before:content-['']"
                    : 'text-nav-text hover:bg-nav-hover hover:text-white',
                )
              : cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                )
          }
        >
          <Icon className={cn('shrink-0', dark ? 'size-[17px]' : 'size-[18px]')} strokeWidth={dark ? 1.9 : 2} aria-hidden />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </div>
  ))
  return (
    <div className="relative isolate min-h-[calc(100dvh-4rem)] lg:ml-[272px]">
      {/* Fixed to the viewport so the warm artwork sits behind the frosted header too,
          letting the nav bar blend into the background instead of being a white strip. */}
      <DashboardBackdrop className="animate-fade-in fixed inset-0 -z-10" />
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[272px] flex-col bg-nav text-nav-text lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-white/10 bg-nav px-5">
          <Link to="/" aria-label="Home"><Logo /></Link>
        </div>
        <p className="mx-5 mt-3 mb-0.5 inline-flex w-fit rounded-full bg-white/8 px-2.5 py-0.5 text-[10.5px] font-medium tracking-wide text-nav-text uppercase">Learner</p>
        <nav data-lenis-prevent aria-label="My learning" className="sidebar-scroll grid flex-1 content-start gap-0.5 overflow-y-auto px-3 pt-0.5 pb-3">
          {links(true)}
        </nav>
      </aside>
      <div className="relative mx-auto grid max-w-[90rem] grid-cols-1 px-4 py-6 sm:px-6 lg:py-8">
        <details key={pathname} className="mb-5 rounded-xl border border-border bg-surface/90 p-2 shadow-sm lg:hidden">
          <summary className="cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">Learning & work menu</summary>
          <nav aria-label="Learning and work" className="mt-2 grid gap-1">{links()}</nav>
        </details>
        <div ref={setSlot} />
        <div className="min-w-0">
          <LearnerHeaderSlotContext.Provider value={slot}>
            <Outlet />
          </LearnerHeaderSlotContext.Provider>
        </div>
      </div>
    </div>
  )
}
