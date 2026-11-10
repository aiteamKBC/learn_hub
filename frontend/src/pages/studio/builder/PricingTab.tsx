import { Check, Gift, Tag } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type StudioCourse, usePriceTiers, useSetPrice } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { money } from '@/lib/format'
import { radioKeyDown, radioTabIndex } from '@/lib/radio'

import { useUnsavedChanges } from './unsaved'

const FREE = 'free'

export function PricingTab({ course }: { course: StudioCourse }) {
  const tiers = usePriceTiers()
  const save = useSetPrice(course.id)
  const current = course.price ? (course.price.free ? FREE : (course.price.tier_id ?? null)) : null
  const [picked, setPicked] = useState<string | null>(current)
  const dirty = picked !== current
  useUnsavedChanges(dirty && !save.isPending)

  if (tiers.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading prices">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }
  if (tiers.error) return <ErrorState onRetry={() => void tiers.refetch()} />

  const options = [{ id: FREE, name: 'Free', gbp_minor: 0 }, ...tiers.data]
  const checkedIndex = options.findIndex((o) => o.id === picked)

  const onSave = () => {
    if (!picked) return
    save.mutate(picked === FREE ? { free: true } : { free: false, tier_id: picked }, {
      onSuccess: () => toast.success('Price saved'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0 p-5 sm:p-6">
        <h2 className="text-base font-semibold" id="price-label">
          Course price
        </h2>
        <p className="mt-1 text-sm text-muted">Pick a price tier. Learners see it in their own currency.</p>
        <div role="radiogroup" aria-labelledby="price-label" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 stagger">
          {options.map((o, i) => {
            const on = picked === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={radioTabIndex(i, checkedIndex)}
                onClick={() => setPicked(o.id)}
                onKeyDown={(e) => radioKeyDown(e, i, options.length, (j) => setPicked(options[j]!.id))}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/30',
                  on ? 'border-primary bg-primary-soft/60 shadow-sm' : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]', on ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted')}>
                  {on ? <Check /> : o.id === FREE ? <Gift /> : <Tag />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold tabular">{o.id === FREE ? 'Free' : money(o.gbp_minor, 'GBP')}</span>
                  <span className="block truncate text-xs text-muted">{o.id === FREE ? 'Anyone can enrol' : o.name}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <div className="grid min-w-0 content-start gap-3">
        <Card className="p-5">
          <p className="text-[13px] text-muted">Current price</p>
          <p className="mt-1 text-2xl font-semibold tabular">
            {!course.price ? 'Not set' : course.price.free ? 'Free' : money(course.price.gbp_minor, 'GBP')}
          </p>
          {course.price?.tier ? <p className="mt-0.5 text-xs text-muted">{course.price.tier}</p> : null}
        </Card>
        <Button onClick={onSave} disabled={!dirty || !picked} loading={save.isPending}>
          Save price
        </Button>
        <p className="text-xs text-muted" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'Your share of each sale is shown under Sales & earnings.'}
        </p>
      </div>
    </div>
  )
}
