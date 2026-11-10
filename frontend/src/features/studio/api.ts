import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// The instructor studio (/api/v1/studio/). Every key starts with 'studio'. The course
// builder reads one tree (`useStudioCourse`); curriculum edits invalidate just that
// course, so the builder refetches its tree and checklist together.
type S = components['schemas']

const fetchCourses = () => unwrap(api.GET('/api/v1/studio/courses'))
const fetchCourse = (id: string) => unwrap(api.GET('/api/v1/studio/courses/{course_id}', { params: { path: { course_id: id } } }))
const fetchGrading = () => unwrap(api.GET('/api/v1/studio/grading'))
const fetchQuestions = (unanswered: boolean) => unwrap(api.GET('/api/v1/studio/questions', { params: { query: { unanswered } } }))
const fetchReviews = (unreplied: boolean) => unwrap(api.GET('/api/v1/studio/reviews', { params: { query: { unreplied } } }))
const fetchRevenue = () => unwrap(api.GET('/api/v1/studio/revenue'))

export type StudioCourseRow = Awaited<ReturnType<typeof fetchCourses>>[number]
export type StudioCourse = Awaited<ReturnType<typeof fetchCourse>>
export type WorkingVersion = NonNullable<StudioCourse['working_version']>
export type StudioSection = WorkingVersion['sections'][number]
export type StudioLecture = StudioSection['lectures'][number]
export type StudioQuiz = NonNullable<StudioLecture['quiz']>
export type StudioQuizQuestion = StudioQuiz['questions'][number]
export type StudioAssignment = NonNullable<StudioLecture['assignment']>
export type StudioResource = StudioLecture['resources'][number]
export type GradingQueue = Awaited<ReturnType<typeof fetchGrading>>
export type GradingSubmission = GradingQueue['submissions'][number]
export type GradingAttempt = GradingQueue['attempts'][number]
export type InboxQuestion = Awaited<ReturnType<typeof fetchQuestions>>[number]
export type InboxReview = Awaited<ReturnType<typeof fetchReviews>>[number]
export type StudioRevenue = Awaited<ReturnType<typeof fetchRevenue>>

export type CoursePatch = S['CoursePatch']
export type LecturePatch = S['LecturePatch']
export type QuizPatch = S['QuizPatch']
export type QuizQuestionIn = S['QuizQuestionIn']
export type AssignmentPatch = S['AssignmentPatch']
export type CouponIn = S['CouponIn']
export type GradeIn = S['GradeIn']
export type EssayGradeIn = S['EssayGradeIn']
export type InstructorProfileIn = S['InstructorProfileIn']
export type PayoutAccountIn = S['PayoutAccountIn']

/** The 7 lecture kinds the builder can add, in menu order. */
export const LECTURE_KINDS = ['video', 'article', 'external_link', 'live_session', 'download', 'quiz', 'assignment'] as const

const courseKey = (id: string) => ['studio', 'course', id]
const courseChanged = (qc: QueryClient, id: string) => qc.invalidateQueries({ queryKey: courseKey(id) })

// ---------------------------------------------------------------- reads
export function useStudioDashboard() {
  return useQuery({ queryKey: ['studio', 'dashboard'], queryFn: () => unwrap(api.GET('/api/v1/studio/dashboard')) })
}

export function useStudioCourses() {
  return useQuery({ queryKey: ['studio', 'courses'], queryFn: fetchCourses })
}

export function useStudioCourse(id: string | undefined) {
  return useQuery({ queryKey: courseKey(id ?? ''), queryFn: () => fetchCourse(id!), enabled: !!id })
}

export function usePriceTiers() {
  return useQuery({ queryKey: ['studio', 'price-tiers'], queryFn: () => unwrap(api.GET('/api/v1/studio/price-tiers')), staleTime: 10 * 60_000 })
}

export function useCoupons(courseId: string) {
  return useQuery({
    queryKey: ['studio', 'coupons', courseId],
    queryFn: () => unwrap(api.GET('/api/v1/studio/courses/{course_id}/coupons', { params: { path: { course_id: courseId } } })),
  })
}

