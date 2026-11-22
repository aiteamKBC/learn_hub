/** Performance management (PMS): routes and navigation, ready for the integrator.
 *
 * In app/router.tsx:
 *   - /business children:    ...pmsBusinessRoutes   (before the '*' route)
 *   - LearnerLayout children: ...pmsLearnerRoutes
 *   - businessNav:           ...pmsBusinessNav       (after the existing sections)
 */
import { CalendarRange, ClipboardList, Gauge } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'

import type { NavSection } from '@/components/layout/WorkspaceLayout'
import { PageSpinner } from '@/app/guards'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const KpisPage = named(() => import('@/pages/business/pms/KpisPage'), 'KpisPage')
const ProposalsPage = named(() => import('@/pages/business/pms/ProposalsPage'), 'ProposalsPage')
const CyclesPage = named(() => import('@/pages/business/pms/CyclesPage'), 'CyclesPage')
const CycleDetailPage = named(() => import('@/pages/business/pms/CycleDetailPage'), 'CycleDetailPage')
const ReviewPage = named(() => import('@/pages/business/pms/ReviewPage'), 'ReviewPage')
const MyReviewsPage = named(() => import('@/pages/learner/pms/MyReviewsPage'), 'MyReviewsPage')

/** Children of /business (company owner, admin or manager; admin-only actions inside). */
export const pmsBusinessRoutes: RouteObject[] = [
  { path: 'pms/kpis', element: page(<KpisPage />), handle: { art: 'dials' } },
  { path: 'pms/proposals', element: page(<ProposalsPage />), handle: { art: 'checklist' } },
  { path: 'pms/cycles', element: page(<CyclesPage />), handle: { art: 'timetable' } },
  { path: 'pms/cycles/:cycleId', element: page(<CycleDetailPage />), handle: { art: 'storyboard' } },
  { path: 'pms/reviews/:reviewId', element: page(<ReviewPage />), handle: { art: 'storyboard' } },
]

/** Inside LearnerLayout (any signed-in user; shows only their own reviews). */
export const pmsLearnerRoutes: RouteObject[] = [{ path: '/learn/reviews', element: page(<MyReviewsPage />), handle: { art: 'ribbons' } }]

export const pmsBusinessNav: NavSection[] = [
  {
    title: 'Performance',
    items: [
      { to: '/business/pms/kpis', label: 'Performance measures', Icon: Gauge },
      { to: '/business/pms/proposals', label: 'KPI proposals', Icon: ClipboardList },
      { to: '/business/pms/cycles', label: 'Review cycles', Icon: CalendarRange },
    ],
  },
]
