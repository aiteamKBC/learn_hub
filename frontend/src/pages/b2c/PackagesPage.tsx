import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PackageCard } from '@/components/PackageCard'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCashPackages } from '@/features/b2c/api'
import { Link } from '@/lib/router'

export function PackagesPage() {
  const { data, isLoading, error, refetch } = useCashPackages()
  return <>
    <PageHeader title="Course bundles" description="Buy a themed set of recorded courses in one payment. Existing access stays yours; token content unlocks are temporarily unavailable." />
    {isLoading ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-80 rounded-lg" /></div>
      : error ? <ErrorState message="We couldn't load the bundles." onRetry={() => void refetch()} />
      : !data?.length ? <Card><EmptyState icon={<Package />} title="No bundles available" body="Course bundles will appear here when available." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} /></Card>
      : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{data.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}</div>}
  </>
}
