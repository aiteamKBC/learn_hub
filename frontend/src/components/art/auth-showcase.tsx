/**
 * The sign-in artwork: a composed scene rather than a pattern. A deep violet panel
 * with light arcs and a soft mesh, and a floating collage of the product itself (a
 * course in progress, a certificate, a team compliance ring) on frosted glass.
 * Decorative only; the same in light and dark mode (it is always a dark panel).
 */
import { Award, PlayCircle, ShieldCheck } from 'lucide-react'
import { useId } from 'react'

function Arcs() {
  const id = useId()
  return (
    <svg viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <radialGradient id={`${id}a`} cx="78%" cy="18%" r="60%">
          <stop offset="0" stopColor="#f59542" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f59542" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}b`} cx="10%" cy="95%" r="55%">
          <stop offset="0" stopColor="#ec4899" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ec4899" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}c`} cx="95%" cy="85%" r="45%">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.25" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}d`} width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill="#fff" fillOpacity="0.09" />
        </pattern>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="600" height="900" fill={`url(#${id}d)`} />
      <rect width="600" height="900" fill={`url(#${id}a)`} />
      <rect width="600" height="900" fill={`url(#${id}b)`} />
      <rect width="600" height="900" fill={`url(#${id}c)`} />
      <g fill="none" stroke={`url(#${id}l)`} strokeWidth="1.2">
        {[180, 260, 340, 420, 500].map((r) => (
          <circle key={r} cx="560" cy="120" r={r} />
        ))}
      </g>
      <path d="M-20 760 C 140 690, 260 820, 420 740 S 620 640, 640 660" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.5" />
      <path d="M-20 800 C 160 740, 280 860, 440 780 S 620 690, 640 710" fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="1.5" />
    </svg>
  )
}

const glass = 'rounded-2xl border border-white/15 bg-white/10 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.5)] backdrop-blur-md'

/** A QR-like code (decorative): finder squares in three corners, seeded modules. */
const CODE_CELLS: [number, number][] = (() => {
  let a = 11
  const next = () => ((a = (a * 1103515245 + 12345) % 2147483648), a / 2147483648)
  const cells: [number, number][] = []
  for (let x = 0; x < 13; x++)
    for (let y = 0; y < 13; y++) {
      const finder = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8)
      if (!finder && next() > 0.52) cells.push([x, y])
    }
  return cells
})()

function Code() {
  const finder = (x: number, y: number) => (
    <g key={`${x}${y}`}>
      <rect x={x} y={y} width="4" height="4" fill="#1b0f44" />
      <rect x={x + 0.7} y={y + 0.7} width="2.6" height="2.6" fill="#fff" />
      <rect x={x + 1.3} y={y + 1.3} width="1.4" height="1.4" fill="#1b0f44" />
    </g>
  )
  return (
    <svg viewBox="-1 -1 15 15" className="size-10 shrink-0 rounded-md bg-white" aria-hidden>
      {finder(0, 0)}
      {finder(9, 0)}
      {finder(0, 9)}
      {CODE_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1b0f44" />
      ))}
    </svg>
  )
}

function ComplianceRing() {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none" stroke="#fff" strokeOpacity="0.15" strokeWidth="8" />
      <circle cx="38" cy="38" r={r} fill="none" stroke="#4ade80" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * 0.08} />
    </svg>
  )
}

// Evidrise palette: charcoal #1f262e → burnt brown #743219 → muted orange (no purple).
const panel = 'relative h-full overflow-hidden bg-[linear-gradient(160deg,#1f262e_0%,#2d1c12_46%,#743219_78%,#c25d10_100%)] text-white'

/** Background only (the slim strip above the form on phones). */
export function AuthBand() {
  return (
    <div aria-hidden className={panel}>
      <Arcs />
    </div>
  )
}

export function AuthShowcase() {
  return (
    <div aria-hidden className={panel}>
      <Arcs />
      <div className="relative flex h-full flex-col justify-between p-12 xl:p-14">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Learning that keeps teams compliant
          </p>
          <p className="mt-6 max-w-md text-[34px] leading-[1.15] font-semibold tracking-tight">
            Skills for you.
            <br />
            <span className="bg-gradient-to-r from-orange-200 via-amber-200 to-rose-200 bg-clip-text text-transparent">Compliance for your team.</span>
          </p>
        </div>

        {/* the product, floating */}
        <div className="relative mx-auto h-[360px] w-full max-w-[440px] [@media(max-height:780px)]:scale-[0.85]">
          <div className={`${glass} absolute top-0 left-0 w-[270px] -rotate-3 p-3 motion-safe:animate-[float_9s_ease-in-out_infinite]`}>
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#ef8a2b,#c2410c)]">
              <span className="absolute -right-6 -bottom-8 size-24 rounded-full bg-white/10" />
              <PlayCircle className="size-10 text-white/90" strokeWidth={1.5} />
            </div>
            <p className="mt-3 text-sm font-semibold">Python for Data Analysis</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-orange-300 to-amber-300" />
            </div>
            <p className="mt-1.5 text-[11px] text-white/70">68% complete · 12 lectures left</p>
          </div>

          <div className={`${glass} absolute top-24 right-0 w-[220px] rotate-2 p-4 motion-safe:animate-[float_11s_ease-in-out_infinite_reverse]`}>
            <div className="flex items-center gap-3">
              <div className="relative">
                <ComplianceRing />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">92%</span>
              </div>
              <div>
                <p className="text-[11px] text-white/70">Team compliance</p>
                <p className="text-sm font-semibold">Fire Safety</p>
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-300">
                  <ShieldCheck className="size-3" /> 3 renewals due
                </p>
              </div>
            </div>
          </div>

          <div className={`${glass} absolute bottom-0 left-8 flex w-[300px] items-center gap-3 p-4 motion-safe:animate-[float_10s_ease-in-out_infinite]`}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-400 text-[#3b1a00] shadow-lg">
              <Award className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Certificate earned</p>
              <p className="truncate text-[11px] text-white/70">Safeguarding Adults</p>
              <p className="font-mono text-[10px] tracking-wider text-white/50">LH-7Q2K-93XD</p>
            </div>
            <span className="ml-auto">
              <Code />
            </span>
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-4 border-t border-white/15 pt-6 text-[13px] text-white/75">
          <li>
            <span className="block text-base font-semibold text-white">Expert-led</span>courses
          </li>
          <li>
            <span className="block text-base font-semibold text-white">CPD</span>certificates
          </li>
          <li>
            <span className="block text-base font-semibold text-white">Live</span>team tracking
          </li>
        </ul>
      </div>
    </div>
  )
}
