/**
 * LearnHub page artwork. Every page gets its own backdrop instead of a flat colour:
 * generated SVG drawn from the theme tokens, so it follows light / dark mode, stays
 * sharp at any size and costs a few KB. The shapes are seeded, so the same page
 * always gets the same picture (no layout shift, no flicker).
 *
 *   constellation  home: a network of learning paths
 *   mosaic         course catalogue: floating course tiles
 *   waves          course page: layered waves in the course's category colours
 *   path           my learning: a winding journey with milestones
 *   contours       business: topographic map ("where your teams stand")
 *   blueprint      instructor studio and the design page: drafting grid
 *   circuit        admin console: circuit traces
 *   aurora         sign-in pages: soft light behind floating shapes
 *   orbit          empty / not-found states
 *   ribbons        plans and subscriptions: flowing ribbons
 *   confetti       order complete: a burst of brand-coloured confetti
 *   notebook       lessons in the player: a ruled page with margin and pencil marks
 *   guilloche      certificates and verification: security-print rosettes
 *   honeycomb      achievements: a wall of badges, some earned
 *   checklist      required training: rows ticked off on a clipboard grid
 *   signal         notifications: rings spreading from a bell
 *   dials          settings: control dials with tick marks
 *   bubbles        help and support: a conversation drifting upwards
 *   chartgrid      business reports: a wall of faint small charts
 *   orgchart       business people: an org chart drawn like a constellation
 *   floorplan      business units: a floor plan with map pins
 *   storyboard     course builder curriculum: film-strip frames with sketched scenes
 *   coins          studio money pages: coin stacks beside rising bars
 *   stamp          console approvals: an approval seal over a stack of reviewed pages
 *   seats          corporate packages: a classroom plan, some seats taken, some free
 *   timetable      live training: a week grid with sessions joined along a timeline
 */
import { memo, useId, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type BackdropVariant = 'constellation' | 'mosaic' | 'waves' | 'path' | 'contours' | 'blueprint' | 'circuit' | 'aurora' | 'orbit' | 'ribbons' | 'confetti' | 'notebook' | 'guilloche' | 'honeycomb' | 'checklist' | 'signal' | 'dials' | 'bubbles' | 'chartgrid' | 'orgchart' | 'floorplan' | 'storyboard' | 'coins' | 'stamp' | 'seats' | 'timetable'

// small seeded PRNG (mulberry32): same seed, same art
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 1600
const H = 640

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={cn('absolute inset-0 size-full', className)} aria-hidden focusable="false">
      {children}
    </svg>
  )
}

function Glow({ id, cx, cy, r, color, opacity }: { id: string; cx: number; cy: number; r: number; color: string; opacity: number }) {
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={opacity} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  )
}

const Constellation = memo(function Constellation() {
  const id = useId()
  const r = rng(7)
  const nodes = Array.from({ length: 46 }, () => ({ x: 720 + r() * 860, y: 30 + r() * 580, s: r() }))
  const edges: [number, number][] = []
  nodes.forEach((a, i) =>
    nodes.forEach((b, j) => {
      if (j > i && Math.hypot(a.x - b.x, a.y - b.y) < 150) edges.push([i, j])
    }),
  )
  return (
    <Svg>
      <Glow id={`${id}g1`} cx={1180} cy={180} r={520} color="var(--primary)" opacity={0.22} />
      <Glow id={`${id}g2`} cx={260} cy={-40} r={420} color="var(--chart-5)" opacity={0.1} />
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.16">
        <ellipse cx="1180" cy="300" rx="430" ry="170" transform="rotate(-14 1180 300)" />
        <ellipse cx="1180" cy="300" rx="300" ry="110" transform="rotate(-14 1180 300)" strokeDasharray="2 8" />
      </g>
      <g stroke="var(--primary)" strokeOpacity="0.22" strokeWidth="1">
        {edges.map(([i, j]) => (
          <line key={`${i}-${j}`} x1={nodes[i]!.x} y1={nodes[i]!.y} x2={nodes[j]!.x} y2={nodes[j]!.y} />
        ))}
      </g>
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.s > 0.86 ? 5 : 2.2 + n.s * 1.6} fill={n.s > 0.86 ? 'var(--primary)' : 'var(--primary-soft-text)'} fillOpacity={n.s > 0.86 ? 0.8 : 0.35} />
      ))}
      {nodes
        .filter((n) => n.s > 0.86)
        .map((n, i) => (
          <circle key={`h${i}`} cx={n.x} cy={n.y} r={12} fill="none" stroke="var(--primary)" strokeOpacity="0.25" />
        ))}
    </Svg>
  )
})

const Mosaic = memo(function Mosaic({ seed = 21 }: { seed?: number }) {
  const id = useId()
  const r = rng(seed)
  const colors = ['var(--primary)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
  const tiles = Array.from({ length: 34 }, () => ({ x: r() * W, y: r() * H, s: 34 + r() * 70, rot: -18 + r() * 36, c: colors[Math.floor(r() * colors.length)]!, o: 0.05 + r() * 0.1, outline: r() > 0.6 }))
  return (
    <Svg>
      <Glow id={`${id}g`} cx={W * 0.75} cy={60} r={560} color="var(--primary)" opacity={0.16} />
      {tiles.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={t.s * 1.5} height={t.s} rx={t.s * 0.18} transform={`rotate(${t.rot} ${t.x} ${t.y})`} fill={t.outline ? 'none' : t.c} fillOpacity={t.o} stroke={t.outline ? t.c : 'none'} strokeOpacity={0.25} />
      ))}
    </Svg>
  )
})

const Waves = memo(function Waves({ from = 'var(--primary)', to = 'var(--chart-5)' }: { from?: string; to?: string }) {
  const id = useId()
  const layers = [0, 1, 2, 3].map((i) => {
    const y = 330 + i * 70
    const a = 70 - i * 10
    return `M0 ${y} C ${300} ${y - a}, ${520} ${y + a}, ${800} ${y} S ${1300} ${y - a * 1.2}, ${W} ${y + a * 0.4} V ${H} H 0 Z`
  })
  return (
    <Svg>
      <defs>
        <linearGradient id={`${id}w`} x1="0" x2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <pattern id={`${id}d`} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.2" fill={from} fillOpacity="0.22" />
        </pattern>
      </defs>
      <Glow id={`${id}g`} cx={260} cy={40} r={460} color={from} opacity={0.2} />
      <Glow id={`${id}g2`} cx={1380} cy={120} r={420} color={to} opacity={0.14} />
      <rect x="900" y="0" width="700" height="300" fill={`url(#${id}d)`} />
      {layers.map((d, i) => (
        <path key={i} d={d} fill={`url(#${id}w)`} fillOpacity={0.06 + i * 0.025} />
      ))}
      <path d={layers[0]!.split(' V')[0]} fill="none" stroke={`url(#${id}w)`} strokeOpacity="0.45" strokeWidth="1.5" />
    </Svg>
  )
})

