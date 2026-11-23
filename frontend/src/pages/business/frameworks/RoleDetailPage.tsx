import { CheckCircle2, FileEdit, GitBranch, History, Workflow } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { fullDateTime } from '@/features/frameworks/format'
import { useRole, useRoleHistory, useStartVersion } from '@/features/frameworks/api'
import { TRACK_LABEL } from '@/features/hcm/api'
import { useIsOrgAdmin } from '@/features/org/api'
import { Link, useNavigate } from '@/lib/router'

const ACTION_LABEL: Record<string, string> = {
  created: 'Version started',
  submitted: 'Submitted for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  superseded: 'Superseded',
}

export function RoleDetailPage() {
  const { frameworkId = '' } = useParams()
  const admin = useIsOrgAdmin()
  const navigate = useNavigate()
  const { data: role, isLoading, error, refetch } = useRole(frameworkId)
  const history = useRoleHistory(frameworkId)
  const start = useStartVersion()

  const openDraft = () =>
    start.mutate(frameworkId, {
      onSuccess: (v) => navigate(`/business/frameworks/versions/${v.id}`),
      onError: (err) => toast.error((err as Error).message),
    })

  const back = (
    <Link to="/business/frameworks/roles" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
      ← Role frameworks
    </Link>
  )

  return (
    <>
      <PageHeader
        title={role ? role.title : 'Role framework'}
        description="Its approved standard and the history of every version."
        back={back}
        actions={
          admin ? (
            <Button onClick={openDraft} loading={start.isPending}>
              <FileEdit /> Open working draft
            </Button>
          ) : null
        }
      />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !role ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
        </div>
      ) : (
        <div className="animate-reveal grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="This role" action={<Workflow className="size-5 text-muted" aria-hidden />} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted">Level</dt>
                  <dd className="font-medium tabular">
                    L{role.level}.{role.step}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Track</dt>
                  <dd className="font-medium">{(TRACK_LABEL[role.track] ?? role.track) || 'Not set'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Approved version</dt>
                  <dd>{role.approved_version_number ? <Badge tone="success">v{role.approved_version_number}</Badge> : <Badge tone="neutral">None</Badge>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Latest version</dt>
                  <dd className="font-medium tabular">{role.latest_version_number ? `v${role.latest_version_number}` : 'None'}</dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                {role.approved_version_id ? <Button size="sm" variant="secondary" asChild><Link to={`/business/frameworks/versions/${role.approved_version_id}`}>View approved version</Link></Button> : null}
                {role.latest_version_id && role.latest_version_id !== role.approved_version_id ? <Button size="sm" variant="secondary" asChild><Link to={`/business/frameworks/versions/${role.latest_version_id}`}>View latest version</Link></Button> : null}
              </div>
              {admin ? (
                <p className="mt-5 flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                  <GitBranch className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Open the working draft to edit the job description, add KSB requirements and run the approval workflow.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" action={<History className="size-5 text-muted" aria-hidden />} />
            {history.error ? (
              <ErrorState message={(history.error as Error).message} onRetry={() => void history.refetch()} />
            ) : history.isLoading || !history.data ? (
              <div className="grid gap-2 p-4">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : history.data.length === 0 ? (
              <EmptyState icon={<History />} title="No history yet" body="Actions on this role’s versions will appear here." />
            ) : (
              <ol className="relative grid gap-5 p-5 pl-7">
                <span className="absolute top-6 bottom-6 left-[13px] w-px bg-border" aria-hidden />
                {history.data.map((h, i) => (
                  <li key={i} className="relative pl-6">
                    <span className="absolute top-1 left-0 flex size-3.5 items-center justify-center rounded-full bg-primary [&_svg]:size-2.5 [&_svg]:text-on-primary">
                      <CheckCircle2 aria-hidden />
                    </span>
                    <p className="text-sm font-medium">
                      {ACTION_LABEL[h.action] ?? h.action} <span className="text-muted">· v{h.version_number}</span>
                    </p>
                    <p className="text-xs text-muted">{fullDateTime(h.at)}</p>
                    {h.comment ? <p className="mt-1 text-sm text-muted">“{h.comment}”</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
