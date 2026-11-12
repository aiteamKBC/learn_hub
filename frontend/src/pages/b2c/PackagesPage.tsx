import { BookOpen, Check, Info, Package } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
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
    <div className="relative isolate min-h-[70vh]">
      <Backdrop variant="ribbons" height={520} />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Course bundles" description="Buy a themed set of courses together, in one payment." />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </div>
        ) : error ? (
          <ErrorState message="We couldn't load the bundles." onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <EmptyState
            icon={<Package />}
            title="No bundles available"
            body="There aren't any course bundles right now. You can still unlock courses with tokens or subscribe."
            action={
              <Button asChild>
                <Link to="/courses">Browse courses</Link>
              </Button>
            }
          />
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
      </div>
    </div>
  )
}