const Path = memo(function Path() {
  const id = useId()
  const d = 'M -40 470 C 180 380, 260 560, 470 470 S 760 260, 960 330 S 1260 520, 1420 300 S 1600 140, 1680 180'
  const stones = [
    [470, 470],
    [960, 330],
    [1420, 300],
  ]
  const r = rng(5)
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1250} cy={120} r={480} color="var(--primary)" opacity={0.18} />
      <Glow id={`${id}g2`} cx={180} cy={520} r={360} color="var(--chart-2)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--primary)" strokeOpacity="0.12" strokeWidth="26" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--primary)" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="2 12" strokeLinecap="round" />
      {stones.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="22" fill="var(--surface)" stroke="var(--primary)" strokeOpacity="0.5" strokeWidth="2" />
          <path d={`M ${x! - 8} ${y} l 6 6 l 11 -12`} fill="none" stroke={i < 2 ? 'var(--success)' : 'var(--text-subtle)'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      {Array.from({ length: 26 }, (_, i) => {
        const x = r() * W
        const y = r() * 260
        const s = 2 + r() * 4
        return <path key={i} d={`M ${x} ${y - s} L ${x + s * 0.3} ${y} L ${x} ${y + s} L ${x - s * 0.3} ${y} Z`} fill="var(--chart-3)" fillOpacity={0.25 + r() * 0.3} />
      })}
    </Svg>
  )
})

const Contours = memo(function Contours() {
  const id = useId()
  const rings = (cx: number, cy: number, n: number, seed: number) => {
    const r = rng(seed)
    const k1 = 2 + Math.floor(r() * 3)
    const k2 = 3 + Math.floor(r() * 3)
    return Array.from({ length: n }, (_, i) => {
      const base = 40 + i * 34
      const pts = Array.from({ length: 73 }, (_, j) => {
        const t = (j / 72) * Math.PI * 2
        const rad = base + Math.sin(k1 * t + i * 0.35) * (8 + i * 1.6) + Math.cos(k2 * t + seed) * (5 + i)
        return `${(cx + Math.cos(t) * rad * 1.35).toFixed(1)},${(cy + Math.sin(t) * rad).toFixed(1)}`
      })
      return `M${pts.join('L')}Z`
    })
  }
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1300} cy={40} r={520} color="var(--primary)" opacity={0.2} />
      <g fill="none" stroke="var(--primary)" strokeWidth="1">
        {rings(1320, 120, 14, 3).map((d, i) => (
          <path key={`a${i}`} d={d} strokeOpacity={0.08 + (i % 4 === 0 ? 0.14 : 0.06)} />
        ))}
        {rings(260, 560, 10, 9).map((d, i) => (
          <path key={`b${i}`} d={d} strokeOpacity={0.06 + (i % 4 === 0 ? 0.1 : 0.05)} />
        ))}
      </g>
      <circle cx="1320" cy="120" r="5" fill="var(--primary)" fillOpacity="0.5" />
    </Svg>
  )
})

const Blueprint = memo(function Blueprint() {
  const id = useId()
  return (
    <Svg>
      <defs>
        <pattern id={`${id}m`} width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="var(--primary)" strokeOpacity="0.07" />
        </pattern>
        <pattern id={`${id}M`} width="120" height="120" patternUnits="userSpaceOnUse">
          <rect width="120" height="120" fill={`url(#${id}m)`} />
          <path d="M120 0H0V120" fill="none" stroke="var(--primary)" strokeOpacity="0.13" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}M)`} />
      <Glow id={`${id}g`} cx={1250} cy={80} r={480} color="var(--primary)" opacity={0.16} />
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.35" strokeWidth="1.2">
        <circle cx="1240" cy="250" r="150" strokeDasharray="4 6" />
        <rect x="1060" y="150" width="190" height="130" rx="10" />
        <path d="M1060 320h360M1060 314v12M1420 314v12" />
        <path d="M1330 120l90 90" strokeDasharray="3 5" />
      </g>
      <text x="1205" y="345" fill="var(--primary)" fillOpacity="0.45" fontSize="12" fontFamily="ui-monospace, monospace">
        360 px
      </text>
    </Svg>
  )
})

const Circuit = memo(function Circuit() {
  const id = useId()
  const r = rng(13)
  const traces = Array.from({ length: 22 }, () => {
    let x = 700 + r() * 900
    let y = r() * H
    let d = `M${x.toFixed(0)} ${y.toFixed(0)}`
    for (let s = 0; s < 4; s++) {
      if (s % 2 === 0) x += (r() > 0.5 ? 1 : -1) * (40 + r() * 140)
      else y += (r() > 0.5 ? 1 : -1) * (30 + r() * 100)
      d += ` L${x.toFixed(0)} ${y.toFixed(0)}`
    }
    return { d, x, y }
  })
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1250} cy={100} r={500} color="var(--primary)" opacity={0.16} />
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.2" strokeWidth="1.4" strokeLinejoin="round">
        {traces.map((t, i) => (
          <path key={i} d={t.d} />
        ))}
      </g>
      {traces.map((t, i) => (
        <circle key={i} cx={t.x} cy={t.y} r="3.5" fill="var(--surface)" stroke="var(--primary)" strokeOpacity="0.5" />
      ))}
    </Svg>
  )
})

const Aurora = memo(function Aurora({ onDark }: { onDark?: boolean }) {
  const id = useId()
  const r = rng(3)
  // on the dark sign-in panel the text sits low, so shapes stay in the top half there
  const shapes = Array.from({ length: 14 }, () => ({ x: r() * W, y: r() * H * (onDark ? 0.5 : 1), s: 10 + r() * 26, k: Math.floor(r() * 3), rot: r() * 90 }))
  const stroke = onDark ? '#ffffff' : 'var(--primary)'
  return (
    <Svg>
      <Glow id={`${id}a`} cx={1100} cy={120} r={560} color="var(--primary)" opacity={onDark ? 0.75 : 0.22} />
      <Glow id={`${id}b`} cx={420} cy={600} r={480} color="var(--chart-5)" opacity={onDark ? 0.35 : 0.12} />
      <Glow id={`${id}c`} cx={1450} cy={560} r={360} color="#ec4899" opacity={onDark ? 0.3 : 0.08} />
      <g fill="none" stroke={stroke} strokeOpacity={onDark ? 0.22 : 0.18} strokeWidth="1.5">
        {shapes.map((s, i) =>
          s.k === 0 ? (
            <circle key={i} cx={s.x} cy={s.y} r={s.s} />
          ) : s.k === 1 ? (
            <rect key={i} x={s.x} y={s.y} width={s.s * 1.6} height={s.s * 1.6} rx={s.s * 0.35} transform={`rotate(${s.rot} ${s.x} ${s.y})`} />
          ) : (
            <path key={i} d={`M${s.x - s.s} ${s.y}h${s.s * 2}M${s.x} ${s.y - s.s}v${s.s * 2}`} strokeLinecap="round" />
          ),
        )}
      </g>
    </Svg>
  )
})

const Ribbons = memo(function Ribbons() {
  const id = useId()
  const ribbon = (y: number, amp: number, phase: number) => {
    const pts = Array.from({ length: 9 }, (_, i) => [i * 200, y + Math.sin(i * 0.9 + phase) * amp] as const)
    const top = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${yy.toFixed(1)}`).join(' ')
    const bottom = [...pts].reverse().map(([x, yy]) => `L${x} ${(yy + 46 + Math.cos(x / 260 + phase) * 18).toFixed(1)}`).join(' ')
    return `${top} ${bottom} Z`
  }
  return (
    <Svg>
      <defs>
        <linearGradient id={`${id}r`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
          <stop offset="0.45" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--chart-5)" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" x2="1">
          <stop offset="0" stopColor="#ec4899" stopOpacity="0" />
          <stop offset="0.6" stopColor="#ec4899" stopOpacity="0.14" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <Glow id={`${id}g`} cx={1200} cy={80} r={520} color="var(--primary)" opacity={0.18} />
      <path d={ribbon(150, 70, 0)} fill={`url(#${id}r)`} />
      <path d={ribbon(230, 90, 1.7)} fill={`url(#${id}s)`} />
      <path d={ribbon(330, 60, 3.1)} fill={`url(#${id}r)`} opacity="0.6" />
    </Svg>
  )
})

