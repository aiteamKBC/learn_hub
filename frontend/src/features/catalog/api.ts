import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { useMe } from '@/features/identity/auth'
import { useWorkspace } from '@/features/identity/workspace'
import { useCurrency } from '@/lib/currency'

export type SearchIn = 'courses' | 'instructors' | 'topics'
export type CourseFilters = { q?: string; search_in?: SearchIn; category?: string; level?: string; price?: 'free' | 'paid'; rating?: number; sort?: string; limit?: number }

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => unwrap(api.GET('/api/v1/catalog/categories')), staleTime: 10 * 60_000 })
}

export function useCourses(filters: CourseFilters = {}, enabled = true, keepPrevious = true) {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['courses', filters, code],
    enabled,
    queryFn: () => unwrap(api.GET('/api/v1/catalog/courses', { params: { query: { ...filters, currency: code } } })),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  })
}

/** Catalogue pages, loaded 24 at a time with the server's cursor. */
export function useCourseFeed(filters: CourseFilters) {
  const { code } = useCurrency()
  return useInfiniteQuery({
    queryKey: ['courses', 'feed', filters, code],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/catalog/courses', { params: { query: { ...filters, currency: code, cursor: pageParam, limit: 24 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useCourse(slug: string) {
  const { code } = useCurrency()
  const { data: me } = useMe()
  const { org } = useWorkspace()
  return useQuery({ queryKey: ['course', slug, code, me?.id ?? '', org?.org_id ?? ''], queryFn: () => unwrap(api.GET('/api/v1/catalog/courses/{slug}', { params: { path: { slug }, query: { currency: code } } })) })
}

/** Other published courses in the same catalog category or with shared course topics. */
export function useRelatedCourses(slug: string) {
  const { code } = useCurrency()
  return useQuery({
    queryKey: ['courses', 'related', slug, code],
    queryFn: () => unwrap(api.GET('/api/v1/catalog/courses/{slug}/related', { params: { path: { slug }, query: { currency: code } } })),
    enabled: !!slug,
    staleTime: 10 * 60_000,
  })
}

export function usePreview(slug: string, key: string | null) {
  return useQuery({
    queryKey: ['preview', slug, key],
    queryFn: () => unwrap(api.GET('/api/v1/catalog/courses/{slug}/preview/{lecture_key}', { params: { path: { slug, lecture_key: key! } } })),
    enabled: !!key,
    staleTime: 60 * 60_000, // signed links last 2 hours
  })
}

export function useReviews(courseId: string) {
  return useInfiniteQuery({
    queryKey: ['reviews', courseId],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/engagement/courses/{course_id}/reviews', { params: { path: { course_id: courseId }, query: { cursor: pageParam, limit: 6 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function usePlans() {
  const { code } = useCurrency()
  return useQuery({ queryKey: ['plans', code], queryFn: () => unwrap(api.GET('/api/v1/commerce/plans', { params: { query: { currency: code } } })), staleTime: 10 * 60_000 })
}

export type CourseCardData = NonNullable<ReturnType<typeof useCourses>['data']>['items'][number]
