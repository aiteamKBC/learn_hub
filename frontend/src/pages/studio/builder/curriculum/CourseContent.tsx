import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, Eye, EyeOff, GripVertical, Info, ListTree, MoreHorizontal, Pencil, Plus, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { LECTURE_KINDS, useCurriculum, type StudioCourse, type StudioLecture, type StudioSection } from '@/features/studio/api'
import { cn } from '@/lib/cn'

import { KIND_META, errText, kindMeta, moved, type LectureKind } from './shared'

type Drag = { type: 'section'; id: string } | { type: 'lecture'; id: string; sectionId: string }

/** The right-hand column: modules and lessons. Reorder by drag (mouse) or from each
 * row's menu (keyboard and touch); add, rename and delete; pick a lesson to edit it. */
export function CourseContent({ course, selectedId, highlight, onSelect, onAdd, onBulk, onDeleted }: {
  course: StudioCourse
  selectedId: string | null
  highlight: string | null
  onSelect: (id: string) => void
  onAdd: (a: { sectionId: string; kind: LectureKind }) => void
  onBulk: () => void
  onDeleted: (lectureId: string | null, sectionId?: string) => void
}) {
  const version = course.working_version
  const server = version?.sections
  const editable = !!version?.editable
  const c = useCurriculum(course.id)

  // Reorders show at once; the override is dropped as soon as fresh server data arrives.
  const [override, setOverride] = useState<{ base: StudioSection[]; value: StudioSection[] } | null>(null)
  const sections = override && server && override.base === server ? override.value : (server ?? [])
  const [error, setError] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropAt, setDropAt] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const [newModule, setNewModule] = useState<string | null>(null)
  const newRef = useRef<HTMLInputElement>(null)

  // open modules: the first one to begin with, plus whichever holds the chosen lesson
  const [open, setOpen] = useState<Set<string>>(() => new Set(sections[0] ? [sections[0].id] : []))
  const selectedSection = sections.find((s) => s.lectures.some((l) => l.id === selectedId))?.id
  useEffect(() => {
    if (selectedSection) setOpen((o) => (o.has(selectedSection) ? o : new Set(o).add(selectedSection)))
  }, [selectedSection])
  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const fail = (e: unknown) => (setOverride(null), setError(errText(e)))

  const reorderSections = (next: StudioSection[]) => {
    if (!version || !server) return
    setError('')
    setOverride({ base: server, value: next })
    c.orderSections.mutate({ versionId: version.id, ids: next.map((s) => s.id) }, { onError: fail })
  }
  const reorderLectures = (sectionId: string, next: StudioLecture[]) => {
    if (!server) return
    setError('')
    setOverride({ base: server, value: sections.map((s) => (s.id === sectionId ? { ...s, lectures: next } : s)) })
    c.orderLectures.mutate({ sectionId, ids: next.map((l) => l.id) }, { onError: fail })
  }
  const moveSection = (i: number, d: -1 | 1) => {
    reorderSections(moved(sections, i, i + d))
    setAnnounce(`${sections[i]!.title} moved to position ${i + d + 1} of ${sections.length}.`)
  }
  const moveLecture = (s: StudioSection, i: number, d: -1 | 1) => {
    reorderLectures(s.id, moved(s.lectures, i, i + d))
    setAnnounce(`${s.lectures[i]!.title} moved to position ${i + d + 1} of ${s.lectures.length}.`)
  }

  // ---------------------------------------------------------------- drag and drop (mouse; menus cover keyboard and touch)
  const onDragStart = (e: DragEvent, d: Drag) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', d.id)
    setDrag(d)
  }
  const onDragEnd = () => (setDrag(null), setDropAt(null))
  const overSection = (e: DragEvent, id: string) => {
    if (!drag) return
    e.preventDefault() // a lesson may also be dropped on a module: it goes to the end
    setDropAt(id)
  }
  const dropSection = (e: DragEvent, targetId: string) => {
    if (drag?.type !== 'section') return
    e.preventDefault()
    const from = sections.findIndex((s) => s.id === drag.id)
    const to = sections.findIndex((s) => s.id === targetId)
    if (from >= 0 && to >= 0 && from !== to) reorderSections(moved(sections, from, to))
    onDragEnd()
  }
  const overLecture = (e: DragEvent, id: string) => {
    if (drag?.type !== 'lecture') return
    e.preventDefault()
    e.stopPropagation()
    setDropAt(id)
  }
  const dropLecture = (e: DragEvent, section: StudioSection, targetId: string | null) => {
    if (drag?.type !== 'lecture') return
    e.preventDefault()
    e.stopPropagation()
    if (drag.sectionId === section.id) {
      const from = section.lectures.findIndex((l) => l.id === drag.id)
      const to = targetId ? section.lectures.findIndex((l) => l.id === targetId) : section.lectures.length - 1
      if (from >= 0 && to >= 0 && from !== to) reorderLectures(section.id, moved(section.lectures, from, to))
    } else {
      // into another module: the server appends it there, then we put it where it was dropped
      const lectureId = drag.id
      const to = targetId ? section.lectures.findIndex((l) => l.id === targetId) : section.lectures.length
      setError('')
      setOpen((o) => new Set(o).add(section.id))
      c.updateLecture.mutate(
        { lectureId, body: { section_id: section.id } },
        {
          onError: fail,
          onSuccess: () => {
            const ids = section.lectures.map((l) => l.id)
            ids.splice(Math.max(0, to), 0, lectureId)
            c.orderLectures.mutate({ sectionId: section.id, ids }, { onError: fail })
          },
        },
      )
    }
    onDragEnd()
  }

  const addModule = () => {
    const title = newModule?.trim()
    if (!title || !version) return
    setError('')
    c.addSection.mutate(
      { versionId: version.id, title },
      { onSuccess: (r) => (setNewModule(null), setOpen((o) => new Set(o).add(r.id))), onError: fail },
    )
  }
  const startModule = () => {
    setNewModule('')
    window.setTimeout(() => newRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  return (
    <div className="grid content-start gap-4">
      <Card className="grid gap-4 p-4">
        <p className="sr-only" aria-live="polite">{announce}</p>
        <div className="flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text"><ListTree className="size-5" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight">Course content</h2>
            <p className="text-[13px] text-muted">{editable ? 'Organise your course into modules and lessons. Drag and drop to reorder.' : 'Modules and lessons in this version.'}</p>
          </div>
        </div>
        {editable ? (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={startModule}><Plus /> Add module</Button>
            <Button type="button" variant="secondary" onClick={onBulk} disabled={!sections.length} title={sections.length ? undefined : 'Add a module first'}><UploadCloud /> Bulk upload</Button>
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}

        {sections.length ? (
          <ol className="stagger grid gap-2" aria-label="Modules">
            {sections.map((s, si) => {
              const isOpen = open.has(s.id)
              return (
                <li
                  key={s.id}
                  onDragOver={(e) => overSection(e, s.id)}
                  onDrop={(e) => (drag?.type === 'lecture' ? dropLecture(e, s, null) : dropSection(e, s.id))}
                  className={cn(
                    'min-w-0 rounded-lg border bg-surface transition-[border-color,opacity,box-shadow] duration-200',
                    drag?.type === 'section' && drag.id === s.id ? 'opacity-50' : '',
                    dropAt === s.id && drag && !(drag.type === 'section' && drag.id === s.id) ? 'border-primary ring-3 ring-primary/15' : 'border-border',
                  )}
                >
                  <ModuleHeader
                    section={s}
                    index={si}
                    count={sections.length}
                    open={isOpen}
                    editable={editable}
                    courseId={course.id}
                    onToggle={() => toggle(s.id)}
                    onMove={(d) => moveSection(si, d)}
                    onDragStart={(e) => onDragStart(e, { type: 'section', id: s.id })}
                    onDragEnd={onDragEnd}
                    onDeleted={() => onDeleted(null, s.id)}
                    onError={fail}
                  />
                  {isOpen ? (
                    <div id={`module-${s.id}`} className="animate-reveal border-t border-border px-1.5 py-1.5">
                      {s.lectures.length ? (
                        <ul className="grid gap-0.5">
                          {s.lectures.map((l, li) => (
                            <LessonRow
                              key={l.id}
                              lecture={l}
                              number={`${si + 1}.${li + 1}`}
                              first={li === 0}
                              last={li === s.lectures.length - 1}
                              editable={editable}
                              courseId={course.id}
                              selected={selectedId === l.id}
                              highlighted={highlight === l.id}
                              dragging={drag?.type === 'lecture' && drag.id === l.id}
                              dropTarget={dropAt === l.id && drag?.type === 'lecture' && drag.id !== l.id}
                              onOpen={() => onSelect(l.id)}
                              onMove={(d) => moveLecture(s, li, d)}
                              onDragStart={(e) => onDragStart(e, { type: 'lecture', id: l.id, sectionId: s.id })}
                              onDragEnd={onDragEnd}
                              onDragOver={(e) => overLecture(e, l.id)}
                              onDrop={(e) => dropLecture(e, s, l.id)}
                              onDeleted={() => onDeleted(l.id)}
                              onError={fail}
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="px-2 py-3 text-center text-[13px] text-muted">{editable ? 'No lessons yet.' : 'No lessons.'}</p>
                      )}
                      {editable ? <AddLessonMenu title={s.title} onAdd={(kind) => onAdd({ sectionId: s.id, kind })} /> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : newModule === null ? (
          <div className="grid justify-items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <ListTree className="size-6 text-subtle" aria-hidden />
            <p className="text-sm font-medium">Start with a module</p>
            <p className="text-[13px] text-muted">Modules group your lessons, like chapters in a book.</p>
          </div>
        ) : null}

        {editable && newModule !== null ? (
          <form className="animate-reveal grid gap-2 rounded-lg border border-dashed border-border-strong p-2.5" onSubmit={(e) => (e.preventDefault(), addModule())}>
            <Input
              ref={newRef}
              aria-label="New module title"
              autoFocus
              value={newModule}
              maxLength={200}
              placeholder="e.g. Getting started"
              onChange={(e) => setNewModule(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNewModule(null)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewModule(null)}>Cancel</Button>
              <Button type="submit" size="sm" loading={c.addSection.isPending} disabled={!newModule.trim()}><Plus /> Add module</Button>
            </div>
          </form>
        ) : null}
      </Card>

      {editable ? (
        <Card className="grid gap-2.5 bg-primary-soft/25 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-primary" aria-hidden /> Tips</h3>
          <ul className="grid gap-2 text-[13px]">
            <Tip>Drag and drop modules and lessons to reorder them.</Tip>
            <Tip>Use the ••• menu to move a lesson with the keyboard.</Tip>
            <Tip>Use Bulk upload to add several videos at once.</Tip>
            <Tip>Mark a lesson as Free preview so anyone can try it.</Tip>
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span>{children}</span>
    </li>
  )
}

function AddLessonMenu({ title, onAdd }: { title: string; onAdd: (kind: LectureKind) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="mt-1 w-full justify-start text-primary hover:text-primary"><Plus /> Add lesson</Button>
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel className="px-2.5 py-1.5 text-xs font-medium text-muted">Add to “{title}”</MenuLabel>
        {LECTURE_KINDS.map((k) => {
          const m = KIND_META[k]
          return (
            <MenuItem key={k} onSelect={() => onAdd(k)}>
              <m.Icon aria-hidden />
              <span className="grid">
                <span>{m.label}</span>
                <span className="text-xs text-muted">{m.hint}</span>
              </span>
            </MenuItem>
          )
        })}
      </MenuContent>
    </Menu>
  )
}

// ---------------------------------------------------------------- module header
function ModuleHeader({ section: s, index, count, open, editable, courseId, onToggle, onMove, onDragStart, onDragEnd, onDeleted, onError }: {
  section: StudioSection
  index: number
  count: number
  open: boolean
  editable: boolean
  courseId: string
  onToggle: () => void
  onMove: (d: -1 | 1) => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onDeleted: () => void
  onError: (e: unknown) => void
}) {
  const c = useCurriculum(courseId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const rename = () => {
    const title = renaming?.trim()
    if (!title) return
    c.renameSection.mutate({ sectionId: s.id, title, description: s.description }, { onSuccess: () => setRenaming(null), onError })
  }
  const n = s.lectures.length

  if (renaming !== null)
    return (
      <div className="flex min-w-0 items-center gap-1.5 p-2">
        <Input
          aria-label="Module title"
          value={renaming}
          maxLength={200}
          autoFocus
          className="h-9"
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), rename())
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
        <Button type="button" size="icon-sm" variant="soft" aria-label="Save module title" loading={c.renameSection.isPending} onClick={rename}><Check /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(null)}><X /></Button>
      </div>
    )

  return (
    <div className="flex min-w-0 items-center gap-1 py-1 pr-1 pl-1.5">
      {editable ? (
        <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} className="hidden shrink-0 cursor-grab p-1 text-subtle active:cursor-grabbing sm:block" title="Drag to reorder" aria-hidden>
          <GripVertical className="size-4" />
        </span>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? `module-${s.id}` : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="min-w-0 flex-1 text-sm font-semibold break-words">Module {index + 1}: {s.title}</span>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted tabular">{n} {n === 1 ? 'lesson' : 'lessons'}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none', open ? 'rotate-180' : '-rotate-90')} aria-hidden />
      </button>
      {editable ? (
        <Menu>
          <MenuTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`More actions for module ${s.title}`}><MoreHorizontal /></Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => setRenaming(s.title)}><Pencil aria-hidden /> Rename</MenuItem>
            <MenuItem disabled={index === 0} onSelect={() => onMove(-1)}><ArrowUp aria-hidden /> Move up</MenuItem>
            <MenuItem disabled={index === count - 1} onSelect={() => onMove(1)}><ArrowDown aria-hidden /> Move down</MenuItem>
            <MenuSeparator />
            <MenuItem
              className="text-danger [&_svg]:text-danger"
              onSelect={() => {
                const msg = n ? `Delete "${s.title}" and its ${n} ${n === 1 ? 'lesson' : 'lessons'}?` : `Delete "${s.title}"?`
                if (window.confirm(msg)) c.deleteSection.mutate(s.id, { onSuccess: onDeleted, onError })
              }}
            >
              <Trash2 aria-hidden /> Delete module
            </MenuItem>
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- lesson row
function LessonRow({ lecture: l, number, first, last, editable, courseId, selected, highlighted, dragging, dropTarget, onOpen, onMove, onDragStart, onDragEnd, onDragOver, onDrop, onDeleted, onError }: {
  lecture: StudioLecture
  number: string
  first: boolean
  last: boolean
  editable: boolean
  courseId: string
  selected: boolean
  highlighted: boolean
  dragging: boolean
  dropTarget: boolean
  onOpen: () => void
  onMove: (d: -1 | 1) => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onDeleted: () => void
  onError: (e: unknown) => void
}) {
  const c = useCurriculum(courseId)
  const m = kindMeta(l.kind)
  // shows the new value at once; the server's value takes over once it has refetched
  const [pending, setPending] = useState<boolean | null>(null)
  const preview = pending ?? l.is_preview
  const [renaming, setRenaming] = useState<string | null>(null)
  const warning = lessonWarning(l)

  const togglePreview = () => {
    setPending(!preview)
    c.updateLecture.mutate({ lectureId: l.id, body: { is_preview: !preview } }, { onError, onSettled: () => setPending(null) })
  }
  const rename = () => {
    const title = renaming?.trim()
    if (!title) return
    c.updateLecture.mutate({ lectureId: l.id, body: { title } }, { onSuccess: () => setRenaming(null), onError })
  }

  return (
    <li
      id={`lecture-${l.id}`}
      draggable={editable && renaming === null}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group flex min-w-0 items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-1 transition-[background-color,border-color,opacity,box-shadow] duration-200',
        dragging && 'opacity-50',
        dropTarget ? 'border-primary bg-primary-soft/40' : selected ? 'border-primary/30 bg-primary-soft/50' : 'border-transparent hover:bg-surface-2',
        highlighted && 'border-primary ring-3 ring-primary/25',
      )}
    >
      {editable ? <GripVertical className="hidden size-4 shrink-0 cursor-grab text-subtle sm:block" aria-hidden /> : null}
      {renaming !== null ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 py-1">
          <Input
            aria-label="Lesson title"
            value={renaming}
            maxLength={200}
            autoFocus
            className="h-8"
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.preventDefault(), rename())
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
          <Button type="button" size="icon-sm" variant="soft" aria-label="Save lesson title" loading={c.updateLecture.isPending} onClick={rename}><Check /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(null)}><X /></Button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            aria-current={selected ? 'true' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <m.Icon className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted')} aria-hidden />
            <span className={cn('shrink-0 text-[13px] tabular', selected ? 'font-medium text-primary' : 'text-muted')}>{number}</span>
            <span className={cn('min-w-0 flex-1 truncate text-[13px]', selected ? 'font-medium text-primary-soft-text' : '')}>{l.title}</span>
            <span className="sr-only">, {m.label}</span>
            {warning ? (
              <span className="shrink-0 text-warning" title={warning}>
                <AlertCircle className="size-3.5" aria-hidden />
                <span className="sr-only">, {warning}</span>
              </span>
            ) : null}
            {preview ? <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-on-primary">Free</span> : null}
          </button>
          {editable ? (
            <Menu>
              <MenuTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`More actions for ${l.title}`}><MoreHorizontal /></Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={onOpen}><Pencil aria-hidden /> Edit</MenuItem>
                <MenuItem onSelect={() => setRenaming(l.title)}><Pencil aria-hidden /> Rename</MenuItem>
                <MenuItem onSelect={togglePreview}>{preview ? <EyeOff aria-hidden /> : <Eye aria-hidden />} {preview ? 'Remove free preview' : 'Make free preview'}</MenuItem>
                <MenuItem disabled={first} onSelect={() => onMove(-1)}><ArrowUp aria-hidden /> Move up</MenuItem>
                <MenuItem disabled={last} onSelect={() => onMove(1)}><ArrowDown aria-hidden /> Move down</MenuItem>
                <MenuSeparator />
                <MenuItem
                  className="text-danger [&_svg]:text-danger"
                  onSelect={() => window.confirm(`Delete "${l.title}"? This cannot be undone.`) && c.deleteLecture.mutate(l.id, { onSuccess: onDeleted, onError })}
                >
                  <Trash2 aria-hidden /> Delete lesson
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </>
      )}
    </li>
  )
}

/** A short "needs attention" note, matching what the publish checklist will say. */
function lessonWarning(l: StudioLecture): string | null {
  switch (l.kind) {
    case 'video':
      if (!l.video) return 'No video yet'
      if (l.video.status === 'failed') return 'Video failed'
      return null
    case 'article':
      return l.body.trim() ? null : 'Empty'
    case 'live_session':
      return l.live_starts_at ? null : 'No start time'
    case 'quiz':
      return l.quiz?.questions.length ? null : 'No questions'
    case 'assignment':
      return l.assignment?.instructions.trim() ? null : 'No instructions'
    case 'download':
      return l.resources.length ? null : 'No files'
    default:
      return null
  }
}