const Confetti = memo(function Confetti() {
  const id = useId()
  const r = rng(99)
  const colors = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#ec4899']
  const bits = Array.from({ length: 70 }, () => {
    const a = r() * Math.PI - Math.PI // upper half burst from the centre top
    const d = 120 + r() * 640
    return { x: 800 + Math.cos(a) * d * 1.3, y: 300 + Math.sin(a) * d * 0.55, w: 6 + r() * 10, h: 4 + r() * 6, rot: r() * 180, c: colors[Math.floor(r() * colors.length)]!, k: r() }
  })
  return (
    <Svg>
      <Glow id={`${id}g`} cx={800} cy={260} r={480} color="var(--primary)" opacity={0.16} />
      {bits.map((b, i) =>
        b.k > 0.7 ? (
          <circle key={i} cx={b.x} cy={b.y} r={b.h * 0.7} fill={b.c} fillOpacity="0.55" />
        ) : (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" transform={`rotate(${b.rot} ${b.x} ${b.y})`} fill={b.c} fillOpacity="0.6" />
        ),
      )}
    </Svg>
  )
})

const Orbit = memo(function Orbit() {
  const id = useId()
  return (
    <Svg>
      <Glow id={`${id}g`} cx={800} cy={320} r={420} color="var(--primary)" opacity={0.16} />
      <g fill="none" stroke="var(--primary)">
        {[120, 200, 290].map((rr, i) => (
          <ellipse key={rr} cx="800" cy="320" rx={rr * 1.6} ry={rr * 0.62} strokeOpacity={0.18 - i * 0.04} strokeDasharray={i === 1 ? '3 7' : undefined} transform="rotate(-10 800 320)" />
        ))}
      </g>
      <circle cx="1040" cy="236" r="7" fill="var(--primary)" fillOpacity="0.6" />
      <circle cx="420" cy="430" r="5" fill="var(--chart-3)" fillOpacity="0.6" />
      <circle cx="1210" cy="470" r="4" fill="var(--chart-2)" fillOpacity="0.6" />
    </Svg>
  )
})

const Notebook = memo(function Notebook() {
  const id = useId()
  const r = rng(13)
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1260} cy={90} r={460} color="var(--primary)" opacity={0.14} />
      <Glow id={`${id}g2`} cx={240} cy={40} r={340} color="var(--chart-3)" opacity={0.1} />
      <g stroke="var(--chart-5)" strokeOpacity="0.16" strokeWidth="1.5">
        {Array.from({ length: 16 }, (_, i) => (
          <line key={i} x1="0" x2={W} y1={70 + i * 36} y2={70 + i * 36} />
        ))}
      </g>
      <line x1="150" x2="150" y1="0" y2={H} stroke="var(--chart-4)" strokeOpacity="0.28" strokeWidth="2" />
      {[150, 330, 510].map((y) => (
        <circle key={y} cx="60" cy={y} r="11" fill="none" stroke="var(--text-subtle)" strokeOpacity="0.25" strokeWidth="2" />
      ))}
      {/* pencil marks: an underline swoosh, a star, a circled word */}
      <path d="M 1010 214 q 120 -18 250 4" fill="none" stroke="var(--primary)" strokeOpacity="0.4" strokeWidth="4" strokeLinecap="round" />
      <path d="M 1340 132 l 9 20 l 22 2 l -17 14 l 6 22 l -20 -12 l -20 12 l 6 -22 l -17 -14 l 22 -2 Z" fill="var(--chart-3)" fillOpacity="0.32" />
      <ellipse cx="760" cy="138" rx="96" ry="30" fill="none" stroke="var(--chart-2)" strokeOpacity="0.35" strokeWidth="3" transform="rotate(-4 760 138)" />
      {Array.from({ length: 7 }, (_, i) => {
        const y = 70 + (2 + i * 2) * 36 - 10
        const x = 220 + r() * 120
        return <rect key={i} x={x} y={y} width={180 + r() * 520} height="7" rx="3.5" fill="var(--text-subtle)" fillOpacity={0.08 + r() * 0.06} />
      })}
    </Svg>
  )
})

const Guilloche = memo(function Guilloche() {
  const id = useId()
  // spirograph rosettes, as on banknotes and certificates
  const rosette = (cx: number, cy: number, R: number, rr: number, d: number, turns: number) => {
    const pts: string[] = []
    for (let t = 0; t <= Math.PI * 2 * turns; t += 0.02) {
      const x = cx + (R - rr) * Math.cos(t) + d * Math.cos(((R - rr) / rr) * t)
      const y = cy + (R - rr) * Math.sin(t) - d * Math.sin(((R - rr) / rr) * t)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return `M${pts.join(' L')}`
  }
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1250} cy={200} r={480} color="var(--chart-3)" opacity={0.16} />
      <Glow id={`${id}g2`} cx={300} cy={120} r={420} color="var(--primary)" opacity={0.14} />
      <path d={rosette(1250, 230, 210, 42, 80, 21)} fill="none" stroke="var(--chart-3)" strokeOpacity="0.32" strokeWidth="1" />
      <path d={rosette(1250, 230, 120, 30, 46, 15)} fill="none" stroke="var(--primary)" strokeOpacity="0.28" strokeWidth="1" />
      <path d={rosette(1500, 470, 110, 26, 44, 13)} fill="none" stroke="var(--primary)" strokeOpacity="0.2" strokeWidth="1" />
      <g fill="none" stroke="var(--chart-3)" strokeOpacity="0.18">
        {Array.from({ length: 5 }, (_, i) => (
          <path key={i} d={`M 0 ${520 + i * 9} C 400 ${470 + i * 9}, 1200 ${590 + i * 9}, 1600 ${510 + i * 9}`} />
        ))}
      </g>
    </Svg>
  )
})

