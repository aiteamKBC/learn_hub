import { Search, ShoppingCart } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { ActorSwitcher } from '@/components/dev/ActorSwitcher'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useCartCount } from '@/features/commerce/api'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useOn } from '@/lib/motion'
import { Link, NavLink } from '@/lib/router'

import { CurrencyMenu } from './CurrencyMenu'
import { NotificationBell } from './NotificationBell'
import { SearchBox } from './SearchBox'
import { UserMenu } from './UserMenu'

/** The cart icon with its live count; bounces when a course is added (same as the marketplace). */
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

const link = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-md px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-primary' : 'text-muted hover:text-text')

/** The marketplace top bar, reused above a workspace area so staff can jump straight to the
 * public catalogue, cart and account from the console. This is the solid (non-hero) variant of
 * the header in PublicLayout; it carries no hero-overlay or scroll behaviour. */
export function MarketplaceNav() {
  const { data: me, isLoading } = useMe()
  const [searchOpen, setSearchOpen] = useState(false)
  // "My learning" is a plain-learner feature; most console users are staff, so it rarely shows.
  const isLearner = !!me && !me.is_staff && !me.is_instructor && !(me.memberships ?? []).some((m) => ['owner', 'admin', 'manager'].includes(m.role))

  return (
    <header className="vt-header sticky top-0 z-40 border-b border-border/60 bg-surface/70 text-text backdrop-blur-xl">
      <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 flex-1 items-center">
          <Link to="/" aria-label="LearnHub home" className="shrink-0">
            <Logo />
          </Link>
          <nav className="ml-4 hidden items-center lg:flex" aria-label="Primary">
            <NavLink to="/courses" className={link}>Courses</NavLink>
            <NavLink to="/plans" className={link}>Plans</NavLink>
            <Link to="/#sales" className={link({ isActive: false })}>Offers</Link>
            <Link to="/#instructors" className={link({ isActive: false })}>Instructors</Link>
            {isLearner ? <NavLink to="/learn" className={link}>My learning</NavLink> : null}
          </nav>
        </div>
        <SearchBox className="hidden max-w-md flex-1 md:block" />
        <div className="flex flex-1 items-center justify-end gap-1">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen((v) => !v)}>
            <Search />
          </Button>
          <span className="hidden sm:inline-flex">
            <CurrencyMenu />
          </span>
          <ActorSwitcher />
          <ThemeToggle />
          {me?.memberships.length ? null : <CartButton />}
          {me ? <NotificationBell /> : null}
          {isLoading ? null : me ? (
            <UserMenu />
          ) : (
            <Button size="sm" className="!text-on-primary sm:h-10 sm:px-4 sm:text-sm" asChild>
              <Link to="/login">Log in</Link>
            </Button>
          )}
        </div>
      </div>
      {searchOpen ? <SearchBox className="border-t border-border px-4 py-3 md:hidden" autoFocus /> : null}
    </header>
  )
}
