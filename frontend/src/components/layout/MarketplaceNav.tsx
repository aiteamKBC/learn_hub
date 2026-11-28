import { Search } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { Link, NavLink } from '@/lib/router'

import { AuthenticatedHeaderMenu } from './AuthenticatedHeaderMenu'
import { SearchBox } from './SearchBox'

// The section you are in gets orange text and an orange underline; hover gives a faint one.
const link = ({ isActive }: { isActive: boolean }) =>
  cn('border-b-2 px-2 py-1.5 text-sm font-medium transition-colors', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:border-border hover:text-text')

/** The marketplace top bar, reused above a workspace area so staff can jump straight to the
 * public catalogue, cart and account from the console. This is the solid (non-hero) variant of
 * the header in PublicLayout; it carries no hero-overlay or scroll behaviour. */
export function MarketplaceNav({ workspace = false }: { workspace?: boolean }) {
  const { data: me, isLoading } = useMe()
  const [searchOpen, setSearchOpen] = useState(false)
  // "My learning" is a plain-learner feature; most console users are staff, so it rarely shows.
  const isLearner = !!me && !me.is_staff && !me.is_instructor && !(me.memberships ?? []).some((m) => ['owner', 'admin', 'manager'].includes(m.role))

  return (
    <header className="vt-header sticky top-0 z-40 border-b border-border/60 bg-surface/70 text-text backdrop-blur-xl">
      <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 flex-1 items-center">
          <Link to="/" aria-label="LearnHub home" className={cn('shrink-0', workspace && 'lg:hidden')}>
            <Logo />
          </Link>
          {workspace ? null : (
            <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Primary">
              <NavLink to="/courses" className={link}>Courses</NavLink>
              <NavLink to="/plans" className={link}>Plans</NavLink>
              <Link to="/#sales" className={link({ isActive: false })}>Offers</Link>
              <Link to="/#instructors" className={link({ isActive: false })}>Instructors</Link>
              {isLearner ? <NavLink to="/learn" className={link}>My learning</NavLink> : null}
            </nav>
          )}
        </div>
        <SearchBox className="hidden max-w-md flex-1 md:block" />
        <div className="flex flex-1 items-center justify-end gap-1">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen((v) => !v)}>
            <Search />
          </Button>
          {isLoading ? null : me ? (
            <AuthenticatedHeaderMenu marketplaceLinks onSearch={() => setSearchOpen(true)} />
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
