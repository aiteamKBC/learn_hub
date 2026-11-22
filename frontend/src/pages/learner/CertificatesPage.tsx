import { Award, Copy, Download, ExternalLink, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { type Certificate, certificatePdfUrl, useMyCertificates } from '@/features/learning/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const verifyUrl = (code: string) => `${location.origin}/verify/${code}`

function CertificateCard({ c }: { c: Certificate }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl(c.verification_code))
      toast.success('Verification link copied')
    } catch {
      toast.error('Copy failed: the link is ' + verifyUrl(c.verification_code))
    }
  }
  return (
    <article className="group relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-all hover:-translate-y-0.5 hover:shadow">
      {/* a little certificate: double frame, seal, ribbon */}
      <div className="relative m-2.5 rounded-lg border-2 border-double border-chart-3/50 bg-gradient-to-br from-warning-soft/60 via-surface to-primary-soft/40 px-5 pt-5 pb-4">
        <span aria-hidden className="absolute -top-px right-5 h-10 w-6 bg-primary [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" />
        <span className="flex size-11 items-center justify-center rounded-full bg-chart-3/20 text-warning ring-4 ring-chart-3/10 transition-transform duration-300 group-hover:rotate-12">
          <Award className="size-6" />
        </span>
        <p className="mt-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Certificate of completion</p>
        <h2 className="mt-1 line-clamp-2 min-h-12 text-[17px] leading-snug font-semibold">{c.course_title}</h2>
        <p className="mt-2 text-sm text-muted">
          Awarded to <span className="font-medium text-text">{c.recipient_name}</span>
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <div>
            <dt className="sr-only">Issued</dt>
            <dd>{shortDate(c.issued_at)}</dd>
          </div>
          {c.cpd_hours ? (
            <div>
              <dt className="sr-only">CPD</dt>
              <dd>{c.cpd_hours} CPD hours</dd>
            </div>
          ) : null}
          <div>
            <dt className="sr-only">Code</dt>
            <dd className="font-mono tracking-wide">{c.verification_code}</dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        <Button size="sm" asChild>
          <a href={certificatePdfUrl(c.id)} download>
            <Download /> PDF
          </a>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          <Copy /> Copy link
        </Button>
        <Button size="sm" variant="ghost" asChild className="ml-auto">
          <Link to={`/verify/${c.verification_code}`}>
            Verify <ExternalLink />
          </Link>
        </Button>
      </div>
    </article>
  )
}

export function CertificatesPage() {
  const q = useMyCertificates()
  return (
    <>
      <PageHeader title="Certificates" description="Earned by finishing courses. Anyone can check one is genuine with its verification link." />
      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon={<Award />} title="No certificates yet" body="Finish every lecture of a course and its certificate appears here, ready to download and share." action={<Button asChild><Link to="/learn">Continue learning</Link></Button>} />
        </Card>
      ) : (
        <>
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.map((c) => (
              <CertificateCard key={c.id} c={c} />
            ))}
          </div>
          <p className="mt-6 inline-flex items-center gap-2 text-xs text-muted">
            <ShieldCheck className="size-4 text-success" /> Each PDF carries a QR code that opens its public verification page.
          </p>
        </>
      )}
    </>
  )
}
