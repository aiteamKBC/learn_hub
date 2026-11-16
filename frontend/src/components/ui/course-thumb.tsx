import { Briefcase, Code2, HeartPulse, Megaphone, Palette, Server, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'

import { useId } from 'react'

import { cn } from '@/lib/cn'

// Courses without an uploaded image get a branded cover: a gradient per category and
// its icon. Same course, same cover, every time.
// Neutral covers: a calm grey → charcoal gradient from our palette (grey #a4a9ac,
// charcoal #1f262e). Same family for every category; the icon marks the subject.
const covers: Record<string, { from: string; to: string; Icon: LucideIcon }> = {
  development: { from: '#a4a9ac', to: '#2a333c', Icon: Code2 },
  business: { from: '#a4a9ac', to: '#2a333c', Icon: Briefcase },
  design: { from: '#a4a9ac', to: '#2a333c', Icon: Palette },
  'it-software': { from: '#a4a9ac', to: '#2a333c', Icon: Server },
  'health-safety': { from: '#a4a9ac', to: '#2a333c', Icon: ShieldCheck },
  'care-compliance': { from: '#a4a9ac', to: '#2a333c', Icon: HeartPulse },
  marketing: { from: '#a4a9ac', to: '#2a333c', Icon: Megaphone },
}
const fallback = { from: '#a4a9ac', to: '#2a333c', Icon: Sparkles }

/** The gradient a category uses (course covers, and the course page artwork). */
// eslint-disable-next-line react/only-export-components
export function coverColors(category?: string | null) {
  const { from, to } = covers[slugOf(category)] ?? fallback
  return { from, to }
}

function slugOf(category?: string | null) {
  return (category ?? '').toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function CourseThumb({ src, title, category, className }: { src?: string | null; title: string; category?: string | null; className?: string }) {
  const pid = useId()
  if (src) {
    return <img src={src} alt="" loading="lazy" decoding="async" className={cn('aspect-video w-full rounded-md object-cover', className)} />
  }
  const { from, to, Icon } = covers[slugOf(category)] ?? fallback
  return (
    <div
      role="img"
      aria-label={title}
      className={cn('relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md', className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <svg className="absolute inset-0 size-full opacity-[0.14]" aria-hidden>
        <defs>
          <pattern id={pid} width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="#fff" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${pid})`} />
      </svg>
      <span className="absolute -right-6 -bottom-8 size-28 rounded-full bg-white/10" aria-hidden />
      <span className="relative flex size-12 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm">
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
    </div>
  )
}
