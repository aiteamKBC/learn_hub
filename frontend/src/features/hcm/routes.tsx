/** HCM (human capital): HR profiles, wellbeing, CPD and qualifications.
 * The integrator wires these exported arrays into app/router.tsx:
 *   - /business children:      ...hcmBusinessRoutes
 *   - LearnerLayout children:  ...hcmLearnerRoutes
 *   - businessNav:             ...hcmBusinessNav
 */
import { Award, ListChecks, Users } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'

import { PageSpinner } from '@/app/guards'
import type { NavSection } from '@/components/layout/WorkspaceLayout'
import { EmptyState, PageHeader } from '@/components/ui/misc'
import { useRoleCapabilities } from '@/features/org/api'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const QualificationsPage = named(() => import('@/pages/business/hcm/QualificationsPage'), 'QualificationsPage')
const HrPeoplePage = named(() => import('@/pages/business/hcm/HrPeoplePage'), 'HrPeoplePage')
const MemberProfilePage = named(() => import('@/pages/business/hcm/MemberProfilePage'), 'MemberProfilePage')
const MyHrProfilePage = named(() => import('@/pages/learner/hcm/MyHrProfilePage'), 'MyHrProfilePage')
const MyWellbeingPage = named(() => import('@/pages/learner/hcm/MyWellbeingPage'), 'MyWellbeingPage')
const MyCpdPage = named(() => import('@/pages/learner/hcm/MyCpdPage'), 'MyCpdPage')
const TrainingPlansPage = named(() => import('@/pages/business/TrainingPlansPage'), 'TrainingPlansPage')

function HrAdmin({ children }: { children: ReactNode }) {
  const capabilities = useRoleCapabilities()
  if (capabilities.isLoading) return <PageSpinner />
  return capabilities.data?.can_manage_responsibilities ? children : <><PageHeader title="HR records" description="Company HR administration." /><EmptyState icon={<Users />} title="HR access required" body="HR profiles and the qualifications catalogue are available to company owners, admins and assigned HR staff. You can view your own record from My HR profile." /></>
}

/** The backend reserves HR directory/profile administration for owners and admins. */
export const hcmBusinessRoutes: RouteObject[] = [
  { path: 'training-plans', element: page(<TrainingPlansPage />), handle: { art: 'checklist' } },
  { path: 'hcm/people', element: <HrAdmin>{page(<HrPeoplePage />)}</HrAdmin>, handle: { art: 'orgchart' } },
  { path: 'hcm/people/:memberId', element: <HrAdmin>{page(<MemberProfilePage />)}</HrAdmin>, handle: { art: 'orgchart' } },
  { path: 'hcm/qualifications', element: <HrAdmin>{page(<QualificationsPage />)}</HrAdmin>, handle: { art: 'stamp' } },
]

/** Inside LearnerLayout (the signed-in person's own record). */
export const hcmLearnerRoutes: RouteObject[] = [
  { path: '/learn/hr-profile', element: page(<MyHrProfilePage />), handle: { art: 'path' } },
  { path: '/learn/wellbeing', element: page(<MyWellbeingPage />), handle: { art: 'waves' } },
  { path: '/learn/cpd', element: page(<MyCpdPage />), handle: { art: 'notebook' } },
]

export const hcmBusinessNav: NavSection[] = [
  {
    title: 'People',
    items: [
      { to: '/business/hcm/people', label: 'HR Actions', Icon: Users },
      { to: '/business/training-plans', label: 'Training plans', Icon: ListChecks },
      { to: '/business/hcm/qualifications', label: 'Qualifications', Icon: Award },
    ],
  },
]
