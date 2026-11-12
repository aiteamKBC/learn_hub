import { CalendarClock, Package as PackageIcon, ShieldAlert, Users, Video } from 'lucide-react'
import { useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Package, usePackages } from '@/features/corporate/api'
import { BuySeats, RequestLive } from '@/features/corporate/BuyDialogs'
import { gbp } from '@/features/corporate/format'
import { QueryBlock } from '@/features/corporate/ui'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link } from '@/lib/router'

function PackageCard({ pkg, admin }: { pkg: Package; admin: boolean }) {
  const live = pkg.delivery_type === 'live'
  return (
    <Card className="flex flex-col gap-3 p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-5">{live ? <Video /> : <PackageIcon />}</span>
        <Badge tone={live ? 'info' : 'primary'}>{live ? 'Live training' : 'Recorded course'}</Badge>
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug">
          <Link to={`/courses/${pkg.course_slug}`} className="hover:underline">
            {pkg.course_title}
          </Link>
        </h3>
        {pkg.description ? <p className="mt-1 line-clamp-3 text-sm text-muted">{pkg.description}</p> : null}
      </div>
      <p className="mt-auto text-sm">
        <span className="text-lg font-semibold">{gbp(pkg.price_gbp_minor)}</span> <span className="text-muted">per {live ? 'person' : 'seat'}</span>
      </p>
      {live ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock className="size-3.5" /> You pay once your group and dates are confirmed.
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Users className="size-3.5" /> Give seats to anyone in your company.
        </p>
      )}
      {pkg.custom_quote_enabled ? <p className="text-xs text-muted">Buying for a large team? Contact us for a custom quote.</p> : null}
      {admin ? <div className="flex flex-wrap gap-2">{live ? <RequestLive pkg={pkg} /> : <BuySeats pkg={pkg} />}</div> : null}
    </Card>
  )
}

function Grid({ items, admin, kind }: { items: Package[]; admin: boolean; kind: 'recorded' | 'live' }) {
  const list = items.filter((p) => p.delivery_type === kind)
  if (!list.length)
    return (
      <Card className="p-2">
        <p className="p-6 text-center text-sm text-muted">{kind === 'live' ? 'No live training is offered right now.' : 'No recorded courses are offered right now.'}</p>
      </Card>
    )
  return (
    <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((p) => (
        <PackageCard key={p.id} pkg={p} admin={admin} />
      ))}
    </div>
  )
}

export function PackagesPage() {
  const admin = useIsOrgAdmin()
  const q = usePackages()
  useEffect(() => {
    document.title = 'Course packages · LearnHub'
  }, [])
  return (
    <>
      <PageHeader title="Course packages" description="Buy seats on recorded courses, or ask for live training for your team." />
      {!admin ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted">
          <ShieldAlert className="size-4" /> Only company admins can buy seats or request training.
        </p>
      ) : null}
      <QueryBlock query={q} rows={6} empty={{ icon: <PackageIcon />, title: 'No packages yet', body: 'Course packages for companies will appear here.' }}>
        {(items) => (
          <Tabs defaultValue="recorded">
            <TabsList aria-label="Package type">
              <TabsTrigger value="recorded">Recorded courses</TabsTrigger>
              <TabsTrigger value="live">Live training</TabsTrigger>
            </TabsList>
            <TabsContent value="recorded" className="mt-5">
              <Grid items={items} admin={admin} kind="recorded" />
            </TabsContent>
            <TabsContent value="live" className="mt-5">
              <Grid items={items} admin={admin} kind="live" />
            </TabsContent>
          </Tabs>
        )}
      </QueryBlock>
    </>
  )
}
