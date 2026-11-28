import { type Bundle, useBundles } from '@/features/corporate/api'
import { BuyBundle } from '@/features/corporate/BasketDialog'
import { useIsOrgAdmin } from '@/features/org/api'
import { useMe } from '@/features/identity/auth'
import { DeliveryTabs } from '@/features/catalog/DeliveryTabs'
import { ArrowRight, ArrowUpRight, Briefcase, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Code2, HeartPulse, Megaphone, Palette, PlayCircle, Server, ShieldCheck, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useLocation } from 'react-router-dom'

import heroEagle from '@/assets/brand/hero-eagle-dashboard.png'
import heroSectionMobile from '@/assets/brand/section-dashboard.png'
import { BlurText } from '@/components/art/blur-text'
import { HeroIntro } from '@/components/home/HeroIntro'
import { Button } from '@/components/ui/button'
import { CountUp } from '@/components/ui/count-up'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { StarBorder } from '@/components/ui/star-border'
import { type CourseCardData, useCategories, useCourses, usePlans } from '@/features/catalog/api'
import { cn } from '@/lib/cn'
import { duration, money } from '@/lib/format'
import { reducedMotion } from '@/lib/motion'
import { scrollToAnchor } from '@/lib/smooth-scroll'
import { Link } from '@/lib/router'

const categoryIcons: Record<string, LucideIcon> = { code: Code2, briefcase: Briefcase, palette: Palette, server: Server, 'shield-check': ShieldCheck, 'heart-pulse': HeartPulse, megaphone: Megaphone }

/**
 * Shared section eyebrow: the bordered "pill" badge with a star, used for every
 * section label so they read as one family. `text-text` adapts to light/dark;
 * pass `className="text-white"` on always-dark sections.
 */
function SectionEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 font-mono text-[11px] font-medium tracking-[0.22em] text-text uppercase', className)}>
      <span className="size-1.5 rounded-full bg-primary" aria-hidden /> {children}
    </span>
  )
}

/** Evidrise-style full-bleed hero. Custom LearnHub artwork supplied by the user. */
const HERO_SRC = heroEagle
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const NOTEWORTHY_BG =
  'https://readdy.ai/api/search-image?query=Abstract%20layered%20paper%20ridges%20in%20warm%20sand%20cream%20and%20soft%20clay%20tones%20flowing%20like%20rolling%20dunes%2C%20gentle%20side%20light%20creating%20calm%20shadows%2C%20minimal%20editorial%20art%20direction%20with%20airy%20negative%20space%20and%20smooth%20gradient%20transitions&width=1600&height=900&seq=newnoteworthy-bg-2026-c3&orientation=landscape'
const FEATURED_BG = NOTEWORTHY_BG