const Honeycomb = memo(function Honeycomb() {
  const id = useId()
  const r = rng(31)
  const hex = (x: number, y: number, s: number) => Array.from({ length: 6 }, (_, i) => `${(x + s * Math.cos((Math.PI / 3) * i + Math.PI / 6)).toFixed(1)},${(y + s * Math.sin((Math.PI / 3) * i + Math.PI / 6)).toFixed(1)}`).join(' ')
  const colors = ['var(--primary)', 'var(--chart-3)', 'var(--chart-2)', 'var(--chart-5)']
  const cells: ReactNode[] = []
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 20; col++) {
      const x = col * 90 + (row % 2 ? 45 : 0)
      const y = row * 78
      const k = r()
      const fade = Math.max(0, 1 - Math.abs(x - 1150) / 900)
      cells.push(
        <polygon key={`${row}-${col}`} points={hex(x, y, 40)} fill={k > 0.85 ? colors[Math.floor(r() * 4)] : 'none'} fillOpacity={0.22 * fade + 0.04} stroke="var(--primary)" strokeOpacity={0.12 * fade + 0.03} strokeWidth="1.5" />,
      )
    }
  }
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1150} cy={160} r={520} color="var(--chart-3)" opacity={0.14} />
      {cells}
    </Svg>
  )
})

const Checklist = memo(function Checklist() {
  const id = useId()
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1220} cy={140} r={480} color="var(--chart-2)" opacity={0.14} />
      <Glow id={`${id}g2`} cx={300} cy={80} r={360} color="var(--primary)" opacity={0.1} />
      <g transform="translate(170 40) rotate(-6 1180 300)" opacity="0.85">
        <rect x="960" y="70" width="420" height="520" rx="22" fill="var(--surface)" fillOpacity="0.55" stroke="var(--primary)" strokeOpacity="0.22" strokeWidth="2" />
        <rect x="1110" y="50" width="120" height="40" rx="10" fill="var(--primary)" fillOpacity="0.25" />
        {Array.from({ length: 6 }, (_, i) => {
          const y = 140 + i * 70
          const done = i < 4
          return (
            <g key={i}>
              <rect x="1000" y={y} width="34" height="34" rx="8" fill={done ? 'var(--success)' : 'none'} fillOpacity="0.28" stroke={done ? 'var(--success)' : 'var(--text-subtle)'} strokeOpacity="0.5" strokeWidth="2" />
              {done ? <path d={`M ${1008} ${y + 17} l 7 7 l 13 -14`} fill="none" stroke="var(--success)" strokeOpacity="0.8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
              <rect x="1056" y={y + 11} width={180 + ((i * 47) % 110)} height="12" rx="6" fill="var(--text-subtle)" fillOpacity="0.14" />
            </g>
          )
        })}
      </g>
      <g stroke="var(--primary)" strokeOpacity="0.07">
        {Array.from({ length: 22 }, (_, i) => (
          <line key={i} x1={i * 40} x2={i * 40} y1="0" y2={H} />
        ))}
      </g>
    </Svg>
  )
})

const Signal = memo(function Signal() {
  const id = useId()
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1240} cy={180} r={460} color="var(--primary)" opacity={0.18} />
      <g fill="none" stroke="var(--primary)">
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={i} cx="1240" cy="180" r={70 + i * 72} strokeOpacity={0.26 - i * 0.032} strokeWidth={2} strokeDasharray={i % 2 ? '4 10' : undefined} />
        ))}
      </g>
      <path d="M 1240 140 c -26 0 -38 20 -38 44 v 20 l -12 16 h 100 l -12 -16 v -20 c 0 -24 -12 -44 -38 -44 Z M 1228 228 a 12 12 0 0 0 24 0" fill="var(--primary)" fillOpacity="0.3" />
      <circle cx="1268" cy="148" r="9" fill="var(--chart-4)" fillOpacity="0.65" />
      {[[560, 120, 'var(--chart-2)'], [880, 410, 'var(--chart-3)'], [380, 330, 'var(--chart-5)']].map(([x, y, c], i) => (
        <circle key={i} cx={x as number} cy={y as number} r="6" fill={c as string} fillOpacity="0.5" />
      ))}
    </Svg>
  )
})

const Dials = memo(function Dials() {
  const id = useId()
  const dial = (cx: number, cy: number, r: number, angle: number, color: string) => (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="var(--surface)" fillOpacity="0.4" stroke={color} strokeOpacity="0.3" strokeWidth="2" />
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * Math.PI * 2
        const inner = r + 8
        const outer = r + (i % 3 ? 16 : 26)
        return <line key={i} x1={cx + Math.cos(a) * inner} y1={cy + Math.sin(a) * inner} x2={cx + Math.cos(a) * outer} y2={cy + Math.sin(a) * outer} stroke={color} strokeOpacity={i % 3 ? 0.18 : 0.35} strokeWidth="2" />
      })}
      <line x1={cx} y1={cy} x2={cx + Math.cos(angle) * (r - 14)} y2={cy + Math.sin(angle) * (r - 14)} stroke={color} strokeOpacity="0.6" strokeWidth="5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="7" fill={color} fillOpacity="0.6" />
    </g>
  )
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1180} cy={200} r={480} color="var(--primary)" opacity={0.15} />
      {dial(1180, 230, 120, -0.9, 'var(--primary)')}
      {dial(1420, 120, 60, 2.2, 'var(--chart-5)')}
      {dial(930, 90, 46, 0.4, 'var(--chart-2)')}
      {/* sliders on the right, clear of page titles and navigation */}
      <g stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="6" strokeLinecap="round">
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <line x1="1330" x2="1560" y1={300 + i * 56} y2={300 + i * 56} />
            <circle cx={1370 + i * 70} cy={300 + i * 56} r="12" fill="var(--surface)" stroke="var(--primary)" strokeOpacity="0.4" strokeWidth="3" />
          </g>
        ))}
      </g>
    </Svg>
  )
})

