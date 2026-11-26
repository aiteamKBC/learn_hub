import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

// Console > Courses (mockup 45). Keys start with ['console', 'courses', …]; categories
// under ['console', 'categories'].

export type CourseTab = 'all' | 'company' | 'instructor' | 'archived'
export type CourseFilters = { tab: CourseTab; status?: string; category?: string; q?: string }

const fetchCourses = (f: CourseFilters, cursor?: string) =>
  unwrap(api.GET('/api/v1/console/courses', { params: { query: { tab: f.tab, status: f.status || undefined, category: f.category || undefined, q: f.q || undefined, cursor, limit: 25 } } }))
export type ConsoleCoursePage = Awaited<ReturnType<typeof fetchCourses>>
export type ConsoleCourseRow = ConsoleCoursePage['items'][number]
const fetchCourse = (id: string) => unwrap(api.GET('/api/v1/console/courses/{course_id}', { params: { path: { course_id: id } } }))
export type ConsoleCourseDetail = Awaited<ReturnType<typeof fetchCourse>>
const fetchCategories = () => unwrap(api.GET('/api/v1/console/categories'))
export type ConsoleCategory = Awaited<ReturnType<typeof fetchCategories>>[number]

export type BulkAction = 'publish' | 'unpublish' | 'archive' | 'duplicate' | 'category' | 'delete'
export type StatusAction = 'publish' | 'unpublish' | 'archive' | 'relist'

export function useConsoleCourses(f: CourseFilters) {
  return useInfiniteQuery({
    queryKey: ['console', 'courses', 'list', f],
    queryFn: ({ pageParam }) => fetchCourses(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useConsoleCourse(id: string) {
  return useQuery({ queryKey: ['console', 'courses', 'detail', id], queryFn: () => fetchCourse(id), enabled: !!id })
}

export function useConsoleCategories() {
  return useQuery({ queryKey: ['console', 'categories'], queryFn: fetchCategories, staleTime: 60_000 })
}

function useCoursesChanged() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['console', 'courses'] })
    void qc.invalidateQueries({ queryKey: ['console', 'categories'] })
    void qc.invalidateQueries({ queryKey: ['console', 'approvals'] })
    void qc.invalidateQueries({ queryKey: ['console', 'dashboard'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] }) // the public catalogue shows listing changes
  }
}

export function useBulkCourses() {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (b: { ids: string[]; action: BulkAction; reason?: string; category_id?: string }) =>
      unwrap(api.POST('/api/v1/console/courses/bulk', { body: { ids: b.ids, action: b.action, reason: b.reason ?? '', category_id: b.category_id || null } })),
    onSuccess: done,
  })
}

export function useCourseStatus(id: string) {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (b: { action: StatusAction; reason?: string }) => unwrap(api.POST('/api/v1/console/courses/{course_id}/status', { params: { path: { course_id: id } }, body: { action: b.action, reason: b.reason ?? '' } })),
    onSuccess: done,
  })
}

export function useDuplicateCourse() {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/courses/{course_id}/duplicate', { params: { path: { course_id: id } } })),
    onSuccess: done,
  })
}

export type CoursePatch = {
  title?: string
  subtitle?: string
  description?: string
  thumbnail_url?: string
  outcomes?: string[]
  requirements?: string[]
  target_audience?: string[]
  cpd_hours?: number | null
  category_id?: string | null
  language?: string
  access_days?: number | null
  lifetime_access?: boolean
  in_subscription?: boolean
  in_business?: boolean
  level?: 'beginner' | 'intermediate' | 'advanced' | 'all'
}

export function useUpdateCourse(id: string) {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (body: CoursePatch) => unwrap(api.PATCH('/api/v1/console/courses/{course_id}', { params: { path: { course_id: id } }, body })),
    onSuccess: done,
  })
}

export function useSetCoursePrice(id: string) {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (b: { free: boolean; tier_id?: string | null }) => unwrap(api.PUT('/api/v1/console/courses/{course_id}/price', { params: { path: { course_id: id } }, body: { free: b.free, tier_id: b.tier_id ?? null } })),
    onSuccess: done,
  })
}

export function useCourseInstalmentPlan(id: string) {
  return useQuery({
    queryKey: ['console', 'course-instalments', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/courses/{course_id}/instalments', { params: { path: { course_id: id } } })),
    enabled: !!id,
  })
}

export function useCourseInstalmentContent(id: string) {
  return useQuery({
    queryKey: ['console', 'course-instalment-content', id],
    queryFn: () => unwrap(api.GET('/api/v1/console/courses/{course_id}/instalments/content', { params: { path: { course_id: id } } })),
    enabled: !!id,
  })
}

export function useCourseInstalmentLearners(id: string, q = '') {
  return useQuery({
    queryKey: ['console', 'course-instalment-learners', id, q],
    queryFn: () => unwrap(api.GET('/api/v1/console/courses/{course_id}/instalments/learners', { params: { path: { course_id: id }, query: { q: q || undefined } } })),
    enabled: !!id,
  })
}

export function useSaveCourseInstalments(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: components['schemas']['ConsoleB2CCoursePlanIn']) => unwrap(api.PUT('/api/v1/console/courses/{course_id}/instalments', { params: { path: { course_id: id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'course-instalments', id] })
      void qc.invalidateQueries({ queryKey: ['course-instalment-offer', id] })
    },
  })
}

export function useSetCourseInstalmentEligibility(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, enabled, scheduleStart }: { userId: string; enabled: boolean; scheduleStart?: string | null }) => unwrap(api.PUT('/api/v1/console/courses/{course_id}/instalments/learners/{user_id}', { params: { path: { course_id: courseId, user_id: userId } }, body: { enabled, schedule_start: scheduleStart ?? null } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['console', 'course-instalment-learners', courseId] }),
  })
}

export function useCreateCompanyCourse() {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (b: { title: string; category_id?: string }) => unwrap(api.POST('/api/v1/console/courses/company', { body: { title: b.title, category_id: b.category_id || null } })),
    onSuccess: done,
  })
}

export function useCreateCategory() {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: (b: { name: string; icon?: string; parent_id?: string | null }) => unwrap(api.POST('/api/v1/console/categories', { body: { name: b.name, icon: b.icon ?? '', parent_id: b.parent_id ?? null } })),
    onSuccess: done,
  })
}

export function useUpdateCategory() {
  const done = useCoursesChanged()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; icon?: string; is_active?: boolean }) => unwrap(api.PATCH('/api/v1/console/categories/{category_id}', { params: { path: { category_id: id } }, body })),
    onSuccess: done,
  })
}

export function useReorderCategories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => unwrap(api.POST('/api/v1/console/categories/reorder', { body: { ids } })),
    onMutate: async (ids) => {
      // move rows at once; the server confirms (or the refetch puts them back)
      await qc.cancelQueries({ queryKey: ['console', 'categories'] })
      qc.setQueryData<ConsoleCategory[]>(['console', 'categories'], (old) => old?.map((c) => (ids.includes(c.id) ? { ...c, sort_order: ids.indexOf(c.id) + 1 } : c)))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'categories'] })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    },
  })
}
