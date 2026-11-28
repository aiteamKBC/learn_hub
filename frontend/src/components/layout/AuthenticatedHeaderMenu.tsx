import { Bell, Building2, Check, Coins, GraduationCap, LayoutDashboard, LogOut, Menu as MenuIcon, Moon, PenTool, Search, Settings, Shield, ShoppingCart, Sun, User } from 'lucide-react'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'
import { useCartCount, useCurrencies } from '@/features/commerce/api'
import { useUnreadCount } from '@/features/engagement/api'
import { useLogout, useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { Link, useNavigate } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { toast } from '@/lib/toast'

type Props = {
  onDark?: boolean
  marketplaceLinks?: boolean
  onSearch?: () => void
}

/** All signed-in header controls live behind one three-line menu. This keeps every navbar
 * calm while preserving currency, theme, cart, notifications, workspaces and account routes. */
export function AuthenticatedHeaderMenu({ onDark, marketplaceLinks = false, onSearch }: Props) {
  const { data: me } = useMe()
  const { data: cart } = useCartCount()
  const unread = useUnreadCount()
  const { data: currencies } = useCurrencies()
  const { code, setCurrency } = useCurrency()
  const { dark, setChoice } = useTheme()
  const { org, memberships, switchTo } = useWorkspace()
  const logout = useLogout()
  const navigate = useNavigate()

  if (!me) return null

  const currentCurrency = code ?? 'GBP'
  const cartCount = cart?.count ?? 0
  const unreadCount = unread.data?.unread ?? 0
  const manages = memberships.filter((m) => ['owner', 'admin', 'manager'].includes(m.role))

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open account and website controls"
          className={cn('rounded-full', onDark && 'text-white hover:bg-white/10 hover:text-white')}
        >
          <MenuIcon />
        </Button>
      </MenuTrigger>
      <MenuContent className="max-h-[calc(100dvh-24px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto overscroll-contain p-2">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2/75 px-3 py-3">
          <Avatar name={me.full_name || me.email} src={me.avatar_url} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">{me.full_name || me.email}</p>
            <p className="truncate text-xs text-muted">{org ? org.name : 'Personal'}</p>
          </div>
        </div>

        {/* These catalogue links are already visible in the top navbar on large screens,
            so the "Explore" group only appears where the navbar collapses them (phone/tablet). */}
        {marketplaceLinks ? (
          <div className="contents xl:hidden">
            <MenuLabel className="mt-1">Explore</MenuLabel>
            <div className="grid grid-cols-2 gap-1">
              <MenuItem asChild><Link to="/courses">Courses</Link></MenuItem>
              <MenuItem asChild><Link to="/plans">Plans</Link></MenuItem>
              <MenuItem asChild><Link to="/#sales">Offers</Link></MenuItem>
              <MenuItem asChild><Link to="/#instructors">Instructors</Link></MenuItem>
            </div>
            {onSearch ? (
              <MenuItem onSelect={onSearch}>
                <Search /> Search
              </MenuItem>
            ) : null}
            <MenuSeparator />
          </div>
        ) : null}

        <MenuLabel>Quick controls</MenuLabel>
        <MenuSub>
          <MenuSubTrigger>
            <Coins /> Currency
            <span className="ml-auto mr-1 font-semibold tabular text-primary">{currentCurrency}</span>
          </MenuSubTrigger>
          <MenuSubContent className="max-h-80 overflow-y-auto overscroll-contain">
            <MenuLabel>Show prices in</MenuLabel>
            {(currencies ?? []).map((currency) => (
              <MenuItem key={currency.code} onSelect={() => void setCurrency(currency.code)}>
                <span className={cn('w-10 font-semibold tabular', currency.code === currentCurrency && 'text-primary')}>{currency.code}</span>
                <span className="truncate text-muted">{currency.name}</span>
                {currency.code === currentCurrency ? <Check className="ml-auto !text-primary" /> : null}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuItem onSelect={() => setChoice(dark ? 'light' : 'dark')}>
          {dark ? <Sun /> : <Moon />} {dark ? 'Light theme' : 'Dark theme'}
        </MenuItem>
        <MenuItem asChild>
          <Link to="/cart">
            <ShoppingCart /> Cart
            {cartCount ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary tabular">{cartCount}</span> : null}
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link to="/notifications">
            <Bell /> Notifications
            {unreadCount ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white tabular">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
          </Link>
        </MenuItem>

        <MenuSeparator />
        <MenuLabel>Account</MenuLabel>
        <MenuItem asChild>
          <Link to="/learn"><GraduationCap /> My learning</Link>
        </MenuItem>
        <MenuItem asChild>
          <Link to="/account"><Settings /> Profile & settings</Link>
        </MenuItem>

        {manages.length ? (
          <MenuSub>
            <MenuSubTrigger><LayoutDashboard /> Company dashboards</MenuSubTrigger>
            <MenuSubContent>
              {manages.map((membership) => (
                <MenuItem key={membership.org_id} onSelect={() => (switchTo(membership.org_id), navigate('/business'))}>
                  <Building2 /> <span className="truncate">{membership.name}</span>
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ) : null}

        {me.is_instructor ? (
          <MenuItem asChild><Link to="/studio"><PenTool /> Instructor studio</Link></MenuItem>
        ) : (
          <MenuItem asChild><Link to="/teach"><PenTool /> {me.instructor_status === 'pending' ? 'Application pending' : 'Teach on LearnHub'}</Link></MenuItem>
        )}
        {me.is_staff ? <MenuItem asChild><Link to="/console"><Shield /> Admin console</Link></MenuItem> : null}

        {memberships.length ? (
          <MenuSub>
            <MenuSubTrigger><User /> Learning as</MenuSubTrigger>
            <MenuSubContent>
              <MenuItem onSelect={() => (switchTo(null), org && toast.success('Now learning as yourself'))}>
                <User /> Personal {!org ? <Check className="ml-auto !text-primary" /> : null}
              </MenuItem>
              {memberships.map((membership) => (
                <MenuItem key={membership.org_id} onSelect={() => (switchTo(membership.org_id), org?.org_id !== membership.org_id && toast.success(`Now learning as ${membership.name}`))}>
                  <Building2 /> <span className="truncate">{membership.name}</span>
                  {org?.org_id === membership.org_id ? <Check className="ml-auto !text-primary" /> : null}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ) : null}

        <MenuSeparator />
        <MenuItem className="text-danger data-[highlighted]:bg-danger-soft" onSelect={() => logout.mutate()}>
          <LogOut className="!text-danger" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