// ---- orgchart (business people): a constellation-like org chart, nodes linked in a tree
const OrgChart = memo(function OrgChart() {
  const id = useId()
  const r = rng(17)
  // root -> 3 branches -> 2-3 leaves each, all on the right half
  const root = { x: 1220, y: 70 }
  const mids = [
    { x: 1010, y: 220 },
    { x: 1240, y: 240 },
    { x: 1470, y: 210 },
  ]
  const leaves = mids.flatMap((m, i) => {
    const n = i === 1 ? 3 : 2
    return Array.from({ length: n }, (_, j) => ({ x: m.x + (j - (n - 1) / 2) * 92 + (r() - 0.5) * 16, y: m.y + 150 + (r() - 0.5) * 30, p: m }))
  })
  const stars = Array.from({ length: 30 }, () => ({ x: 760 + r() * 840, y: r() * 600, s: r() }))
  const elbow = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} V${(a.y + b.y) / 2} H${b.x} V${b.y}`
  const node = (x: number, y: number, rad: number, color: string, strong: boolean, key: string) => (
    <g key={key}>
      <circle cx={x} cy={y} r={rad + 9} fill="none" stroke={color} strokeOpacity={strong ? 0.28 : 0.16} />
      <circle cx={x} cy={y} r={rad} fill="var(--surface)" fillOpacity="0.6" stroke={color} strokeOpacity="0.5" strokeWidth="2" />
      <circle cx={x} cy={y - rad * 0.22} r={rad * 0.3} fill={color} fillOpacity="0.45" />
      <path d={`M${x - rad * 0.5} ${y + rad * 0.55} a ${rad * 0.5} ${rad * 0.42} 0 0 1 ${rad} 0`} fill={color} fillOpacity="0.35" />
    </g>
  )
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1240} cy={160} r={520} color="var(--primary)" opacity={0.18} />
      <Glow id={`${id}g2`} cx={1500} cy={480} r={320} color="var(--chart-5)" opacity={0.1} />
      {stars.map((s, i) => (
        <circle key={`s${i}`} cx={s.x} cy={s.y} r={1.4 + s.s * 1.6} fill="var(--primary-soft-text)" fillOpacity={0.18 + s.s * 0.2} />
      ))}
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.3" strokeWidth="1.5" strokeLinejoin="round">
        {mids.map((m, i) => (
          <path key={`m${i}`} d={elbow(root, m)} />
        ))}
      </g>
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.2" strokeWidth="1.2" strokeDasharray="3 6">
        {leaves.map((l, i) => (
          <path key={`l${i}`} d={elbow(l.p, l)} />
        ))}
      </g>
      {node(root.x, root.y, 26, 'var(--primary)', true, 'root')}
      {mids.map((m, i) => node(m.x, m.y, 20, i === 1 ? 'var(--chart-5)' : 'var(--primary)', true, `mn${i}`))}
      {leaves.map((l, i) => node(l.x, l.y, 13, i % 3 === 0 ? 'var(--chart-2)' : 'var(--primary)', false, `ln${i}`))}
    </Svg>
  )
})

// ---- floorplan (business units): a site floor plan with map pins on its rooms
const FloorPlan = memo(function FloorPlan() {
  const id = useId()
  const pin = (x: number, y: number, color: string, s: number, key: string) => (
    <g key={key}>
      <ellipse cx={x} cy={y + 2} rx={s * 0.7} ry={s * 0.22} fill={color} fillOpacity="0.18" />
      <path d={`M${x} ${y} C ${x - s * 0.2} ${y - s * 0.7}, ${x - s} ${y - s * 1.1}, ${x - s} ${y - s * 1.7} a ${s} ${s} 0 0 1 ${s * 2} 0 C ${x + s} ${y - s * 1.1}, ${x + s * 0.2} ${y - s * 0.7}, ${x} ${y} Z`} fill={color} fillOpacity="0.4" stroke={color} strokeOpacity="0.6" strokeWidth="1.5" />
      <circle cx={x} cy={y - s * 1.7} r={s * 0.38} fill="var(--surface)" fillOpacity="0.85" />
    </g>
  )
  return (
    <Svg>
      <defs>
        <pattern id={`${id}t`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--primary)" strokeOpacity="0.06" />
        </pattern>
      </defs>
      <Glow id={`${id}g`} cx={1230} cy={170} r={520} color="var(--primary)" opacity={0.16} />
      <g transform="rotate(-4 1230 280)">
        <rect x="900" y="40" width="660" height="440" fill={`url(#${id}t)`} />
        {/* outer walls with a door gap, then rooms */}
        <g fill="none" stroke="var(--primary)" strokeOpacity="0.32" strokeWidth="5" strokeLinecap="square">
          <path d="M900 40 H1560 V480 H1180 M1110 480 H900 V40" />
        </g>
        <g fill="none" stroke="var(--primary)" strokeOpacity="0.22" strokeWidth="3">
          <path d="M1120 40 V170 M1120 220 V300 H900" />
          <path d="M1340 40 V140 M1340 190 V300 H1250 M1190 300 H1120" />
          <path d="M1340 300 H1560 M1420 300 V480" />
        </g>
        {/* door swings */}
        <g fill="none" stroke="var(--primary)" strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="3 4">
          <path d="M1120 170 a 50 50 0 0 1 50 50" />
          <path d="M1340 140 a 50 50 0 0 0 -50 50" />
          <path d="M1110 480 a 70 70 0 0 1 70 -70" />
        </g>
        {/* furniture blocks */}
        <g fill="var(--primary)" fillOpacity="0.07">
          <rect x="940" y="80" width="140" height="60" rx="8" />
          <rect x="1170" y="90" width="120" height="120" rx="60" />
          <rect x="1380" y="80" width="140" height="40" rx="6" />
          <rect x="1380" y="140" width="140" height="40" rx="6" />
          <rect x="950" y="350" width="180" height="80" rx="10" />
          <rect x="1450" y="340" width="80" height="110" rx="8" />
        </g>
      </g>
      {pin(1010, 250, 'var(--primary)', 16, 'p1')}
      {pin(1235, 175, 'var(--chart-5)', 20, 'p2')}
      {pin(1460, 260, 'var(--chart-2)', 15, 'p3')}
      {pin(1300, 420, 'var(--chart-3)', 13, 'p4')}
      <path d="M1010 252 Q 1120 330 1235 178 T 1460 262" fill="none" stroke="var(--primary)" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round" />
    </Svg>
  )
})

const Bubbles = memo(function Bubbles() {
  const id = useId()
  const bubble = (x: number, y: number, w: number, h: number, left: boolean, color: string, o: number) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2.4} fill={color} fillOpacity={o} />
      <path d={left ? `M ${x + 26} ${y + h - 2} l -14 20 l 30 -14 Z` : `M ${x + w - 26} ${y + h - 2} l 14 20 l -30 -14 Z`} fill={color} fillOpacity={o} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={x + w / 2 - 20 + i * 20} cy={y + h / 2} r="5" fill="var(--surface)" fillOpacity="0.7" />
      ))}
    </g>
  )
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1220} cy={160} r={500} color="var(--chart-5)" opacity={0.14} />
      <Glow id={`${id}g2`} cx={260} cy={60} r={360} color="var(--primary)" opacity={0.12} />
      {bubble(1000, 250, 260, 78, true, 'var(--primary)', 0.16)}
      {bubble(1180, 120, 220, 70, false, 'var(--chart-5)', 0.18)}
      {bubble(1060, 30, 170, 56, true, 'var(--chart-2)', 0.14)}
      {bubble(1340, 330, 150, 52, false, 'var(--primary)', 0.1)}
      {bubble(640, 90, 130, 46, true, 'var(--chart-3)', 0.1)}
    </Svg>
  )
})

