import { Archive, CalendarClock, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CourseThumb } from '@/components/ui/course-thumb'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { complianceTone, type Requirement, TONE_FILL, useArchiveRequirement, useRequirements } from '@/features/compliance/api'
import { RequirementForm } from '@/features/compliance/RequirementForm'
import { useIsOrgAdmin, useLibrary } from '@/features/org/api'
import { Link } from '@/lib/router'

function targetChips(r: Requirement) {
  if (!r.targets.length || r.targets.every((t) => !t.unit_id && !t.job_role_id)) return ['Everyone']
  return r.targets.map((t) => [t.unit_name ? `${t.unit_name}${t.include_subunits ? ' and teams inside' : ''}` : null, t.job_role_name].filter(Boolean).join(' · ') || 'Everyone')
}

function schedule(r: Requirement) {
  return [`Due within ${r.due_days} ${r.due_days === 1 ? 'day' : 'days'}`, r.renewal_months ? `renews every ${r.renewal_months} ${r.renewal_months === 1 ? 'month' : 'months'}` : 'one-off'].join(' · ')
}

function RequirementCard({ r, thumb, admin, onEdit, onArchive }: { r: Requirement; thumb?: string; admin: boolean; onEdit: () => void; onArchive: () => void }) {
  const tone = complianceTone(r.compliance_pct)
  return (
    <li>
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 gap-4">
          <CourseThumb src={thumb} title={r.course_title} className="hidden w-28 shrink-0 self-start sm:block" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold break-words">{r.name}</h2>
              {admin ? (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`} className="-mt-1 -mr-2 sm:hidden">
                      <MoreHorizontal />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={onEdit}>
                      <Pencil /> Edit
                    </MenuItem>
                    <MenuItem onSelect={onArchive} className="text-danger">
                      <Archive /> Archive
                    </MenuItem>
                  </MenuContent>
                </Menu>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">{r.course_title}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              {r.renewal_months ? <RefreshCw className="size-3.5" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
              {schedule(r)}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Applies to">
              {targetChips(r).map((c, i) => (
                <li key={i}>
                  <Badge tone="primary">{c}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex items-center gap-5 border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
          <Ring value={r.compliance_pct} size={96} stroke={9} color={TONE_FILL[tone]} label="" />
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">People</dt>
              <dd className="font-semibold tabular">{r.total}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Overdue or expired</dt>
              <dd className={r.overdue ? 'font-semibold text-danger tabular' : 'font-semibold tabular'}>{r.overdue}</dd>
            </div>
          </dl>
          <div className="ml-auto flex flex-col gap-2 sm:ml-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/business/matrix?req=${r.id}`}>Matrix</Link>
            </Button>
            {admin ? (
              <div className="hidden flex-col gap-2 sm:flex">
                <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`Edit ${r.name}`}>
                  <Pencil /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={onArchive} aria-label={`Archive ${r.name}`} className="text-danger hover:text-danger">
                  <Archive /> Archive
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </li>
  )
}

export function RequirementsPage() {
  const admin = useIsOrgAdmin()
  const { data, isLoading, error, refetch } = useRequirements()
  const library = useLibrary()
  const archive = useArchiveRequirement()
  const [sheet, setSheet] = useState<{ open: boolean; requirement?: Requirement }>({ open: false })
  const [archiving, setArchiving] = useState<Requirement | null>(null)
  const thumbs = new Map(library.data?.map((c) => [c.id, c.thumbnail_url]) ?? [])

  const openNew = () => setSheet({ open: true })
  const openEdit = (r: Requirement) => setSheet({ open: true, requirement: r })

  return (
    <>
      <PageHeader
        title="Requirements"
        description={admin ? 'The training people must complete, when it is due and who it applies to.' : 'The training your people must complete. Only company admins can change these.'}
        actions={
          admin ? (
            <Button onClick={openNew}>
              <Plus /> New requirement
            </Button>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Loading requirements">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck />}
            title="No requirements yet"
            body={admin ? 'Choose a course from your library, set when it is due, and decide who must do it.' : 'Your company admin has not set any required training yet.'}
            action={
              admin ? (
                <Button onClick={openNew}>
                  <Plus /> New requirement
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="animate-reveal grid gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Users className="size-3.5" aria-hidden /> {data.length} {data.length === 1 ? 'requirement' : 'requirements'}
          </p>
          <ul className="stagger grid gap-4">
            {data.map((r) => (
              <RequirementCard key={r.id} r={r} thumb={thumbs.get(r.course_id) || undefined} admin={admin} onEdit={() => openEdit(r)} onArchive={() => setArchiving(r)} />
            ))}
          </ul>
        </div>
      )}

      {admin ? (
        <Dialog open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}>
          <DialogContent side="right" title={sheet.requirement ? 'Edit requirement' : 'New requirement'} description={sheet.requirement?.name} className="w-[min(680px,100vw)]">
            <RequirementForm key={sheet.requirement?.id ?? 'new'} requirement={sheet.requirement} onDone={() => setSheet((s) => ({ ...s, open: false }))} />
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <DialogContent title="Archive this requirement?" description={archiving?.name}>
          <p className="text-sm text-muted">It leaves the matrix and people are no longer asked to do it. Completion records are kept.</p>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={archive.isPending}
              onClick={() =>
                archiving &&
                archive.mutate(archiving.id, {
                  onSuccess: () => (toast.success(`${archiving.name} archived`), setArchiving(null)),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              <Archive /> Archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
