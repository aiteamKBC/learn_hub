/** Admin controls backed by the existing platform settings contract. */
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Home, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { useSaveSettings } from '@/features/console/settings'
import { usePublicSettings } from '@/features/platform/api'

type Section = { id: string; label: string; note: string; visible: boolean; locked?: boolean }

const INITIAL: Section[] = [
  { id: 'hero', label: 'Hero', note: 'Headline, call to action and log-in', visible: true, locked: true },
  { id: 'categories', label: 'Browse by category', note: 'Every discipline, one way of learning', visible: true },
  { id: 'courses', label: 'Featured courses', note: 'Courses built around skills', visible: true },
  { id: 'sales', label: 'Course bundles', note: 'Offers, priced like a decision', visible: true },
  { id: 'new', label: 'New and noteworthy', note: 'The latest published courses', visible: true },
  { id: 'why', label: 'Why LearnHub', note: 'Catalogue statistics and teaching approach', visible: true },
  { id: 'instructors', label: 'Instructors', note: 'Taught by people who ship it', visible: true },
  { id: 'membership', label: 'Membership', note: 'One membership, every course', visible: true },
]

const LANDING = [
  { id: 'home', label: 'Marketing home', note: 'The public landing page (/)' },
  { id: 'courses', label: 'Course catalogue', note: 'Send visitors straight to /courses' },
  { id: 'plans', label: 'Plans and pricing', note: 'Open on /plans' },
]

export function ConsoleHomeLayoutPage() {
  const { settings, isLoading } = usePublicSettings()
  const save = useSaveSettings()
  const [sections, setSections] = useState<Section[]>(INITIAL)
  const [landing, setLanding] = useState('home')
  const [hydrated, setHydrated] = useState(false)
  const storedOrder = settings['home.section_order'].split(',')
  const storedHidden = settings['home.hidden_sections'].split(',').filter(Boolean)
  const storedSections = storedOrder.map((id) => INITIAL.find((section) => section.id === id)).filter((section): section is Section => !!section)
    .map((section) => ({ ...section, visible: !storedHidden.includes(section.id) }))
  const validStored = storedSections.length === INITIAL.length
  const baseline = validStored ? storedSections : INITIAL
  const dirty = JSON.stringify(sections) !== JSON.stringify(baseline) || landing !== settings['home.default_landing']

  useEffect(() => {
    if (isLoading || hydrated) return
    setSections(baseline)
    setLanding(settings['home.default_landing'])
    setHydrated(true)
  }, [isLoading, hydrated, settings['home.section_order'], settings['home.hidden_sections'], settings['home.default_landing']])

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= sections.length || sections[i].locked || sections[j].locked) return
    const next = [...sections]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSections(next)
  }
  const toggle = (id: string) => setSections((s) => s.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)))
  const reset = () => (setSections(INITIAL), setLanding('home'))
  const saveLayout = async () => {
    try {
      await save.mutateAsync({
        'home.section_order': sections.map((section) => section.id).join(','),
        'home.hidden_sections': sections.filter((section) => !section.visible).map((section) => section.id).join(','),
        'home.default_landing': landing,
      })
      toast.success('Home layout saved')
    } catch {
      toast.error('Could not save the home layout')
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Home page layout"
        description="Reorder the sections on the marketing home page, hide the ones you don't need, and choose the default landing page."
        actions={
          <>
            <Button variant="ghost" onClick={reset} disabled={!dirty}>
              <RotateCcw /> Reset
            </Button>
            <Button onClick={() => void saveLayout()} disabled={!dirty || save.isPending || isLoading}>
              Save layout
            </Button>
          </>
        }
      />

      <Card className="p-2 sm:p-3">
        <ul className="grid gap-1.5">
          {sections.map((s, i) => (
            <li
              key={s.id}
              className={cn('flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-opacity', !s.visible && 'opacity-55')}
            >
              <GripVertical className="size-4 shrink-0 text-subtle" aria-hidden />
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[13px] font-semibold text-muted tabular">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-text">
                  {s.label}
                  {s.locked ? <Badge tone="neutral">Fixed</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted">{s.note}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" aria-label={s.visible ? `Hide ${s.label}` : `Show ${s.label}`} onClick={() => toggle(s.id)} disabled={s.locked}>
                  {s.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move ${s.label} up`} onClick={() => move(i, -1)} disabled={i === 0 || !!s.locked || !!sections[i - 1]?.locked}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move ${s.label} down`} onClick={() => move(i, 1)} disabled={i === sections.length - 1 || !!s.locked || !!sections[i + 1]?.locked}>
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-text">
        <Home className="size-4 text-primary" /> Default landing page
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {LANDING.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLanding(l.id)}
            aria-pressed={landing === l.id}
            className={cn(
              'rounded-xl border p-4 text-left transition-colors',
              landing === l.id ? 'border-primary bg-primary-soft/40 ring-1 ring-primary' : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <p className="text-sm font-semibold text-text">{l.label}</p>
            <p className="mt-1 text-xs text-muted">{l.note}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
