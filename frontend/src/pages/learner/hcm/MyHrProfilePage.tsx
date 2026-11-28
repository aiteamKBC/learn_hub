import { Award, BadgeCheck, Briefcase, CalendarClock, HeartHandshake, Save, UserRound } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'
import { type MemberQualification, type Profile, TRACK_LABEL, useMyProfile, useMyQualifications, useUpdateMyProfile } from '@/features/hcm/api'

function ProfileForm({ profile }: { profile: Profile }) {
  const save = useUpdateMyProfile()
  const [aspiration, setAspiration] = useState(profile.aspiration)
  const [adjustments, setAdjustments] = useState(profile.adjustments)
  useEffect(() => {
    setAspiration(profile.aspiration)
    setAdjustments(profile.adjustments)
  }, [profile])
  const dirty = aspiration !== profile.aspiration || adjustments !== profile.adjustments

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { aspiration, adjustments },
          { onSuccess: () => toast.success('Your profile is saved'), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <Field label="Where you want your career to go" hint="Shared with HR to help plan your learning.">
        {(p) => <Textarea {...p} maxLength={300} value={aspiration} onChange={(e) => setAspiration(e.target.value)} placeholder="For example: move into a team lead role within two years." />}
      </Field>
      <Field label="Workplace adjustments" hint="Anything that helps you do your best work. These details are part of your HR record.">
        {(p) => <Textarea {...p} maxLength={2000} value={adjustments} onChange={(e) => setAdjustments(e.target.value)} placeholder="For example: a quiet space for focused work, flexible start times." />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!dirty}>
          <Save /> Save changes
        </Button>
      </div>
    </form>
  )
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="font-medium break-words">{value}</dd>
      </div>
    </div>
  )
}

function Quals({ items }: { items: MemberQualification[] }) {
  if (!items.length)
    return <p className="px-5 pb-5 text-sm text-muted">No qualifications have been awarded to you yet.</p>
  return (
    <ul className="stagger grid gap-2 p-4">
      {items.map((q) => (
        <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
          <div className="min-w-0">
            <p className="font-medium">{q.qualification_name}</p>
            {q.code ? <p className="text-xs text-muted">{q.code}</p> : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            {q.awarded_on ? <span>Awarded {shortDate(q.awarded_on)}</span> : null}
            {q.expires_on ? <Badge tone="warning">Expires {shortDate(q.expires_on)}</Badge> : <Badge tone="success">No expiry</Badge>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function MyHrProfilePage() {
  const { data: profile, isLoading, error, refetch } = useMyProfile()
  const quals = useMyQualifications()

  return (
    <>
      <PageHeader title="My HR profile" description="How your details stand at work, and where you want to go next." />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !profile ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <div className="animate-reveal grid gap-6 lg:grid-cols-2">
          <div className="grid gap-6">
            <Card>
              <CardHeader title="Your details" description="Set by your company. Speak to HR if something looks wrong." />
              <CardBody>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Fact icon={<UserRound />} label="Name" value={profile.full_name || profile.email} />
                  <Fact icon={<Briefcase />} label="Track and level" value={`${(TRACK_LABEL[profile.track] ?? profile.track) || 'Not set'}${profile.level ? ` · Level ${profile.level}` : ''}`} />
                  <Fact icon={<HeartHandshake />} label="Line manager" value={profile.line_manager_name || 'Not set'} />
                  <Fact icon={<Briefcase />} label="Location" value={profile.location || 'Not set'} />
                  <Fact icon={<CalendarClock />} label="Started" value={profile.start_date ? shortDate(profile.start_date) : 'Not set'} />
                  <Fact icon={<BadgeCheck />} label="CPD hours logged" value={<span className="tabular">{profile.cpd_hours_cached}</span>} />
                  <Fact icon={<Award />} label="Qualifications" value={quals.data ? quals.data.length : '—'} />
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="What you can change" />
              <CardBody>
                <ProfileForm profile={profile} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6">
            <Card>
              <CardHeader title="Your qualifications" action={<Award className="size-5 text-muted" aria-hidden />} />
              {quals.error ? (
                <ErrorState message={(quals.error as Error).message} onRetry={() => void quals.refetch()} />
              ) : quals.isLoading || !quals.data ? (
                <div className="grid gap-2 p-4">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-14 rounded-lg" />
                  ))}
                </div>
              ) : (
                <Quals items={quals.data} />
              )}
            </Card>
            <Card className="p-5">
              <EmptyState
                icon={<HeartHandshake />}
                title="Keep your record up to date"
                body="Share how you are doing and log the learning you do outside the platform."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="secondary" asChild>
                      <Link to="/learn/wellbeing">Wellbeing check-in</Link>
                    </Button>
                    <Button variant="secondary" asChild>
                      <Link to="/learn/cpd">Log CPD</Link>
                    </Button>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
