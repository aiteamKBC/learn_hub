import { GraduationCap, MailWarning } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/identity/auth'
import { useAcceptInstructorInvite, useInstructorInvite } from '@/features/identity/invites'
import { Link, useNavigate } from '@/lib/router'

/** /teach/invite/:token — the link in the "Add instructor" email. Signed-out visitors are sent to sign in first (RequireAuth). */
export function InstructorInvitePage() {
  const { token = '' } = useParams()
  const invite = useInstructorInvite(token)
  const me = useMe()
  const accept = useAcceptInstructorInvite()
  const navigate = useNavigate()
  const email = invite.data?.email
  const wrongAccount = !!email && !!me.data && me.data.email.toLowerCase() !== email

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Teach on LearnHub" description="You’ve been invited to become an instructor." />
      <Card>
        {invite.isPending ? (
          <CardBody className="grid gap-3" aria-busy="true" aria-label="Loading invitation">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-10 w-40" />
          </CardBody>
        ) : invite.isError ? (
          <EmptyState
            icon={<MailWarning />}
            title="This invitation can’t be used"
            body={(invite.error as Error).message || 'It may have expired. Ask the person who invited you to send a new one.'}
            action={
              <Button asChild variant="secondary">
                <Link to="/teach">Apply to teach instead</Link>
              </Button>
            }
          />
        ) : (
          <CardBody className="animate-reveal grid gap-4">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
                <GraduationCap className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-medium">Invitation for {email}</p>
                <p className="text-sm text-muted">Accept to open your instructor studio. You can create courses straight away; they are reviewed before going live.</p>
              </div>
            </div>
            {wrongAccount ? (
              <p role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-text">
                You’re signed in as {me.data!.email}. Sign out and sign in as {email} to accept.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="secondary">
                <Link to="/learn">Not now</Link>
              </Button>
              <Button
                disabled={wrongAccount}
                loading={accept.isPending}
                onClick={() =>
                  accept.mutate(token, {
                    onSuccess: () => (toast.success('Welcome aboard. Your studio is ready.'), navigate('/studio')),
                    onError: (e) => toast.error((e as Error).message),
                  })
                }
              >
                Accept invitation
              </Button>
            </div>
          </CardBody>
        )}
      </Card>
    </div>
  )
}
