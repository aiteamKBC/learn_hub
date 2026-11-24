import { BookOpen, CircleDot, LockKeyhole, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { KIND_LABEL, useCompetencies, useMyCompetence } from '@/features/frameworks/api'
import { Link } from '@/lib/router'

const levels = ['Foundation', 'Developing', 'Proficient', 'Advanced', 'Expert']

/** Learner-facing view of the shared KSB catalogue.
 *
 * It deliberately separates verified workplace evidence from self-led learning:
 * course completion can build a learner's evidence level, but does not claim a
 * manager has signed off competence.
 */
export function PractiseKsbsPage() {
  const catalogue = useCompetencies()
  const competence = useMyCompetence()
  const evidenceByCompetency = new Map((competence.data?.items ?? []).map((item) => [item.competency_id, item.evidenced_level]))

  return (
    <>
      <PageHeader title="Practise your KSBs" description="Build knowledge, skills and behaviours through learning. Your completed learning is shown separately from workplace sign-off." />
      {catalogue.error || competence.error ? (
        <ErrorState message={((catalogue.error ?? competence.error) as Error).message} onRetry={() => { void catalogue.refetch(); void competence.refetch() }} />
      ) : catalogue.isLoading || competence.isLoading || !catalogue.data || !competence.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-60 rounded-2xl" />)}
        </div>
      ) : catalogue.data.length === 0 ? (
        <Card><EmptyState icon={<Sparkles />} title="No KSBs available yet" body="Your company has not published a KSB catalogue for this workspace." /></Card>
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2">
          {catalogue.data.map((ksb) => {
            const evidencedLevel = evidenceByCompetency.get(ksb.id) ?? 0
            return (
              <Card key={ksb.id} className="overflow-hidden">
                <CardBody className="grid gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-xs text-muted">{ksb.code}</span>
                        <Badge tone={KIND_LABEL[ksb.kind]?.tone ?? 'neutral'}>{KIND_LABEL[ksb.kind]?.label ?? ksb.kind}</Badge>
                      </div>
                      <h2 className="text-base font-semibold text-text">{ksb.name}</h2>
                      {ksb.description ? <p className="mt-1 text-sm text-muted">{ksb.description}</p> : null}
                    </div>
                    <Badge tone={evidencedLevel ? 'success' : 'neutral'}>{evidencedLevel ? `Level ${evidencedLevel} evidenced` : 'Not started'}</Badge>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Learning level</span><span>{evidencedLevel}/5 evidenced</span></div>
                    <div className="grid grid-cols-5 gap-1.5" aria-label={`Current level: ${evidencedLevel} of 5`}>
                      {levels.map((level, index) => {
                        const unlocked = index <= evidencedLevel
                        return <div key={level} className="min-w-0 text-center"><div className={`mx-auto grid size-7 place-items-center rounded-full border text-xs ${unlocked ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted'}`}>{unlocked ? <CircleDot className="size-3.5" /> : <LockKeyhole className="size-3" />}</div><span className="mt-1 block truncate text-[10px] text-muted">{index + 1}. {level}</span></div>
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="text-xs text-muted">Workplace sign-off is recorded by your manager.</p>
                    <Button size="sm" variant="secondary" asChild><Link to={`/courses?q=${encodeURIComponent(ksb.name)}`}><BookOpen /> Find learning</Link></Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
