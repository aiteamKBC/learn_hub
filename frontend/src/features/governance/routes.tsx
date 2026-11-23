/** Company strategy, policies and technical question bank.
 * The routes stay feature-owned so the business and learner workspaces share
 * the same lazy-loading and artwork conventions as the rest of LearnHub.
 */
import { BookOpenCheck, CircleHelp, Compass } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'

import { PageSpinner } from '@/app/guards'
import type { NavSection } from '@/components/layout/WorkspaceLayout'

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const StrategiesPage = named(() => import('@/pages/business/governance/StrategiesPage'), 'StrategiesPage')
const StrategyDetailPage = named(() => import('@/pages/business/governance/StrategyDetailPage'), 'StrategyDetailPage')
const PoliciesPage = named(() => import('@/pages/business/governance/PoliciesPage'), 'PoliciesPage')
const PolicyDetailPage = named(() => import('@/pages/business/governance/PolicyDetailPage'), 'PolicyDetailPage')
const QuestionsPage = named(() => import('@/pages/business/governance/QuestionsPage'), 'QuestionsPage')
const MyPoliciesPage = named(() => import('@/pages/learner/governance/MyPoliciesPage'), 'MyPoliciesPage')

export const governanceBusinessRoutes: RouteObject[] = [
  { path: 'governance/strategies', element: page(<StrategiesPage />), handle: { art: 'compass' } },
  { path: 'governance/strategies/:strategyId', element: page(<StrategyDetailPage />), handle: { art: 'compass' } },
  { path: 'governance/policies', element: page(<PoliciesPage />), handle: { art: 'notebook' } },
  { path: 'governance/policies/:policyId', element: page(<PolicyDetailPage />), handle: { art: 'notebook' } },
  { path: 'governance/questions', element: page(<QuestionsPage />), handle: { art: 'checklist' } },
]

export const governanceLearnerRoutes: RouteObject[] = [{ path: '/learn/policies', element: page(<MyPoliciesPage />), handle: { art: 'notebook' } }]

export const governanceBusinessNav: NavSection[] = [
  {
    title: 'Governance',
    items: [
      { to: '/business/governance/strategies', label: 'Strategy', Icon: Compass },
      { to: '/business/governance/policies', label: 'Policies & SOPs', Icon: BookOpenCheck },
      { to: '/business/governance/questions', label: 'Question bank', Icon: CircleHelp },
    ],
  },
]
