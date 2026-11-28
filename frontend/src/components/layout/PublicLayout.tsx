import { Mail, Menu as MenuIcon, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { AuthTabs } from '@/components/home/GetStarted'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Logo } from '@/components/ui/logo'
import { ActorSwitcher } from '@/components/dev/ActorSwitcher'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { scrollToAnchor, smoothScrollTo } from '@/lib/smooth-scroll'

import { AuthenticatedHeaderMenu } from './AuthenticatedHeaderMenu'
import { BottomNav } from './BottomNav'
import { SearchBox } from './SearchBox'
import { Link, NavLink, useNavigate } from '@/lib/router'

const YEAR = new Date().getFullYear()

/** Marketplace pages: top navigation, footer; phones get the learner bottom bar. */
export function PublicLayout() {
  const { data: me, isLoading } = useMe()
  const [searchOpen, setSearchOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === '/'
  const hasLearnerSidebar = pathname === '/learn'
    || pathname.startsWith('/learn/')
    || pathname === '/notifications'
    || pathname === '/wishlist'
    || pathname.startsWith('/account')
    || pathname.startsWith('/wallet')
    || pathname === '/subscription'
    || pathname === '/packages'
    || pathname === '/checkout/review'
    || pathname.startsWith('/teach')
    || pathname.startsWith('/support')
  // "My learning" is a learner feature: show it only for a plain learner — not platform
  // staff, not an instructor, and not someone who manages a company workspace.
  const isLearner = !!me && !me.is_staff && !me.is_instructor && !(me.memberships ?? []).some((m) => ['owner', 'admin', 'manager'].includes(m.role))
  // Close the auth dialog whenever the route changes (e.g. after a successful log in).
  useEffect(() => setAuthOpen(false), [pathname])
  const [scrolled, setScrolled] = useState(false)
  // Scroll-spy: underline the nav link for the home section currently in view, so the
  // active section updates on its own as you scroll (not only when you click).
  const [activeSection, setActiveSection] = useState<string | null>(null)
  useEffect(() => {
    if (!isHome) {
      setActiveSection(null)
      return
    }
    const ids = ['courses', 'sales', 'instructors']
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    if (!els.length) return
    const visible = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id)
          else visible.delete(e.target.id)
        }
        setActiveSection(ids.find((id) => visible.has(id)) ?? null)
      },
      // a thin band around the upper-middle of the viewport decides the "current" section
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [isHome])
  useEffect(() => {
    if (!isHome) return
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isHome])
  // Transparent over the home hero at the top; solid once scrolled or on any other page.
  const overlay = isHome && !scrolled
  // On the home page, smooth-scroll to a section. From another page, navigate home
  // (client-side) and let HomePage scroll to the section on mount — no full reload.
  const goSection = (id: string) => {
    if (isHome) {
      // scrollToAnchor keeps re-aiming as the async sections above load in, so we
      // always land on the right section (and bails out if the user scrolls).
      scrollToAnchor(id)
      window.history.replaceState(null, '', `/#${id}`)
    } else {
      navigate(`/#${id}`)
    }
  }
  const scrollToId = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    goSection(id)
  }
  // The section you are in gets orange text and an orange underline; hover gives a faint one.
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'border-b-2 px-2 py-1.5 text-sm font-medium transition-colors',
      isActive
        ? 'border-primary text-primary'
        : overlay
          ? 'border-transparent text-white/80 hover:border-white/40 hover:text-white'
          : 'border-transparent text-muted hover:border-border hover:text-text',
    )

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className={cn('vt-header sticky top-0 z-40 transition-[colors,margin] duration-300', hasLearnerSidebar && 'lg:ml-[272px]', overlay ? 'border-b border-transparent bg-transparent text-white' : 'border-b border-border/60 bg-surface/60 text-text backdrop-blur-xl')}>
        <div className={cn('flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-10', overlay && '[&_button]:text-white [&_button:hover]:text-white')}>
          <div className="flex min-w-0 flex-1 items-center">
          <Link
            to="/"
            aria-label="LearnHub home, back to top"
            className={cn('shrink-0', hasLearnerSidebar && 'lg:hidden')}
            onClick={(e) => {
              e.preventDefault()
              if (isHome) {
                smoothScrollTo(0)
                window.history.replaceState(null, '', '/')
              } else {
                navigate('/#hero')
              }
            }}
          >
            <Logo />
          </Link>
          {hasLearnerSidebar ? null : (
            <nav className="ml-4 hidden items-center gap-1 xl:flex" aria-label="Primary">
              <a href="/#courses" onClick={scrollToId('courses')} className={link({ isActive: activeSection === 'courses' })}>Courses</a>
              <NavLink to="/plans" className={link}>Plans</NavLink>
              <a href="/#sales" onClick={scrollToId('sales')} className={link({ isActive: activeSection === 'sales' })}>Offers</a>
              <a href="/#instructors" onClick={scrollToId('instructors')} className={link({ isActive: activeSection === 'instructors' })}>Instructors</a>
              {isLearner ? <NavLink to="/learn" className={link}>My learning</NavLink> : null}
            </nav>
          )}
          </div>
          <SearchBox className="hidden max-w-md flex-1 lg:block" overlay={overlay} />
          <div className="flex flex-1 items-center justify-end gap-1">
            <ActorSwitcher />
            {isLoading ? null : me ? (
              <AuthenticatedHeaderMenu onDark={overlay} marketplaceLinks onSearch={() => setSearchOpen(true)} />
            ) : (
              <Dialog open={authOpen} onOpenChange={setAuthOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="!text-on-primary sm:h-10 sm:px-4 sm:text-sm">
                    Log in
                  </Button>
                </DialogTrigger>
                <DialogContent title="Welcome to LearnHub" description="Log in or create an account to get started." hideHeader className="max-w-[600px] overflow-hidden rounded-[24px] border-white/70 bg-[#fffdfa] p-0 shadow-2xl">
                  <AuthTabs />
                </DialogContent>
              </Dialog>
            )}
            {/* Visitors still need the small-screen navigation. Signed-in account controls
                and these links are merged into the single three-line menu above. */}
            {!me ? <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                  <MenuIcon />
                </Button>
              </MenuTrigger>
              <MenuContent className="min-w-52">
                <MenuItem onSelect={() => goSection('courses')}>Courses</MenuItem>
                <MenuItem onSelect={() => navigate('/plans')}>Plans</MenuItem>
                <MenuItem onSelect={() => goSection('sales')}>Offers</MenuItem>
                <MenuItem onSelect={() => goSection('instructors')}>Instructors</MenuItem>
                {isLearner ? <MenuItem onSelect={() => navigate('/learn')}>My learning</MenuItem> : null}
                <MenuSeparator />
                <MenuItem onSelect={() => setSearchOpen(true)}>
                  <Search /> Search
                </MenuItem>
              </MenuContent>
            </Menu> : null}
          </div>
        </div>
        {searchOpen ? <SearchBox className="border-t border-border px-4 py-3 lg:hidden" autoFocus overlay={overlay} /> : null}
      </header>

      <main id="main" className={cn('flex-1', me && 'pb-14 lg:pb-0')}>
        <Outlet />
      </main>

      {isHome ? (
      <footer className={cn('bg-[#1f262e] text-white', me && 'pb-14 lg:pb-0')}>
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">Courses, programmes and memberships for teams who turn complex work into skills they can prove.</p>
            <div className="mt-5 flex items-center gap-2.5">
              <a href="mailto:hello@learnhub.com" className="inline-flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white">
                <Mail className="size-4" /> hello@learnhub.com
              </a>
            </div>
          </div>
          {[
            { title: 'Learn', items: [['Courses', '/courses'], ['Plans', '/plans'], ['Membership', '/plans'], ['My learning', '/learn'], ['Instructors', '/#instructors']] },
            { title: 'Company', items: [['About LearnHub', '/about'], ['For teams', '/plans'], ['Careers', '/careers'], ['Press', '/press']] },
            { title: 'Support', items: [['Help centre', '/help'], ['Contact', '/contact'], ['Accessibility', '/accessibility'], ['Terms of service', '/terms']] },
          ].map(({ title, items }) => (
            <div key={title}>
              <p className="font-mono text-[11px] tracking-[0.18em] text-white/50 uppercase">{title}</p>
              <ul className="mt-4 grid gap-2.5 text-sm">
                {items.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-white/70 transition-colors hover:text-white">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>© {YEAR} LearnHub · Learning that proves itself.</span>
            <span className="flex gap-5">
              <Link to="/privacy" className="transition-colors hover:text-white">Privacy</Link>
              <Link to="/terms" className="transition-colors hover:text-white">Terms</Link>
              <Link to="/cookies" className="transition-colors hover:text-white">Cookies</Link>
            </span>
          </div>
        </div>
      </footer>
      ) : null}
      {me ? <BottomNav /> : null}
    </div>
  )
}
