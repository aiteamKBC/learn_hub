import { ArrowRight, ArrowUpRight, Briefcase, CheckCircle2, Clock, Code2, HeartPulse, Megaphone, Palette, PlayCircle, Server, ShieldCheck, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useLocation } from 'react-router-dom'

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { BlurText } from '@/components/art/blur-text'
import { AuthTabs } from '@/components/home/GetStarted'
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

/** Evidrise-style full-bleed hero. Image used with the user's explicit sign-off (see docs/NEEDS-USER.md). */
const HERO_SRC = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/d2bf3230f8d24f5bb5ed7a6a696f7ca2.png'
const NOTEWORTHY_BG =
  'https://readdy.ai/api/search-image?query=Abstract%20layered%20paper%20ridges%20in%20warm%20sand%20cream%20and%20soft%20clay%20tones%20flowing%20like%20rolling%20dunes%2C%20gentle%20side%20light%20creating%20calm%20shadows%2C%20minimal%20editorial%20art%20direction%20with%20airy%20negative%20space%20and%20smooth%20gradient%20transitions&width=1600&height=900&seq=newnoteworthy-bg-2026-c3&orientation=landscape'
const FEATURED_BG = NOTEWORTHY_BG

function Hero() {
  const [ready, setReady] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const { data: me, isLoading: isLoadingMe } = useMe()
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 80)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <section id="hero" aria-label="LearnHub" className="relative -mt-[calc(4rem+1px)] h-[calc(100svh+1px)] min-h-[600px] w-full overflow-hidden bg-[#1f262e]">
      <img
        src={HERO_SRC}
        width={1784}
        height={1006}
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
                {/* Placeholder until the real intro video is added — not shipped content. */}
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-muted">
                  <PlayCircle className="size-10 opacity-60" />
                  <p className="text-sm">Video coming soon</p>
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
    <section id="categories" className="relative scroll-mt-20 overflow-hidden">
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
                  <Link key={c.id} to={`/courses?category=${c.slug}`} className="group relative flex flex-col rounded-2xl border border-border bg-gradient-to-br from-surface to-primary-soft/40 p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow">
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
          <div role="group" aria-label="Billing period" className="relative inline-flex shrink-0 rounded-full border border-text/25 bg-white/85 p-1 text-sm shadow-sm backdrop-blur-sm">
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
                className={cn('relative z-10 w-24 rounded-full px-4 py-1.5 text-center font-medium transition-colors duration-200', yearly === o.k ? 'text-on-primary' : 'text-text/60 hover:text-text')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {tiers.map((t) => (
            <article key={t.name} className={cn('relative flex flex-col rounded-2xl p-6 shadow-lg', t.featured ? 'bg-[#2a333c] ring-1 ring-primary/50' : 'bg-white text-text')}>
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

/** Instructors, derived from the real course feed; portrait photos are placeholders. */
function Instructors() {
  const { data, isLoading } = useCourses({ limit: 50 })
  const gridRef = useRef<HTMLDivElement>(null)
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
  const count = people.length

  // Cards rise in with a gentle stagger as the grid scrolls into view. Driven by
  // ScrollTrigger (same mechanism as the section reveal), so cards are never left
  // hidden if it can't run — reduced motion simply shows them in place.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || count === 0 || reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      gsap.from('[data-card]', {
        opacity: 0,
        y: 28,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.09,
        scrollTrigger: { trigger: grid, start: 'top 85%', once: true },
      })
    }, grid)
    return () => ctx.revert()
  }, [count])

  if (isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
        ))}
      </div>
    )
  }

  // Staggered 3-column arrangement: side columns stacked, centre column vertically centred.
  const col1 = [people[0], people[3]].filter(Boolean)
  const centre = [people[2]].filter(Boolean)
  const col3 = [people[1], people[4]].filter(Boolean)
  return (
    <div ref={gridRef} className="grid gap-5 lg:grid-cols-3 lg:gap-7">
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

/** Offers / bundles. PLACEHOLDER prices & discounts (see docs/NEEDS-USER.md) until wired to real data. */
const BUNDLES = [
  { title: 'Compliance essentials', note: 'The two courses every new starter needs — safety first, safeguarding second.', save: 'Save 25%', price: '£179', was: '£238' },
  { title: 'Core skills starter', note: 'Build the foundations your team keeps coming back to, at one lower price.', save: 'Save 27%', price: '£189', was: '£258' },
  { title: 'Team-ready pack', note: "Everything a new hire needs in their first month, bundled together.", save: 'Save 26%', price: '£199', was: '£268' },
]

function Offers() {
  const { data } = useCourses({ sort: 'popular', limit: 6 })
  const courses = data?.items ?? []
  return (
    <div className="grid gap-5 stagger sm:grid-cols-2 lg:grid-cols-3">
      {BUNDLES.map((b, i) => {
        const pair = [courses[i * 2], courses[i * 2 + 1]].filter(Boolean)
        return (
          <article key={b.title} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
            <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
              <img src={FEATURED_PHOTOS[(i + 2) % FEATURED_PHOTOS.length]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
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
              <div className="mt-4 flex items-baseline gap-2">
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
      })}
    </div>
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
    <section className="scroll-mt-20 border-t border-border bg-surface">
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
    <Link to={`/courses/${course.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
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

        <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Filter courses by category">
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              role="tab"
              aria-selected={active === t.slug}
              onClick={() => setActive(t.slug)}
              className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', active === t.slug ? 'bg-primary text-on-primary' : 'border border-border bg-surface text-muted hover:text-text')}
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
  const fresh = useCourses({ sort: 'newest', limit: 4 })
  const { hash } = useLocation()

  // Arriving at /#section from another page: scroll once the (async) section has
  // rendered, and keep re-aiming as more content loads so we don't park on the wrong one.
  useEffect(() => {
    if (!hash) return
    return scrollToAnchor(hash.slice(1))
  }, [hash])

  // Reveal each section with a soft rise as it scrolls into view (GSAP ScrollTrigger).
  useEffect(() => {
    if (reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('main > section').forEach((s, i) => {
        if (i === 0) return // leave the hero (it has its own entrance)
        gsap.from(s, {
          opacity: 0,
          y: 48,
          duration: 0.85,
          ease: 'power2.out',
          scrollTrigger: { trigger: s, start: 'top 85%', once: true },
        })
      })
    })
    const t = setTimeout(() => ScrollTrigger.refresh(), 400)
    return () => {
      clearTimeout(t)
      ctx.revert()
    }
  }, [])

  return (
    <>
      <Hero />
      <CategorySection />
      <FeaturedCourses />
      <section id="sales" className="scroll-mt-20">
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
      <section id="new" className="relative scroll-mt-20 overflow-hidden">
        <img
          src={NOTEWORTHY_BG}
          alt=""
          aria-hidden
          width={1600}
          height={900}
          className="pointer-events-none absolute inset-0 size-full object-cover object-center"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/90 via-background/70 to-background/95 dark:from-background/92 dark:via-background/80 dark:to-background/96" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-12">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-text">New and noteworthy</h2>
            <p className="mt-1 text-sm text-muted">The latest courses, just published.</p>
          </div>
          <div className={cn('grid gap-5 sm:grid-cols-2 lg:grid-cols-4', fresh.data && 'stagger')}>
            {fresh.isLoading || !fresh.data
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[380px] rounded-2xl" />)
              : fresh.data.items.map((c, i) => <FeaturedCourseCard key={c.id} course={c} index={i} />)}
          </div>
        </div>
      </section>
      <WhyLearnHub />
      <section id="instructors" className="scroll-mt-20 bg-[#faeee0] dark:bg-surface-2/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20">
          <div className="max-w-none">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.26em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary" /> Instructors
            </p>
            <h2 className="mt-4 text-[clamp(30px,5vw,44px)] leading-[1.05] font-bold tracking-tight text-text">
              Taught by people who <span className="text-primary">ship it.</span>
            </h2>
            <p className="mt-4 text-muted">No career trainers. Every course is led by a practitioner still working in the field, reviewed by a second pair of eyes.</p>
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
