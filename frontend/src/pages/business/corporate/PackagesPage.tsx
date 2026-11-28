import { CalendarClock, Layers, Package as PackageIcon, ShieldAlert, Users, Video } from 'lucide-react'
import { useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type Bundle, type Package, useBundles, usePackages } from '@/features/corporate/api'
import { BuyBundle, BuySeveral } from '@/features/corporate/BasketDialog'
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

function BundleCard({ b, admin }: { b: Bundle; admin: boolean }) {
  return (
    <Card className="flex flex-col gap-3 p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-5">
          <Layers />
        </span>
        <Badge tone="primary">{b.courses.length} courses</Badge>
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug">{b.title}</h3>
        {b.description ? <p className="mt-1 line-clamp-3 text-sm text-muted">{b.description}</p> : null}
      </div>
      <ul className="grid gap-1 text-sm">
        {b.courses.map((c) => (
          <li key={c.course_id} className="flex items-center justify-between gap-2">
            <Link to={`/courses/${c.slug}`} className="min-w-0 truncate hover:underline">
              {c.title}
            </Link>
            {c.seats_on_sale ? (c.normal_price_minor ? <span className="shrink-0 text-xs text-subtle line-through">{gbp(c.normal_price_minor)}</span> : null) : <span className="shrink-0 text-xs text-muted">Not sold as seats yet</span>}
          </li>
        ))}
      </ul>
      <p className="mt-auto text-sm">
        <span className="text-lg font-semibold">{gbp(b.seat_price_minor)}</span> <span className="text-muted">per seat, any course</span>
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Users className="size-3.5" /> Split the seats between the courses however you like.
      </p>
      {admin ? <BuyBundle bundle={b} /> : null}
    </Card>
  )
}

function Bundles({ admin }: { admin: boolean }) {
  const q = useBundles()
  return (
    <QueryBlock query={q} rows={3} empty={{ icon: <Layers />, title: 'No bundles yet', body: 'LearnHub groups courses into bundles at a lower seat price. They appear here when one is on sale.' }}>
      {(items) => (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <BundleCard key={b.id} b={b} admin={admin} />
          ))}
        </div>
      )}
    </QueryBlock>
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
      <PageHeader title="Company course catalogue" description="Recorded courses use the same published price shown to individual learners. Buy seats for employees; request live training separately and agree dates with the LearnHub admin." />
      {!admin ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted">
          <ShieldAlert className="size-4" /> Only company admins can buy seats or request training.
        </p>
      ) : null}
      <QueryBlock query={q} rows={6} empty={{ icon: <PackageIcon />, title: 'No courses available yet', body: 'Published, paid recorded courses appear here automatically. Live courses appear when LearnHub makes them available for company requests.' }}>
        {(items) => (
          <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') === 'bundles' ? 'bundles' : 'recorded'}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList aria-label="Package type">
                <TabsTrigger value="recorded">Recorded courses</TabsTrigger>
                <TabsTrigger value="bundles">Bundles</TabsTrigger>
                <TabsTrigger value="live">Live training</TabsTrigger>
              </TabsList>
              {admin ? <BuySeveral packages={items} /> : null}
            </div>
            <TabsContent value="recorded" className="mt-5">
              <Grid items={items} admin={admin} kind="recorded" />
            </TabsContent>
            <TabsContent value="bundles" className="mt-5">
              <Bundles admin={admin} />
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