/** chartgrid (reports): a wall of faint small charts (bars, lines, donuts) on the right. */
const ChartGrid = memo(function ChartGrid() {
  const id = useId()
  const r = rng(41)
  const colors = ['var(--primary)', 'var(--chart-2)', 'var(--chart-5)', 'var(--chart-3)']
  const cols = 4
  const rows = 3
  const pw = 170
  const ph = 130
  const gap = 26
  const x0 = 840
  const y0 = 30
  const panels: ReactNode[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * (pw + gap) + (row % 2 ? 40 : 0)
      const y = y0 + row * (ph + gap)
      const kind = (row * cols + col) % 3
      const c = colors[Math.floor(r() * colors.length)]!
      const fade = 0.55 + 0.45 * ((x - x0) / (cols * (pw + gap)))
      const inner: ReactNode[] = []
      if (kind === 0) {
        // bars
        const n = 6
        const bw = (pw - 40) / n - 6
        for (let i = 0; i < n; i++) {
          const h = 18 + r() * (ph - 54)
          inner.push(<rect key={i} x={x + 20 + i * (bw + 6)} y={y + ph - 18 - h} width={bw} height={h} rx="3" fill={c} fillOpacity={0.22 + (i === n - 1 ? 0.18 : 0)} />)
        }
      } else if (kind === 1) {
        // a line with its area
        const pts = Array.from({ length: 7 }, (_, i) => [x + 18 + i * ((pw - 36) / 6), y + 30 + r() * (ph - 60)] as const)
        const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
        inner.push(<path key="a" d={`${line} L${pts[6]![0]} ${y + ph - 16} L${pts[0]![0]} ${y + ph - 16} Z`} fill={c} fillOpacity="0.1" />)
        inner.push(<path key="l" d={line} fill="none" stroke={c} strokeOpacity="0.5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)
        inner.push(<circle key="d" cx={pts[6]![0]} cy={pts[6]![1]} r="4" fill={c} fillOpacity="0.6" />)
      } else {
        // a donut
        const cx = x + pw / 2
        const cy = y + ph / 2 + 4
        const rad = 36
        const circ = 2 * Math.PI * rad
        const share = 0.45 + r() * 0.45
        inner.push(<circle key="t" cx={cx} cy={cy} r={rad} fill="none" stroke="var(--text-subtle)" strokeOpacity="0.14" strokeWidth="11" />)
        inner.push(<circle key="v" cx={cx} cy={cy} r={rad} fill="none" stroke={c} strokeOpacity="0.45" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${circ * share} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} />)
      }
      panels.push(
        <g key={`${row}-${col}`} opacity={fade}>
          <rect x={x} y={y} width={pw} height={ph} rx="14" fill="var(--surface)" fillOpacity="0.45" stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="1.5" />
          <rect x={x + 16} y={y + 12} width={40 + r() * 40} height="6" rx="3" fill="var(--text-subtle)" fillOpacity="0.18" />
          {inner}
        </g>,
      )
    }
  }
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1230} cy={150} r={520} color="var(--primary)" opacity={0.16} />
      <Glow id={`${id}g2`} cx={300} cy={40} r={360} color="var(--chart-2)" opacity={0.08} />
      <g stroke="var(--primary)" strokeOpacity="0.06">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1="0" x2={W} y1={40 + i * 70} y2={40 + i * 70} />
        ))}
      </g>
      {panels}
    </Svg>
  )
})

/** storyboard (curriculum builder): a tilted film strip of frames with sketched scenes,
 * plus a few loose storyboard cards, all on the right. */
const Storyboard = memo(function Storyboard() {
  const id = useId()
  const r = rng(53)
  const colors = ['var(--primary)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-3)']
  const fw = 150
  const fh = 104
  const x0 = 820
  const y0 = 150
  const frames = 5
  const scene = (x: number, y: number, kind: number, c: string) => {
    // a play triangle (video)
    if (kind === 0) return <path d={`M${x + fw / 2 - 14} ${y + fh / 2 - 18} L${x + fw / 2 + 18} ${y + fh / 2} L${x + fw / 2 - 14} ${y + fh / 2 + 18} Z`} fill={c} fillOpacity="0.32" />
    // hills and a sun (a scene)
    if (kind === 1)
      return (
        <g>
          <circle cx={x + fw - 36} cy={y + 30} r="11" fill={c} fillOpacity="0.3" />
          <path d={`M${x + 10} ${y + fh - 14} L${x + 52} ${y + 46} L${x + 82} ${y + 72} L${x + 106} ${y + 52} L${x + fw - 10} ${y + fh - 14} Z`} fill={c} fillOpacity="0.18" stroke={c} strokeOpacity="0.4" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      )
    // lines of text (a reading)
    if (kind === 2)
      return (
        <g fill={c} fillOpacity="0.22">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={x + 18} y={y + 22 + i * 17} width={(fw - 36) * (i === 3 ? 0.55 : 0.85 + r() * 0.15)} height="7" rx="3.5" />
          ))}
        </g>
      )
    // a tick in a circle (a quiz)
    return (
      <g fill="none" stroke={c} strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx={x + fw / 2} cy={y + fh / 2} r="24" strokeOpacity="0.3" />
        <path d={`M${x + fw / 2 - 11} ${y + fh / 2} l8 8 l15 -16`} />
      </g>
    )
  }
  const stripW = frames * (fw + 22) + 22
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1220} cy={170} r={540} color="var(--primary)" opacity={0.16} />
      <Glow id={`${id}g2`} cx={260} cy={30} r={360} color="var(--chart-5)" opacity={0.08} />
      {/* loose storyboard cards behind the strip */}
      <g transform="rotate(6 1380 80)">
        <rect x="1250" y="20" width="200" height="130" rx="12" fill="var(--surface)" fillOpacity="0.4" stroke="var(--primary)" strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="5 6" />
        <rect x="1270" y="164" width="120" height="7" rx="3.5" fill="var(--text-subtle)" fillOpacity="0.16" />
      </g>
      <g transform="rotate(-8 980 470)">
        <rect x="900" y="420" width="180" height="118" rx="12" fill="var(--surface)" fillOpacity="0.4" stroke="var(--chart-5)" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="5 6" />
      </g>
      {/* the film strip: sprocket holes above and below a row of frames */}
      <g transform={`rotate(-7 ${x0 + stripW / 2} ${y0 + fh / 2})`}>
        <rect x={x0} y={y0 - 34} width={stripW} height={fh + 68} rx="10" fill="var(--primary)" fillOpacity="0.1" stroke="var(--primary)" strokeOpacity="0.24" strokeWidth="1.5" />
        <g fill="var(--surface)" fillOpacity="0.75">
          {Array.from({ length: Math.floor(stripW / 30) }, (_, i) => (
            <g key={i}>
              <rect x={x0 + 12 + i * 30} y={y0 - 24} width="14" height="10" rx="2.5" />
              <rect x={x0 + 12 + i * 30} y={y0 + fh + 14} width="14" height="10" rx="2.5" />
            </g>
          ))}
        </g>
        {Array.from({ length: frames }, (_, i) => {
          const x = x0 + 22 + i * (fw + 22)
          const c = colors[i % colors.length]!
          return (
            <g key={i} opacity={0.6 + 0.4 * (i / (frames - 1))}>
              <rect x={x} y={y0} width={fw} height={fh} rx="8" fill="var(--surface)" fillOpacity="0.55" stroke={c} strokeOpacity="0.3" strokeWidth="1.5" />
              {scene(x, y0, i % 4, c)}
            </g>
          )
        })}
      </g>
      {/* reorder arrows between the strip and the cards */}
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round">
        <path d="M1180 120 C 1230 60, 1290 60, 1320 120" />
        <path d="M1050 400 C 1010 440, 1000 470, 1010 500" />
      </g>
    </Svg>
  )
})