function Hero() {
  const [ready, setReady] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 80)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <section id="hero" aria-label="LearnHub" className="relative -mt-[calc(4rem+1px)] w-full overflow-hidden bg-[#1f262e] lg:h-[calc(100svh+1px)] lg:min-h-[600px]">
      {/* Desktop (lg+): full-bleed artwork with the copy overlaid to the left. */}
      <picture>
        {/* A media source prevents phones from downloading the 2 MB desktop artwork. */}
        <source media="(min-width: 1024px)" srcSet={HERO_SRC} />
        <img
          src={TRANSPARENT_PIXEL}
          width={1717}
          height={916}
          alt=""
          fetchPriority="high"
          decoding="async"
          // Soften the outer edges into the charcoal background so the artwork blends in rather
          // than reading as a boxed rectangle; the subject (centre-right) stays fully crisp.
          style={{
            WebkitMaskImage: 'radial-gradient(135% 130% at 60% 45%, #000 72%, transparent 100%)',
            maskImage: 'radial-gradient(135% 130% at 60% 45%, #000 72%, transparent 100%)',
          }}
          className={cn('absolute inset-0 hidden h-full w-full object-cover object-center transition-opacity duration-[650ms] ease-out lg:block', ready ? 'opacity-100' : 'opacity-0')}
        />
      </picture>
      {/* Charcoal veil that deepens behind the copy and clears to the right so the artwork stays visible. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(31,38,46,0.86)_0%,rgba(31,38,46,0.6)_26%,rgba(31,38,46,0.12)_54%,transparent_76%)] lg:block" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-1/3 bg-[linear-gradient(to_top,rgba(31,38,46,0.72),transparent)] lg:block" />

      <div className="absolute inset-0 z-10 hidden flex-col justify-center px-10 py-12 lg:flex lg:px-42 lg:py-16">
        <div className="stagger w-full max-w-[620px]">
          <SectionEyebrow className="text-white">LearnHub</SectionEyebrow>
          <h1 className="mt-4 text-[clamp(44px,5.4vw,60px)] leading-[1.1] font-bold tracking-tight text-white">
            <BlurText text="Learn without limits," className="block" />
            <BlurText text="built for real work." delay={0.35} className="block font-semibold text-primary" />
          </h1>
          <p className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-white/80">High-quality courses from industry experts, with certificates your whole team can keep up with. Buy what you need, or subscribe for everything.</p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <StarBorder>
              <Button size="lg" className="min-w-[9.5rem] rounded-full" asChild>
                <Link to="/courses">View courses</Link>
              </Button>
            </StarBorder>
            <Button size="lg" className="min-w-[9.5rem] rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => setVideoOpen(true)}>
              <PlayCircle className="size-4 text-primary" /> Watch video
            </Button>
          </div>
          <p className="mt-5 font-mono text-[9.5px] tracking-[0.2em] text-white/55 uppercase">12,400 learners · CPD certificates · Compliance training for teams</p>
        </div>
      </div>

      {/* Mobile + tablet (below lg): ONE continuous charcoal scene — no seam, no overlay.
          The wrapper owns a single background matched to the artwork's own dark top
          (#1a222b, sampled from section.png) so the copy area and the illustration share
          the exact same tone and there is no visible boundary between them. The artwork is
          cropped to its lower portion (object-bottom) so the eagle sits just beneath the
          buttons with no dead gap, and no element below introduces its own opaque background. */}
      <div className="relative flex flex-col bg-[#1a222b] lg:hidden">
        <div className="flex flex-col items-center px-5 pt-8 text-center sm:px-6">
          <div className="stagger flex w-full max-w-md flex-col items-center">
            <SectionEyebrow className="text-white">LearnHub</SectionEyebrow>
            <h1 className="mt-4 text-[clamp(30px,7.5vw,44px)] leading-[1.12] font-bold tracking-tight text-white">
              <BlurText text="Learn without limits," className="block" />
              <BlurText text="built for real work." delay={0.35} className="block font-semibold text-primary" />
            </h1>
            <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-white/80">High-quality courses from industry experts, with certificates your whole team can keep up with. Buy what you need, or subscribe for everything.</p>
            <div className="mt-7 flex w-full max-w-xs flex-col gap-3">
              <Button size="lg" className="w-full rounded-full" asChild>
                <Link to="/courses">View courses</Link>
              </Button>
              <Button size="lg" className="w-full rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => setVideoOpen(true)}>
                <PlayCircle className="size-4 text-primary" /> Watch video
              </Button>
            </div>
          </div>
        </div>
        {/* aspect-[941/905] crops the image to its lower region (a little dark headroom above
            the eagle, then the eagle onward); object-bottom anchors it. The wrapper bg equals
            the image's dark, and a short top mask-fade (24px) melts the crop edge into it so any
            faint tone drift at the top-right of the artwork can't read as a seam. The fade sits
            in the dark headroom above the eagle, so the bird/laptop stay fully opaque. */}
        <div className="relative mt-1 w-full overflow-hidden aspect-[941/905] [mask-image:linear-gradient(to_bottom,transparent_0,#000_24px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,#000_24px)]">
          <picture>
            {/* Desktop receives only the tiny fallback instead of this 1.5 MB phone image. */}
            <source media="(max-width: 1023px)" srcSet={heroSectionMobile} />
            <img
              src={TRANSPARENT_PIXEL}
              width={941}
              height={1672}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-bottom"
            />
          </picture>
        </div>
      </div>

      {/* Shared intro clip, opened by either "Watch video" button. */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent title="Watch the LearnHub intro" description="A short look at how LearnHub works." className="max-w-3xl">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video src="https://ik.imagekit.io/bmjbddbgyi/evidrise-reveal-v6.mp4?tr=orig-true" controls autoPlay playsInline className="aspect-video w-full" preload="metadata">
              Your browser cannot play this video.
            </video>
            {/* 40% charcoal shade over the clip. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(31,38,46,0.4)]" />
          </div>
        </DialogContent>
      </Dialog>

      <a href="#categories" aria-label="Scroll to categories" className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/70 transition-colors hover:text-white lg:flex">
        <span className="h-9 w-px bg-white/40" aria-hidden />
        <span className="font-mono text-[9px] tracking-[0.3em] uppercase">Scroll</span>
      </a>
    </section>
  )
}

const categoryNotes: Record<string, string> = {
  development: 'Build and ship real software',
  business: 'Skills that move the needle',
  design: 'Craft that users notice',
  'it-software': 'Systems that stay up',
  'health-safety': 'Keep your workplace safe',
  'care-compliance': 'Training that keeps you compliant',
  marketing: 'Reach the right people',
}

type Category = NonNullable<ReturnType<typeof useCategories>['data']>[number]

/** One category card: icon, name and a one-line note, linking to its filtered catalogue. */
function CategoryCard({ c }: { c: Category }) {
  const Icon = categoryIcons[c.icon] ?? Sparkles
  return (
    <Link to={`/courses?category=${c.slug}`} className="group relative flex h-full flex-col rounded-2xl border border-border bg-gradient-to-br from-surface to-primary-soft/40 p-6 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-6 text-lg font-semibold tracking-tight text-text">{c.name}</h3>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className="text-sm text-muted">{categoryNotes[c.slug] ?? 'Explore this track'}</p>
        <ArrowUpRight className="size-4 shrink-0 text-subtle transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </Link>
  )
}

/**
 * Horizontal category carousel: a scroll-snap track (three cards on desktop, two on tablet,
 * one-plus-a-peek on phones) that you swipe, or step through with the side arrows and the
 * page dots. Motion is user-triggered only and drops to an instant jump under reduced motion.
 */
function CategoryCarousel({ items }: { items: Category[] }) {
  const track = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number; page: number } | null>(null)
  const [page, setPage] = useState(0)
  const [stops, setStops] = useState([0])
  const pages = stops.length

  useEffect(() => {
    const el = track.current
    if (!el) return
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth
      const left = el.getBoundingClientRect().left
      const nextStops = max <= 1
        ? [0]
        : Array.from(el.children, (child) => {
            const x = (child as HTMLElement).getBoundingClientRect().left - left + el.scrollLeft
            return Math.round(Math.min(max, Math.max(0, x)))
          }).filter((x, i, all) => i === 0 || Math.abs(x - all[i - 1]!) > 2)
      setStops((current) => current.length === nextStops.length && current.every((x, i) => x === nextStops[i]) ? current : nextStops)
      let nearest = 0
      for (let i = 1; i < nextStops.length; i += 1) {
        if (Math.abs(nextStops[i]! - el.scrollLeft) < Math.abs(nextStops[nearest]! - el.scrollLeft)) nearest = i
      }
      setPage(nearest)
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [items])

  const goTo = (i: number) => {
    const el = track.current
    if (!el) return
    const next = Math.min(pages - 1, Math.max(0, i))
    el.scrollTo({ left: stops[next] ?? 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0]
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY, page }
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current
    const touch = e.changedTouches[0]
    touchStart.current = null
    if (!start || !touch) return
    const dx = start.x - touch.clientX
    const dy = start.y - touch.clientY
    if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) goTo(start.page + (dx > 0 ? 1 : -1))
  }

  return (
    <div className="mt-10">
      {/* Arrows live in this row so top-1/2 centres them on the cards, not the dots below. */}
      <div className="relative sm:px-16">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page === 0}
          aria-label="Previous categories"
          className="absolute top-1/2 left-0 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-md transition-all duration-200 hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-40 sm:flex"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Next categories"
          className="absolute top-1/2 right-0 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-md transition-all duration-200 hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-40 sm:flex"
        >
          <ChevronRight className="size-5" />
        </button>

        <div
          ref={track}
          role="group"
          aria-roledescription="carousel"
          aria-label="Course categories"
          tabIndex={0}
          data-lenis-prevent
          data-lenis-prevent-touch
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="flex touch-pan-x snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-scrollbar]:hidden"
        >
          {items.map((c) => (
            <div key={c.id} className="shrink-0 basis-[82%] snap-start sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]">
              <CategoryCard c={c} />
            </div>
          ))}
        </div>
      </div>

      {pages > 1 ? (
        <div className="mt-6 flex justify-center gap-1">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to page ${i + 1} of ${pages}`}
              aria-current={i === page}
              className="group grid place-items-center p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className={cn('h-2 rounded-full transition-all duration-300 ease-out', i === page ? 'w-6 bg-primary' : 'w-2 bg-primary/25 group-hover:bg-primary/50')} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Evidrise-style "Browse by category": editorial header + large cards + decorative rings. */
function CategorySection() {
  const { data, error, isLoading, refetch } = useCategories()
  return (
    <section id="categories" className="relative scroll-mt-20 overflow-hidden bg-surface-2">
      {/* decorative concentric rings, top-right */}
      <svg aria-hidden className="pointer-events-none absolute -top-24 right-[-10%] h-[520px] w-[520px] text-primary/15" viewBox="0 0 520 520" fill="none">
        {[80, 140, 200, 258].map((r) => (
          <circle key={r} cx="320" cy="200" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
      </svg>
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <SectionEyebrow>Browse by category</SectionEyebrow>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Every discipline, one way of <span className="text-primary">learning.</span>
            </h2>
            <p className="mt-4 text-muted">Find the right track for where you want to go: real skills, assessed and certified.</p>
          </div>
          <Button variant="secondary" size="lg" asChild className="shrink-0 rounded-full border-primary/40">
            <Link to="/courses" state={{ returnTo: '/#categories' }}>
              All courses <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        {error && !data ? (
          <div className="mt-10 rounded-2xl border border-border bg-surface/80">
            <ErrorState message={error.message} onRetry={() => void refetch()} />
          </div>
        ) : isLoading || !data ? (
          <div className="mt-10 flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-40 shrink-0 basis-[82%] rounded-2xl sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]" />
            ))}
          </div>
        ) : (
          <CategoryCarousel items={data} />
        )}
      </div>
    </section>
  )
}

const MEMBERSHIP_FEATURES = {
  explorer: ['Three starter courses', 'Weekly learning digest', 'Community reading room', 'Progress tracking'],
  practitioner: ['Every course and programme', 'Graded capstone projects', 'Verified certificates', 'Live critique sessions', 'Downloadable evidence packs'],
  teams: ['Everything in Practitioner', 'Seat management and SSO', 'Team progress analytics', 'Private cohort pathways', 'Dedicated success lead'],
}

/** Evidrise-style membership section (dark). Real plan prices; annual figure is monthly × 12. */
/** Personal plans: not shown to company members (employers and their employees), who
 * get courses through seats their company buys. */
function useIsCompanyMember() {
  return !!useMe().data?.memberships.length
}

function Membership() {
  const company = useIsCompanyMember()
  const { data, isLoading } = usePlans()
  const personal = data?.find((p) => p.audience === 'personal')
  const [yearly, setYearly] = useState(true)

  const practitioner = personal
    ? yearly
      ? { price: money(personal.amount_minor * 12, personal.currency, personal.exponent), unit: '/year', note: 'billed annually' }
      : { price: money(personal.amount_minor, personal.currency, personal.exponent), unit: '/month', note: personal.trial_days ? `${personal.trial_days}-day free trial` : 'billed monthly' }
    : null
  const tiers = [
    { name: 'Explorer', tagline: 'For getting your bearings.', price: 'Free', unit: '', note: '', features: MEMBERSHIP_FEATURES.explorer, cta: 'Start free', to: '/signup', featured: false, badge: '' },
    { name: 'Practitioner', tagline: 'For the work you are doing now.', price: practitioner?.price, unit: practitioner?.unit, note: practitioner?.note, features: MEMBERSHIP_FEATURES.practitioner, cta: 'Choose Practitioner', to: '/plans', featured: true, badge: 'Most chosen' },
  ]

  if (company) return null
  return (
    <section id="membership" className="relative scroll-mt-20 overflow-hidden text-white">
      <img src={FEATURED_PHOTOS[5]} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-40" />
      <div aria-hidden className="absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <SectionEyebrow>Membership</SectionEyebrow>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] text-text leading-[1.05] font-bold tracking-tight">
              One membership, every <span className="text-primary">course.</span>
            </h2>
            <p className="mt-4 text-primary-soft-text">Start free. Move up when you want the graded work, the critique sessions and the certificate.</p>
          </div>
          {/* Mobile: a compact dropdown with a chevron. Desktop keeps the sliding toggle. */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" className="shrink-0 rounded-full capitalize md:hidden">
                {yearly ? 'Yearly' : 'Monthly'} <ChevronDown className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent className="min-w-[8rem]">
              <MenuItem onSelect={() => setYearly(false)}>Monthly</MenuItem>
              <MenuItem onSelect={() => setYearly(true)}>Yearly</MenuItem>
            </MenuContent>
          </Menu>
          <div role="group" aria-label="Billing period" className="relative hidden shrink-0 rounded-full border border-border bg-surface/85 p-1 text-sm shadow-sm backdrop-blur-sm md:inline-flex">
            {/* Sliding highlight: moves between the two slots, honouring reduced motion via the global setting. */}
            <span aria-hidden className={cn('pointer-events-none absolute top-1 bottom-1 left-1 w-24 rounded-full bg-primary shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out motion-reduce:transition-none', yearly && 'translate-x-full')} />
            {[
              { k: false, label: 'monthly' },
              { k: true, label: 'yearly' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setYearly(o.k)}
                aria-pressed={yearly === o.k}
                className={cn('relative z-10 w-24 rounded-full px-4 py-1.5 text-center font-medium transition-colors duration-200', yearly === o.k ? 'text-on-primary' : 'text-muted hover:text-text')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          {tiers.map((t) => (
            <article key={t.name} className={cn('relative flex flex-col rounded-2xl p-6 shadow-lg transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0', t.featured ? 'bg-[#2a333c] ring-1 ring-primary/50 hover:ring-primary/70' : 'border border-border bg-surface text-text')}>
              {t.badge ? <span className="absolute top-5 right-5 rounded-full bg-primary px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-on-primary uppercase">{t.badge}</span> : null}
              <h3 className={cn('text-base font-semibold', t.featured ? 'text-white' : 'text-text')}>{t.name}</h3>
              <p className={cn('mt-1 text-sm', t.featured ? 'text-white/60' : 'text-muted')}>{t.tagline}</p>
              <p className={cn('mt-5 text-4xl font-bold tracking-tight tabular', t.featured ? 'text-white' : 'text-text')}>
                {t.price ?? (isLoading ? <Skeleton className="h-9 w-24" /> : '—')}
                {t.unit ? <span className={cn('ml-1.5 text-sm font-normal', t.featured ? 'text-white/55' : 'text-muted')}>{t.unit}</span> : null}
              </p>
              {t.note ? <p className={cn('mt-1 text-[12.5px]', t.featured ? 'text-white/55' : 'text-subtle')}>{t.note}</p> : null}
              <ul className="mt-5 grid flex-1 gap-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className={cn('flex items-center gap-2', t.featured ? 'text-white/85' : 'text-text')}>
                    <CheckCircle2 className="size-4 shrink-0 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Button className={cn('mt-6 w-full rounded-full', !t.featured && 'border border-border bg-transparent text-text hover:bg-surface-2')} variant={t.featured ? 'primary' : 'secondary'} asChild>
                <Link to={t.to}>
                  {t.cta} <ArrowRight className="size-4" />
                </Link>
              </Button>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Initials for an avatar, e.g. "Dr. Amira Haddad" -> "AH". */
function initials(name: string) {
  return name
    .replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Instructor portrait photos — PLACEHOLDER imagery (see docs/NEEDS-USER.md). */
const INSTRUCTOR_PHOTOS = [
  'https://readdy.ai/api/search-image?query=Portrait%20of%20a%20confident%20woman%20in%20her%20forties%20with%20short%20natural%20hair%20wearing%20a%20dark%20navy%20blazer%2C%20warm%20cream%20studio%20background%2C%20soft%20editorial%20lighting%2C%20professional%20headshot%2C%20calm%20expression%2C%20premium%20corporate%20photography&width=600&height=750&seq=evidrise-faculty-01&orientation=portrait',
  'https://readdy.ai/api/search-image?query=Portrait%20of%20a%20thoughtful%20man%20in%20his%20fifties%20with%20silver%20hair%20and%20glasses%20wearing%20a%20charcoal%20knit%20sweater%2C%20warm%20cream%20studio%20background%2C%20soft%20editorial%20lighting%2C%20professional%20headshot%2C%20premium%20corporate%20photography&width=600&height=750&seq=evidrise-faculty-02&orientation=portrait',
  'https://readdy.ai/api/search-image?query=Portrait%20of%20a%20South%20Asian%20woman%20in%20her%20thirties%20with%20long%20dark%20hair%20wearing%20a%20sand%20colored%20blouse%2C%20warm%20cream%20studio%20background%2C%20soft%20editorial%20lighting%2C%20professional%20headshot%2C%20premium%20corporate%20photography&width=600&height=750&seq=evidrise-faculty-03&orientation=portrait',
  'https://readdy.ai/api/search-image?query=Portrait%20of%20a%20Black%20man%20in%20his%20thirties%20with%20a%20short%20beard%20wearing%20a%20light%20cream%20shirt%2C%20warm%20beige%20studio%20background%2C%20soft%20editorial%20lighting%2C%20professional%20headshot%2C%20premium%20corporate%20photography&width=600&height=750&seq=evidrise-faculty-04&orientation=portrait',
]

type Faculty = { name: string; specialty: string; courses: number; learners: number; photo: string }

function InstructorCard({ p }: { p: Faculty }) {
  return (
    <article data-card className="group">
      <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-2 shadow-sm">
        <img src={p.photo} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
      </div>
      <h3 className="mt-4 text-center text-[15px] font-semibold tracking-tight text-text">{p.name}</h3>
      <p className="mt-1 text-center text-[12.5px] text-muted">{p.specialty}</p>
      <p className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
        {p.courses} {p.courses === 1 ? 'course' : 'courses'} · {p.learners.toLocaleString()} learners
      </p>
    </article>
  )
}

/** Reduced-motion / fallback view: the original staggered 3-column arrangement. */
function InstructorGrid({ people }: { people: Faculty[] }) {
  const col1 = [people[0], people[3]].filter(Boolean)
  const centre = [people[2]].filter(Boolean)
  const col3 = [people[1], people[4]].filter(Boolean)
  return (
    <div className="grid gap-5 lg:grid-cols-3 lg:gap-7">
      <div className="flex flex-col gap-6">
        {col1.map((p) => (
          <InstructorCard key={p.name} p={p} />
        ))}
      </div>
      <div className="flex flex-col justify-center gap-6">
        {centre.map((p) => (
          <InstructorCard key={p.name} p={p} />
        ))}
      </div>
      <div className="flex flex-col gap-6">
        {col3.map((p) => (
          <InstructorCard key={p.name} p={p} />
        ))}
      </div>
    </div>
  )
}

type Slide = { key: string; label: string; content: ReactNode }

/**
 * Generic 3D cover-flow carousel. The active slide faces front and centre;
 * neighbours recede and rotate away in 3D. Navigate with the arrows, the dots,
 * arrow keys, a swipe, or by tapping a side slide. When `interactive` is set the
 * off-centre slides are made `inert` (so their own links/buttons stay out of the
 * tab order and can't be clicked by mistake) and a full-card tap target simply
 * brings them forward; the centred slide is live and fully usable. Callers fall
 * back to a plain grid under reduced motion.
 */
function Coverflow({
  slides,
  label,
  itemNoun,
  cardWidth,
  stageHeight,
  maxWidth = 'max-w-5xl',
  interactive = false,
  fill = false,
}: {
  slides: Slide[]
  label: string
  itemNoun: string
  cardWidth: string
  stageHeight: string
  maxWidth?: string
  interactive?: boolean
  fill?: boolean
}) {
  const count = slides.length
  const [active, setActive] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  // Track the stage width so card spacing scales with the available room (no fixed px breakpoints).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const go = (dir: number) => setActive((a) => (a + dir + count) % count)
  const gap = Math.max(Math.min(width * 0.25, 240), 100)
  // On phones the wide cards overlap and their captions collide, so show the centred card
  // only (neighbours fade out). Arrows and dots still move through every item.
  const maxVisible = width && width < 560 ? 0 : 2

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current && Math.abs(e.clientX - drag.current.x) > 8) drag.current.moved = true
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dx = e.clientX - d.x
    if (d.moved && Math.abs(dx) > 45) {
      suppressClick.current = true
      go(dx < 0 ? 1 : -1)
    } else {
      suppressClick.current = false
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) } else if (e.key === 'Home') { e.preventDefault(); setActive(0) } else if (e.key === 'End') { e.preventDefault(); setActive(count - 1) }
  }
  const bringForward = (i: number) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    setActive(i)
  }

  return (
    <div className={cn('mx-auto', maxWidth)}>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (drag.current = null)}
        className="relative touch-pan-y overflow-hidden rounded-3xl outline-none select-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div ref={stageRef} className={cn('relative [perspective:1400px]', stageHeight)}>
          <div className="absolute inset-0 [transform-style:preserve-3d]">
            {slides.map((s, i) => {
              let offset = i - active
              if (offset > count / 2) offset -= count
              if (offset < -count / 2) offset += count
              const abs = Math.abs(offset)
              const sign = Math.sign(offset)
              const hidden = abs > maxVisible
              const isActive = offset === 0
              return (
                <div
                  key={s.key}
                  aria-hidden={!isActive}
                  onClick={!interactive && !isActive ? () => bringForward(i) : undefined}
                  style={{
                    transform: `translateX(calc(-50% + ${offset * gap}px)) translateZ(${-abs * 170}px) rotateY(${-sign * 36}deg) scale(${Math.max(1 - abs * 0.12, 0.72)})`,
                    opacity: hidden ? 0 : 1 - abs * 0.22,
                    zIndex: 100 - abs,
                    pointerEvents: hidden ? 'none' : 'auto',
                  }}
                  className={cn(
                    'absolute top-0 left-1/2 transition-[transform,opacity] duration-500 ease-out will-change-transform motion-reduce:transition-none',
                    cardWidth,
                    fill && 'h-full',
                    isActive ? 'cursor-default' : 'cursor-pointer',
                  )}
                >
                  <div
                    inert={interactive && !isActive ? true : undefined}
                    className={cn('rounded-[20px] transition-shadow duration-500', fill && 'h-full', isActive && 'shadow-[0_28px_60px_-28px_rgba(31,38,46,0.55)]')}
                  >
                    {s.content}
                  </div>
                  {interactive && !isActive ? (
                    <button type="button" aria-label={`Show ${s.label}`} onClick={() => bringForward(i)} className="absolute inset-0 rounded-[20px]" />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Controls: arrows + position dots. */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button type="button" onClick={() => go(-1)} aria-label={`Previous ${itemNoun}`} className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-text shadow-sm transition-all duration-200 hover:border-primary/40 hover:text-primary active:scale-95 motion-reduce:transition-none">
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show ${s.label}`}
              aria-current={i === active}
              className={cn('h-2 rounded-full transition-all duration-300 motion-reduce:transition-none', i === active ? 'w-6 bg-primary' : 'w-2 bg-border hover:bg-primary/40')}
            />
          ))}
        </div>
        <button type="button" onClick={() => go(1)} aria-label={`Next ${itemNoun}`} className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-text shadow-sm transition-all duration-200 hover:border-primary/40 hover:text-primary active:scale-95 motion-reduce:transition-none">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {slides[active]?.label}, {itemNoun} {active + 1} of {count}
      </p>
    </div>
  )
}