export function useCourseStudents(courseId: string | undefined) {
  return useQuery({
    queryKey: ['studio', 'students', courseId ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/studio/courses/{course_id}/students', { params: { path: { course_id: courseId! }, query: { limit: 500 } } })),
    enabled: !!courseId,
  })
}

export function useGradingQueue() {
  return useQuery({ queryKey: ['studio', 'grading'], queryFn: fetchGrading })
}

export function useQuestionInbox(unanswered: boolean) {
  return useQuery({ queryKey: ['studio', 'questions', unanswered], queryFn: () => fetchQuestions(unanswered) })
}

export function useReviewInbox(unreplied: boolean) {
  return useQuery({ queryKey: ['studio', 'reviews', unreplied], queryFn: () => fetchReviews(unreplied) })
}

/** One question with its answers (the engagement thread), for answering inline. */
export function useQuestionThread(questionId: string | undefined) {
  return useQuery({
    queryKey: ['studio', 'question', questionId ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/questions/{question_id}', { params: { path: { question_id: questionId! } } })),
    enabled: !!questionId,
  })
}

export function useCourseAnnouncements(courseId: string | undefined) {
  return useQuery({
    queryKey: ['studio', 'announcements', courseId ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/engagement/courses/{course_id}/announcements', { params: { path: { course_id: courseId! } } })),
    enabled: !!courseId,
  })
}

export function useStudioRevenue() {
  return useQuery({ queryKey: ['studio', 'revenue'], queryFn: fetchRevenue })
}

export function usePayouts() {
  return useQuery({ queryKey: ['studio', 'payouts'], queryFn: () => unwrap(api.GET('/api/v1/studio/payouts')) })
}

export function usePayoutAccount() {
  return useQuery({ queryKey: ['studio', 'payout-account'], queryFn: () => unwrap(api.GET('/api/v1/studio/payout-account')) })
}

/** Video processing status: polls every 4 s until Bunny says it's playable (or failed). */
export function useMediaStatus(assetId: string | undefined) {
  return useQuery({
    queryKey: ['studio', 'media', assetId ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/studio/media/{asset_id}', { params: { path: { asset_id: assetId! } } })),
    enabled: !!assetId,
    refetchInterval: (q) => (q.state.data && ['ready', 'failed'].includes(q.state.data.status) ? false : 4000),
  })
}

// ---------------------------------------------------------------- becoming an instructor
export function useApplyToTeach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InstructorProfileIn) => unwrap(api.POST('/api/v1/studio/instructor-profile', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

// ---------------------------------------------------------------- courses
export function useCreateCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; category_id?: string | null }) => unwrap(api.POST('/api/v1/studio/courses', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'courses'] }),
  })
}

export function useUpdateCourse(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CoursePatch) => unwrap(api.PATCH('/api/v1/studio/courses/{course_id}', { params: { path: { course_id: courseId } }, body })),
    onSuccess: () => Promise.all([courseChanged(qc, courseId), qc.invalidateQueries({ queryKey: ['studio', 'courses'] })]),
  })
}

export function useSetPrice(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { free: boolean; tier_id?: string | null }) =>
      unwrap(api.PUT('/api/v1/studio/courses/{course_id}/price', { params: { path: { course_id: courseId } }, body })),
    onSuccess: () => courseChanged(qc, courseId),
  })
}

export function useNewDraft(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/studio/courses/{course_id}/draft', { params: { path: { course_id: courseId } } })),
    onSuccess: () => Promise.all([courseChanged(qc, courseId), qc.invalidateQueries({ queryKey: ['studio', 'courses'] })]),
  })
}

export function useSubmitForReview(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { versionId: string; change_summary?: string; requires_recompletion?: boolean; is_major_change?: boolean }) =>
      unwrap(api.POST('/api/v1/studio/versions/{version_id}/submit', {
        params: { path: { version_id: v.versionId } },
        body: { change_summary: v.change_summary ?? '', requires_recompletion: v.requires_recompletion ?? false, is_major_change: v.is_major_change ?? false },
      })),
    onSuccess: () => Promise.all([courseChanged(qc, courseId), qc.invalidateQueries({ queryKey: ['studio', 'courses'] })]),
  })
}