/** coins (money pages): stacks of coins beside bars that rise to a trend line. */
const Coins = memo(function Coins() {
  const id = useId()
  const r = rng(67)
  const coin = (cx: number, cy: number, c: string, o: number, key: string) => (
    <g key={key}>
      <rect x={cx - 34} y={cy} width="68" height="12" fill={c} fillOpacity={o * 0.8} />
      <ellipse cx={cx} cy={cy + 12} rx="34" ry="10" fill={c} fillOpacity={o * 0.8} />
      <ellipse cx={cx} cy={cy} rx="34" ry="10" fill={c} fillOpacity={o} stroke={c} strokeOpacity="0.45" strokeWidth="1.2" />
      <ellipse cx={cx} cy={cy} rx="22" ry="6" fill="none" stroke="var(--surface)" strokeOpacity="0.5" strokeWidth="1.2" />
    </g>
  )
  const stack = (cx: number, base: number, n: number, c: string, key: string) =>
    Array.from({ length: n }, (_, i) => coin(cx + (r() - 0.5) * 6, base - i * 14, c, 0.22 + (i === n - 1 ? 0.12 : 0), `${key}${i}`))
  const bars = Array.from({ length: 7 }, (_, i) => ({ x: 860 + i * 58, h: 60 + i * 34 + r() * 30 }))
  const baseY = 560
  const trend = bars.map((b, i) => `${i ? 'L' : 'M'}${b.x + 18} ${(baseY - b.h - 18).toFixed(1)}`).join(' ')
  const last = bars[bars.length - 1]!
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1230} cy={180} r={540} color="var(--chart-2)" opacity={0.14} />
      <Glow id={`${id}g2`} cx={1000} cy={60} r={380} color="var(--primary)" opacity={0.12} />
      <g stroke="var(--primary)" strokeOpacity="0.06">
        {Array.from({ length: 8 }, (_, i) => (
          <line key={i} x1="820" x2={W} y1={baseY - i * 64} y2={baseY - i * 64} />
        ))}
      </g>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={baseY - b.h} width="36" height={b.h} rx="6" fill="var(--primary)" fillOpacity={0.08 + i * 0.025} stroke="var(--primary)" strokeOpacity="0.16" />
      ))}
      <path d={trend} fill="none" stroke="var(--chart-2)" strokeOpacity="0.5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M${last.x + 6} ${(baseY - last.h - 30).toFixed(1)} l12 -12 l12 12`} fill="none" stroke="var(--chart-2)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {stack(1330, 520, 6, 'var(--chart-3)', 'a')}
      {stack(1420, 520, 9, 'var(--chart-2)', 'b')}
      {stack(1510, 520, 4, 'var(--chart-3)', 'c')}
      {coin(1480, 150, 'var(--chart-3)', 0.2, 'f1')}
      {coin(1290, 90, 'var(--chart-2)', 0.14, 'f2')}
    </Svg>
  )
})

const Stamp = memo(function Stamp() {
  const id = useId()
  // a round approval seal (scalloped edge, inner rings, a tick) pressed over reviewed pages
  const cx = 1290
  const cy = 250
  const scallop = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2
    const rr = i % 2 ? 150 : 162
    return `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`
  }).join(' ')
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2
    return { x1: cx + 112 * Math.cos(a), y1: cy + 112 * Math.sin(a), x2: cx + 122 * Math.cos(a), y2: cy + 122 * Math.sin(a) }
  })
  const pages = [
    { x: 940, y: 300, rot: -8 },
    { x: 980, y: 280, rot: -3 },
    { x: 1020, y: 262, rot: 2 },
  ]
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1290} cy={240} r={460} color="var(--chart-2)" opacity={0.14} />
      <Glow id={`${id}g2`} cx={980} cy={120} r={380} color="var(--primary)" opacity={0.12} />
      {pages.map((p, i) => (
        <g key={i} transform={`rotate(${p.rot} ${p.x + 110} ${p.y + 140})`}>
          <rect x={p.x} y={p.y} width="220" height="280" rx="10" fill="var(--surface)" fillOpacity="0.5" stroke="var(--primary)" strokeOpacity={0.12 + i * 0.05} />
          {Array.from({ length: 7 }, (_, j) => (
            <line key={j} x1={p.x + 26} x2={p.x + (j % 3 === 2 ? 140 : 194)} y1={p.y + 50 + j * 28} y2={p.y + 50 + j * 28} stroke="var(--primary)" strokeOpacity={0.1 + i * 0.03} strokeWidth="5" strokeLinecap="round" />
          ))}
        </g>
      ))}
      <g transform={`rotate(-12 ${cx} ${cy})`}>
        <path d={`${scallop} Z`} fill="var(--chart-2)" fillOpacity="0.08" stroke="var(--chart-2)" strokeOpacity="0.4" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="132" fill="none" stroke="var(--chart-2)" strokeOpacity="0.35" strokeWidth="2.5" />
        <circle cx={cx} cy={cy} r="100" fill="none" stroke="var(--chart-2)" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4 6" />
        <g stroke="var(--chart-2)" strokeOpacity="0.3" strokeWidth="1.5">
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1.toFixed(1)} y1={t.y1.toFixed(1)} x2={t.x2.toFixed(1)} y2={t.y2.toFixed(1)} />
          ))}
        </g>
        <path d={`M${cx - 46} ${cy + 2} l32 32 l62 -70`} fill="none" stroke="var(--chart-2)" strokeOpacity="0.55" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g fill="none" stroke="var(--primary)" strokeOpacity="0.1">
        {Array.from({ length: 4 }, (_, i) => (
          <path key={i} d={`M 760 ${560 + i * 10} C 1000 ${520 + i * 10}, 1300 ${600 + i * 10}, 1600 ${540 + i * 10}`} />
        ))}
      </g>
    </Svg>
  )
})

