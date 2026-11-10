import { Megaphone, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { useLogout, useMe } from '@/features/identity/auth'
import { usePublicSettings, useSiteBanner } from '@/features/platform/api'
import { setDatePrefs } from '@/lib/format'
import { Link } from '@/lib/router'

// Pages a visitor can open while guest browsing is off are sign-in pages only; the
// catalogue sends them to log in (the API refuses it too).
const CATALOGUE = [/^\/$/, /^\/courses(\/|$)/, /^\/plans$/]
const AUTH_PAGES = /^\/(login|signup|account\/(verify-email|password|provider))/

/** Uses the platform name in every browser tab title (pages write "… · LearnHub"; a
 * renamed platform replaces it) and the uploaded favicon. */
function useBranding(name: string, favicon: string) {
  useEffect(() => {
    if (name === 'LearnHub') return
    const swap = () => {
      if (document.title.includes('LearnHub')) document.title = document.title.replaceAll('LearnHub', name)
    }
    swap()
    const title = document.querySelector('title')
    if (!title) return
    const mo = new MutationObserver(swap)
    mo.observe(title, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [name])
  useEffect(() => {
    if (!favicon) return
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) link = Object.assign(document.createElement('link'), { rel: 'icon' })
    link.href = favicon
    document.head.appendChild(link)
  }, [favicon])
}

function MaintenancePage({ message, signedIn }: { message: string; signedIn: boolean }) {
  const logout = useLogout()
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg px-4">
      <Backdrop variant="circuit" />
      <div className="relative w-full max-w-md animate-reveal rounded-2xl border border-border bg-surface p-6 text-center shadow-lg sm:p-8">
        <Logo className="justify-center" />
        <span className="mx-auto mt-6 grid size-14 place-items-center rounded-full bg-warning-soft text-warning">
          <Wrench className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">We'll be back soon</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          {signedIn ? (
            <Button variant="secondary" loading={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/login">Staff sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}

/** An announcement shown across the site (console > Communications > Announcements). */
function SiteBanner() {
  const { data } = useSiteBanner()
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('banner-hidden')
    } catch {
      return null
    }
  })
  if (!data || hidden === data.id) return null
  return (
    <div role="region" aria-label="Announcement" className="relative z-50 animate-reveal bg-primary text-on-primary">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2 text-sm sm:items-center">
        <Megaphone className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{data.title}</span> <span className="opacity-90">{data.body}</span>{' '}
          {data.url ? (
            <Link to={data.url} className="font-medium underline underline-offset-2">
              Find out more
            </Link>
          ) : null}
        </p>
        <button
          type="button"
          aria-label="Hide announcement"
          className="rounded p-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
          onClick={() => {
            setHidden(data.id)
            try {
              sessionStorage.setItem('banner-hidden', data.id)
            } catch {
              /* private mode: hide for this page view only */
            }
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * The root of every page: applies the console's platform settings in the browser
 * (name, favicon, banner) and its switches (maintenance page for everyone but staff;
 * catalogue needs sign-in when guest browsing is off). The API enforces both too.
 */
export function SiteRoot() {
  const { settings } = usePublicSettings()
  const { data: me, isLoading } = useMe()
  const { pathname, search } = useLocation()
  useBranding(settings['general.platform_name'], settings['general.favicon_url'])
  // date format, time zone and language for every page (set during render so the first paint uses them)
  setDatePrefs(settings['general.date_format'], settings['general.time_zone'])
  const lang = settings['general.default_language']
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en-GB' : lang
  }, [lang])

  if (settings['access.maintenance_mode'] && !me?.is_staff && !isLoading && !AUTH_PAGES.test(pathname)) {
    return <MaintenancePage message={settings['access.maintenance_message']} signedIn={!!me} />
  }
  if (!settings['access.guest_browsing'] && !isLoading && !me && CATALOGUE.some((r) => r.test(pathname))) {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
  }
  return (
    <>
      <SiteBanner />
      <Outlet />
    </>
  )
}