// ---------------------------------------------------------------- curriculum
// Every curriculum mutation takes the course id so it refreshes exactly that tree.
export function useCurriculum(courseId: string) {
  const qc = useQueryClient()
  const done = () => courseChanged(qc, courseId)
  return {
    addSection: useMutation({
      mutationFn: (v: { versionId: string; title: string; description?: string }) =>
        unwrap(api.POST('/api/v1/studio/versions/{version_id}/sections', { params: { path: { version_id: v.versionId } }, body: { title: v.title, description: v.description ?? '' } })),
      onSuccess: done,
    }),
    renameSection: useMutation({
      mutationFn: (v: { sectionId: string; title: string; description?: string }) =>
        unwrap(api.PATCH('/api/v1/studio/sections/{section_id}', { params: { path: { section_id: v.sectionId } }, body: { title: v.title, description: v.description ?? '' } })),
      onSuccess: done,
    }),
    deleteSection: useMutation({
      mutationFn: (sectionId: string) => unwrap(api.DELETE('/api/v1/studio/sections/{section_id}', { params: { path: { section_id: sectionId } } })),
      onSuccess: done,
    }),
    orderSections: useMutation({
      mutationFn: (v: { versionId: string; ids: string[] }) =>
        unwrap(api.PUT('/api/v1/studio/versions/{version_id}/sections/order', { params: { path: { version_id: v.versionId } }, body: { ids: v.ids } })),
      onSuccess: done,
    }),
    addLecture: useMutation({
      mutationFn: (v: { sectionId: string; kind: string; title: string; body?: string; external_url?: string }) =>
        unwrap(api.POST('/api/v1/studio/sections/{section_id}/lectures', {
          params: { path: { section_id: v.sectionId } },
          body: { kind: v.kind, title: v.title, body: v.body, external_url: v.external_url },
        })),
      onSuccess: done,
    }),
    updateLecture: useMutation({
      mutationFn: (v: { lectureId: string; body: LecturePatch }) =>
        unwrap(api.PATCH('/api/v1/studio/lectures/{lecture_id}', { params: { path: { lecture_id: v.lectureId } }, body: v.body })),
      onSuccess: done,
    }),
    deleteLecture: useMutation({
      mutationFn: (lectureId: string) => unwrap(api.DELETE('/api/v1/studio/lectures/{lecture_id}', { params: { path: { lecture_id: lectureId } } })),
      onSuccess: done,
    }),
    orderLectures: useMutation({
      mutationFn: (v: { sectionId: string; ids: string[] }) =>
        unwrap(api.PUT('/api/v1/studio/sections/{section_id}/lectures/order', { params: { path: { section_id: v.sectionId } }, body: { ids: v.ids } })),
      onSuccess: done,
    }),
    updateQuiz: useMutation({
      mutationFn: (v: { quizId: string; body: QuizPatch }) =>
        unwrap(api.PATCH('/api/v1/studio/quizzes/{quiz_id}', { params: { path: { quiz_id: v.quizId } }, body: v.body })),
      onSuccess: done,
    }),
    addQuestion: useMutation({
      mutationFn: (v: { quizId: string; body: QuizQuestionIn }) =>
        unwrap(api.POST('/api/v1/studio/quizzes/{quiz_id}/questions', { params: { path: { quiz_id: v.quizId } }, body: v.body })),
      onSuccess: done,
    }),
    replaceQuestion: useMutation({
      mutationFn: (v: { questionId: string; body: QuizQuestionIn }) =>
        unwrap(api.PUT('/api/v1/studio/questions/{question_id}', { params: { path: { question_id: v.questionId } }, body: v.body })),
      onSuccess: done,
    }),
    deleteQuestion: useMutation({
      mutationFn: (questionId: string) => unwrap(api.DELETE('/api/v1/studio/questions/{question_id}', { params: { path: { question_id: questionId } } })),
      onSuccess: done,
    }),
    updateAssignment: useMutation({
      mutationFn: (v: { assignmentId: string; body: AssignmentPatch }) =>
        unwrap(api.PATCH('/api/v1/studio/assignments/{assignment_id}', { params: { path: { assignment_id: v.assignmentId } }, body: v.body })),
      onSuccess: done,
    }),
    renameResource: useMutation({
      mutationFn: (v: { resourceId: string; title: string }) =>
        unwrap(api.PATCH('/api/v1/studio/resources/{resource_id}', { params: { path: { resource_id: v.resourceId } }, body: { title: v.title } })),
      onSuccess: done,
    }),
    deleteResource: useMutation({
      mutationFn: (resourceId: string) => unwrap(api.DELETE('/api/v1/studio/resources/{resource_id}', { params: { path: { resource_id: resourceId } } })),
      onSuccess: done,
    }),
  }
}

