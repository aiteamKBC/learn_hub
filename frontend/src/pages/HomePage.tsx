import { ArrowRight, ArrowUpRight, Briefcase, CheckCircle2, ChevronLeft, ChevronRight, Clock, Code2, HeartPulse, Megaphone, Palette, PlayCircle, Server, ShieldCheck, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useLocation } from 'react-router-dom'

import heroEagle from '@/assets/brand/hero-eagle.png'
import { BlurText } from '@/components/art/blur-text'
import { AuthTabs } from '@/components/home/GetStarted'
import { HeroIntro } from '@/components/home/HeroIntro'
import { Button } from '@/components/ui/button'
import { CountUp } from '@/components/ui/count-up'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StarBorder } from '@/components/ui/star-border'
import { type CourseCardData, useCategories, useCourses, usePlans } from '@/features/catalog/api'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { duration, money } from '@/lib/format'
import { reducedMotion } from '@/lib/motion'
import { scrollToAnchor } from '@/lib/smooth-scroll'
import { Link } from '@/lib/router'

const categoryIcons: Record<string, LucideIcon> = { code: Code2, briefcase: Briefcase, palette: Palette, server: Server, 'shield-check': ShieldCheck, 'heart-pulse': HeartPulse, megaphone: Megaphone }

/** Evidrise-style full-bleed hero. Custom LearnHub artwork supplied by the user. */
const HERO_SRC = heroEagle
const NOTEWORTHY_BG =
  'https://readdy.ai/api/search-image?query=Abstract%20layered%20paper%20ridges%20in%20warm%20sand%20cream%20and%20soft%20clay%20tones%20flowing%20like%20rolling%20dunes%2C%20gentle%20side%20light%20creating%20calm%20shadows%2C%20minimal%20editorial%20art%20direction%20with%20airy%20negative%20space%20and%20smooth%20gradient%20transitions&width=1600&height=900&seq=newnoteworthy-bg-2026-c3&orientation=landscape'
const FEATURED_BG = NOTEWORTHY_BG

function Hero() {
  const [ready, setReady] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const { data: me, isLoading: isLoadingMe } = useMe()
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 80)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <section id="hero" aria-label="LearnHub" className="relative -mt-[calc(4rem+1px)] h-[calc(100svh+1px)] min-h-[600px] w-full overflow-hidden bg-[#1f262e]">
      <img
        src={HERO_SRC}
        width={1717}
        height={916}
        alt=""
        fetchPriority="high"
        decoding="async"
        className={cn('absolute inset-0 block h-full w-full object-cover object-center transition-opacity duration-[650ms] ease-out', ready ? 'opacity-100' : 'opacity-0')}
      />
      {/* Charcoal veil that deepens behind the copy and clears to the right so the artwork stays visible. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(31,38,46,0.86)_0%,rgba(31,38,46,0.6)_26%,rgba(31,38,46,0.12)_54%,transparent_76%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(to_top,rgba(31,38,46,0.72),transparent)]" />

     <div className="absolute inset-0 z-10 flex flex-col justify-center px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-12 lg:px-42 lg:py-16">
        <div className="stagger w-full max-w-[620px]">
          <p className="font-mono text-[11px] tracking-[0.26em] text-white/70 uppercase">01 — LearnHub</p>
          <h1 className="mt-4 text-[clamp(38px,9vw,20px)] leading-[1.1] font-bold tracking-tight text-white md:text-[clamp(52px,5.4vw,60px)]">
            <BlurText text="Learn without limits," className="block" />
            <BlurText text="built for real work." delay={0.35} className="block font-semibold text-primary" />
          </h1>
          <p className="mt-5 max-w-[440px] text-[13.5px] leading-relaxed text-white/80 md:text-[15px]">High-quality courses from industry experts, with certificates your whole team can keep up with — buy what you need, or subscribe for everything.</p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5 md:mt-8">
            {!isLoadingMe && !me ? (
              <>
                <StarBorder>
                  <Button size="lg" className="min-w-[9.5rem] rounded-full" onClick={() => setAuthOpen(true)}>Log in</Button>
                </StarBorder>
                <Dialog open={authOpen} onOpenChange={setAuthOpen}>
                  <DialogContent title="Welcome to LearnHub" description="Log in or create an account to get started." className="max-w-[460px]">
                    <AuthTabs />
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
            <Button size="lg" className="min-w-[9.5rem] rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => setVideoOpen(true)}>
              <PlayCircle className="size-4 text-primary" /> Watch video
            </Button>
            <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
              <DialogContent title="Watch the LearnHub intro" description="A short look at how LearnHub works." className="max-w-3xl">
                <div className="relative overflow-hidden rounded-lg bg-black">
                  <video src="https://ik.imagekit.io/bmjbddbgyi/web%20(1).mp4?tr=w-1600,q-72" controls autoPlay playsInline className="aspect-video w-full" preload="metadata">
                    Your browser cannot play this video.
                  </video>
                  {/* 40% charcoal shade over the clip. */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(31,38,46,0.4)]" />
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <p className="mt-5 font-mono text-[9.5px] tracking-[0.2em] text-white/55 uppercase">12,400 learners · CPD certificates · Compliance training for teams</p>
        </div>
      </div>

      <a href="#categories" aria-label="Scroll to categories" className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/70 transition-colors hover:text-white md:flex">
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

