import { CheckCircle2, Loader2, MailCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useMe, useVerifyEmail } from '@/features/identity/auth'
import { pendingInvite } from '@/lib/next'

import { AuthShell } from './AuthShell'
import { Link } from '@/lib/router'

/** The link in the confirmation email lands here; the key is sent to allauth once. */
export function VerifyEmailPage() {
  const { key = '' } = useParams()
  const verify = useVerifyEmail()
  const { data: me } = useMe()
  const [invite] = useState(pendingInvite)
  const inviteNext = invite ? `?next=${encodeURIComponent(invite)}` : ''

  return (
    <AuthShell title={verify.isPending ? 'Confirming your email' : verify.isSuccess ? 'Email confirmed' : 'Confirm your email'}>
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        {verify.isPending ? (
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        ) : verify.isSuccess ? (
          <>
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <p className="mt-3 font-medium">Your email is confirmed.</p>
            <Button className="mt-5" asChild>
              {invite ? (
                <Link to={verify.data ? invite : `/login?next=${encodeURIComponent(invite)}`}>Continue to your invitation</Link>
              ) : (
                <Link to={verify.data ? '/learn' : '/login'}>{verify.data ? 'Start learning' : 'Log in'}</Link>
              )}
            </Button>
          </>
        ) : (
          <>
            {verify.isError && me ? (
              <>
                <CheckCircle2 className="mx-auto size-10 text-success" />
                <p className="mt-3 font-medium">You’re already signed in.</p>
                <p className="mt-2 text-sm text-muted">Continue to your invitation and we’ll finish joining you.</p>
                <Button className="mt-5 w-full" asChild>
                  <Link to={invite ?? '/learn'}>{invite ? 'Continue to your invitation' : 'Go to my learning'}</Link>
                </Button>
              </>
            ) : verify.isError ? (
              <>
                <XCircle className="mx-auto size-10 text-danger" />
                <p className="mt-3 font-medium">This link has expired or was already used.</p>
                <p className="mt-2 text-sm text-muted">If you already confirmed your email, sign in. Otherwise, sign in with the password you set and check for the latest confirmation email. You only need a password reset if you have forgotten your password.</p>
                <div className="mt-5 grid gap-2">
                  <Button variant="secondary" asChild>
                    <Link to={`/login${inviteNext}`}>Log in to continue</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <MailCheck className="mx-auto size-10 text-primary" />
                <p className="mt-3 font-medium">Confirm your email address</p>
                <p className="mt-2 text-sm text-muted">Continue to verify this email and finish setting up your account.</p>
                <Button className="mt-5 w-full" onClick={() => verify.mutate(key)}>
                  Confirm email address
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </AuthShell>
  )
}