/** Instructors, derived from the real course feed; portrait photos are placeholders. */
function Instructors() {
  const { data, isLoading } = useCourses({ limit: 50 })
  const people: Faculty[] = (() => {
    const map = new Map<string, { name: string; courses: number; learners: number; cats: Record<string, number> }>()
    for (const c of data?.items ?? []) {
      for (const name of c.instructors) {
        const e = map.get(name) ?? { name, courses: 0, learners: 0, cats: {} }
        e.courses += 1
        e.learners += c.student_count ?? 0
        if (c.category) e.cats[c.category] = (e.cats[c.category] ?? 0) + 1
        map.set(name, e)
      }
    }
    return [...map.values()]
      .sort((a, b) => b.learners - a.learners || b.courses - a.courses)
      .slice(0, 5)
      .map((p, i) => ({
        name: p.name,
        specialty: Object.entries(p.cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Course instructor',
        courses: p.courses,
        learners: p.learners,
        photo: INSTRUCTOR_PHOTOS[i % INSTRUCTOR_PHOTOS.length],
      }))
  })()

  if (isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
        ))}
      </div>
    )
  }

  if (people.length === 0) return null
  // The 3D cover-flow is the default; reduced motion keeps the calmer grid.
  if (reducedMotion()) return <InstructorGrid people={people} />
  return (
    <Coverflow
      label="Instructors"
      itemNoun="instructor"
      maxWidth="max-w-5xl"
      cardWidth="w-[264px] sm:w-[300px]"
      stageHeight="h-[452px] sm:h-[484px]"
      slides={people.map((p) => ({ key: p.name, label: p.name, content: <InstructorCard p={p} /> }))}
    />
  )
}

