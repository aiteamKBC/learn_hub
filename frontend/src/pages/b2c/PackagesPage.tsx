import { BookOpen, Check, Info, Package } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCashPackages } from '@/features/b2c/api'
import type { ReviewItem } from '@/pages/b2c/CheckoutReviewPage'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

// My Learning reads the real, server-granted enrolments — so landing there after payment
// shows exactly what the server actually unlocked, never an assumption from the return URL.
const SUCCESS = '/learn?welcome=package'
const CANCEL = '/packages'

/** Cash course bundles: pay once, keep the courses. A full-price alternative to unlocking
 * with tokens or subscribing. */
export function PackagesPage() {
  const { data, isLoading, error, refetch } = useCashPackages()
  const navigate = useNavigate()

  const buy = (pkg: { id: string; name: string; amount_minor: number; currency: string; courses: { id: string }[] }) => {
    const item: ReviewItem = {
      kind: 'package',
      packageId: pkg.id,
      name: pkg.name,
      courseCount: pkg.courses.length,
      amountMinor: pkg.amount_minor,
      currency: pkg.currency,
      successPath: SUCCESS,
      cancelPath: CANCEL,
    }
    navigate('/checkout/review', { state: item })
  }

  return (
    <>
      <PageHeader title="Course bundles" description="Buy a themed set of courses together, in one payment." />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </div>
        ) : error ? (
          <ErrorState message="We couldn't load the bundles." onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <PackagesPreview />
        ) : (
          <div className="stagger grid gap-5 md:grid-cols-2">
            {data.map((pkg) => (
              <Card key={pkg.id} className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3 border-b border-border bg-primary-soft/30 px-5 py-4">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-on-primary">
                    <Package className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{pkg.name}</p>
                    <p className="text-xs text-muted">
                      {pkg.courses.length} {pkg.courses.length === 1 ? 'course' : 'courses'}
                    </p>
                  </div>
                  <p className="text-xl font-bold">{money(pkg.amount_minor, pkg.currency)}</p>
                </div>
                <CardBody className="flex flex-1 flex-col">
                  {pkg.description ? <p className="text-sm text-muted">{pkg.description}</p> : null}
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {pkg.courses.map((c) => (
                      <li key={c.id} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        <Link to={`/courses/${c.slug}`} className="hover:text-primary hover:underline">
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {pkg.owned_count > 0 ? (
                    <p className="mt-3 flex items-center gap-2 rounded-md bg-primary-soft/40 px-3 py-2 text-xs text-primary-soft-text">
                      <Info className="size-3.5 shrink-0" />
                      {pkg.owned_count >= pkg.courses.length
                        ? 'You already have access to all of these (e.g. via your subscription).'
                        : `You already have ${pkg.owned_count} of these ${pkg.courses.length} courses.`}
                    </p>
                  ) : null}
                  <div className="mt-auto flex gap-2 pt-5">
                    {pkg.owned_count >= pkg.courses.length ? (
                      <Button className="flex-1" variant="secondary" disabled>
                        Already yours
                      </Button>
                    ) : (
                      <Button className="flex-1" onClick={() => buy(pkg)}>
                        <BookOpen /> Buy bundle
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
    </>
  )
}

function PackagesPreview() {
  const samples = [
    { name: 'Workplace Safety Essentials', category: 'Health & Safety', price: 'CA$119.99', courses: ['Fire Safety Awareness', 'Manual Handling', 'First Aid Awareness'] },
    { name: 'Care & Compliance Starter', category: 'Care & Compliance', price: 'CA$129.99', courses: ['Safeguarding Adults', 'GDPR Essentials', 'Infection Prevention and Control'] },
  ]
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {samples.map((pkg) => (
        <Card key={pkg.name} className="overflow-hidden rounded-2xl">
          <div className="relative">
            <CourseThumb title={pkg.name} category={pkg.category} className="rounded-none" />
            <Badge tone="warning" className="absolute top-3 left-3 shadow-sm">Example bundle</Badge>
          </div>
          <CardBody className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-lg font-bold tracking-tight">{pkg.name}</p><p className="mt-1 text-xs text-muted">{pkg.courses.length} courses · lifetime access</p></div>
              <p className="shrink-0 text-xl font-extrabold">{pkg.price}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {pkg.courses.map((course) => <li key={course} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /><span>{course}</span></li>)}
            </ul>
            <div className="mt-5 flex gap-2">
              <Button asChild className="flex-1"><Link to="/courses"><BookOpen /> Browse courses</Link></Button>
              <Button variant="secondary" disabled>Preview</Button>
            </div>
          </CardBody>
        </Card>
      ))}
      <Card className="rounded-2xl border-dashed p-5 text-center md:col-span-2">
        <Package className="mx-auto size-7 text-primary" /><p className="mt-2 text-sm text-muted">Real bundles will replace these examples automatically when they are published.</p>
      </Card>
    </div>
  )
}
