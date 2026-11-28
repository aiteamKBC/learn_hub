import { Menu as MenuIcon, Search, type LucideIcon } from 'lucide-react'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { type BackdropVariant } from '@/components/art/backdrops'
import { DashboardBackdrop } from '@/components/art/dashboard-backdrop'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/ui/logo'
import { cn } from '@/lib/cn'
import { Link, NavLink, useNavigate } from '@/lib/router'

import { AuthenticatedHeaderMenu } from './AuthenticatedHeaderMenu'

export type NavItem = { to: string; label: string; Icon: LucideIcon; end?: boolean; badge?: ReactNode }
export type NavSection = { title?: string; items: NavItem[] }

function SideNav({ sections, area, sidebarTop, onNavigate }: { sections: NavSection[]; area: string; sidebarTop?: ReactNode; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-nav text-nav-text">
      {sidebarTop ? (
        <div className="px-3 pt-3 pb-1">{sidebarTop}</div>
      ) : (
        <p className="mx-5 mt-2.5 mb-1 inline-flex w-fit rounded-full bg-white/8 px-2.5 py-0.5 text-[10.5px] font-medium tracking-wide text-nav-text uppercase">{area}</p>
      )}
      <nav data-lenis-prevent className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-1.5" aria-label={area}>
        {sections.map((s, i) => (
          <div key={i} className="mt-1 first:mt-0.5">
            {s.title ? <p className="px-3 pb-0.5 text-[10px] font-medium tracking-wider text-nav-text-muted uppercase">{s.title}</p> : null}
            <ul className="grid">
              {s.items.map(({ to, label, Icon, end, badge }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'relative flex h-7 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors',
                        isActive
                          ? "bg-nav-active text-nav-text-active before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-nav-active-bar before:content-['']"
                          : 'hover:bg-nav-hover hover:text-white',
                      )
                    }
                  >
                    <Icon className="size-[17px]" strokeWidth={1.9} />
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

/** Instructor, business and admin areas: full-height navy sidebar on desktop, hamburger drawer
 * on phones. `topBar` is an optional marketplace row for the content column; the sidebar always
 * owns the full left edge from the top of the viewport. */
export function WorkspaceLayout({ area, sections, header, search, topBar, sidebarTop, centerHeader = false, style }: { area: string; sections: NavSection[]; header?: ReactNode; art?: BackdropVariant; search?: WorkspaceSearch; topBar?: ReactNode; sidebarTop?: ReactNode; centerHeader?: boolean; style?: CSSProperties }) {
  const [open, setOpen] = useState(false)
  const hasTop = !!topBar
  const headerContent = header ?? (search ? <HeaderSearch {...search} /> : null)
  // With a top bar the controls move to the marketplace nav; if there's no search/header
  // either, the header has only the mobile hamburger left, so it hides on desktop.
  const headerEmptyOnDesktop = hasTop && !headerContent

  const body = (
    <>
      <div className="hidden bg-nav lg:block">
        <aside className="vt-sidebar sticky top-0 flex h-dvh flex-col">
          <div className="flex h-16 shrink-0 items-center border-b border-white/10 bg-nav px-5">
            <Link to="/" aria-label="Home">
              <Logo />
            </Link>
          </div>
          <div className="min-h-0 flex-1">
            <SideNav sections={sections} area={area} sidebarTop={sidebarTop} />
          </div>
        </aside>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`${area} menu`} side="left" className="border-none bg-nav p-0 [&>div:first-child]:hidden [&>div:last-child]:h-full">
          {/* the drawer renders in a portal, outside the root above: carry the branding over */}
          <div className="flex h-full flex-col" style={style}>
            <div className="flex h-16 shrink-0 items-center border-b border-white/10 bg-nav px-5">
              <Link to="/" aria-label="Home" onClick={() => setOpen(false)}>
                <Logo />
              </Link>
            </div>
            <div className="min-h-0 flex-1">
              <SideNav sections={sections} area={area} sidebarTop={sidebarTop} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className={cn('relative isolate flex min-h-dvh min-w-0 flex-col', hasTop && 'lg:pt-16')}>
        <DashboardBackdrop className="animate-fade-in" />
        {/* With a top bar, the signed-in controls already live in its three-line account menu.
            This header then stays only where it is needed for the sidebar or local search. */}
        <header className={cn('vt-header relative sticky z-30 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-6', hasTop ? 'top-16' : 'top-0', headerEmptyOnDesktop && 'lg:hidden')}>
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <div
            className={cn(
              'hidden min-w-0 max-w-2xl flex-1 sm:block',
              centerHeader && 'sm:absolute sm:left-1/2 sm:w-[calc(100%_-_20rem)] sm:max-w-md sm:-translate-x-1/2',
            )}
          >
            {headerContent}
          </div>
          {hasTop ? null : (
            <div className="ml-auto flex items-center gap-1">
              <AuthenticatedHeaderMenu />
            </div>
          )}
        </header>
        <main id="main" className="relative mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </>
  )

  if (hasTop) {
    return (
      <div className="min-h-dvh" style={style}>
        <div className="lg:fixed lg:top-0 lg:right-0 lg:left-[272px] lg:z-40">{topBar}</div>
        <div className="lg:grid lg:grid-cols-[272px_1fr]">{body}</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_1fr]" style={style}>
      {body}
    </div>
  )
}