/** Bundles on sale, set up by the platform admin (Console > Bundles). Company members
 * buy them from Course packages; everyone else sees what is offered to companies. */
function BundleCard({ b, index, company }: { b: Bundle; index: number; company: boolean }) {
  const buyer = useIsOrgAdmin()
  const normal = b.courses.reduce((n, c) => n + (c.normal_price_minor ?? 0), 0) / Math.max(1, b.courses.length)
  const save = normal > b.seat_price_minor ? Math.round((1 - b.seat_price_minor / normal) * 100) : 0
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
        <img src={FEATURED_PHOTOS[(index + 2) % FEATURED_PHOTOS.length]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
        {save ? <span className="absolute top-3 left-3 rounded-full bg-primary/90 px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-on-primary uppercase shadow-sm">Save {save}%</span> : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold tracking-tight text-text">{b.title}</h3>
        {b.description ? <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{b.description}</p> : null}
        <p className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">{b.courses.length} courses in this bundle</p>
        <ul className="mt-2 grid gap-2 text-sm">
          {b.courses.slice(0, 4).map((c) => (
            <li key={c.course_id}>
              <Link to={`/courses/${c.slug}`} className="flex items-center gap-2 text-text transition-colors duration-150 hover:text-primary">
                <CheckCircle2 className="size-4 shrink-0 text-primary" /> <span className="truncate underline-offset-2 hover:underline">{c.title}</span>
              </Link>
            </li>
          ))}
          {b.courses.length > 4 ? <li className="text-xs text-muted">and {b.courses.length - 4} more</li> : null}
        </ul>
        <div className="mt-auto flex items-baseline gap-2 pt-4">
          <span className="text-2xl font-bold tracking-tight text-text tabular">{money(b.seat_price_minor, 'GBP', 2)}</span>
          <span className="text-sm text-muted">per seat</span>
        </div>
        {buyer ? (
          <BuyBundle bundle={b} label="Choose courses and seats" className="mt-4 h-10 w-full rounded-full" />
        ) : (
          <p className="mt-4 text-xs text-muted">{company ? 'Your company admin can buy this bundle for the team.' : 'For company teams: seats split between the courses.'}</p>
        )}
      </div>
    </article>
  )
}

function Offers({ bundles, company }: { bundles: Bundle[]; company: boolean }) {
  // The 3D cover-flow is the default; reduced motion (or one bundle) keeps the calmer grid.
  if (reducedMotion() || bundles.length < 3) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {bundles.map((b, i) => (
          <BundleCard key={b.id} b={b} index={i} company={company} />
        ))}
      </div>
    )
  }
  return (
    <Coverflow
      label="Course bundles"
      itemNoun="bundle"
      interactive
      fill
      maxWidth="max-w-5xl"
      cardWidth="w-[calc(100vw-32px)] max-w-[336px] sm:w-[396px] sm:max-w-none"
      stageHeight="h-[510px] sm:h-[520px]"
      slides={bundles.map((b, i) => ({ key: b.id, label: b.title, content: <BundleCard b={b} index={i} company={company} /> }))}
    />
  )
}

