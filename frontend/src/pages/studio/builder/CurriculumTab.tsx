import { ArrowLeft, Clapperboard, Lock, MousePointerClick } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import type { StudioCourse } from '@/features/studio/api'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

import { AddLessonDialog, type Adding } from './curriculum/AddLesson'
import { BulkUploadDialog } from './curriculum/BulkUpload'
import { CourseContent } from './curriculum/CourseContent'
import { LessonEditor } from './curriculum/LessonEditor'
import { DISCARD, useUnsavedGuard } from './curriculum/shared'

/** Where a lesson sits: its module and its "1.2" number. */
function locate(course: StudioCourse, id: string | null) {
  if (!id) return null
  const sections = course.working_version?.sections ?? []
  for (const [si, s] of sections.entries()) {
    const li = s.lectures.findIndex((l) => l.id === id)
    if (li >= 0) return { section: s, lecture: s.lectures[li]!, number: `${si + 1}.${li + 1}` }
  }
  return null
}

/** The builder's Curriculum tab: the lesson editor in the middle and the course content
 * (modules and lessons) on the right. The chosen lesson lives in the URL (?lesson=). On a
 * phone the content list comes first and a lesson opens full width. */
export function CurriculumTab({ course }: { course: StudioCourse }) {
  const version = course.working_version
  const server = version?.sections
  const editable = !!version?.editable
  const [params, setParams] = useSearchParams()
  const lessonId = params.get('lesson')
  const found = locate(course, lessonId)
  const lecture = found?.lecture

  const [dirty, setDirty] = useState(false)
  const [rev, setRev] = useState(0) // bumped by Cancel so the form restarts from saved data
  const [adding, setAdding] = useState<Adding | null>(null)
  const [bulk, setBulk] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  // asks before leaving the page, and before switching lesson (that's a navigation too)
  useUnsavedGuard(dirty && !!lecture)

  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('lesson', id)
    else next.delete('lesson')
    setParams(next)
  }

  // ---------------------------------------------------------------- "Go to" from the Publish tab
  const focus = params.get('focus')
  useEffect(() => {
    if (!focus || !server) return
    const target = server.flatMap((s) => s.lectures).find((l) => l.title === focus)
    const next = new URLSearchParams(params)
    next.delete('focus')
    if (target) next.set('lesson', target.id)
    setParams(next, { replace: true })
    if (!target) return
    setHighlight(target.id)
    const scroll = window.setTimeout(() => document.getElementById(`lecture-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    const clear = window.setTimeout(() => setHighlight(null), 2400)
    return () => (window.clearTimeout(scroll), window.clearTimeout(clear))
  }, [focus, server, params, setParams])

  if (!version) return <EmptyState icon={<Clapperboard />} title="No version to edit" body="This course has no working version yet." />

  const cancel = () => {
    if (dirty && !window.confirm(DISCARD)) return
    setDirty(false)
    setRev((r) => r + 1)
  }
  const onDeleted = (lectureId: string | null, sectionId?: string) => {
    if (!found) return
    if ((lectureId && lectureId === found.lecture.id) || (sectionId && sectionId === found.section.id)) {
      setDirty(false)
      select(null)
    }
  }

  return (
    <div className="grid gap-5">
      {editable ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/70 px-4 py-3 text-sm">
          <Lock className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            {version.status === 'in_review' ? 'This version is waiting for review, so it cannot be changed right now.' : 'This is the live version. To change it, create a new draft.'}
          </span>
          <Button asChild variant="secondary" size="sm"><Link to={`/studio/courses/${course.id}/publish`}>Go to Publish</Link></Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn('min-w-0', !lecture && 'max-lg:hidden')}>
          {lecture && found ? (
            <div key={lecture.id} className="grid animate-reveal gap-3">
              <Button type="button" variant="ghost" size="sm" className="-ml-2 justify-self-start lg:hidden" onClick={() => select(null)}>
                <ArrowLeft /> Back to course content
              </Button>
              <LessonEditor
                key={`${lecture.id}-${rev}`}
                course={course}
                lecture={lecture}
                number={found.number}
                readOnly={!editable}
                onDirty={setDirty}
                onSaved={() => undefined}
                onCancel={cancel}
                onAddKind={(kind) => setAdding({ sectionId: found.section.id, kind })}
              />
            </div>
          ) : (
            <Card className="animate-reveal">
              <EmptyState
                icon={<MousePointerClick />}
                title={server?.length ? 'Pick a lesson to edit' : 'No lessons yet'}
                body={editable ? 'Pick a lesson on the right, or add your first module.' : 'Pick a lesson on the right to see it.'}
              />
            </Card>
          )}
        </div>

        <aside aria-label="Course content" className={cn('min-w-0', lecture && 'max-lg:hidden')}>
          <CourseContent course={course} selectedId={lecture?.id ?? null} highlight={highlight} onSelect={select} onAdd={setAdding} onBulk={() => setBulk(true)} onDeleted={onDeleted} />
        </aside>
      </div>

      <AddLessonDialog courseId={course.id} adding={adding} onClose={() => setAdding(null)} onCreated={(id) => (setAdding(null), select(id))} />
      <BulkUploadDialog courseId={course.id} sections={server ?? []} defaultSectionId={found?.section.id} open={bulk} onClose={() => setBulk(false)} />
    </div>
  )
}