/** Evidrise-style "Browse by category": editorial header + large cards + decorative rings. */
function CategorySection() {
  const { data, isLoading } = useCategories()
  return (
    <section id="categories" className="relative scroll-mt-20 overflow-hidden bg-surface-2">
      {/* decorative concentric rings, top-right */}
      <svg aria-hidden className="pointer-events-none absolute -top-24 right-[-10%] h-[520px] w-[520px] text-primary/15" viewBox="0 0 520 520" fill="none">
        {[80, 140, 200, 258].map((r) => (
          <circle key={r} cx="320" cy="200" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
      </svg>
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> Browse by category
            </p>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Every discipline, one way of <span className="text-primary">learning.</span>
            </h2>
            <p className="mt-4 text-muted">Find the right track for where you want to go — real skills, assessed and certified.</p>
          </div>
          <Button variant="secondary" size="lg" asChild className="shrink-0 rounded-full">
            <Link to="/courses">
              All courses <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className={cn('mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3', data && 'stagger')}>
          {isLoading || !data
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)
            : data.slice(0, 6).map((c) => {
                const Icon = categoryIcons[c.icon] ?? Sparkles
                return (
                  <Link key={c.id} to={`/courses?category=${c.slug}`} className="group relative flex flex-col rounded-2xl border border-border bg-gradient-to-br from-surface to-primary-soft/40 p-6 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
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
              })}
        </div>
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
function Membership() {
  const { data, isLoading } = usePlans()
  const personal = data?.find((p) => p.audience === 'personal')
  const team = data?.find((p) => p.audience === 'team')
  const [yearly, setYearly] = useState(true)

  const practitioner = personal
    ? yearly
      ? { price: money(personal.amount_minor * 12, personal.currency, personal.exponent), unit: '/year', note: 'billed annually' }
      : { price: money(personal.amount_minor, personal.currency, personal.exponent), unit: '/month', note: personal.trial_days ? `${personal.trial_days}-day free trial` : 'billed monthly' }
    : null
  // Real team price when the plan is in the data; a genuine "contact sales" state otherwise
  // (never an empty box). While plans are still loading we leave price undefined so the card
  // shows its skeleton rather than flashing "Custom" before the real figure arrives.
  const teams = team
    ? { price: money(team.amount_minor, team.currency, team.exponent), unit: '/seat · year', note: 'From 5 seats' }
    : { price: isLoading ? undefined : 'Custom', unit: '', note: isLoading ? '' : 'Billed per seat · from 5 seats' }

  const tiers = [
    { name: 'Explorer', tagline: 'For getting your bearings.', price: 'Free', unit: '', note: '', features: MEMBERSHIP_FEATURES.explorer, cta: 'Start free', to: '/signup', featured: false, badge: '' },
    { name: 'Practitioner', tagline: 'For the work you are doing now.', price: practitioner?.price, unit: practitioner?.unit, note: practitioner?.note, features: MEMBERSHIP_FEATURES.practitioner, cta: 'Choose Practitioner', to: '/plans', featured: true, badge: 'Most chosen' },
    { name: 'Teams', tagline: 'For groups building together.', price: teams?.price, unit: teams?.unit, note: teams?.note, features: MEMBERSHIP_FEATURES.teams, cta: 'Talk to us', to: '/plans', featured: false, badge: '' },
  ]

  return (
    <section className="relative overflow-hidden  text-white">
      <img src={FEATURED_PHOTOS[5]} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-40" />
      <div aria-hidden className="absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> Membership
            </p>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] text-text leading-[1.05] font-bold tracking-tight">
              One membership, every <span className="text-primary">course.</span>
            </h2>
            <p className="mt-4 text-primary-soft-text">Start free. Move up when you want the graded work, the critique sessions and the certificate.</p>
          </div>
          <div role="group" aria-label="Billing period" className="relative inline-flex shrink-0 rounded-full border border-border bg-surface/85 p-1 text-sm shadow-sm backdrop-blur-sm">
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

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {tiers.map((t) => (
            <article key={t.name} className={cn('relative flex flex-col rounded-2xl p-6 shadow-lg transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0', t.featured ? 'bg-[#2a333c] ring-1 ring-primary/50 hover:ring-primary/70' : 'border border-border bg-surface text-text')}>
              {t.badge ? <span className="absolute top-5 right-5 rounded-full bg-primary px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-on-primary uppercase">{t.badge}</span> : null}
              <h3 className={cn('text-base font-semibold', t.featured ? 'text-white' : 'text-text')}>{t.name}</h3>
              <p className={cn('mt-1 text-sm', t.featured ? 'text-white/60' : 'text-muted')}>{t.tagline}</p>
              <p className={cn('mt-5 text-4xl font-bold tracking-tight tabular', t.featured ? 'text-white' : 'text-text')}>
                {t.price ?? <Skeleton className="h-9 w-24" />}
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
  const maxVisible = width && width < 560 ? 1 : 2

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

/** Offers / bundles. PLACEHOLDER prices & discounts (see docs/NEEDS-USER.md) until wired to real data. */
const BUNDLES = [
  { title: 'Compliance essentials', note: 'The two courses every new starter needs — safety first, safeguarding second.', save: 'Save 25%', price: '£179', was: '£238' },
  { title: 'Core skills starter', note: 'Build the foundations your team keeps coming back to, at one lower price.', save: 'Save 27%', price: '£189', was: '£258' },
  { title: 'Team-ready pack', note: "Everything a new hire needs in their first month, bundled together.", save: 'Save 26%', price: '£199', was: '£268' },
]

/** A single bundle card — same content in the grid and the cover-flow. */
function BundleCard({ b, pair, index }: { b: (typeof BUNDLES)[number]; pair: CourseCardData[]; index: number }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
        <img src={FEATURED_PHOTOS[(index + 2) % FEATURED_PHOTOS.length]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
        <span className="absolute top-3 left-3 rounded-full bg-primary/90 px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-on-primary uppercase shadow-sm">{b.save}</span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold tracking-tight text-text">{b.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{b.note}</p>
        <ul className="mt-4 grid gap-2 text-sm">
          {(pair.length ? pair.map((c) => c.title) : ['Two complementary courses']).map((t) => (
            <li key={t} className="flex items-center gap-2 text-text">
              <CheckCircle2 className="size-4 shrink-0 text-primary" /> <span className="truncate">{t}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-baseline gap-2 pt-4">
          <span className="text-2xl font-bold tracking-tight text-text tabular">{b.price}</span>
          <span className="text-sm text-subtle line-through tabular">{b.was}</span>
        </div>
        <Button className="mt-4 w-full rounded-full" asChild>
          <Link to="/courses">
            See the bundle <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </article>
  )
}

function Offers() {
  const { data } = useCourses({ sort: 'popular', limit: 6 })
  const courses = data?.items ?? []
  const bundles = BUNDLES.map((b, i) => ({ b, index: i, pair: [courses[i * 2], courses[i * 2 + 1]].filter(Boolean) }))

  // The 3D cover-flow is the default; reduced motion keeps the calmer grid.
  if (reducedMotion()) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {bundles.map(({ b, pair, index }) => (
          <BundleCard key={b.title} b={b} pair={pair} index={index} />
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
      cardWidth="w-[320px] sm:w-[396px]"
      stageHeight="h-[560px] sm:h-[580px]"
      slides={bundles.map(({ b, pair, index }) => ({ key: b.title, label: b.title, content: <BundleCard b={b} pair={pair} index={index} /> }))}
    />
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
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 py-16 lg:grid-cols-2 lg:gap-14 lg:py-20">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
            <span className="size-1.5 rounded-full bg-primary" /> 02 — Why LearnHub
          </p>
          <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
            Taught by people who <span className="text-primary">do the work.</span>
          </h2>
          <p className="mt-4 max-w-md text-muted">Every instructor still works in the field they teach. Courses are short, practical and assessed — built to change how your team works, not just what they know.</p>
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
  const { data, isLoading } = useCourses({ category: active || undefined, sort: 'popular', limit: 6 })
  const tabs = [{ slug: '', name: 'All' }, ...(cats ?? []).map((c) => ({ slug: c.slug, name: c.name }))]
  return (
    <section id="courses" className="relative scroll-mt-20 overflow-hidden border-y border-border">
      <img
        src={FEATURED_BG}
        alt=""
        aria-hidden
        width={1600}
        height={900}
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/88 via-background/72 to-background/92 dark:from-background/92 dark:via-background/82 dark:to-background/95" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-none">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> Featured courses
            </p>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Courses built around skills, not <span className="text-primary">hype.</span>
            </h2>
            <p className="mt-4 text-muted">Each course is short enough to finish alongside your work, and demanding enough to change how you do it.</p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/courses">
                All courses <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="secondary" asChild size="lg" className="rounded-full">
              <Link to="/plans">See membership</Link>
            </Button>
          </div>
        </div>

        <div
          className="mt-8 inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-border bg-white/85 p-1 shadow-sm backdrop-blur-sm dark:bg-white/10"
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
                'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
                active === t.slug ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-text',
              )}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className={cn('mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3', data && 'stagger')}>
          {isLoading || !data ? (
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
      <section id="sales" className="scroll-mt-20 bg-surface-2">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-none">
              <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
                <span className="size-1.5 rounded-full bg-primary" /> Offers
              </p>
              <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
                Course bundles, priced like a <span className="text-primary">decision.</span>
              </h2>
              <p className="mt-4 text-muted">Two courses that belong together, one lower price. The offer stays open while the current intake is enrolling.</p>
            </div>
            <Button variant="secondary" size="lg" asChild className="shrink-0 rounded-full">
              <Link to="/plans">
                Team &amp; volume pricing <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-10">
            <Offers />
          </div>
        </div>
      </section>
      <section id="new" className="relative scroll-mt-20 overflow-hidden bg-[#1f262e]">
        {/* Decorative artwork: a ring frame on the left, a glowing sun on the right, and
            flowing orange light-trails sweeping across the base. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Left — concentric ring frame, with a dashed orange hint at its core. */}
          <svg viewBox="0 0 440 440" fill="none" className="absolute top-1/2 -left-28 hidden h-[360px] w-[360px] -translate-y-1/2 sm:block lg:h-[440px] lg:w-[440px]">
            <circle cx="220" cy="220" r="214" className="stroke-white/[0.05]" strokeWidth="1.5" />
            <circle cx="220" cy="220" r="170" className="stroke-white/[0.07]" strokeWidth="1.5" />
            <circle cx="220" cy="220" r="126" className="stroke-white/[0.09]" strokeWidth="1.5" />
            <circle cx="220" cy="220" r="82" className="stroke-primary/45" strokeWidth="1.5" strokeDasharray="3 10" />
          </svg>
          {/* Right — a soft warm glow spilling from the top-right corner. */}
          <div className="absolute -top-28 -right-28 size-[460px] rounded-full bg-primary/25 blur-[130px]" />
          <div className="absolute -top-10 right-10 hidden size-[240px] rounded-full bg-primary/15 blur-[90px] sm:block" />
          {/* Bottom — subtle, elegant swells with an orange rim-light that flares brightest
              at a single node on the lower-left, then fades gently to the right. */}
          <svg viewBox="0 0 1440 440" preserveAspectRatio="xMidYMax slice" fill="none" className="absolute inset-x-0 bottom-0 h-[62%] w-full">
            <defs>
              <linearGradient id="nw-rim" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
                <stop offset="0.07" stopColor="var(--color-primary)" stopOpacity="0.14" />
                <stop offset="0.18" stopColor="var(--color-primary)" stopOpacity="0.55" />
                <stop offset="0.30" stopColor="var(--color-primary)" stopOpacity="0.95" />
                <stop offset="0.43" stopColor="var(--color-primary)" stopOpacity="0.26" />
                <stop offset="0.60" stopColor="var(--color-primary)" stopOpacity="0.07" />
                <stop offset="0.82" stopColor="var(--color-primary)" stopOpacity="0.18" />
                <stop offset="0.95" stopColor="var(--color-primary)" stopOpacity="0.05" />
                <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* layered swells — furthest (faint sheen) to front (darkest) */}
            <path d="M-20 300 C 200 268 380 258 500 282 C 640 310 740 344 860 342 C 1020 340 1160 312 1300 302 C 1380 296 1420 304 1460 308 L1460 440 L-20 440 Z" fill="#273039" opacity="0.5" />
            <path d="M-20 318 C 190 288 370 278 490 302 C 630 328 730 360 850 358 C 1010 356 1150 330 1290 320 C 1372 315 1416 322 1460 326 L1460 440 L-20 440 Z" fill="#1b222b" />
            <path d="M-20 336 C 180 306 360 296 476 318 C 610 344 710 374 828 372 C 988 370 1128 344 1268 336 C 1356 330 1414 338 1460 342 L1460 440 L-20 440 Z" fill="#11161c" />
            {/* orange rim-light on the front crest: wide blurred glow, then a crisp bright line */}
            <path d="M-20 336 C 180 306 360 296 476 318 C 610 344 710 374 828 372 C 988 370 1128 344 1268 336 C 1356 330 1414 338 1460 342" stroke="url(#nw-rim)" strokeWidth="7" strokeLinecap="round" style={{ filter: 'blur(6px)' }} />
            <path d="M-20 336 C 180 306 360 296 476 318 C 610 344 710 374 828 372 C 988 370 1128 344 1268 336 C 1356 330 1414 338 1460 342" stroke="url(#nw-rim)" strokeWidth="1.4" strokeLinecap="round" />
            {/* single bright node on the lower-left crest */}
            <circle cx="452" cy="314" r="10" fill="var(--color-primary)" opacity="0.8" style={{ filter: 'blur(7px)' }} />
            <circle cx="452" cy="314" r="3" fill="#ffd9b0" opacity="0.9" style={{ filter: 'blur(1.5px)' }} />
          </svg>
        </div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-24">
          <div className="mb-8 text-center">
            <h2 className="text-[clamp(30px,5vw,44px)] font-semibold tracking-tight text-white">New and noteworthy</h2>
            <p className="mt-1 text-sm text-white/70">The latest courses, just published.</p>
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
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="flex items-center justify-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> Instructors
            </p>
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