// ---------------------------------------------------------------- uploads (straight to Azure / Bunny)
/** PUT one file to a pre-signed Azure link with the headers the API gave (fetch() can't
 * report upload progress). The file never passes through our servers. */
export function putToAzure(ticket: { method: string; upload_url: string; headers: Record<string, string> }, file: File, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(ticket.method, ticket.upload_url)
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection, or the storage settings.'))
    xhr.send(file)
  })
}

/** Lecture file: 1) ask for a write-only link, 2) PUT to Azure, 3) attach. */
export async function uploadLectureFile(lectureId: string, file: File, onProgress?: (pct: number) => void) {
  const start = await unwrap(api.POST('/api/v1/studio/lectures/{lecture_id}/resources/uploads', {
    params: { path: { lecture_id: lectureId } },
    body: { filename: file.name, size_bytes: file.size },
  }))
  await putToAzure(start, file, onProgress)
  return unwrap(api.POST('/api/v1/studio/lectures/{lecture_id}/resources', {
    params: { path: { lecture_id: lectureId } },
    body: { asset_id: start.asset_id, title: file.name },
  }))
}

export function resourceDownloadUrl(resourceId: string) {
  return unwrap(api.GET('/api/v1/studio/resources/{resource_id}/download', { params: { path: { resource_id: resourceId } } }))
}

/** Video: we create it at Bunny; the browser then uploads with the returned session. */
export function startVideoUpload(body: { course_id: string; title: string; filename: string; size_bytes: number }) {
  return unwrap(api.POST('/api/v1/studio/media/videos', { body }))
}

// ---------------------------------------------------------------- coupons
export function useCreateCoupon(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CouponIn) => unwrap(api.POST('/api/v1/studio/courses/{course_id}/coupons', { params: { path: { course_id: courseId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'coupons', courseId] }),
  })
}

export function useDeactivateCoupon(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (couponId: string) => unwrap(api.DELETE('/api/v1/studio/coupons/{coupon_id}', { params: { path: { coupon_id: couponId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'coupons', courseId] }),
  })
}

// ---------------------------------------------------------------- marking
const markingChanged = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: ['studio', 'grading'] }), qc.invalidateQueries({ queryKey: ['studio', 'dashboard'] })])

export function useGradeSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { submissionId: string; body: GradeIn }) =>
      unwrap(api.POST('/api/v1/studio/submissions/{submission_id}/grade', { params: { path: { submission_id: v.submissionId } }, body: v.body })),
    onSuccess: () => markingChanged(qc),
  })
}

export function useGradeEssay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { attemptId: string; body: EssayGradeIn }) =>
      unwrap(api.POST('/api/v1/studio/attempts/{attempt_id}/grade', { params: { path: { attempt_id: v.attemptId } }, body: v.body })),
    onSuccess: () => markingChanged(qc),
  })
}

export function submissionFileUrl(fileId: string) {
  return unwrap(api.GET('/api/v1/studio/submission-files/{file_id}/download', { params: { path: { file_id: fileId } } }))
}

// ---------------------------------------------------------------- Q&A, reviews, announcements
export function useAnswerQuestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { questionId: string; body: string }) =>
      unwrap(api.POST('/api/v1/engagement/questions/{question_id}/answers', { params: { path: { question_id: v.questionId } }, body: { body: v.body } })),
    onSuccess: (_r, v) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['studio', 'question', v.questionId] }),
        qc.invalidateQueries({ queryKey: ['studio', 'questions'] }),
        qc.invalidateQueries({ queryKey: ['studio', 'dashboard'] }),
      ]),
  })
}

