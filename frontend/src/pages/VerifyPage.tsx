import { BadgeCheck, Search, ShieldAlert, ShieldX } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useVerifyCertificate } from '@/features/learning/api'
import { useNavigate } from '@/lib/router'

/** Public: anyone (an employer, an auditor) can check a certificate from its QR code. */
export function VerifyPage() {
  const { code = '' } = useParams()
  return (
    <div className="relative isolate min-h-[70dvh]">
      <Backdrop variant="guilloche" height={520} />
      <div className="relative mx-auto max-w-xl px-4 py-12 sm:py-20">
        <p className="text-center text-xs font-semibold tracking-[0.16em] text-primary uppercase">Certificate verification</p>
        {code ? <Result code={code.toUpperCase()} /> : <Lookup />}
      </div>
    </div>
  )
}

function Lookup({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const navigate = useNavigate()
  const go = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim().toUpperCase()
    if (v) navigate(`/verify/${encodeURIComponent(v)}`)
  }
  return (
    <form onSubmit={go} className="mt-6 flex gap-2">
      <Input icon={<Search />} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. LH-7K2Q-9WXM-4TPA" aria-label="Verification code" className="font-mono uppercase" maxLength={20} />
      <Button type="submit">Check</Button>
    </form>
  )
}

function Result({ code }: { code: string }) {
  const q = useVerifyCertificate(code)
  if (q.isLoading) return <Skeleton className="mt-6 h-72 rounded-2xl" />
  if (q.error || !q.data) {
    return (
      <div className="mt-6 animate-reveal rounded-2xl border border-border bg-surface p-6 text-center shadow-lg sm:p-8">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
          <ShieldX className="size-7" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">No certificate with this code</h1>
        <p className="mt-1 text-sm text-muted">
          Check the code <span className="font-mono font-medium text-text">{code}</span> was typed exactly as printed.
        </p>
        <Lookup />
      </div>
    )
  }
  const c = q.data
  const revoked = c.is_revoked || c.is_expired
  const longDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="mt-6 animate-reveal overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      <div className={revoked ? 'bg-danger-soft px-6 py-4' : 'bg-success-soft px-6 py-4'}>
        <p className={`flex items-center justify-center gap-2 text-sm font-semibold ${revoked ? 'text-danger' : 'text-success'}`}>
          {revoked ? <ShieldAlert className="size-5" /> : <BadgeCheck className="size-5 animate-pop" />}
          {c.is_revoked
            ? 'This certificate has been withdrawn'
            : c.is_expired
              ? `This certificate expired on ${longDate(c.expires_at!)}`
              : 'Genuine certificate, issued by LearnHub'}
        </p>
        {!revoked && c.expires_at ? <p className="mt-1 text-center text-[13px] text-success">Valid until {longDate(c.expires_at)}</p> : null}
      </div>
      <dl className="grid gap-5 p-6 text-center sm:p-8">
        <div>
          <dt className="text-xs text-muted">Awarded to</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight">{c.recipient_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">For completing</dt>
          <dd className="mt-1 text-lg font-medium">{c.course_title}</dd>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Issued</dt>
            <dd className="mt-0.5 text-sm font-medium">{new Date(c.issued_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">CPD hours</dt>
            <dd className="mt-0.5 text-sm font-medium">{c.cpd_hours ?? '—'}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-muted">Code</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium tracking-wide">{c.verification_code}</dd>
          </div>
        </div>
      </dl>
    </div>
  )
}
