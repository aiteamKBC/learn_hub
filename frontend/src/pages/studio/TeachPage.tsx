import { ArrowRight, BadgeCheck, CircleSlash, Clock, LifeBuoy, PenTool, Sparkles, Upload, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/identity/auth'
import { useApplyToTeach } from '@/features/studio/api'
import { Link } from '@/lib/router'

const STEPS = [
  { Icon: PenTool, title: 'Tell us about you', body: 'A headline and a short bio, as learners will see them.' },
  { Icon: Clock, title: 'We review it', body: 'Our team checks every application before you can publish.' },
  { Icon: Upload, title: 'Build your course', body: 'Use the studio to add lessons, quizzes and assignments, then send it for review.' },
  { Icon: Users, title: 'Teach and earn', body: 'Answer questions, mark work and follow your sales.' },
]

function ApplyForm({ again, onDone }: { again?: boolean; onDone?: () => void }) {
  const apply = useApplyToTeach()
  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [touched, setTouched] = useState(false)

  const errors = {
    headline: headline.trim().length < 3 ? 'Use at least 3 characters.' : undefined,
    website: website.trim() && !website.trim().startsWith('https://') ? 'Use a link that starts with https://' : undefined,
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (errors.headline || errors.website) return
    apply.mutate(
      { headline: headline.trim(), bio: bio.trim(), website_url: website.trim() },
      { onSuccess: () => (toast.success(again ? 'Application updated' : 'Application sent'), onDone?.()), onError: (err) => toast.error((err as Error).message) },
    )
  }

  return (
    <Card>
      <CardHeader title={again ? 'Update your application' : 'Your instructor profile'} description="This is what learners see on your courses. Plain text only." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Field label="Headline" hint="For example: Health and safety trainer with 12 years in construction" error={touched ? errors.headline : undefined}>
            {(p) => <Input {...p} value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={160} required />}
          </Field>
          <Field label="About you" hint={`${bio.length} / 5000 · what you teach, and why learners can trust you`}>
            {(p) => <Textarea {...p} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={5000} rows={6} />}
          </Field>
          <Field label="Website (optional)" hint="Your site or a professional profile" error={touched ? errors.website : undefined}>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={500} />}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            <Button type="submit" loading={apply.isPending}>
              {again ? 'Send update' : 'Send application'} <ArrowRight />
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function Steps() {
  return (
    <Card className="h-fit">
      <CardHeader title="What happens next" />
      <CardBody>
        <ol className="stagger grid gap-4">
          {STEPS.map(({ Icon, title, body }, i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-text [&_svg]:size-[18px]">
                <Icon />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {i + 1}. {title}
                </p>
                <p className="text-[13px] text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

export function TeachPage() {
  const { data: me, isLoading, error, refetch } = useMe()
  const [editing, setEditing] = useState(false)
  const status = me?.instructor_status ?? 'none'

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !me)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-80" />
      </div>
    )

  return (
    <div className="animate-reveal">
      <PageHeader title="Teach on LearnHub" description="Share what you know with learners and companies across the UK." />
      {status === 'approved' ? (
        <Card>
          <EmptyState
            icon={<BadgeCheck />}
            title="You're an approved instructor"
            body="Your studio is ready. Create a course, build its lessons and send it for review."
            action={
              <Button asChild>
                <Link to="/studio">
                  Open the studio <ArrowRight />
                </Link>
              </Button>
            }
          />
        </Card>
      ) : status === 'suspended' ? (
        <Card>
          <EmptyState
            icon={<CircleSlash />}
            title="Your instructor account is paused"
            body="You can't use the studio at the moment. Contact support and we'll explain what happens next."
            action={
              <Button variant="secondary" asChild>
                <Link to="/support">
                  <LifeBuoy /> Contact support
                </Link>
              </Button>
            }
          />
        </Card>
      ) : status === 'pending' && !editing ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card className="min-w-0">
            <EmptyState
              icon={<Clock />}
              title="We're reviewing your application"
              body="Thanks for applying. Our team will look at your profile soon. Come back to this page to see the decision."
              action={
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Update my application
                </Button>
              }
            />
          </Card>
          <Steps />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="grid min-w-0 gap-4">
            {status === 'rejected' ? (
              <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-text">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-warning" />
                Your last application wasn't approved. You're welcome to apply again with more detail about what you teach.
              </p>
            ) : null}
            <ApplyForm again={status === 'pending'} onDone={() => setEditing(false)} />
          </div>
          <Steps />
        </div>
      )}
    </div>
  )
}
