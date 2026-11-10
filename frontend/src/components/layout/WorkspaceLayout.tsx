import { Menu as MenuIcon, Search, type LucideIcon } from 'lucide-react'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { Backdrop, type BackdropVariant } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/ui/logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/cn'
import { usePageArt } from '@/lib/page-art'
import { Link, NavLink, useNavigate } from '@/lib/router'

import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'

export type NavItem = { to: string; label: string; Icon: LucideIcon; end?: boolean; badge?: ReactNode }
export type NavSection = { title?: string; items: NavItem[] }

function SideNav({ sections, area, onNavigate }: { sections: NavSection[]; area: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-nav text-nav-text">
      <div className="flex h-16 items-center gap-3 px-5">
        <Link to="/" onClick={onNavigate}>
          <Logo inverted />
        </Link>
      </div>
      <p className="mx-5 mb-2 inline-flex w-fit rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-medium tracking-wide text-nav-text uppercase">{area}</p>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label={area}>
        {sections.map((s, i) => (
          <div key={i} className="mt-4 first:mt-2">
            {s.title ? <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wider text-nav-text/60 uppercase">{s.title}</p> : null}
            <ul className="grid gap-0.5">
              {s.items.map(({ to, label, Icon, end, badge }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        isActive ? 'bg-nav-active text-nav-text-active shadow-sm' : 'hover:bg-nav-hover hover:text-white',
                      )
                    }
                  >
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                    <span className="flex-1 truncate">{label}</span>
                    {badge}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}

/** Header search: submitting goes to the area's own search page (e.g. people). */
function HeaderSearch({ placeholder, to }: { placeholder: string; to: (q: string) => string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim()) navigate(to(q.trim()))
      }}
    >
      <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="bg-surface-2/60" />
    </form>
  )
}

export type WorkspaceSearch = { placeholder: string; to: (q: string) => string }

/** Instructor, business and admin areas: navy sidebar on desktop, hamburger drawer on
 * phones (approved navigation decision). `art` is the area's default artwork; a page can
 * choose its own with `handle: { art }` in its route. */
export function WorkspaceLayout({ area, sections, header, art: areaArt, search, style }: { area: string; sections: NavSection[]; header?: ReactNode; art: BackdropVariant; search?: WorkspaceSearch; style?: CSSProperties }) {
  const [open, setOpen] = useState(false)
  const art = usePageArt(areaArt)

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]" style={style}>
      <div className="hidden bg-nav lg:block">
        <aside className="vt-sidebar sticky top-0 h-dvh">
          <SideNav sections={sections} area={area} />
        </aside>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`${area} menu`} side="left" className="border-none bg-nav p-0 [&>div:first-child]:hidden [&>div:last-child]:h-full">
          {/* the drawer renders in a portal, outside the root above: carry the branding over */}
          <div className="h-full" style={style}>
            <SideNav sections={sections} area={area} onNavigate={() => setOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative isolate flex min-w-0 flex-col">
        <Backdrop key={art} variant={art} height={460} className="animate-fade-in" />
        <header className="vt-header sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <div className="hidden min-w-0 max-w-sm flex-1 sm:block">{header ?? (search ? <HeaderSearch {...search} /> : null)}</div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="relative mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
