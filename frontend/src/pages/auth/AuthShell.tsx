import type { ReactNode } from 'react'

import { AuthBand, AuthShowcase } from '@/components/art/auth-showcase'
import { Logo } from '@/components/ui/logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

/** Sign-in pages: a calm, focused form on the left; the product showcase on the right
 * (desktop). On phones a slim strip of the same artwork sits above the form.
 * `gridClassName` overrides the desktop column split (default ~1fr / 620px). */
export function AuthShell({ title, subtitle, eyebrow, gridClassName = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)]', children }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: string; gridClassName?: string; children: ReactNode }) {
  return (
    <div className={cn('grid min-h-dvh bg-surface', gridClassName)}>
      <div className="relative flex flex-col">
        <div aria-hidden className="h-24 overflow-hidden lg:hidden">
          <AuthBand />
        </div>
        {/* form side: a warm cream wash with soft flowing contour waves, never a flat colour */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#fbf2e7] via-[#fdf8f1] to-[#f6e6d4] dark:hidden" />
          <svg className="absolute inset-0 size-full text-primary" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
            <g stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.16">
              <path d="M-60 90 C 150 30, 320 160, 680 70" />
              <path d="M-60 140 C 160 85, 330 215, 680 120" />
              <path d="M-60 190 C 170 135, 340 265, 680 170" />
              <path d="M-60 245 C 180 195, 350 315, 680 225" />
              <path d="M-60 690 C 160 630, 330 775, 680 670" />
              <path d="M-60 745 C 170 690, 340 830, 680 725" />
              <path d="M-60 800 C 180 750, 350 885, 680 780" />
              <path d="M-60 855 C 190 810, 360 935, 680 835" />
            </g>
          </svg>
          <div className="absolute -bottom-40 -left-24 size-[520px] rounded-full bg-[radial-gradient(closest-side,var(--primary-soft),transparent)] opacity-90" />
          <div className="absolute -top-36 right-0 size-[380px] rounded-full bg-[radial-gradient(closest-side,var(--primary-soft),transparent)] opacity-60" />
        </div>
        <div className="relative flex items-center justify-between px-5 pt-5 sm:px-10 sm:pt-8">
          <Link to="/" aria-label="LearnHub home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <main id="main" className="relative mx-auto flex w-full max-w-[400px] flex-1 animate-rise flex-col justify-center px-5 py-10 sm:px-0">
          {eyebrow ? (
            <p className="mb-4 flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> {eyebrow}
            </p>
          ) : null}
          <h1 className={eyebrow ? 'text-[clamp(34px,6vw,46px)] leading-[1.05] font-bold tracking-tight' : 'text-[30px] leading-tight font-bold tracking-tight'}>{title}</h1>
          {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </main>
        <p className="relative px-5 pb-6 text-center text-xs text-subtle sm:px-10">Protected by secure sign-in. We never share your email.</p>
      </div>
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <AuthShowcase />
      </aside>
    </div>
  )
}
