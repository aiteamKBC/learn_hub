import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useVerifyEmail } from '@/features/identity/auth'
import { pendingInvite } from '@/lib/next'

import { AuthShell } from './AuthShell'
import { Link } from '@/lib/router'

/** The link in the confirmation email lands here; the key is sent to allauth once. */
export function VerifyEmailPage() {
  const { key = '' } = useParams()
  const verify = useVerifyEmail()
  const [invite] = useState(pendingInvite)
  const sent = useRef(false)
  useEffect(() => {
    if (!sent.current) {
      sent.current = true
      verify.mutate(key)
    }
  }, [key, verify])

  return (
    <AuthShell title="Confirming your email">
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        {verify.isPending || verify.isIdle ? (
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
            <XCircle className="mx-auto size-10 text-danger" />
            <p className="mt-3 font-medium">This link has expired or was already used.</p>
            <Button className="mt-5" variant="secondary" asChild>
              <Link to="/login">Back to log in</Link>
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  )
}
