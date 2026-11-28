import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState, PageHeader } from '@/components/ui/misc'
import { useCashPackages } from '@/features/b2c/api'
import type { ReviewItem } from '@/pages/b2c/CheckoutReviewPage'
import { money } from '@/lib/format'
import { Link } from '@/lib/router'

export function PackageDetailPage() {
  const { slug } = useParams()
  const { data, isLoading, error, refetch } = useCashPackages()
  const navigate = useNavigate()
  const pkg = data?.find(item => item.slug === slug)
  if (isLoading) return <p className="p-8 text-muted">Loading package…</p>
  if (error) return <ErrorState message="Could not load this package." onRetry={() => void refetch()} />
  if (!pkg) return <PageHeader title="Package unavailable" description="This package is no longer available." />
  const savings = pkg.full_minor - pkg.amount_minor
  const percent = pkg.full_minor > 0 ? Math.round(savings * 100 / pkg.full_minor) : 0
  const buy = () => {
    const item: ReviewItem = { kind: 'package', packageId: pkg.id, name: pkg.name, courseCount: pkg.courses.length, amountMinor: pkg.amount_minor, currency: pkg.currency, successPath: '/learn?welcome=package', cancelPath: `/packages/${pkg.slug}` }
    navigate('/checkout/review', { state: item })
  }
  return <div className="space-y-6">
    <PageHeader title={pkg.name} description={pkg.description || `${pkg.courses.length} recorded courses in one bundle.`} />
    <p className="text-sm text-muted">{pkg.courses.length} courses · {Math.round(pkg.duration_sec / 60)} minutes</p>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">{pkg.courses.map(course => <Card key={course.id} className="overflow-hidden p-5">
        <div className="flex gap-4">{course.thumbnail_url ? <img src={course.thumbnail_url} alt="" className="size-20 rounded-lg object-cover" /> : <div className="flex size-20 items-center justify-center rounded-lg bg-primary-soft text-primary">Course</div>}
          <div><h2 className="font-semibold"><Link to={`/courses/${course.slug}`} className="hover:text-primary">{course.title}</Link></h2><p className="text-sm text-muted">{course.category} · {course.instructor} · {course.level}</p><p className="text-sm text-muted">{course.lecture_count} lessons · {Math.round(course.duration_sec / 60)} min · {course.access_days ? `${course.access_days} days access` : 'Lifetime access'}</p><p className="font-semibold">{money(course.list_minor, pkg.currency)}</p></div>
        </div>
        {course.description && <div className="mt-4 text-sm text-muted" dangerouslySetInnerHTML={{ __html: course.description }} />}
        <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer font-medium">Public curriculum</summary>{(course.curriculum as { title: string; lectures: { title: string; kind: string }[] }[]).map((section, index) => <div key={index} className="mt-3"><h3 className="text-sm font-medium">{section.title}</h3><ul className="ml-5 list-disc text-sm text-muted">{section.lectures.map((lecture, i) => <li key={i}>{lecture.title} · {lecture.kind.replace('_', ' ')}</li>)}</ul></div>)}</details>
      </Card>)}</div>
      <Card className="h-fit space-y-3 p-5 lg:sticky lg:top-24"><h2 className="font-semibold">Bundle summary</h2><div className="flex justify-between"><span>Individual total</span><span>{money(pkg.full_minor, pkg.currency)}</span></div><div className="flex justify-between font-bold"><span>Bundle price</span><span>{money(pkg.amount_minor, pkg.currency)}</span></div>{savings > 0 && <p className="text-success">Save {money(savings, pkg.currency)} ({percent}%)</p>}{pkg.owned_count > 0 && <p className="text-sm text-muted">You already have {pkg.owned_count} of these courses. The bundle price is unchanged.</p>}<Button className="w-full" onClick={buy} disabled={pkg.owned_count >= pkg.courses.length}>{pkg.owned_count >= pkg.courses.length ? 'Already yours' : 'Buy bundle'}</Button></Card>
    </div>
  </div>
}