function BundlesSection() {
  const { data } = useBundles()
  const company = useIsCompanyMember()
  if (!data?.length) return null // nothing on sale: no empty promise on the home page
  return (
      <section id="sales" className="scroll-mt-20 bg-surface-2">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16 lg:py-20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-none">
              <SectionEyebrow>Offers</SectionEyebrow>
              <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
                Course bundles, priced like a <span className="text-primary">decision.</span>
              </h2>
              <p className="mt-4 text-muted">Courses that belong together, one lower seat price. Split the seats between them however your team needs.</p>
            </div>
          </div>
          <div className="mt-10">
            <Offers bundles={data} company={company} />
          </div>
        </div>
      </section>
  )
}

/** "Why LearnHub": value prop + PLACEHOLDER live-cohort stats (see docs/NEEDS-USER.md). */
const COHORT_STATS = [
  { n: 12400, format: (v: number) => Math.round(v).toLocaleString('en-GB'), label: 'Learners', note: 'Since the first cohort in 2019' },
  { n: 38, format: (v: number) => Math.round(v).toLocaleString('en-GB'), label: 'Countries', note: 'Learners across four time zones' },
  { n: 94, format: (v: number) => `${Math.round(v)}%`, label: 'Completion rate', note: 'Courses finished, not just started' },
  { n: 4.8, format: (v: number) => `${v.toFixed(1)}/5`, label: 'Average rating', note: 'Across the last six months' },
]
const TEAMS = ['Meridian Health', 'Northwind Labs', 'Banque Atlas', 'Kite Logistics']