export function useReplyToReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { reviewId: string; body: string }) =>
      unwrap(api.POST('/api/v1/engagement/reviews/{review_id}/reply', { params: { path: { review_id: v.reviewId } }, body: { body: v.body } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'reviews'] }),
  })
}

export function useAnnounce() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { courseId: string; title: string; body: string }) =>
      unwrap(api.POST('/api/v1/engagement/courses/{course_id}/announcements', { params: { path: { course_id: v.courseId } }, body: { title: v.title, body: v.body } })),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['studio', 'announcements', v.courseId] }),
  })
}

// ---------------------------------------------------------------- payouts
export function useSetPayoutAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PayoutAccountIn) => unwrap(api.PUT('/api/v1/studio/payout-account', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'payout-account'] }),
  })
}

// ---------------------------------------------------------------- video parts, key moments, thumbnail
export type VideoDetails = Awaited<ReturnType<typeof fetchVideoDetails>>
const fetchVideoDetails = (assetId: string) =>
  unwrap(api.GET('/api/v1/studio/media/{asset_id}/details', { params: { path: { asset_id: assetId } } }))

/** Parts (Bunny chapters), key moments (Bunny moments) and thumbnails of one video. */
export function useVideoDetails(assetId: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['studio', 'video', assetId ?? ''], queryFn: () => fetchVideoDetails(assetId!), enabled: !!assetId && enabled })
}

export function useSaveVideoParts(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['VideoPartsIn']) => unwrap(api.PUT('/api/v1/studio/media/{asset_id}/parts', { params: { path: { asset_id: assetId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'video', assetId] }),
  })
}

export function useSetVideoThumbnail(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (choice: string) => unwrap(api.PUT('/api/v1/studio/media/{asset_id}/thumbnail', { params: { path: { asset_id: assetId } }, body: { choice } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'video', assetId] }),
  })
}

/** An external video link (a direct file URL): Bunny fetches and hosts it like an upload. */
export function fetchVideoFromLink(body: { course_id: string; title: string; url: string }) {
  return unwrap(api.POST('/api/v1/studio/media/videos/fetch', { body }))
}

/** Subtitles (.srt / .vtt, up to 1 MB): the text is sent to us and forwarded to Bunny. */
export function useVideoCaptions(assetId: string) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['studio', 'video', assetId] })
  return {
    add: useMutation({
      mutationFn: (body: S['CaptionIn']) => unwrap(api.POST('/api/v1/studio/media/{asset_id}/captions', { params: { path: { asset_id: assetId } }, body })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (srclang: string) => unwrap(api.DELETE('/api/v1/studio/media/{asset_id}/captions/{srclang}', { params: { path: { asset_id: assetId, srclang } } })),
      onSuccess: done,
    }),
  }
}

// ---------------------------------------------------------------- certificate templates (mockup 23)
const fetchCertTemplates = () => unwrap(api.GET('/api/v1/studio/certificate-templates'))
export type StudioCertTemplate = Awaited<ReturnType<typeof fetchCertTemplates>>[number]
const certTemplatesKey = ['studio', 'certificate-templates']

export function useStudioCertTemplates() {
  return useQuery({ queryKey: certTemplatesKey, queryFn: fetchCertTemplates })
}

export type StudioCertTemplateInput = Pick<StudioCertTemplate, 'name' | 'layout' | 'signatory_name' | 'signatory_title' | 'show_qr_code'>

/** Create or edit the instructor's own template; either way it goes to staff for approval. */
export function useSaveStudioCertTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: StudioCertTemplateInput & { id?: string }) =>
      id
        ? unwrap(api.PATCH('/api/v1/studio/certificate-templates/{template_id}', { params: { path: { template_id: id } }, body }))
        : unwrap(api.POST('/api/v1/studio/certificate-templates', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: certTemplatesKey }),
  })
}

/** null = the platform default. */
export function useSetCourseCertTemplate(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string | null) =>
      unwrap(api.PUT('/api/v1/studio/courses/{course_id}/certificate-template', { params: { path: { course_id: courseId } }, body: { template_id: templateId } })),
    onSuccess: () => courseChanged(qc, courseId),
  })
}
