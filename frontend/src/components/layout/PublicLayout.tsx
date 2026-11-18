import { Mail, Search, ShoppingCart } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useSearchParams } from 'react-router-dom'

import { AuthTabs } from '@/components/home/GetStarted'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/ui/logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useCartCount } from '@/features/commerce/api'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useOn } from '@/lib/motion'
import { scrollToAnchor, smoothScrollTo } from '@/lib/smooth-scroll'

import { BottomNav } from './BottomNav'
import { CurrencyMenu } from './CurrencyMenu'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'
import { Link, NavLink, useNavigate } from '@/lib/router'

const YEAR = new Date().getFullYear()

/** The cart icon shows how many courses are in it, and bounces when one is added. */
function CartButton() {
  const [n, setN] = useState(0)
  useOn('cart:added', useCallback(() => setN((x) => x + 1), []))
  const { data } = useCartCount()
  const count = data?.count ?? 0
  return (
    <Button variant="ghost" size="icon" asChild aria-label={count ? `Cart, ${count} ${count === 1 ? 'course' : 'courses'}` : 'Cart'} className="relative">
      <Link to="/cart">
        <ShoppingCart key={n} className={n ? 'animate-bounce-once' : undefined} />
        {count ? (
          <span key={`c${count}`} className="absolute top-1 right-0.5 flex h-[18px] min-w-[18px] animate-pop items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary ring-2 ring-surface tabular">
            {count}
          </span>
        ) : null}
      </Link>
    </Button>
  )
}

function SearchBox({ className, autoFocus, overlay }: { className?: string; autoFocus?: boolean; overlay?: boolean }) {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const navigate = useNavigate()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/courses?q=${encodeURIComponent(q.trim())}` : '/courses')
  }
  return (
    <form role="search" onSubmit={submit} className={className}>
      <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for courses, topics or instructors" aria-label="Search courses" autoFocus={autoFocus} className={cn('rounded-full', overlay ? 'border-white/25 bg-white/10 text-white placeholder:text-white/60' : 'bg-surface-2/80')} />
    </form>
  )
}

/** Marketplace pages: top navigation, footer; phones get the learner bottom bar. */
export function PublicLayout() {
  const { data: me, isLoading } = useMe()
  const [searchOpen, setSearchOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === '/'
  // "My learning" is a learner feature: show it only for a plain learner — not platform
  // staff, not an instructor, and not someone who manages a company workspace.
  const isLearner = !!me && !me.is_staff && !me.is_instructor && !(me.memberships ?? []).some((m) => ['owner', 'admin', 'manager'].includes(m.role))
  // Close the auth dialog whenever the route changes (e.g. after a successful log in).
  useEffect(() => setAuthOpen(false), [pathname])
  const [scrolled, setScrolled] = useState(false)
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
  const scrollToId = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (isHome) {
      // scrollToAnchor keeps re-aiming as the async sections above load in, so we
      // always land on the right section (and bails out if the user scrolls).
      scrollToAnchor(id)
      window.history.replaceState(null, '', `/#${id}`)
    } else {
      navigate(`/#${id}`)
    }
  }
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-3 py-2 text-sm font-medium transition-colors',
      overlay ? (isActive ? 'text-white' : 'text-white/80 hover:text-white') : isActive ? 'text-primary' : 'text-muted hover:text-text',
    )

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className={cn('vt-header sticky top-0 z-40 transition-colors duration-300', overlay ? 'border-b border-transparent bg-transparent text-white' : 'border-b border-border/60 bg-surface/60 text-text backdrop-blur-xl')}>
        <div className={cn('flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-10', overlay && '[&_button]:text-white [&_button:hover]:text-white')}>
          <div className="flex min-w-0 flex-1 items-center">
          <Link
            to="/"
            aria-label="LearnHub home — back to top"
            className="shrink-0"
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
          <nav className="ml-4 hidden items-center lg:flex" aria-label="Primary">
            <a href="/#courses" onClick={scrollToId('courses')} className={link({ isActive: false })}>Courses</a>
            <NavLink to="/plans" className={link}>Plans</NavLink>
            <a href="/#sales" onClick={scrollToId('sales')} className={link({ isActive: false })}>Offers</a>
            <a href="/#instructors" onClick={scrollToId('instructors')} className={link({ isActive: false })}>Instructors</a>
            {isLearner ? <NavLink to="/learn" className={link}>My learning</NavLink> : null}
          </nav>
          </div>
          <SearchBox className="hidden max-w-md flex-1 md:block" overlay={overlay} />
          <div className="flex flex-1 items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen((v) => !v)}>
              <Search />
            </Button>
            <span className="hidden sm:inline-flex">
              <CurrencyMenu />
            </span>
            <ThemeToggle />
            <CartButton />
            {me ? <NotificationBell /> : null}
            {isLoading ? null : me ? (
              <UserMenu />
            ) : (
              <Dialog open={authOpen} onOpenChange={setAuthOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="!text-on-primary sm:h-10 sm:px-4 sm:text-sm">
                    Log in
                  </Button>
                </DialogTrigger>
                <DialogContent title="Welcome to LearnHub" description="Log in or create an account to get started." className="max-w-[460px]">
                  <AuthTabs />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
        {searchOpen ? <SearchBox className="border-t border-border px-4 py-3 md:hidden" autoFocus /> : null}
      </header>

      <main id="main" className={cn('flex-1', me && 'pb-16 md:pb-0')}>
        <Outlet />
      </main>

      {isHome ? (
      <footer className={cn('bg-[#1f262e] text-white', me && 'pb-16 md:pb-0')}>
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">Courses, programmes and memberships for teams who turn complex work into skills they can prove.</p>
            <div className="mt-5 flex items-center gap-2.5">
              {[
                { label: 'LinkedIn', path: 'M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.73v20.53C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.73C24 .78 23.2 0 22.22 0z' },
                { label: 'Instagram', path: 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.38C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.12.66.66 1.33 1.08 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.86 5.86 0 002.12-1.38 5.86 5.86 0 001.38-2.12c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 00-1.38-2.12A5.86 5.86 0 0019.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zm0 10.16a4 4 0 110-8 4 4 0 010 8zm6.41-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z' },
                { label: 'YouTube', path: 'M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 00.5 6.19C0 8.08 0 12 0 12s0 3.92.5 5.81a3.02 3.02 0 002.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 002.12-2.14C24 15.92 24 12 24 12s0-3.92-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z' },
              ].map(({ label, path }) => (
                <a key={label} href="#" aria-label={label} className="flex size-9 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white/40 hover:text-white">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
                    <path d={path} />
                  </svg>
                </a>
              ))}
              <a href="mailto:hello@learnhub.com" className="ml-1 inline-flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white">
                <Mail className="size-4" /> hello@learnhub.com
              </a>
            </div>
          </div>
          {[
            { title: 'Learn', items: [['Courses', '/courses'], ['Plans', '/plans'], ['Membership', '/plans'], ['My learning', '/learn'], ['Instructors', '/#instructors']] },
            { title: 'Company', items: [['About LearnHub', '#'], ['For teams', '/plans'], ['Careers', '#'], ['Press', '#']] },
            { title: 'Support', items: [['Help centre', '#'], ['Contact', '#'], ['Accessibility', '#'], ['Terms of service', '#']] },
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
              {['Privacy', 'Terms', 'Cookies'].map((l) => (
                <a key={l} href="#" className="transition-colors hover:text-white">{l}</a>
              ))}
            </span>
          </div>
        </div>
      </footer>
      ) : null}
      {me ? <BottomNav /> : null}
    </div>
  )
}