function WhyLearnHub() {
  return (
    <section className="scroll-mt-20 border-t border-border bg-[#f6f4f0] dark:bg-surface-2">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 py-12 sm:py-16 lg:grid-cols-2 lg:gap-14 lg:py-20">
        <div>
          <SectionEyebrow>Why LearnHub</SectionEyebrow>
          <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
            Taught by people who <span className="text-primary">do the work.</span>
          </h2>
          <p className="mt-4 max-w-md text-muted">Every instructor still works in the field they teach. Courses are short, practical and assessed, built to change how your team works, not just what they know.</p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/courses">
                Browse the catalogue <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="secondary" asChild size="lg" className="rounded-full">
              <a href="/#instructors">Meet the instructors</a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">Teams we teach</span>
            {TEAMS.map((t) => (
              <span key={t} className="rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary-soft-text">{t}</span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-surface to-primary-soft/40 p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
            <span className="flex items-center gap-2 text-primary">
              <span className="size-1.5 rounded-full bg-primary" /> Live cohort data
            </span>
            <span>Nov 2026</span>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-6">
            {COHORT_STATS.map((s) => (
              <div key={s.label} className="border-t border-border pt-4">
                <CountUp value={s.n} format={s.format} className="block text-[clamp(26px,4vw,36px)] font-bold tracking-tight text-text tabular" />
                <p className="mt-1 text-sm font-semibold text-text">{s.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** Warm editorial cover photos (used per the user's explicit sign-off; see docs/NEEDS-USER.md). */
const FEATURED_PHOTOS = [
  'https://readdy.ai/api/search-image?query=Minimal%20warm%20editorial%20photograph%20of%20a%20light%20conference%20table%20with%20an%20open%20laptop%20and%20printed%20strategy%20documents%2C%20soft%20morning%20daylight%2C%20cream%20walls%2C%20muted%20terracotta%20accents%2C%20shallow%20depth%20of%20field%2C%20premium%20business%20editorial%20photography%2C%20calm%20uncluttered%20composition&width=1200&height=750&seq=evidrise-course-01&orientation=landscape',
  'https://readdy.ai/api/search-image?query=Warm%20minimal%20photograph%20of%20a%20researcher%20desk%20with%20a%20notebook%20of%20hand%20drawn%20diagrams%20and%20a%20matte%20laptop%2C%20soft%20window%20light%2C%20cream%20and%20sand%20palette%2C%20subtle%20orange%20detail%2C%20shallow%20depth%20of%20field%2C%20premium%20editorial%20photography%2C%20uncluttered&width=1200&height=750&seq=evidrise-course-02&orientation=landscape',
  'https://readdy.ai/api/search-image?query=Minimal%20warm%20photograph%20of%20a%20product%20planning%20wall%20with%20sticky%20notes%20in%20amber%20and%20cream%20tones%2C%20soft%20natural%20light%2C%20muted%20neutral%20background%2C%20editorial%20business%20photography%2C%20calm%20uncluttered%20composition&width=1200&height=750&seq=evidrise-course-03&orientation=landscape',
  'https://readdy.ai/api/search-image?query=Warm%20minimal%20photograph%20of%20printed%20charts%20and%20a%20fine%20pen%20on%20a%20linen%20desk%20surface%2C%20soft%20directional%20daylight%2C%20cream%20and%20warm%20grey%20palette%2C%20shallow%20depth%20of%20field%2C%20premium%20editorial%20style%2C%20uncluttered&width=1200&height=750&seq=evidrise-course-04&orientation=landscape',
  'https://readdy.ai/api/search-image?query=Minimal%20warm%20photograph%20of%20two%20stacked%20laptops%20and%20a%20notebook%20of%20equations%20on%20a%20light%20oak%20desk%2C%20soft%20diffused%20daylight%2C%20cream%20background%2C%20subtle%20orange%20object%20accent%2C%20premium%20editorial%20photography%2C%20calm%20composition&width=1200&height=750&seq=evidrise-course-05&orientation=landscape',
  'https://static.readdy.ai/image/d84279027d7bca7939cd7344401a26dd/58dd6d7a3c9f7b545b0e503080399fdc.png',
]

/** Rich Evidrise-style course card: cover, category tag, instructor, rating, price + CTA. */
function FeaturedCourseCard({ course, index }: { course: CourseCardData; index: number }) {
  const price = course.price
  const instructor = course.instructors[0]
  const cover = course.thumbnail_url || FEATURED_PHOTOS[index % FEATURED_PHOTOS.length]
  return (
    <Link to={`/courses/${course.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="aspect-[16/10] overflow-hidden bg-surface-2">
        <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase">
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-primary-soft-text">{course.category}</span>
          {course.level && course.level !== 'all' ? <span className="text-subtle">{course.level}</span> : null}
          {course.delivery?.map((d) => (
            <span key={d} className="rounded-full border border-border px-2 py-0.5 text-muted">{d === 'live' ? 'Live' : 'Recorded'}</span>
          ))}
        </div>
        <h3 className="line-clamp-2 min-h-[2.6em] text-[16px] leading-snug font-semibold tracking-tight text-text group-hover:text-primary">{course.title}</h3>
        {instructor ? (
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary-soft-text">{initials(instructor)}</span>
            <span className="min-w-0 truncate text-[12.5px] text-muted">{course.instructors.join(', ')}</span>
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-2 text-[12px] text-muted">
          <span className="flex items-center gap-1">
            <Star className="size-3.5 fill-warning text-warning" />
            <span className="font-semibold text-text">{(course.rating_avg ?? 0).toFixed(1)}</span>
            {course.rating_count ? <span className="text-subtle">({course.rating_count.toLocaleString()})</span> : null}
          </span>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="flex items-center gap-1">
            <PlayCircle className="size-3.5" /> {course.lecture_count} lessons
          </span>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" /> {duration(course.total_duration_sec)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
          <span className="text-[19px] font-semibold tracking-tight text-text tabular">{!price ? '' : price.free ? 'Free' : money(price.sale_minor ?? price.list_minor ?? 0, price.currency, price.exponent)}</span>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary group-hover:gap-2.5">
            View course <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/** Featured courses with category tab filter — Evidrise-style, real data. */
function FeaturedCourses() {
  const { data: cats } = useCategories()
  const [active, setActive] = useState('')
  const company = useIsCompanyMember()
  const [delivery, setDelivery] = useState<'' | 'recorded' | 'live' | 'both'>('')
  const { data, error, isLoading, isPlaceholderData, refetch } = useCourses({ category: active || undefined, delivery: delivery || undefined, sort: 'popular', limit: 6 })
  const tabs = [{ slug: '', name: 'All' }, ...(cats ?? []).map((c) => ({ slug: c.slug, name: c.name }))]
  return (
    <section id="courses" className="relative scroll-mt-20 overflow-hidden border-y border-border">
      <img
        src={FEATURED_BG}
        alt=""
        aria-hidden
        width={1600}
        height={900}
        loading="lazy"
        decoding="async"
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/88 via-background/72 to-background/92 dark:from-background/92 dark:via-background/82 dark:to-background/95" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <SectionEyebrow>Featured courses</SectionEyebrow>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Courses built around skills, not <span className="text-primary">hype.</span>
            </h2>
            <p className="mt-4 text-muted">Each course is short enough to finish alongside your work, and demanding enough to change how you do it.</p>
          </div>
          <div className="flex w-full shrink-0 flex-nowrap items-center gap-1.5 sm:w-auto sm:gap-2.5">
            <Button asChild size="lg" className="h-10 gap-1.5 rounded-full px-3 text-[13px] sm:h-12 sm:gap-2 sm:px-6 sm:text-[15px]">
              <Link to="/courses">
                All courses <ArrowRight className="size-3.5 sm:size-4" />
              </Link>
            </Button>
            {company ? null : (
              <Button variant="secondary" asChild size="lg" className="h-10 rounded-full px-3 text-[13px] sm:h-12 sm:px-6 sm:text-[15px]">
                <a href="#membership">See membership</a>
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" className="h-10 w-[72px] justify-between gap-1 rounded-full px-2.5 text-[13px] md:hidden" title={tabs.find((t) => t.slug === active)?.name ?? 'All'}>
                  <span className="truncate">{tabs.find((t) => t.slug === active)?.name ?? 'All'}</span> <ChevronDown className="size-3.5" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end" className="max-h-72 min-w-44 overflow-y-auto">
                {tabs.map((t) => (
                  <MenuItem key={t.slug} onSelect={() => setActive(t.slug)} className={cn(active === t.slug && 'font-medium text-primary')}>
                    {t.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </div>
        </div>

        <DeliveryTabs className="mt-8 flex w-fit" value={delivery} onChange={setDelivery} />
        {/* Desktop keeps the full pill tablist; phones use the dropdown in the action row. */}
        <div
          className="mt-8 hidden max-w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full border border-border bg-white/85 p-1 shadow-sm backdrop-blur-sm [-ms-overflow-style:none] [scrollbar-width:none] md:inline-flex dark:bg-white/10 [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Filter courses by category"
        >
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              role="tab"
              aria-selected={active === t.slug}
              onClick={() => setActive(t.slug)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-200',
                active === t.slug ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-text',
              )}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className={cn('mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3', data && 'stagger')}>
          {error && !data ? (
            <div className="col-span-full rounded-2xl border border-border bg-surface/80">
              <ErrorState message={error.message} onRetry={() => void refetch()} />
            </div>
          ) : isLoading || isPlaceholderData || !data ? (
            Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[380px] rounded-2xl" />)
          ) : data.items.length ? (
            data.items.map((c, i) => <FeaturedCourseCard key={c.id} course={c} index={i} />)
          ) : (
            <p className="col-span-full py-12 text-center text-muted">No courses in this track yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export function HomePage() {
  const fresh = useCourses({ sort: 'newest', limit: 3 })
  const { hash } = useLocation()

  // Arriving at /#section from another page: scroll once the (async) section has
  // rendered, and keep re-aiming as more content loads so we don't park on the wrong one.
  useEffect(() => {
    if (!hash) return
    return scrollToAnchor(hash.slice(1))
  }, [hash])

  return (
    <>
      <HeroIntro />
      <Hero />
      <CategorySection />
      <FeaturedCourses />
      <BundlesSection />
      <section id="new" className="relative scroll-mt-20 overflow-hidden bg-[#1e252d]">
        {/* Decorative artwork: full-bleed layered dune-waves forming one broad valley (high on the
            left, dipping centre, rising to the right). Each crest catches a faint top sheen; a thin
            glowing orange rim runs along the rising right crest. Soft light grazes the top-left and a
            warm glow sits in the top-right. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Atmospheric lighting — soft cool sheen top-left, warm glow top-right. */}
          <div className="absolute -top-40 -left-32 size-[560px] rounded-full bg-white/[0.035] blur-[130px]" />
          <div className="absolute -top-32 -right-24 size-[520px] rounded-full bg-primary/20 blur-[150px]" />
          <div className="absolute top-1/3 -right-12 hidden size-[260px] rounded-full bg-primary/10 blur-[120px] sm:block" />
          <svg viewBox="0 0 1440 760" preserveAspectRatio="xMidYMax slice" fill="none" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="nw-rim" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
                <stop offset="0.06" stopColor="var(--color-primary)" stopOpacity="0.26" />
                <stop offset="0.35" stopColor="var(--color-primary)" stopOpacity="0.32" />
                <stop offset="0.60" stopColor="var(--color-primary)" stopOpacity="0.44" />
                <stop offset="0.84" stopColor="var(--color-primary)" stopOpacity="0.95" />
                <stop offset="0.94" stopColor="var(--color-primary)" stopOpacity="0.4" />
                <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="nw-atmo" cx="0.5" cy="0" r="0.8">
                <stop offset="0" stopColor="#2c3641" stopOpacity="0.35" />
                <stop offset="1" stopColor="#1e252d" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="1440" height="760" fill="url(#nw-atmo)" />
            {/* layered dune-waves — back bands sit lighter (lit), front bands darker, for depth */}
            <path d="M-60 330 C 240 322 470 420 720 498 C 930 562 1095 566 1270 506 C 1352 478 1414 450 1500 430 L1500 760 L-60 760 Z" fill="#2e3843" opacity="0.7" />
            <path d="M-60 388 C 240 380 470 478 720 556 C 930 620 1095 624 1270 564 C 1352 536 1414 508 1500 488 L1500 760 L-60 760 Z" fill="#242d37" />
            <path d="M-60 450 C 240 442 470 540 720 618 C 930 682 1095 686 1270 626 C 1352 598 1414 570 1500 550 L1500 760 L-60 760 Z" fill="#181f27" />
            <path d="M-60 512 C 240 504 470 602 720 680 C 930 744 1095 748 1270 688 C 1352 660 1414 632 1500 612 L1500 760 L-60 760 Z" fill="#0d1218" />
            {/* faint top sheen along two crests, catching the light */}
            <path d="M-60 330 C 240 322 470 420 720 498 C 930 562 1095 566 1270 506 C 1352 478 1414 450 1500 430" className="stroke-white/[0.06]" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M-60 450 C 240 442 470 540 720 618 C 930 682 1095 686 1270 626 C 1352 598 1414 570 1500 550" className="stroke-white/[0.028]" strokeWidth="1.5" strokeLinecap="round" />
            {/* orange rim-light on the 2nd crest: wide blurred glow, then a crisp bright line, brightest as it rises to the right */}
            <path d="M-60 388 C 240 380 470 478 720 556 C 930 620 1095 624 1270 564 C 1352 536 1414 508 1500 488" stroke="url(#nw-rim)" strokeWidth="6" strokeLinecap="round" style={{ filter: 'blur(6px)' }} />
            <path d="M-60 388 C 240 380 470 478 720 556 C 930 620 1095 624 1270 564 C 1352 536 1414 508 1500 488" stroke="url(#nw-rim)" strokeWidth="1.4" strokeLinecap="round" />
            {/* a single warm node where the rim is brightest */}
            <circle cx="1210" cy="584" r="9" fill="var(--color-primary)" opacity="0.7" style={{ filter: 'blur(7px)' }} />
            <circle cx="1210" cy="584" r="2.5" fill="#ffd9b0" opacity="0.9" style={{ filter: 'blur(1.5px)' }} />
          </svg>
        </div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16 lg:py-24">
          <div className="mb-10 text-center">
            <div className="mb-5 flex items-center justify-center gap-4">
              <span aria-hidden className="h-px w-14 bg-gradient-to-r from-transparent to-white/30 sm:w-24" />
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 font-mono text-[11px] font-medium tracking-[0.22em] text-white uppercase">
                <Star className="size-3.5 fill-primary text-primary" aria-hidden /> Just added
              </span>
              <span aria-hidden className="h-px w-14 bg-gradient-to-l from-transparent to-white/30 sm:w-24" />
            </div>
            <h2 className="text-[clamp(30px,5vw,44px)] font-semibold tracking-tight text-white">New and <span className="text-primary">noteworthy</span></h2>
            <p className="mt-2 text-sm text-white/70">The latest courses, just published.</p>
          </div>
          <div className={cn('grid gap-5 sm:grid-cols-2 lg:grid-cols-3', fresh.data && 'stagger')}>
            {fresh.isLoading || !fresh.data
              ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[380px] rounded-2xl" />)
              : fresh.data.items.map((c, i) => <FeaturedCourseCard key={c.id} course={c} index={i} />)}
          </div>
        </div>
      </section>
      <WhyLearnHub />
      <section id="instructors" className="scroll-mt-20 bg-[#faeee0] dark:bg-surface-2/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <SectionEyebrow>Instructors</SectionEyebrow>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Taught by people who <span className="text-primary">ship it.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted">No career trainers. Every course is led by a practitioner still working in the field, reviewed by a second pair of eyes.</p>
          </div>
          <div className="mt-12">
            <Instructors />
          </div>
        </div>
      </section>
      <Membership />
    </>
  )
}