/** seats (corporate packages): rows of classroom seats, some taken (filled), some free. */
const Seats = memo(function Seats() {
  const id = useId()
  const r = rng(83)
  const rows = Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 9 - (row % 2) }, (_, col) => ({
      x: 900 + col * 72 + (row % 2) * 36,
      y: 150 + row * 70,
      taken: r() < 0.55 - row * 0.04,
      tone: r() < 0.5 ? 'var(--primary)' : 'var(--chart-2)',
    })),
  ).flat()
  const seat = (x: number, y: number, taken: boolean, tone: string, key: number) => (
    <g key={key}>
      <rect x={x} y={y} width="46" height="30" rx="9" fill={tone} fillOpacity={taken ? 0.2 : 0.04} stroke={tone} strokeOpacity={taken ? 0.4 : 0.22} strokeWidth="1.4" />
      <rect x={x + 6} y={y + 34} width="34" height="8" rx="4" fill={tone} fillOpacity={taken ? 0.16 : 0.05} />
    </g>
  )
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1250} cy={200} r={560} color="var(--primary)" opacity={0.13} />
      <Glow id={`${id}g2`} cx={1500} cy={520} r={360} color="var(--chart-2)" opacity={0.1} />
      <rect x="960" y="70" width="520" height="34" rx="8" fill="var(--primary)" fillOpacity="0.07" stroke="var(--primary)" strokeOpacity="0.2" />
      <line x1="1000" x2="1440" y1="87" y2="87" stroke="var(--primary)" strokeOpacity="0.18" strokeDasharray="4 8" />
      {rows.map((s, i) => seat(s.x, s.y, s.taken, s.tone, i))}
      <g fill="none" stroke="var(--chart-3)" strokeOpacity="0.45" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1494 600 l8 8 l16 -18" />
        <circle cx="1504" cy="600" r="22" />
      </g>
    </Svg>
  )
})

/** timetable (live training): a week grid, session blocks joined along one timeline. */
const Timetable = memo(function Timetable() {
  const id = useId()
  const r = rng(91)
  const cols = 6
  const x0 = 880
  const cw = 112
  const y0 = 120
  const rh = 64
  const blocks = Array.from({ length: cols }, (_, c) => ({ c, row: Math.floor(r() * 5), h: 1 + (r() < 0.3 ? 1 : 0) }))
  const centre = (b: (typeof blocks)[number]) => [x0 + b.c * cw + cw / 2, y0 + b.row * rh + (b.h * rh) / 2] as const
  const line = blocks.map((b, i) => `${i ? 'L' : 'M'}${centre(b)[0].toFixed(1)} ${centre(b)[1].toFixed(1)}`).join(' ')
  return (
    <Svg>
      <Glow id={`${id}g`} cx={1220} cy={220} r={560} color="var(--chart-2)" opacity={0.13} />
      <Glow id={`${id}g2`} cx={1460} cy={80} r={340} color="var(--primary)" opacity={0.12} />
      <g stroke="var(--primary)" strokeOpacity="0.08">
        {Array.from({ length: cols + 1 }, (_, i) => (
          <line key={`v${i}`} x1={x0 + i * cw} x2={x0 + i * cw} y1={y0 - 40} y2={y0 + rh * 6} />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`h${i}`} x1={x0} x2={x0 + cols * cw} y1={y0 + i * rh} y2={y0 + i * rh} />
        ))}
      </g>
      {Array.from({ length: cols }, (_, i) => (
        <rect key={`d${i}`} x={x0 + i * cw + 30} y={y0 - 30} width={cw - 60} height="10" rx="5" fill="var(--primary)" fillOpacity="0.1" />
      ))}
      {blocks.map((b, i) => (
        <rect key={i} x={x0 + b.c * cw + 10} y={y0 + b.row * rh + 8} width={cw - 20} height={b.h * rh - 16} rx="10" fill={i === 0 ? 'var(--chart-2)' : 'var(--primary)'} fillOpacity={i === 0 ? 0.24 : 0.1} stroke={i === 0 ? 'var(--chart-2)' : 'var(--primary)'} strokeOpacity={i === 0 ? 0.5 : 0.2} />
      ))}
      <path d={line} fill="none" stroke="var(--chart-2)" strokeOpacity="0.4" strokeWidth="2" strokeDasharray="6 7" strokeLinecap="round" />
      {blocks.map((b, i) => {
        const [cx, cy] = centre(b)
        return <circle key={`p${i}`} cx={cx} cy={cy} r={i === 0 ? 7 : 4.5} fill={i === 0 ? 'var(--chart-2)' : 'var(--primary)'} fillOpacity={i === 0 ? 0.7 : 0.35} />
      })}
      <g fill="none" stroke="var(--chart-3)" strokeOpacity="0.45" strokeWidth="2.2" strokeLinejoin="round">
        <rect x="1452" y="560" width="64" height="44" rx="9" />
        <path d="M1516 574 l26 -12 v40 l-26 -12" />
      </g>
    </Svg>
  )
})

/**
 * The artwork for one page, placed behind its top area and faded into the page
 * background so content always reads clearly. Purely decorative (aria-hidden).
 */
export function Backdrop({ variant, height = 560, className, from, to, fade = true, onDark, seed }: { variant: BackdropVariant; height?: number | string; className?: string; from?: string; to?: string; fade?: boolean; onDark?: boolean; seed?: number }) {
  const art = {
    constellation: <Constellation />,
    mosaic: <Mosaic seed={seed} />,
    waves: <Waves from={from} to={to} />,
    path: <Path />,
    contours: <Contours />,
    blueprint: <Blueprint />,
    circuit: <Circuit />,
    aurora: <Aurora onDark={onDark} />,
    orbit: <Orbit />,
    ribbons: <Ribbons />,
    confetti: <Confetti />,
    notebook: <Notebook />,
    guilloche: <Guilloche />,
    honeycomb: <Honeycomb />,
    checklist: <Checklist />,
    signal: <Signal />,
    dials: <Dials />,
    bubbles: <Bubbles />,
    chartgrid: <ChartGrid />,
    orgchart: <OrgChart />,
    floorplan: <FloorPlan />,
    storyboard: <Storyboard />,
    coins: <Coins />,
    stamp: <Stamp />,
    seats: <Seats />,
    timetable: <Timetable />,
  }[variant]
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-x-0 top-0 -z-0 overflow-hidden select-none', fade && '[mask-image:linear-gradient(to_bottom,black_45%,transparent)]', className)}
      style={{ height }}
    >
      {art}
    </div>
  )
}
