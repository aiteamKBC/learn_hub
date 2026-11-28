import { Award, CheckCircle2, Copy, Download, ExternalLink, LockKeyhole, PlayCircle, ShieldCheck, Sparkles, Trophy } from 'lucide-react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { LogoMark } from '@/components/ui/logo'
import { useMe } from '@/features/identity/auth'
import { type Certificate, type MyCourse, certificatePdfUrl, useMyCertificates, useMyCourses } from '@/features/learning/api'
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

function CourseProgressCard({ course }: { course: MyCourse }) {
  const progress = Math.round(course.progress_pct)
  const remaining = Math.max(0, 100 - progress)

  return (
    <article className="group grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow sm:grid-cols-[180px_minmax(0,1fr)]">
      <CourseThumb src={course.thumbnail_url} title={course.title} className="h-full min-h-28 rounded-xl" />
      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">Certificate journey</p>
            <h3 className="mt-1 truncate text-lg font-bold tracking-tight">{course.title}</h3>
            <p className="mt-0.5 truncate text-sm text-muted">{course.instructors.join(', ') || 'LearnHub Academy'}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary-soft-text tabular">{progress}%</span>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">{progress}% complete</span>
            <span className="text-muted">{remaining}% left to unlock your certificate</span>
          </div>
          <Progress value={progress} label={`${course.title}: ${progress}% complete`} className="h-2.5" />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted">
            <LockKeyhole className="size-3.5 text-primary" /> Complete the course to unlock the verified certificate.
          </p>
          <Button size="sm" asChild>
            <Link to={`/learn/${course.slug}`}><PlayCircle /> {progress > 0 ? 'Continue course' : 'Start course'}</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

function CertificatePreview({ course, recipient }: { course?: MyCourse; recipient: string }) {
  const progress = Math.round(course?.progress_pct ?? 0)
  const remaining = Math.max(0, 100 - progress)

  return (
    <aside className="xl:sticky xl:top-24 xl:self-start">
      <Card className="overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">Live preview</p>
            <h2 className="mt-0.5 text-lg font-bold tracking-tight">Your certificate</h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">
            <LockKeyhole className="size-3.5" /> Locked
          </span>
        </div>

        <div className="relative aspect-[1.414/1] overflow-hidden rounded-xl border border-[#e7c08d] bg-[#fffaf3] p-2 shadow-inner">
          <div className="relative flex h-full flex-col items-center justify-between overflow-hidden rounded-lg border-2 border-[#ee7b22]/45 px-5 py-4 text-center">
            <span aria-hidden className="absolute -top-16 -left-14 size-36 rounded-full border-[18px] border-primary/10" />
            <span aria-hidden className="absolute -right-12 -bottom-16 size-40 rounded-full border-[20px] border-primary/10" />
            <div className="relative z-10 flex items-center gap-2 text-sm font-extrabold text-[#111827]">
              <LogoMark className="h-6" /> Evid<span className="-ml-2 text-primary">Rise</span>
            </div>
            <div className="relative z-10">
              <Award className="mx-auto size-8 text-primary" strokeWidth={1.7} />
              <p className="mt-1 text-[9px] font-semibold tracking-[0.2em] text-[#8a5a34] uppercase">Certificate of completion</p>
              <p className="mt-2 text-[9px] text-muted">This certificate is proudly presented to</p>
              <p className="mt-0.5 font-serif text-lg font-bold text-[#111827]">{recipient}</p>
              <p className="mt-1 text-[9px] text-muted">for successfully completing</p>
              <p className="mt-0.5 line-clamp-1 text-sm font-bold text-[#111827]">{course?.title ?? 'Your course title'}</p>
            </div>
            <div className="relative z-10 flex w-full items-end justify-between text-[8px] text-muted">
              <span className="border-t border-[#b8a38e] px-3 pt-1">LearnHub Academy</span>
              <span className="flex size-9 items-center justify-center rounded-full border-2 border-primary/40 bg-primary-soft text-primary"><ShieldCheck className="size-5" /></span>
              <span className="border-t border-[#b8a38e] px-3 pt-1">Verified credential</span>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-primary-soft/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">Certificate progress</span>
            <span className="text-sm font-extrabold text-primary tabular">{progress}%</span>
          </div>
          <Progress value={progress} label="Certificate progress" className="mt-2 h-2.5 bg-white/80" />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {remaining > 0 ? `Only ${remaining}% of the course remains before this certificate is unlocked.` : 'Course complete. Your certificate is being prepared.'}
          </p>
        </div>
      </Card>
    </aside>
  )
}

export function CertificatesPage() {
  const certificates = useMyCertificates()
  const courses = useMyCourses()
  const { data: me } = useMe()
  const courseItems = courses.data?.items ?? []
  const pendingCourses = courseItems.filter((course) => !course.certificate_id && course.progress_pct < 100)
  const featuredCourse = [...pendingCourses].sort((a, b) => b.progress_pct - a.progress_pct)[0]
  const earned = certificates.data ?? []
  const closestProgress = Math.round(featuredCourse?.progress_pct ?? 0)
  const recipient = me?.full_name || 'Learner name'
  const error = certificates.error ?? courses.error
  const loading = certificates.isLoading || courses.isLoading

  return (
    <>
      <PageHeader title="Certificates" description="Track how close you are to your next certificate, then download and share every certificate you earn." />
      {error ? (
        <ErrorState message={error.message} onRetry={() => void (certificates.refetch(), courses.refetch())} />
      ) : loading ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]">
          <div className="grid gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
          <Skeleton className="h-[480px] rounded-2xl" />
        </div>
      ) : !courseItems.length && !earned.length ? (
        <Card className="rounded-2xl">
          <EmptyState icon={<Award />} title="Your certificate journey starts here" body="Enrol in a course and you will see its live progress and certificate preview on this page." action={<Button asChild><Link to="/courses">Explore courses</Link></Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Card className="flex items-center gap-3 rounded-2xl p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Sparkles className="size-5" /></span>
              <div><p className="text-2xl font-extrabold tabular">{pendingCourses.length}</p><p className="text-xs text-muted">Certificates in progress</p></div>
            </Card>
            <Card className="flex items-center gap-3 rounded-2xl p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning"><Award className="size-5" /></span>
              <div><p className="text-2xl font-extrabold tabular">{closestProgress}%</p><p className="text-xs text-muted">Closest certificate progress</p></div>
            </Card>
            <Card className="flex items-center gap-3 rounded-2xl p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success"><Trophy className="size-5" /></span>
              <div><p className="text-2xl font-extrabold tabular">{earned.length}</p><p className="text-xs text-muted">Certificates earned</p></div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]">
            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Your certificate journey</h2>
                  <p className="mt-1 text-sm text-muted">Finish each course to unlock its downloadable, verified certificate.</p>
                </div>
                <Button variant="secondary" size="sm" asChild><Link to="/learn">My learning</Link></Button>
              </div>
              {pendingCourses.length ? (
                <div className="stagger grid gap-4">
                  {pendingCourses.map((course) => <CourseProgressCard key={course.enrollment_id} course={course} />)}
                </div>
              ) : (
                <Card className="rounded-2xl p-6">
                  <div className="flex items-center gap-3"><CheckCircle2 className="size-8 text-success" /><div><h3 className="font-bold">All current courses are complete</h3><p className="text-sm text-muted">Your earned certificates are ready below.</p></div></div>
                </Card>
              )}
            </section>

            <CertificatePreview course={featuredCourse ?? courseItems[0]} recipient={recipient} />
          </div>

          <section className="mt-10">
            <div className="mb-4">
              <h2 className="text-xl font-bold tracking-tight">Earned certificates</h2>
              <p className="mt-1 text-sm text-muted">Download, share or verify certificates you have already unlocked.</p>
            </div>
            {earned.length ? (
              <>
                <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {earned.map((c) => <CertificateCard key={c.id} c={c} />)}
                </div>
                <p className="mt-6 inline-flex items-center gap-2 text-xs text-muted">
                  <ShieldCheck className="size-4 text-success" /> Each PDF carries a QR code that opens its public verification page.
                </p>
              </>
            ) : (
              <Card className="rounded-2xl border-dashed p-5">
                <p className="flex items-center gap-3 text-sm text-muted"><LockKeyhole className="size-5 text-primary" /> Your first certificate will appear here as soon as you complete a course.</p>
              </Card>
            )}
          </section>
        </>
      )}
    </>
  )
}
