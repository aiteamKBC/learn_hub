import { ArrowRightLeft, Building2, PlayCircle, Users, Video } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/features/identity/workspace'
import { useIsOrgAdmin } from '@/features/org/api'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

import { type Package, usePackages } from './api'
import { LiveForm, SeatsForm } from './BuyDialogs'
import { gbp } from './format'

type Kind = 'recorded' | 'live'

const KINDS: { kind: Kind; label: string; body: string; icon: typeof PlayCircle }[] = [
  { kind: 'recorded', label: 'Recorded course', body: 'Buy seats now. Each person starts straight away.', icon: PlayCircle },
  { kind: 'live', label: 'Live training', body: 'Sessions with a tutor. You pay once the dates are set.', icon: Video },
]

/** Recorded or live: each has its own price, set by the platform. An option the platform
 * has not switched on (or priced) is shown but cannot be picked. */
function KindPicker({ offers, value, onChange }: { offers: Partial<Record<Kind, Package>>; value: Kind | null; onChange: (k: Kind) => void }) {
  return (
    <div role="radiogroup" aria-label="Type of training" className="grid gap-3 sm:grid-cols-2">
      {KINDS.map(({ kind, label, body, icon: Icon }) => {
        const pkg = offers[kind]
        const selected = value === kind
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!pkg}
            onClick={() => onChange(kind)}
            className={cn(
              'grid gap-1.5 rounded-xl border p-4 text-left transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              selected ? 'border-primary shadow-md' : 'border-border',
              pkg ? 'hover:shadow-sm' : 'cursor-not-allowed opacity-60',
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Icon className="size-4 text-primary" /> {label}
            </span>
            <span className="text-sm text-muted">{pkg ? body : 'Not offered for this course yet.'}</span>
            {pkg ? (
              <span className="text-sm">
                <span className="font-semibold">{gbp(pkg.price_gbp_minor)}</span> <span className="text-muted">per {kind === 'live' ? 'person' : 'seat'}</span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function offersFor(rows: Package[] | undefined, courseId: string) {
  const offers: Partial<Record<Kind, Package>> = {}
  for (const p of rows ?? []) if (p.course_id === courseId && (p.delivery_type === 'recorded' || p.delivery_type === 'live')) offers[p.delivery_type] = p
  return offers
}

function Choose({ offers, onClose, cancel }: { offers: Partial<Record<Kind, Package>>; onClose: () => void; cancel: ReactNode }) {
  const only = offers.recorded && !offers.live ? 'recorded' : offers.live && !offers.recorded ? 'live' : null
  const [kind, setKind] = useState<Kind | null>(only)
  const pkg = kind ? offers[kind] : undefined
  return (
    <div className="grid gap-5">
      <KindPicker offers={offers} value={kind} onChange={setKind} />
      {!offers.recorded && !offers.live ? (
        <p className="text-sm text-muted">
          This course is not on sale to companies yet.{' '}
          <Link to="/support" className="font-medium text-primary hover:underline">
            Ask us to offer it
          </Link>
          .
        </p>
      ) : pkg ? (
        <div key={pkg.id} className="animate-reveal">
          {kind === 'live' ? <LiveForm pkg={pkg} onSent={onClose} footer={cancel} /> : <SeatsForm pkg={pkg} footer={cancel} />}
        </div>
      ) : (
        <p className="text-sm text-muted">Pick recorded or live to continue.</p>
      )}
    </div>
  )
}

function TeamBuyDialog({ courseId, title, onClose }: { courseId: string; title: string; onClose: () => void }) {
  const q = usePackages()
  const cancel = (
    <DialogClose asChild>
      <Button type="button" variant="secondary">
        Cancel
      </Button>
    </DialogClose>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Buy for your team: ${title}`} description="Choose recorded or live, then how many people.">
        {q.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : q.isError ? (
          <ErrorState message="We could not load the prices for companies." onRetry={() => void q.refetch()} />
        ) : (
          <div className="animate-reveal">
            <Choose offers={offersFor(q.data, courseId)} onClose={onClose} cancel={cancel} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** On every course page. Company owners and admins get one button to buy for their
 * team (recorded or live, each priced by the platform). Someone who runs a company but
 * is in their personal space is offered a switch. Nobody else sees anything. */
export function TeamBuy({ courseId, title }: { courseId: string; title: string }) {
  const admin = useIsOrgAdmin()
  const { org, memberships, switchTo } = useWorkspace()
  const [open, setOpen] = useState(false)
  const runs = memberships.filter((m) => m.role === 'owner' || m.role === 'admin')
  if (!admin && (org || !runs.length)) return null
  return (
    <Card className="mt-4 grid gap-3 p-5 animate-reveal">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text [&_svg]:size-4.5">
          <Building2 />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Buying for your team?</p>
          <p className="text-sm text-muted">{admin && org ? `For ${org.name}. Recorded seats or live training.` : 'Switch to your company to buy recorded seats or live training.'}</p>
        </div>
      </div>
      {admin ? (
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          <Users /> Buy for your team
        </Button>
      ) : (
        runs.slice(0, 3).map((m) => (
          <Button key={m.org_id} variant="secondary" className="w-full" onClick={() => switchTo(m.org_id)}>
            <ArrowRightLeft /> Switch to {m.name}
          </Button>
        ))
      )}
      {open ? <TeamBuyDialog courseId={courseId} title={title} onClose={() => setOpen(false)} /> : null}
    </Card>
  )
}
