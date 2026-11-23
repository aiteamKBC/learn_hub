import { GraduationCap, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsOrgAdmin } from '@/features/org/api'
import { useCompetencies, useCourseCompetencies, useTagCourse } from './api'

/** Company administrators map real course evidence to the shared KSB catalogue. */
export function CourseCompetencyPanel({ courseId }: { courseId: string }) {
  const admin = useIsOrgAdmin()
  const tags = useCourseCompetencies(courseId)
  const competencies = useCompetencies()
  const save = useTagCourse(courseId)
  const [form, setForm] = useState({ competency_id: '', target_level: '3', weight: '5' })

  return (
    <Card>
      <CardHeader title="Competency evidence" description="Map this course to the knowledge, skills and behaviours it evidences on completion." action={<GraduationCap className="size-5 text-muted" aria-hidden />} />
      <CardBody className="grid min-w-0 gap-5">
        {tags.error ? <ErrorState message={(tags.error as Error).message} onRetry={() => void tags.refetch()} /> : tags.isLoading ? <Skeleton className="h-24" /> : !tags.data?.length ? (
          <EmptyState icon={<GraduationCap />} title="No competencies mapped" body="A company admin can add competencies and the level this course evidences." />
        ) : (
          <ul className="stagger grid gap-2">
            {tags.data.map((tag) => (
              <li key={tag.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0"><p className="break-words text-sm font-medium">{tag.competency_code} · {tag.competency_name}</p><p className="text-xs text-muted">Weight {tag.weight}</p></div>
                <div className="flex items-center gap-2"><Badge tone="info">Level {tag.target_level}</Badge>{admin ? <Button size="sm" variant="ghost" onClick={() => setForm({ competency_id: tag.competency_id, target_level: String(tag.target_level), weight: String(tag.weight) })}>Edit</Button> : null}</div>
              </li>
            ))}
          </ul>
        )}
        {admin ? competencies.error ? <ErrorState message={(competencies.error as Error).message} onRetry={() => void competencies.refetch()} /> : (
          <form className="grid gap-4 border-t border-border pt-4" onSubmit={(event) => {
            event.preventDefault()
            save.mutate({ competency_id: form.competency_id, target_level: Number(form.target_level), weight: Number(form.weight) }, {
              onSuccess: () => { toast.success('Course competency saved'); setForm({ competency_id: '', target_level: '3', weight: '5' }) },
              onError: (error) => toast.error((error as Error).message),
            })
          }}>
            <Field label="Competency" hint="Choose an existing mapping to update its level and weight.">{(props) => <NativeSelect {...props} required value={form.competency_id} disabled={competencies.isLoading} onChange={(event) => setForm((current) => ({ ...current, competency_id: event.target.value }))}><option value="">Choose a competency</option>{competencies.data?.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</NativeSelect>}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Evidenced level (1–5)">{(props) => <Input {...props} type="number" required min={1} max={5} step={1} value={form.target_level} onChange={(event) => setForm((current) => ({ ...current, target_level: event.target.value }))} />}</Field>
              <Field label="Weight (1–10)">{(props) => <Input {...props} type="number" required min={1} max={10} step={1} value={form.weight} onChange={(event) => setForm((current) => ({ ...current, weight: event.target.value }))} />}</Field>
            </div>
            <Button type="submit" className="justify-self-end" loading={save.isPending} disabled={!form.competency_id}><Save /> Save competency</Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  )
}
