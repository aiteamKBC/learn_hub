import { Copy, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { api, unwrap } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthError, ReauthNeeded, reauthenticate, recoveryCodes, startTotp, useActivateTotp, useAuthenticators, useDeactivateTotp } from '@/features/identity/auth'
import { usePublicSettings } from '@/features/platform/api'

/** Asks for the password again when allauth wants a fresh sign-in, then retries. */
function ReauthDialog({ open, onDone, onCancel }: { open: boolean; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await reauthenticate(password)
      setPassword('')
      onDone()
    } catch (er) {
      setError(er instanceof AuthError ? (er.fields.password ?? er.message) : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title="Confirm it's you" description="Enter your password to change 2-step sign-in.">
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="Password" error={error || undefined}>{(f) => <PasswordInput {...f} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" loading={busy}>Continue</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface-2/60 p-4">
      <p className="text-sm font-medium">Your recovery codes</p>
      <p className="text-xs text-muted">Keep them somewhere safe. Each one signs you in once if you lose your phone.</p>
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm sm:grid-cols-4">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => void navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Copied'))}>
        <Copy /> Copy codes
      </Button>
    </div>
  )
}

/** Account > 2-step sign-in with an authenticator app (allauth MFA: TOTP + recovery codes). */
export function TwoStepCard() {
  const { settings } = usePublicSettings()
  const allowed = settings['security.mfa_enabled']
  const auth = useAuthenticators(true)
  const activate = useActivateTotp()
  const deactivate = useDeactivateTotp()
  const [setup, setSetup] = useState<{ secret: string; totp_url: string; qr?: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [retry, setRetry] = useState<(() => void) | null>(null)

  const guard = (run: () => Promise<unknown>) => {
    const go = () =>
      run().catch((e: Error) => {
        if (e instanceof ReauthNeeded) setRetry(() => go)
        else toast.error(e.message)
      })
    void go()
  }

  const begin = () =>
    guard(async () => {
      const offer = await startTotp()
      // the QR is drawn by our server from the key allauth keeps in the session; without it the key still works
      const qr = await unwrap(api.GET('/api/v1/identity/mfa/totp-qr')).then((r) => r.image).catch(() => undefined)
      setSetup({ ...offer, qr })
    })
  const confirm = (e: FormEvent) => {
    e.preventDefault()
    guard(async () => {
      await activate.mutateAsync(code.replace(/\s/g, ''))
      setSetup(null)
      setCode('')
      toast.success('2-step sign-in is on')
      setCodes(await recoveryCodes())
    })
  }

  const on = auth.data?.totp
  if (!allowed && !on) return null
  return (
    <Card id="two-step">
      <CardHeader
        title="2-step sign-in"
        description="After your password, enter a code from an authenticator app on your phone. It keeps your account safe even if someone learns your password."
        action={on ? <Badge tone="success"><ShieldCheck /> On</Badge> : <Badge tone="neutral">Off</Badge>}
      />
      <CardBody className="grid gap-4">
        {auth.isLoading ? (
          <Skeleton className="h-10" />
        ) : on ? (
          <>
            <p className="text-sm text-muted">{auth.data?.recoveryLeft != null ? `${auth.data.recoveryLeft} recovery codes left.` : 'Recovery codes are set up.'}</p>
            {codes ? <Codes codes={codes} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => guard(async () => setCodes(await recoveryCodes(true)))}>
                New recovery codes
              </Button>
              <Button variant="ghost" size="sm" loading={deactivate.isPending} onClick={() => guard(async () => (await deactivate.mutateAsync(), setCodes(null), toast.success('2-step sign-in is off')))}>
                <ShieldOff /> Turn off
              </Button>
            </div>
          </>
        ) : setup ? (
          <form className="grid gap-4" onSubmit={confirm}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {setup.qr ? (
                <img src={setup.qr} alt="QR code to add your account to an authenticator app" width={168} height={168} className="size-42 shrink-0 animate-reveal self-center rounded-lg border border-border bg-white p-2 sm:self-start" />
              ) : null}
            <ol className="grid list-decimal gap-2 pl-5 text-sm">
              <li>Open an authenticator app (for example Microsoft or Google Authenticator).</li>
              <li>
                {setup.qr ? 'Scan the QR code, or add an account with this key:' : 'Add an account with this key:'}{' '}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs break-all select-all">{setup.secret}</code>{' '}
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => void navigator.clipboard.writeText(setup.secret).then(() => toast.success('Key copied'))}>
                  Copy
                </button>
                {setup.totp_url ? (
                  <>
                    {' '}or{' '}
                    <a href={setup.totp_url} className="text-xs font-medium text-primary hover:underline">open it in the app on this phone</a>
                  </>
                ) : null}
                .
              </li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
              <Field label="Code from the app">{(f) => <Input {...f} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} required />}</Field>
              <div className="flex gap-2">
                <Button type="submit" loading={activate.isPending} disabled={code.trim().length < 6}>Turn on</Button>
                <Button type="button" variant="ghost" onClick={() => (setSetup(null), setCode(''))}>Cancel</Button>
              </div>
            </div>
          </form>
        ) : (
          <Button variant="secondary" className="justify-self-start" onClick={begin}>
            <Smartphone /> Set up 2-step sign-in
          </Button>
        )}
      </CardBody>
      <ReauthDialog open={!!retry} onCancel={() => setRetry(null)} onDone={() => { const r = retry; setRetry(null); r?.() }} />
    </Card>
  )
}
