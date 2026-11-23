/** Competency and role frameworks, plus department maturity.
 * The integrator wires these exported arrays into app/router.tsx:
 *   - /business children:      ...frameworksBusinessRoutes
 *   - LearnerLayout children:  ...frameworksLearnerRoutes
 *   - businessNav:             ...frameworksBusinessNav
 */
import { Gauge, Layers, Workflow } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'

import { PageSpinner } from '@/app/guards'
import type { NavSection } from '@/components/layout/WorkspaceLayout'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const CompetenciesPage = named(() => import('@/pages/business/frameworks/CompetenciesPage'), 'CompetenciesPage')
const RolesPage = named(() => import('@/pages/business/frameworks/RolesPage'), 'RolesPage')
const RoleDetailPage = named(() => import('@/pages/business/frameworks/RoleDetailPage'), 'RoleDetailPage')
const RoleVersionPage = named(() => import('@/pages/business/frameworks/RoleVersionPage'), 'RoleVersionPage')
const MaturityPage = named(() => import('@/pages/business/frameworks/MaturityPage'), 'MaturityPage')
const MyCompetencePage = named(() => import('@/pages/learner/frameworks/MyCompetencePage'), 'MyCompetencePage')

/** Children of /business (admins change things; managers read). */
export const frameworksBusinessRoutes: RouteObject[] = [
  { path: 'frameworks/competencies', element: page(<CompetenciesPage />), handle: { art: 'honeycomb' } },
  { path: 'frameworks/roles', element: page(<RolesPage />), handle: { art: 'blueprint' } },
  { path: 'frameworks/roles/:frameworkId', element: page(<RoleDetailPage />), handle: { art: 'blueprint' } },
  { path: 'frameworks/versions/:versionId', element: page(<RoleVersionPage />), handle: { art: 'checklist' } },
  { path: 'frameworks/maturity', element: page(<MaturityPage />), handle: { art: 'dials' } },
]

/** Inside LearnerLayout (the signed-in person's own competence). */
export const frameworksLearnerRoutes: RouteObject[] = [{ path: '/learn/competence', element: page(<MyCompetencePage />), handle: { art: 'constellation' } }]

export const frameworksBusinessNav: NavSection[] = [
  {
    title: 'Frameworks',
    items: [
      { to: '/business/frameworks/competencies', label: 'Competencies', Icon: Layers },
      { to: '/business/frameworks/roles', label: 'Role frameworks', Icon: Workflow },
      { to: '/business/frameworks/maturity', label: 'Department maturity', Icon: Gauge },
    ],
  },
]
