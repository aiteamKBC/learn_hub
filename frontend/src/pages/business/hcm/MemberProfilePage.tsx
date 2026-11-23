import { Award, Plus, Save, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'
import { type Profile, TRACK_LABEL, useAwardQualification, useMemberProfile, useQualifications, useUpdateHrProfile } from '@/features/hcm/api'
import { useIsOrgAdmin, usePeople } from '@/features/org/api'

const TRACKS = ['ic', 'management', 'specialist', 'support']

function HrForm({ memberId, profile }: { memberId: string; profile: Profile }) {
  const save = useUpdateHrProfile(memberId)
  const people = usePeople({})
  const managers = useMemo(() => (people.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.member_id !== memberId), [people.data, memberId])
  const [form, setForm] = useState({
    track: profile.track ?? '',
    level: profile.level != null ? String(profile.level) : '',
    location: profile.location ?? '',
    start_date: profile.start_date ?? '',
    termination_date: profile.termination_date ?? '',
    line_manager_id: profile.line_manager_id ?? '',
    aspiration: profile.aspiration ?? '',
    adjustments: profile.adjustments ?? '',
  })
  useEffect(() => {
    setForm({
      track: profile.track ?? '',
      level: profile.level != null ? String(profile.level) : '',
      location: profile.location ?? '',
      start_date: profile.start_date ?? '',
      termination_date: profile.termination_date ?? '',
      line_manager_id: profile.line_manager_id ?? '',
      aspiration: profile.aspiration ?? '',
      adjustments: profile.adjustments ?? '',
    })
  }, [profile])

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          {
            track: form.track,
            level: form.level === '' ? null : Number(form.level),
            location: form.location,
            start_date: form.start_date || null,
            termination_date: form.termination_date || null,
            line_manager_id: form.line_manager_id || null,
            aspiration: form.aspiration,
            adjustments: form.adjustments,
          },
          { onSuccess: () => toast.success('Profile updated'), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Track">
          {(p) => (
            <NativeSelect {...p} value={form.track} onChange={(e) => setForm((f) => ({ ...f, track: e.target.value }))}>
              <option value="">Not set</option>
              {TRACKS.map((t) => (
                <option key={t} value={t}>
                  {TRACK_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Level" hint="Level 1 to 4, if your company uses levels.">
          {(p) => <Input {...p} type="number" min={1} max={4} step={1} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} />}
        </Field>
        <Field label="Location">
          {(p) => <Input {...p} maxLength={160} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="For example: London office" />}
        </Field>
        <Field label="Line manager">
          {(p) => (
            <NativeSelect {...p} value={form.line_manager_id} onChange={(e) => setForm((f) => ({ ...f, line_manager_id: e.target.value }))}>
              <option value="">Not set</option>
              {managers.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.name || m.email}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Start date">
          {(p) => <Input {...p} type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />}
        </Field>
        <Field label="Leaving date" hint="Leave blank if they are still with you.">
          {(p) => <Input {...p} type="date" value={form.termination_date} onChange={(e) => setForm((f) => ({ ...f, termination_date: e.target.value }))} />}
        </Field>
      </div>
      <Field label="Career aspiration">
        {(p) => <Textarea {...p} maxLength={300} value={form.aspiration} onChange={(e) => setForm((f) => ({ ...f, aspiration: e.target.value }))} />}
      </Field>
      <Field label="Workplace adjustments">
        {(p) => <Textarea {...p} maxLength={2000} value={form.adjustments} onChange={(e) => setForm((f) => ({ ...f, adjustments: e.target.value }))} />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          <Save /> Save profile
        </Button>
      </div>
    </form>
  )
}

function AwardForm({ memberId, onDone }: { memberId: string; onDone: () => void }) {
  const quals = useQualifications()
  const award = useAwardQualification(memberId)
  const active = quals.data?.filter((q) => !q.archived) ?? []
  const [qualId, setQualId] = useState('')
  const [awardedOn, setAwardedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [expiresOn, setExpiresOn] = useState('')

  if (quals.isLoading) return <Skeleton className="h-40 rounded-lg" />
  if (quals.error) return <ErrorState message={(quals.error as Error).message} onRetry={() => void quals.refetch()} />
  if (!active.length)
    return (
      <EmptyState
        icon={<Award />}
        title="No qualifications to award"
        body="Add a qualification to your company catalogue first."
        action={
          <Button variant="secondary" asChild>
            <Link to="/business/hcm/qualifications">Open catalogue</Link>
          </Button>
        }
      />
    )

  return (
    <form
      className="grid gap-4 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        award.mutate(
          { qualification_id: qualId, awarded_on: awardedOn || null, expires_on: expiresOn || null },
          {
            onSuccess: () => {
              toast.success('Qualification awarded')
              onDone()
            },
            onError: (err) => toast.error((err as Error).message),
          },
        )
      }}
    >
      <Field label="Qualification">
        {(p) => (
          <NativeSelect {...p} value={qualId} onChange={(e) => setQualId(e.target.value)}>
            <option value="" disabled>
              Choose a qualification
            </option>
            {active.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
                {q.code ? ` (${q.code})` : ''}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Awarded on">
          {(p) => <Input {...p} type="date" value={awardedOn} onChange={(e) => setAwardedOn(e.target.value)} />}
        </Field>
        <Field label="Expires on" hint="Leave blank if it does not expire.">
          {(p) => <Input {...p} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" loading={award.isPending} disabled={!qualId}>
          <Award /> Award qualification
        </Button>
      </div>
    </form>
  )
}

export function MemberProfilePage() {
  const { memberId = '' } = useParams()
  const admin = useIsOrgAdmin()
  const { data: profile, isLoading, error, refetch } = useMemberProfile(memberId)
  const [awarding, setAwarding] = useState(false)

  const back = (
    <Link to="/business/hcm/people" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
      ← People
    </Link>
  )

  return (
    <>
      <PageHeader title={profile ? profile.full_name || profile.email : 'HR profile'} description="View and update this person’s HR profile." back={back} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !profile ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <div className="animate-reveal grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Overview"
              action={
                admin ? (
                  <Button size="sm" variant="secondary" onClick={() => setAwarding(true)}>
                    <Plus /> Award qualification
                  </Button>
                ) : null
              }
            />
            <CardBody>
              <div className="flex items-center gap-3">
                <Avatar name={profile.full_name || profile.email} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{profile.full_name || profile.email}</p>
                  <p className="truncate text-sm text-muted">{profile.email}</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted">Track and level</dt>
                  <dd className="font-medium">{`${(TRACK_LABEL[profile.track] ?? profile.track) || 'Not set'}${profile.level ? ` · L${profile.level}` : ''}`}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Line manager</dt>
                  <dd className="font-medium">{profile.line_manager_name || 'Not set'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Started</dt>
                  <dd className="font-medium">{profile.start_date ? shortDate(profile.start_date) : 'Not set'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">CPD hours</dt>
                  <dd className="font-medium tabular">{profile.cpd_hours_cached}</dd>
                </div>
              </dl>
              {profile.termination_date ? (
                <p className="mt-4">
                  <Badge tone="warning">Leaving {shortDate(profile.termination_date)}</Badge>
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={admin ? 'Edit HR profile' : 'HR profile'} action={<UserRound className="size-5 text-muted" aria-hidden />} />
            <CardBody>
              {admin ? (
                <HrForm memberId={memberId} profile={profile} />
              ) : (
                <p className="text-sm text-muted">Only HR admins can change HR profiles.</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {admin ? (
        <Dialog open={awarding} onOpenChange={setAwarding}>
          <DialogContent title="Award a qualification" description={profile?.full_name || profile?.email}>
            <AwardForm memberId={memberId} onDone={() => setAwarding(false)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
