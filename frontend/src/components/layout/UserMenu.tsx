import { Building2, Check, GraduationCap, Heart, LayoutDashboard, LogOut, PenTool, ReceiptText, Shield, Sparkles, User } from 'lucide-react'

import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { useLogout, useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { cn } from '@/lib/cn'
import { Link, useNavigate } from '@/lib/router'

/** Avatar menu: where to go (learning, company, studio, console) and which space to use. */
export function UserMenu({ onDark }: { onDark?: boolean }) {
  const { data: me } = useMe()
  const { org, memberships, switchTo } = useWorkspace()
  const logout = useLogout()
  const navigate = useNavigate()
  if (!me) return null
  const manages = memberships.filter((m) => ['owner', 'admin', 'manager'].includes(m.role))

  return (
    <Menu>
      <MenuTrigger
        className={cn('flex items-center gap-2.5 rounded-full p-0.5 pr-0.5 transition-colors sm:rounded-lg sm:p-1 sm:pr-2', onDark ? 'hover:bg-nav-hover' : 'hover:bg-surface-2')}
        aria-label="Account menu"
      >
        <Avatar name={me.full_name || me.email} src={me.avatar_url} size="sm" />
        <span className="hidden text-left leading-tight sm:block">
          <span className={cn('block max-w-36 truncate text-[13px] font-medium', onDark ? 'text-white' : 'text-text')}>{me.full_name || me.email}</span>
          <span className={cn('block max-w-36 truncate text-[11px]', onDark ? 'text-nav-text' : 'text-muted')}>{org ? org.name : 'Personal'}</span>
        </span>
      </MenuTrigger>
      <MenuContent className="w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{me.full_name || 'Your account'}</p>
          <p className="truncate text-xs text-muted">{me.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link to="/learn">
            <GraduationCap /> My learning
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link to="/wishlist">
            <Heart /> Wishlist
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link to="/account/orders">
            <ReceiptText /> Purchase history
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link to="/plans">
            <Sparkles /> Subscriptions
          </Link>
        </MenuItem>
        {manages.map((m) => (
          <MenuItem key={m.org_id} onSelect={() => (switchTo(m.org_id), navigate('/business'))}>
            <LayoutDashboard /> <span className="truncate">{m.name} dashboard</span>
          </MenuItem>
        ))}
        {me.is_instructor ? (
          <MenuItem asChild>
            <Link to="/studio">
              <PenTool /> Instructor studio
            </Link>
          </MenuItem>
        ) : (
          <MenuItem asChild>
            <Link to="/teach">
              <PenTool /> {me.instructor_status === 'pending' ? 'Application pending' : 'Teach on LearnHub'}
            </Link>
          </MenuItem>
        )}
        {me.is_staff ? (
          <MenuItem asChild>
            <Link to="/console">
              <Shield /> Admin console
            </Link>
          </MenuItem>
        ) : null}
        {memberships.length ? (
          <>
            <MenuSeparator />
            <MenuLabel>Learning as</MenuLabel>
            <MenuItem onSelect={() => (switchTo(null), org && toast.success('Now learning as yourself'))}>
              <User /> Personal {!org ? <Check className="ml-auto !text-primary" /> : null}
            </MenuItem>
            {memberships.map((m) => (
              <MenuItem key={m.org_id} onSelect={() => (switchTo(m.org_id), org?.org_id !== m.org_id && toast.success(`Now learning as ${m.name}`))}>
                <Building2 /> <span className="truncate">{m.name}</span>
                {org?.org_id === m.org_id ? <Check className="ml-auto !text-primary" /> : null}
              </MenuItem>
            ))}
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem onSelect={() => logout.mutate(undefined, { onSettled: () => navigate('/') })}>
          <LogOut /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
