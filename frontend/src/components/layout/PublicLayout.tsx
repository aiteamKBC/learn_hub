import { Search, ShoppingCart } from 'lucide-react'
import { type FormEvent, useCallback, useState } from 'react'
import { Outlet, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/ui/logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useCartCount } from '@/features/commerce/api'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useOn } from '@/lib/motion'

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

function SearchBox({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const navigate = useNavigate()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/courses?q=${encodeURIComponent(q.trim())}` : '/courses')
  }
  return (
    <form role="search" onSubmit={submit} className={className}>
      <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for courses, topics or instructors" aria-label="Search courses" autoFocus={autoFocus} className="rounded-full bg-surface-2/60" />
    </form>
  )
}

/** Marketplace pages: top navigation, footer; phones get the learner bottom bar. */
export function PublicLayout() {
  const { data: me, isLoading } = useMe()
  const [searchOpen, setSearchOpen] = useState(false)
  const link = ({ isActive }: { isActive: boolean }) => cn('rounded-md px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-primary' : 'text-muted hover:text-text')

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="vt-header sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="shrink-0">
            <Logo />
          </span>
          <nav className="ml-4 hidden items-center lg:flex" aria-label="Primary">
            <NavLink to="/" end className={link}>Home</NavLink>
            <NavLink to="/courses" className={link}>Courses</NavLink>
            <NavLink to="/plans" className={link}>Plans</NavLink>
            {me ? <NavLink to="/learn" className={link}>My learning</NavLink> : null}
          </nav>
          <SearchBox className="mx-4 hidden max-w-md flex-1 md:block" />
          <div className="ml-auto flex items-center gap-1">
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
              <>
                <Button variant="ghost" asChild className="hidden sm:inline-flex">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm" className="sm:h-10 sm:px-4 sm:text-sm">
                  <Link to="/signup">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
        {searchOpen ? <SearchBox className="border-t border-border px-4 py-3 md:hidden" autoFocus /> : null}
      </header>

      <main id="main" className={cn('flex-1', me && 'pb-16 md:pb-0')}>
        <Outlet />
      </main>

      <footer className={cn('border-t border-border bg-surface', me && 'pb-16 md:pb-0')}>
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted">Courses from expert instructors, and compliance training your whole team can keep up with.</p>
          </div>
          {[
            ['Learn', ['Browse courses', 'Subscriptions', 'Certificates']],
            ['Business', ['Team plans', 'Compliance tracking', 'Book a demo']],
            ['LearnHub', ['Teach on LearnHub', 'Help centre', 'Privacy']],
          ].map(([title, items]) => (
            <div key={title as string}>
              <p className="text-sm font-semibold">{title}</p>
              <ul className="mt-3 grid gap-2 text-sm text-muted">
                {(items as string[]).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="border-t border-border py-4 text-center text-xs text-subtle">© {YEAR} LearnHub. Demo build.</p>
      </footer>
      {me ? <BottomNav /> : null}
    </div>
  )
}
