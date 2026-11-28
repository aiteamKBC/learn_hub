import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/router'
import { money } from '@/lib/format'
import type { useCashPackages } from '@/features/b2c/api'

type Bundle = NonNullable<ReturnType<typeof useCashPackages>['data']>[number]

export function PackageCard({ pkg }: { pkg: Bundle }) {
  const savings = pkg.full_minor - pkg.amount_minor
  const percent = pkg.full_minor > 0 ? Math.round(savings * 100 / pkg.full_minor) : 0
  return <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-primary-soft via-surface-2 to-surface">
      {pkg.courses[0]?.thumbnail_url ? <img src={pkg.courses[0].thumbnail_url} alt="" className="h-full w-full object-cover" /> : <Package className="size-12 text-primary/70" aria-hidden />}
      {savings > 0 && <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs text-on-primary">Save {percent}%</span>}
    </div>
    <div className="flex flex-1 flex-col p-5">
      <h3 className="font-semibold text-text">{pkg.name}</h3>
      {pkg.description && <p className="mt-1 text-sm text-muted">{pkg.description}</p>}
      <p className="mt-3 text-sm text-muted">{pkg.courses.length} courses · {Math.round(pkg.duration_sec / 60)} minutes</p>
      <ul className="mt-3 space-y-2 text-sm">{pkg.courses.slice(0, 4).map(course => <li key={course.id} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-primary" />{course.title}</li>)}</ul>
      <div className="mt-auto pt-5"><div className="flex items-baseline gap-2"><strong className="text-xl">{money(pkg.amount_minor, pkg.currency)}</strong>{savings > 0 && <span className="text-sm text-muted line-through">{money(pkg.full_minor, pkg.currency)}</span>}</div>
      {savings > 0 && <p className="text-sm text-success">Save {money(savings, pkg.currency)} ({percent}%)</p>}
      <Button asChild className="mt-4 w-full"><Link to={`/packages/${pkg.slug}`}>View package details</Link></Button></div>
    </div>
  </article>
}
