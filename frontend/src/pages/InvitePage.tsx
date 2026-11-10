import { useQueryClient } from '@tanstack/react-query'
import { Building2, LinkIcon, LogOut, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'
import { Skeleton } from '@/components/ui/skeleton'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { type Me, useLogout, useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { ROLE_LABEL, useAcceptInvitation, useInvitation } from '@/features/org/api'
import { forgetInvite, pendingInvite, rememberInvite } from '@/lib/next'
import { Link, useNavigate } from '@/lib/router'

const article = (role: string) => (/^[aeiou]/i.test(ROLE_LABEL[role] ?? role) ? 'an' : 'a')

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background">
      <Backdrop variant="aurora" height="100%" fade={false} />
      <div className="relative flex items-center justify-between px-5 pt-5 sm:px-10 sm:pt-8">
        <Link to="/" aria-label="LearnHub home">
          <Logo />
        </Link>
        <ThemeToggle />
      </div>
      <main id="main" className="relative mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-5 py-10">
        {children}
      </main>
    </div>
  )
}

function Problem({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card className="animate-reveal p-7 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
        <LinkIcon className="size-6" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
    </Card>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me, isLoading: meLoading } = useMe()
  const { switchTo } = useWorkspace()
  const invitation = useInvitation(token)
  const accept = useAcceptInvitation()
  const logout = useLogout()
  const [wrongAccount, setWrongAccount] = useState<string | null>(null)
  const here = `/invite/${encodeURIComponent(token)}`
  const next = `?next=${encodeURIComponent(here)}`
  const gone = invitation.error instanceof ApiError && invitation.error.status === 404

  // an invitation that can't be used any more shouldn't keep bringing people back here
  useEffect(() => {
    if (gone && pendingInvite() === here) forgetInvite()
  }, [gone, here])

  if (invitation.isLoading || meLoading) {
    return (
      <Shell>
        <Card className="p-7">
          <Skeleton className="mx-auto size-14 rounded-xl" />
          <Skeleton className="mx-auto mt-5 h-7 w-3/4" />
          <Skeleton className="mx-auto mt-3 h-4 w-2/3" />
          <Skeleton className="mt-8 h-11 w-full" />
        </Card>
      </Shell>
    )
  }

  const err = invitation.error
  if (err) {
    return (
      <Shell>
        {gone ? (
          <Problem title="This invitation can't be used" body="It may have expired, been used already, or been cancelled. Ask the person who invited you to send a new one.">
            <Button asChild>
              <Link to={me ? '/learn' : '/'}>{me ? 'Go to my learning' : 'Go to LearnHub'}</Link>
            </Button>
          </Problem>
        ) : (
          <Problem title="We couldn't load this invitation" body={(err as Error).message}>
            <Button onClick={() => void invitation.refetch()}>Try again</Button>
          </Problem>
        )}
      </Shell>
    )
  }

  const inv = invitation.data!
  const roleName = (ROLE_LABEL[inv.role] ?? inv.role).toLowerCase()

  const onAccept = () =>
    accept.mutate(token, {
      onSuccess: async ({ org_id }) => {
        forgetInvite()
        await qc.refetchQueries({ queryKey: ['me'], type: 'all' })
        switchTo(org_id)
        toast.success(`Welcome to ${inv.org_name}`)
        // the role they actually have there (someone already in the company keeps theirs)
        const role = qc.getQueryData<Me | null>(['me'])?.memberships.find((m) => m.org_id === org_id)?.role ?? inv.role
        navigate(role === 'learner' ? '/learn' : '/business', { replace: true })
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'wrong_account') setWrongAccount(e.message)
        else if (e instanceof ApiError && e.status === 404) void invitation.refetch()
        else toast.error((e as Error).message)
      },
    })

  return (
    <Shell>
      <Card className="animate-reveal p-7">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-text">
            <Building2 className="size-7" />
          </span>
          <p className="mt-5 text-xs font-medium tracking-wide text-muted uppercase">You're invited</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{inv.org_name}</h1>
          <p className="mt-2 text-[15px] text-muted">
            You've been invited to join {inv.org_name} as {article(inv.role)} {roleName}.
          </p>
        </div>

        {wrongAccount ? (
          <div role="alert" className="mt-6 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
            {wrongAccount}
          </div>
        ) : null}

        {me ? (
          <div className="mt-6 grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-3 text-sm">
              <UserRound className="size-4 shrink-0 text-muted" />
              <span className="min-w-0">
                Signed in as <span className="font-medium break-all">{me.email}</span>
              </span>
            </div>
            {wrongAccount ? (
              <Button size="lg" loading={logout.isPending} onClick={() => logout.mutate(undefined, { onSettled: () => (forgetInvite(), setWrongAccount(null), navigate(`/login${next}`)) })}>
                <LogOut /> Sign out and use another account
              </Button>
            ) : (
              <Button size="lg" loading={accept.isPending} onClick={onAccept}>
                Accept and join
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            <Button size="lg" asChild>
              <Link to={`/signup${next}`} onClick={() => rememberInvite(here)}>
                Create an account
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link to={`/login${next}`}>I already have an account</Link>
            </Button>
            <p className="text-center text-xs text-muted">Use the email address the invitation was sent to. You'll come back here to accept.</p>
          </div>
        )}
      </Card>
    </Shell>
  )
}
