import { Check, CheckCircle2, Clock, Coins, Eye, Lock, Settings2, Star, Video } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { LECTURE_KINDS, useCurriculum, type LecturePatch, type StudioCourse, type StudioLecture } from '@/features/studio/api'
import { cn } from '@/lib/cn'

import { AssignmentFields, assignmentDraft, assignmentErrors, assignmentPayload, type AssignmentDraft } from './AssignmentFields'
import { LectureFiles } from './LectureFiles'
import { QuizQuestions, quizSettingsDraft, quizSettingsErrors, quizSettingsPayload, type QuizSettingsDraft } from './QuizQuestions'
import { RichText } from './RichText'
import { KIND_META, errText, fromLocalInput, kindMeta, splitSeconds, timeZoneName, toLocalInput, type LectureKind } from './shared'
import { VideoSource } from './VideoSource'

export function findLecture(course: StudioCourse, id: string | null) {
  if (!id) return undefined
  for (const s of course.working_version?.sections ?? []) for (const l of s.lectures) if (l.id === id) return l
  return undefined
}

const INTRO: Record<LectureKind, string> = {
  video: 'Add or edit a video lesson, manage its media and set how it is completed.',
  article: 'Write the reading and choose how it counts towards the course.',
  external_link: 'Send learners to a web page that opens in a new tab.',
  live_session: 'Schedule a live class. Create a Microsoft Teams meeting or paste a secure join link.',
  download: 'Attach the files learners download.',
  quiz: 'Set up the quiz and write its questions.',
  assignment: 'Write the brief and choose how you mark it.',
}
/** Kinds whose length the instructor sets by hand (live sessions have their own length). */
const TIMED: string[] = ['video', 'article', 'external_link', 'download']

type LectureDraft = {
  title: string
  is_preview: boolean
  token_price: string
  is_required: boolean
  body: string
  external_url: string
  live_at: string
  live_duration_min: string
  live_join_url: string
  min_watch_pct: string
  prerequisite: string // an earlier lesson's key, or '' for none
  dur_h: string
  dur_m: string
  dur_s: string
}

function lectureDraft(l: StudioLecture): LectureDraft {
  // a video lesson without a length set yet starts from the video's own length
  const d = splitSeconds(l.duration_sec || (l.kind === 'video' ? (l.video?.duration_sec ?? 0) : 0))
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    title: l.title,
    is_preview: l.is_preview,
    token_price: l.token_price == null ? '' : String(l.token_price),
    is_required: l.is_required,
    body: l.body,
    external_url: l.external_url,
    live_at: toLocalInput(l.live_starts_at),
    live_duration_min: l.live_duration_min ? String(l.live_duration_min) : '60',
    live_join_url: l.live_join_url,
    min_watch_pct: String(l.min_watch_pct),
    prerequisite: l.prerequisite_key ?? '',
    dur_h: pad(d.h),
    dur_m: pad(d.m),
    dur_s: pad(d.s),
  }
}

