/** Corporate packages: routes and navigation, ready for the integrator to plug in.
 *
 * Every page is its own lazy chunk. The paths match the URLs the backend sends Stripe
 * back to (/business/purchases?success=1, /business/packages, /business/live-bookings).
 *
 * In app/router.tsx:
 *   - /business children:  ...corporateBusinessRoutes  (before the '*' route)
 *   - /console children:   ...corporateConsoleRoutes   (before the '*' route)
 *   - LearnerLayout children: ...corporateLearnerRoutes
 *   - businessNav:  ...corporateBusinessNav  (after 'Learning')
 * In pages/console/ConsoleShell.tsx consoleNav: ...corporateConsoleNav
 */
import { BarChart3, Building2, CalendarDays, LayoutDashboard, Package, Receipt, Armchair, Undo2, Video } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'

import type { NavSection } from '@/components/layout/WorkspaceLayout'
import { PageSpinner } from '@/app/guards'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const CorporateOverviewPage = named(() => import('@/pages/business/corporate/CorporateOverviewPage'), 'CorporateOverviewPage')
const PackagesPage = named(() => import('@/pages/business/corporate/PackagesPage'), 'PackagesPage')
const PurchasesPage = named(() => import('@/pages/business/corporate/PurchasesPage'), 'PurchasesPage')
const SeatsPage = named(() => import('@/pages/business/corporate/SeatsPage'), 'SeatsPage')
const LiveTrainingPage = named(() => import('@/pages/business/corporate/LiveTrainingPage'), 'LiveTrainingPage')
const CancellationsPage = named(() => import('@/pages/business/corporate/CancellationsPage'), 'CancellationsPage')
const MyLiveTrainingPage = named(() => import('@/features/corporate/MyLiveTrainingPage'), 'MyLiveTrainingPage')
const ConsolePackages = named(() => import('@/pages/console/corporate/CorporatePackagesPage'), 'ConsoleCorporatePackagesPage')
const ConsoleLive = named(() => import('@/pages/console/corporate/CorporateLivePage'), 'ConsoleCorporateLivePage')
const ConsoleCases = named(() => import('@/pages/console/corporate/CorporateCasesPage'), 'ConsoleCorporateCasesPage')
const ConsoleReports = named(() => import('@/pages/console/corporate/CorporateReportsPage'), 'ConsoleCorporateReportsPage')

/** Children of /business (company owner, admin or manager; buying is admin-only inside). */
export const corporateBusinessRoutes: RouteObject[] = [
  { path: 'corporate', element: page(<CorporateOverviewPage />), handle: { art: 'seats' } },
  { path: 'packages', element: page(<PackagesPage />), handle: { art: 'seats' } },
  { path: 'purchases', element: page(<PurchasesPage />), handle: { art: 'ribbons' } },
  { path: 'seats', element: page(<SeatsPage />), handle: { art: 'seats' } },
  { path: 'live-bookings', element: page(<LiveTrainingPage />), handle: { art: 'timetable' } },
  { path: 'cancellations', element: page(<CancellationsPage />), handle: { art: 'ribbons' } },
]

/** Inside LearnerLayout (any signed-in user; shows only their own live training). */
export const corporateLearnerRoutes: RouteObject[] = [{ path: '/learn/live', element: page(<MyLiveTrainingPage />), handle: { art: 'timetable' } }]

/** Children of /console (staff). */
export const corporateConsoleRoutes: RouteObject[] = [
  { path: 'corporate', element: page(<ConsolePackages />), handle: { art: 'seats' } },
  { path: 'corporate/live', element: page(<ConsoleLive />), handle: { art: 'timetable' } },
  { path: 'corporate/cases', element: page(<ConsoleCases />), handle: { art: 'ribbons' } },
  { path: 'corporate/reports', element: page(<ConsoleReports />), handle: { art: 'chartgrid' } },
]

export const corporateBusinessNav: NavSection[] = [
  {
    title: 'Company training',
    items: [
      { to: '/business/corporate', label: 'Overview', Icon: LayoutDashboard },
      { to: '/business/packages', label: 'Course packages', Icon: Package },
      { to: '/business/seats', label: 'Seats', Icon: Armchair },
      { to: '/business/live-bookings', label: 'Live training', Icon: Video },
      { to: '/business/purchases', label: 'Purchases', Icon: Receipt },
      { to: '/business/cancellations', label: 'Refunds and changes', Icon: Undo2 },
    ],
  },
]

export const corporateConsoleNav: NavSection[] = [
  {
    title: 'Companies',
    items: [
      { to: '/console/corporate', label: 'Company packages', Icon: Building2, end: true },
      { to: '/console/corporate/live', label: 'Live training', Icon: CalendarDays },
      { to: '/console/corporate/cases', label: 'Refunds and departures', Icon: Undo2 },
      { to: '/console/corporate/reports', label: 'Company reports', Icon: BarChart3 },
    ],
  },
]