/** Fresh server data for the fields the instructor hasn't touched; their edits stay. */
function rebase<T extends Record<string, unknown>>(current: T, before: T, fresh: T): T {
  const next = { ...current }
  for (const k of Object.keys(fresh) as (keyof T)[]) if (current[k] === before[k]) next[k] = fresh[k]
  return next
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The lessons before this one, in course order: the only valid prerequisites. */
function earlierLessons(course: StudioCourse, lectureId: string) {
  const out: { key: string; label: string }[] = []
  for (const [si, s] of (course.working_version?.sections ?? []).entries()) {
    for (const [li, l] of s.lectures.entries()) {
      if (l.id === lectureId) return out
      out.push({ key: l.key, label: `${si + 1}.${li + 1} ${l.title}` })
    }
  }
  return out
}

const httpsOk = (u: string) => !u || /^https:\/\/\S+\.\S+/.test(u)
const durationOf = (d: LectureDraft) => Number(d.dur_h) * 3600 + Number(d.dur_m) * 60 + Number(d.dur_s)

/** The centre of the curriculum page: the lesson-type list, the lesson's own content and
 * the "Lesson settings" card. One Save sends only what changed. */
export function LessonEditor({ course, lecture, number, readOnly, onDirty, onSaved, onCancel, onAddKind }: {
  course: StudioCourse
  lecture: StudioLecture
  number: string
  readOnly: boolean
  onDirty: (d: boolean) => void
  onSaved: () => void
  onCancel: () => void
  onAddKind: (kind: LectureKind) => void
}) {
  const { updateLecture, updateQuiz, updateAssignment, createTeamsMeeting } = useCurriculum(course.id)
  const uid = useId()
  const kind = lecture.kind
  const meta = kindMeta(kind)

  const fresh = useMemo(() => ({
    lec: lectureDraft(lecture),
    quiz: lecture.quiz ? quizSettingsDraft(lecture.quiz) : null,
    asg: lecture.assignment ? assignmentDraft(lecture.assignment) : null,
  }), [lecture])
  const [start, setStart] = useState(fresh)
  const [lec, setLec] = useState(fresh.lec)
  const [quiz, setQuiz] = useState<QuizSettingsDraft | null>(fresh.quiz)
  const [asg, setAsg] = useState<AssignmentDraft | null>(fresh.asg)
  // the lesson changed on the server (a menu toggle, the video finishing): take it in
  if (start !== fresh) {
    setStart(fresh)
    setLec(rebase(lec, start.lec, fresh.lec))
    if (same(quiz, start.quiz)) setQuiz(fresh.quiz)
    if (same(asg, start.asg)) setAsg(fresh.asg)
  }

  const [questionDirty, setQuestionDirty] = useState(false)
  const [videoDirty, setVideoDirty] = useState(false) // unsaved parts / key moments
  const [tried, setTried] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const timed = TIMED.includes(kind)
  const lecChanged = !same(lec, fresh.lec)
  const quizChanged = !same(quiz, fresh.quiz)
  const asgChanged = !same(asg, fresh.asg)
  // a length taken from the video counts as a change to save, but not as unsaved work
  const durationPending = timed && durationOf(lec) !== lecture.duration_sec
  const dirty = lecChanged || quizChanged || asgChanged || questionDirty || videoDirty
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 2500)
    return () => window.clearTimeout(t)
  }, [saved])

  const set = (patch: Partial<LectureDraft>) => (setLec((x) => ({ ...x, ...patch })), setSaved(false))

  // client checks, mirroring the server's
  const errs: Record<string, string> = {}
  if (!lec.title.trim()) errs.title = 'Give the lesson a title.'
  if (lec.token_price && (!/^\d+$/.test(lec.token_price) || Number(lec.token_price) < 1)) errs.token_price = 'Use at least 1 token, or leave it blank.'
  if (kind === 'external_link' && (!lec.external_url || !httpsOk(lec.external_url))) errs.external_url = 'Enter a full link starting with https://'
  if (kind === 'live_session') {
    if (!httpsOk(lec.live_join_url)) errs.live_join_url = 'Links must start with https://'
    const m = Number(lec.live_duration_min)
    if (!(Number.isInteger(m) && m >= 5 && m <= 600)) errs.live_duration_min = 'Between 5 and 600 minutes.'
  }
  if (kind === 'video') {
    const p = Number(lec.min_watch_pct)
    if (!(Number.isInteger(p) && p >= 0 && p <= 100)) errs.min_watch_pct = 'Between 0 and 100.'
  }
  if (timed) {
    const okPart = (v: string, max: number) => /^\d{1,2}$/.test(v.trim()) && Number(v) <= max
    if (!okPart(lec.dur_h, 23) || !okPart(lec.dur_m, 59) || !okPart(lec.dur_s, 59)) errs.duration = 'Use hours, minutes (0–59) and seconds (0–59).'
  }
  const earlier = useMemo(() => earlierLessons(course, lecture.id), [course, lecture.id])
  // a prerequisite moved below this lesson (or deleted) is shown so it can be fixed
  if (lec.prerequisite && !earlier.some((e) => e.key === lec.prerequisite)) errs.prerequisite = 'Pick a lesson that comes before this one.'
  const quizErrs = quiz ? quizSettingsErrors(quiz) : {}
  const asgErrs = asg ? assignmentErrors(asg) : {}
  const invalid = Object.keys(errs).length + Object.keys(quizErrs).length + Object.keys(asgErrs).length > 0
  const show = (k: string) => (tried ? errs[k] : undefined)
  const canSave = lecChanged || quizChanged || asgChanged || durationPending

  const save = async () => {
    setTried(true)
    setError('')
    if (invalid) return
    setSaving(true)
    try {
      const s = fresh.lec
      const body: LecturePatch = {}
      if (lec.title !== s.title) body.title = lec.title.trim()
      if (lec.is_preview !== s.is_preview) body.is_preview = lec.is_preview
      if (lec.token_price !== s.token_price) body.token_price = lec.token_price === '' ? null : Number(lec.token_price)
      if (lec.is_required !== s.is_required) body.is_required = lec.is_required
      if (lec.body !== s.body) body.body = lec.body
      if (lec.external_url !== s.external_url) body.external_url = lec.external_url.trim()
      if (lec.live_at !== s.live_at) body.live_starts_at = fromLocalInput(lec.live_at)
      if (lec.live_duration_min !== s.live_duration_min) body.live_duration_min = Number(lec.live_duration_min)
      if (lec.live_join_url !== s.live_join_url) body.live_join_url = lec.live_join_url.trim()
      if (lec.min_watch_pct !== s.min_watch_pct) body.min_watch_pct = Number(lec.min_watch_pct)
      if (lec.prerequisite !== s.prerequisite) body.prerequisite_key = lec.prerequisite || null
      if (durationPending) body.duration_sec = durationOf(lec)
      if (Object.keys(body).length) await updateLecture.mutateAsync({ lectureId: lecture.id, body })
      if (quizChanged && quiz && lecture.quiz) await updateQuiz.mutateAsync({ quizId: lecture.quiz.id, body: quizSettingsPayload(quiz) })
      if (asgChanged && asg && lecture.assignment) await updateAssignment.mutateAsync({ assignmentId: lecture.assignment.id, body: assignmentPayload(asg) })
      setTried(false)
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-text"><meta.Icon className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{meta.label} lesson editor</h2>
          <p className="text-sm text-muted">{readOnly ? 'Read only. Create a new draft in Publish to make changes.' : INTRO[kind as LectureKind] ?? INTRO.article}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[148px_minmax(0,1fr)] 2xl:grid-cols-[148px_minmax(0,1fr)_272px]">
        {/* lesson types: the current one, and quick "add a lesson of this type" for the rest */}
        <nav aria-label="Lesson type" className="xl:row-span-2 2xl:row-span-1">
          <ul className="flex flex-wrap gap-1.5 xl:sticky xl:top-20 xl:flex-col xl:gap-1">
            {LECTURE_KINDS.map((k) => {
              const m = KIND_META[k]
              const current = k === kind
              if (!current && readOnly) return null
              const cls = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150 max-xl:w-auto max-xl:border max-xl:py-1.5'
              return (
                <li key={k}>
                  {current ? (
                    <span aria-current="true" className={cn(cls, 'bg-primary-soft font-medium text-primary-soft-text max-xl:border-primary/30')}>
                      <m.Icon className="size-4 shrink-0" aria-hidden /> {m.label}
                    </span>
                  ) : (
                    <button type="button" onClick={() => onAddKind(k)} title={`Add a new ${m.label.toLowerCase()} lesson to this module`} className={cn(cls, 'text-muted hover:bg-surface-2 hover:text-text max-xl:border-border focus-visible:outline-2 focus-visible:outline-primary')}>
                      <m.Icon className="size-4 shrink-0" aria-hidden /> {m.label}
                      <span className="sr-only">: add a new lesson of this type</span>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {readOnly ? null : <p className="mt-2 hidden text-xs text-muted xl:block">Pick another type to add a new lesson to this module.</p>}
        </nav>

        <form className="contents" onSubmit={(e) => (e.preventDefault(), void save())} noValidate aria-label={`Edit ${lecture.title}`}>
          <Card className="grid content-start gap-6 p-4 sm:p-5">
            <Field label="Lesson title" error={show('title')}>
              {(p) => (
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted tabular" aria-hidden>{number}</span>
                  <Input {...p} value={lec.title} maxLength={200} disabled={readOnly} onChange={(e) => set({ title: e.target.value })} style={{ paddingLeft: `${1.4 + number.length * 0.55}rem` }} />
                </div>
              )}
            </Field>

            {kind === 'video' ? <VideoSource courseId={course.id} lecture={lecture} readOnly={readOnly} onDirty={setVideoDirty} /> : null}

            {kind === 'article' ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-body`}>Reading</Label>
                <RichText id={`${uid}-body`} label="Reading" value={lec.body} onChange={(body) => set({ body })} placeholder="Write the lesson…" minHeight={260} readOnly={readOnly} />
              </div>
            ) : null}

            {kind === 'external_link' ? (
              <Field label="Link" hint="Learners open it in a new tab." error={show('external_url')}>
                {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={lec.external_url} maxLength={500} disabled={readOnly} onChange={(e) => set({ external_url: e.target.value })} />}
              </Field>
            ) : null}

            {kind === 'live_session' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts" hint={`Your time zone: ${timeZoneName()}`}>
                  {(p) => <Input {...p} type="datetime-local" value={lec.live_at} disabled={readOnly} onChange={(e) => set({ live_at: e.target.value })} />}
                </Field>
                <Field label="Length (minutes)" error={show('live_duration_min')}>
                  {(p) => <Input {...p} type="number" min={5} max={600} value={lec.live_duration_min} disabled={readOnly} onChange={(e) => set({ live_duration_min: e.target.value })} />}
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Join link" hint="A Teams meeting is visible to learners 15 minutes before the start." error={show('live_join_url')}>
                    {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={lec.live_join_url} maxLength={500} disabled={readOnly} onChange={(e) => set({ live_join_url: e.target.value })} />}
                  </Field>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text"><Video className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Microsoft Teams</p>
                    <p className="text-xs text-muted">{lecture.live_provider === 'teams' ? `Meeting created by ${lecture.teams_organizer || 'the training organiser'}.` : 'Save the session time first, then create the meeting from LearnHub.'}</p>
                  </div>
                  {lecture.live_provider === 'teams' ? <span className="text-xs font-medium text-success">Connected</span> : (
                    <Button type="button" variant="secondary" size="sm" disabled={readOnly || saving || createTeamsMeeting.isPending || !lec.live_at || !lec.live_duration_min || dirty} onClick={() => void createTeamsMeeting.mutateAsync(lecture.id).then(() => onSaved()).catch((e) => setError(errText(e)))}>
                      <Video /> {createTeamsMeeting.isPending ? 'Creating…' : 'Create Teams meeting'}
                    </Button>
                  )}
                  {dirty && !readOnly ? <p className="basis-full text-xs text-amber-700">Save your session changes before creating the Teams meeting.</p> : null}
                </div>
              </div>
            ) : null}

            {kind === 'download' ? <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-muted">Learners download the files you attach below. Add at least one.</p> : null}

            {kind === 'quiz' && quiz && lecture.quiz ? (
              <>
                <section aria-labelledby={`${uid}-qset`} className="grid gap-4">
                  <h3 id={`${uid}-qset`} className="text-sm font-semibold">Quiz settings</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Type">
                      {(p) => (
                        <NativeSelect {...p} value={quiz.mode} disabled={readOnly} onChange={(e) => setQuiz({ ...quiz, mode: e.target.value })}>
                          <option value="graded">Graded</option>
                          <option value="practice">Practice</option>
                        </NativeSelect>
                      )}
                    </Field>
                    <Field label="Pass mark (%)" error={tried ? quizErrs.pass_mark_pct : undefined}>
                      {(p) => <Input {...p} type="number" min={0} max={100} value={quiz.pass_mark_pct} disabled={readOnly} onChange={(e) => setQuiz({ ...quiz, pass_mark_pct: e.target.value })} />}
                    </Field>
                    <Field label="Time limit (minutes)" hint="Empty: no limit." error={tried ? quizErrs.time_limit_min : undefined}>
                      {(p) => <Input {...p} type="number" min={1} max={240} value={quiz.time_limit_min} disabled={readOnly} onChange={(e) => setQuiz({ ...quiz, time_limit_min: e.target.value })} />}
                    </Field>
                    <Field label="Attempts allowed" hint="Empty: unlimited." error={tried ? quizErrs.max_attempts : undefined}>
                      {(p) => <Input {...p} type="number" min={1} max={100} value={quiz.max_attempts} disabled={readOnly} onChange={(e) => setQuiz({ ...quiz, max_attempts: e.target.value })} />}
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Show correct answers">
                        {(p) => (
                          <NativeSelect {...p} value={quiz.reveal_answers} disabled={readOnly} onChange={(e) => setQuiz({ ...quiz, reveal_answers: e.target.value })}>
                            <option value="after_submit">After each attempt</option>
                            <option value="after_pass">Once passed</option>
                            <option value="never">Never</option>
                          </NativeSelect>
                        )}
                      </Field>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <label className="flex items-center gap-3 text-sm">
                      <Switch checked={quiz.shuffle_questions} disabled={readOnly} onCheckedChange={(v) => setQuiz({ ...quiz, shuffle_questions: v })} aria-label="Shuffle questions" />
                      Shuffle questions
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                      <Switch checked={quiz.shuffle_options} disabled={readOnly} onCheckedChange={(v) => setQuiz({ ...quiz, shuffle_options: v })} aria-label="Shuffle answer options" />
                      Shuffle answer options
                    </label>
                  </div>
                </section>
                <QuizQuestions courseId={course.id} quiz={lecture.quiz} readOnly={readOnly} onDirty={setQuestionDirty} />
              </>
            ) : null}

            {kind === 'assignment' && asg ? <AssignmentFields value={asg} onChange={setAsg} errors={tried ? asgErrs : {}} readOnly={readOnly} /> : null}

            <div className="border-t border-border pt-5">
              <LectureFiles courseId={course.id} lecture={lecture} readOnly={readOnly} />
            </div>
          </Card>

          {/* lesson settings: under the editor until there is room beside it */}
          <Card className="grid content-start gap-5 self-start p-4 sm:p-5 xl:col-start-2 2xl:sticky 2xl:top-20 2xl:col-start-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Settings2 className="size-4 text-primary" aria-hidden /> Lesson settings</h3>

            <SettingRow icon={<Eye />} title="Free preview" body="Anyone can open this lesson before buying the course.">
              <Switch checked={lec.is_preview} disabled={readOnly} onCheckedChange={(is_preview) => set({ is_preview })} aria-label="Free preview" />
            </SettingRow>

            <div className="grid gap-2">
              <SettingRow icon={<Coins />} title="Token price" body="Tokens needed to unlock this lesson on its own. Leave blank if it is available only with the full course, subscription or as a preview." />
              <div className="ml-7">
                <Input aria-label="Token price" type="number" min={1} step={1} inputMode="numeric" placeholder="Not sold separately" value={lec.token_price} disabled={readOnly} aria-invalid={show('token_price') ? true : undefined} onChange={(e) => set({ token_price: e.target.value.replace(/[^\d]/g, '') })} />
                {show('token_price') ? <p className="mt-1 text-[13px] text-danger">{show('token_price')}</p> : null}
              </div>
            </div>

            {timed ? (
              <div className="grid gap-2">
                <SettingRow icon={<Clock />} title="Lesson length" body={kind === 'video' ? 'Starts from the video’s length. Shown on the course page.' : 'How long it takes. Shown on the course page.'} />
                <fieldset className="ml-7 flex items-center gap-1.5" aria-describedby={errs.duration && tried ? `${uid}-dur` : undefined}>
                  <legend className="sr-only">Lesson length</legend>
                  {(['dur_h', 'dur_m', 'dur_s'] as const).map((k, i) => (
                    <span key={k} className="contents">
                      {i ? <span className="text-muted" aria-hidden>:</span> : null}
                      <Input
                        aria-label={['Hours', 'Minutes', 'Seconds'][i]}
                        inputMode="numeric"
                        maxLength={2}
                        value={lec[k]}
                        disabled={readOnly}
                        aria-invalid={tried && errs.duration ? true : undefined}
                        onChange={(e) => set({ [k]: e.target.value.replace(/\D/g, '') } as Partial<LectureDraft>)}
                        onBlur={(e) => e.target.value && set({ [k]: e.target.value.padStart(2, '0') } as Partial<LectureDraft>)}
                        className="h-10 w-14 text-center tabular"
                      />
                    </span>
                  ))}
                </fieldset>
                {tried && errs.duration ? <p id={`${uid}-dur`} className="ml-7 text-[13px] text-danger">{errs.duration}</p> : null}
              </div>
            ) : null}

            {kind === 'video' ? (
              <div className="grid gap-2">
                <SettingRow icon={<CheckCircle2 />} title="Completion requirement" body="Marked complete when the video is watched to at least:" />
                <div className="ml-7">
                  <NativeSelect aria-label="Completion requirement" value={lec.min_watch_pct} disabled={readOnly} onChange={(e) => set({ min_watch_pct: e.target.value })} aria-invalid={show('min_watch_pct') ? true : undefined}>
                    {[...new Set(['50', '75', '90', '100', lec.min_watch_pct])].map((v) => <option key={v} value={v}>{v === '100' ? '100% (full video)' : `${v}%`}</option>)}
                  </NativeSelect>
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              <SettingRow icon={<Lock />} title="Prerequisite lesson" body={earlier.length ? 'Learners must complete another lesson first.' : 'The first lesson can’t have one.'}>
                <Switch
                  checked={!!lec.prerequisite}
                  disabled={readOnly || (!earlier.length && !lec.prerequisite)}
                  onCheckedChange={(on) => set({ prerequisite: on ? (earlier.at(-1)?.key ?? '') : '' })}
                  aria-label="Require another lesson first"
                />
              </SettingRow>
              {lec.prerequisite ? (
                <div className="ml-7 grid gap-1">
                  <NativeSelect aria-label="Lesson to complete first" value={lec.prerequisite} disabled={readOnly} onChange={(e) => set({ prerequisite: e.target.value })} aria-invalid={errs.prerequisite ? true : undefined} aria-describedby={errs.prerequisite ? `${uid}-pre` : undefined}>
                    {earlier.some((e) => e.key === lec.prerequisite) ? null : <option value={lec.prerequisite}>Missing lesson</option>}
                    {earlier.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                  </NativeSelect>
                  {errs.prerequisite ? <p id={`${uid}-pre`} className="text-[13px] text-danger">{errs.prerequisite}</p> : null}
                </div>
              ) : null}
            </div>

            <SettingRow icon={<Star />} title="Required" body="Learners must finish it to complete the course.">
              <Switch checked={lec.is_required} disabled={readOnly} onCheckedChange={(is_required) => set({ is_required })} aria-label="Required to complete the course" />
            </SettingRow>

            {readOnly ? null : (
              <div className="grid gap-3 border-t border-border pt-4">
                {error ? (
                  <p role="alert" className="text-[13px] text-danger">{error}</p>
                ) : tried && invalid ? (
                  <p role="alert" className="text-[13px] text-danger">Fix the highlighted fields.</p>
                ) : questionDirty ? (
                  <p className="text-[13px] text-muted">Save or cancel the open question first.</p>
                ) : videoDirty ? (
                  <p className="text-[13px] text-muted">Parts and key moments have their own Save button.</p>
                ) : saved ? (
                  <p className="inline-flex animate-reveal items-center gap-1.5 text-[13px] text-success" role="status"><Check className="size-4" aria-hidden /> Lesson saved</p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" onClick={onCancel} disabled={!dirty}>Cancel</Button>
                  <Button type="submit" loading={saving} disabled={!canSave}><Check /> Save lesson</Button>
                </div>
              </div>
            )}
          </Card>
        </form>
      </div>
    </div>
  )
}

function SettingRow({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-primary [&_svg]:size-4" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted">{body}</p>
      </div>
      {children ? <div className="shrink-0 pt-0.5">{children}</div> : null}
    </div>
  )
}
