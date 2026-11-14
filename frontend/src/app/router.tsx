import { BookOpen, Building2, ClipboardCheck, CreditCard, DollarSign, FileBarChart, GraduationCap, LayoutDashboard, LifeBuoy, MessageSquare, Network, ShieldCheck, UserPlus, Users, Wallet } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Outlet } from 'react-router-dom'

import { BusinessLayout } from '@/components/layout/BusinessLayout'
import { LearnerLayout } from '@/components/layout/LearnerLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { SiteRoot } from '@/components/layout/SiteRoot'
import { type NavSection, WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { corporateBusinessNav, corporateBusinessRoutes, corporateConsoleRoutes, corporateLearnerRoutes } from '@/features/corporate/routes'
import { NotFoundPage } from '@/pages/StatusPages'

import { PageSpinner, RequireAuth, RequireManager, RequireRole } from './guards'

// Every page is its own chunk: visitors download the marketplace only.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))
const HomePage = named(() => import('@/pages/HomePage'), 'HomePage')
const CoursesPage = named(() => import('@/pages/CoursesPage'), 'CoursesPage')
const CoursePage = named(() => import('@/pages/CoursePage'), 'CoursePage')
const MyLearningPage = named(() => import('@/pages/MyLearningPage'), 'MyLearningPage')
const DesignPage = named(() => import('@/pages/DesignPage'), 'DesignPage')
const LoginPage = named(() => import('@/pages/auth/LoginPage'), 'LoginPage')
const SignupPage = named(() => import('@/pages/auth/SignupPage'), 'SignupPage')
const VerifyEmailPage = named(() => import('@/pages/auth/VerifyEmailPage'), 'VerifyEmailPage')
const ForgotPasswordPage = named(() => import('@/pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage')
const ResetPasswordPage = named(() => import('@/pages/auth/ResetPasswordPage'), 'ResetPasswordPage')
const CartPage = named(() => import('@/pages/shop/CartPage'), 'CartPage')
const CheckoutSuccessPage = named(() => import('@/pages/shop/CheckoutSuccessPage'), 'CheckoutSuccessPage')
const PlansPage = named(() => import('@/pages/shop/PlansPage'), 'PlansPage')
const WishlistPage = named(() => import('@/pages/shop/WishlistPage'), 'WishlistPage')
const OrdersPage = named(() => import('@/pages/shop/OrdersPage'), 'OrdersPage')
const PlayerPage = named(() => import('@/pages/learn/PlayerPage'), 'PlayerPage')
const CertificatesPage = named(() => import('@/pages/learner/CertificatesPage'), 'CertificatesPage')
const AchievementsPage = named(() => import('@/pages/learner/AchievementsPage'), 'AchievementsPage')
const RequiredTrainingPage = named(() => import('@/pages/learner/RequiredTrainingPage'), 'RequiredTrainingPage')
const NotificationsPage = named(() => import('@/pages/learner/NotificationsPage'), 'NotificationsPage')
const AccountPage = named(() => import('@/pages/learner/AccountPage'), 'AccountPage')
const SupportPage = named(() => import('@/pages/learner/SupportPages'), 'SupportPage')
const TicketPage = named(() => import('@/pages/learner/SupportPages'), 'TicketPage')
const VerifyPage = named(() => import('@/pages/VerifyPage'), 'VerifyPage')
const WalletPage = named(() => import('@/pages/b2c/WalletPage'), 'WalletPage')
const TokenBuyPage = named(() => import('@/pages/b2c/TokenBuyPage'), 'TokenBuyPage')
const TokenResultPage = named(() => import('@/pages/b2c/TokenResultPage'), 'TokenResultPage')
const SubscriptionPage = named(() => import('@/pages/b2c/SubscriptionPage'), 'SubscriptionPage')
const PackagesPage = named(() => import('@/pages/b2c/PackagesPage'), 'PackagesPage')
const CheckoutReviewPage = named(() => import('@/pages/b2c/CheckoutReviewPage'), 'CheckoutReviewPage')
const ComplianceDashboard = named(() => import('@/pages/business/ComplianceDashboard'), 'ComplianceDashboard')
const MatrixPage = named(() => import('@/pages/business/MatrixPage'), 'MatrixPage')
const RequirementsPage = named(() => import('@/pages/business/RequirementsPage'), 'RequirementsPage')
const ReportsPage = named(() => import('@/pages/business/ReportsPage'), 'ReportsPage')
const PeoplePage = named(() => import('@/pages/business/PeoplePage'), 'PeoplePage')
const PersonPage = named(() => import('@/pages/business/PersonPage'), 'PersonPage')
const UnitsPage = named(() => import('@/pages/business/UnitsPage'), 'UnitsPage')
const InvitesPage = named(() => import('@/pages/business/InvitesPage'), 'InvitesPage')
const LibraryPage = named(() => import('@/pages/business/LibraryPage'), 'LibraryPage')
const AssignPage = named(() => import('@/pages/business/AssignPage'), 'AssignPage')
const BillingPage = named(() => import('@/pages/business/BillingPage'), 'BillingPage')
const CompanySettingsPage = named(() => import('@/pages/business/CompanySettingsPage'), 'CompanySettingsPage')
const InvitePage = named(() => import('@/pages/InvitePage'), 'InvitePage')
const TeachPage = named(() => import('@/pages/studio/TeachPage'), 'TeachPage')
const InstructorInvitePage = named(() => import('@/pages/studio/InstructorInvitePage'), 'InstructorInvitePage')
const StudioDashboard = named(() => import('@/pages/studio/StudioDashboard'), 'StudioDashboard')
const StudioCoursesPage = named(() => import('@/pages/studio/StudioCoursesPage'), 'StudioCoursesPage')
const CourseBuilderPage = named(() => import('@/pages/studio/CourseBuilderPage'), 'CourseBuilderPage')
const StudentsPage = named(() => import('@/pages/studio/StudentsPage'), 'StudentsPage')
const GradingPage = named(() => import('@/pages/studio/GradingPage'), 'GradingPage')
const QuestionsPage = named(() => import('@/pages/studio/QuestionsPage'), 'QuestionsPage')
const RevenuePage = named(() => import('@/pages/studio/RevenuePage'), 'RevenuePage')
const PayoutsPage = named(() => import('@/pages/studio/PayoutsPage'), 'PayoutsPage')
const ConsoleShell = named(() => import('@/pages/console/ConsoleShell'), 'ConsoleShell')
const ConsoleDashboardPage = named(() => import('@/pages/console/DashboardPage'), 'ConsoleDashboardPage')
const ConsoleCoursesPage = named(() => import('@/pages/console/CoursesPage'), 'ConsoleCoursesPage')
const ConsoleInstructorsPage = named(() => import('@/pages/console/InstructorsPage'), 'ConsoleInstructorsPage')
const ConsoleStudentsPage = named(() => import('@/pages/console/StudentsPage'), 'ConsoleStudentsPage')
const ConsoleSalesPage = named(() => import('@/pages/console/SalesPage'), 'ConsoleSalesPage')
const ConsoleSubscriptionsPage = named(() => import('@/pages/console/SubscriptionsPage'), 'ConsoleSubscriptionsPage')
const ConsolePricingPage = named(() => import('@/pages/console/PricingPage'), 'ConsolePricingPage')
const ConsolePromotionsPage = named(() => import('@/pages/console/PromotionsPage'), 'ConsolePromotionsPage')
const ConsoleCommissionsPage = named(() => import('@/pages/console/CommissionsPage'), 'ConsoleCommissionsPage')
const ConsolePayoutsPage = named(() => import('@/pages/console/PayoutsPage'), 'ConsolePayoutsPage')
const ConsoleReportsPage = named(() => import('@/pages/console/ReportsPage'), 'ConsoleReportsPage')
const ConsoleApprovalsPage = named(() => import('@/pages/console/ApprovalsPage'), 'ConsoleApprovalsPage')
const ConsoleReviewsPage = named(() => import('@/pages/console/ReviewsPage'), 'ConsoleReviewsPage')
const ConsoleCommunicationsPage = named(() => import('@/pages/console/CommunicationsPage'), 'ConsoleCommunicationsPage')
const ConsoleCertificatesPage = named(() => import('@/pages/console/CertificatesPage'), 'ConsoleCertificatesPage')
const ConsoleCompaniesPage = named(() => import('@/pages/console/CompaniesPage'), 'ConsoleCompaniesPage')
const ConsoleSettingsPage = named(() => import('@/pages/console/SettingsPage'), 'ConsoleSettingsPage')
const ConsoleAuditPage = named(() => import('@/pages/console/AuditPage'), 'ConsoleAuditPage')
const ConsoleTokenPricingPage = named(() => import('@/pages/console/b2c/TokenPricingPage'), 'TokenPricingPage')
const ConsoleWalletsPage = named(() => import('@/pages/console/b2c/AdminWalletPage'), 'AdminWalletPage')
const ConsolePackagesPage = named(() => import('@/pages/console/b2c/AdminPackagesPage'), 'AdminPackagesPage')

const page = (el: ReactNode) => <Suspense fallback={<PageSpinner />}>{el}</Suspense>

const businessNav: NavSection[] = [
  { items: [{ to: '/business', label: 'Overview', Icon: LayoutDashboard, end: true }] },
  {
    title: 'Compliance',
    items: [
      { to: '/business/matrix', label: 'Training matrix', Icon: ClipboardCheck },
      { to: '/business/requirements', label: 'Requirements', Icon: ShieldCheck },
      { to: '/business/reports', label: 'Reports', Icon: FileBarChart },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/business/people', label: 'People', Icon: Users },
      { to: '/business/units', label: 'Locations & teams', Icon: Network },
      { to: '/business/invites', label: 'Invitations', Icon: UserPlus },
    ],
  },
  {
    title: 'Learning',
    items: [
      { to: '/business/library', label: 'Course library', Icon: BookOpen },
      { to: '/business/assign', label: 'Assign training', Icon: GraduationCap },
    ],
  },
  ...corporateBusinessNav,
  {
    title: 'Company',
    items: [
      { to: '/business/billing', label: 'Billing', Icon: CreditCard },
      { to: '/business/settings', label: 'Settings', Icon: Building2 },
      { to: '/support', label: 'B2B support', Icon: LifeBuoy },
    ],
  },
]

const studioNav: NavSection[] = [
  { items: [{ to: '/studio', label: 'Dashboard', Icon: LayoutDashboard, end: true }, { to: '/studio/courses', label: 'My courses', Icon: BookOpen }] },
  { title: 'Learners', items: [{ to: '/studio/students', label: 'Students', Icon: Users }, { to: '/studio/grading', label: 'Assignments', Icon: ClipboardCheck }, { to: '/studio/questions', label: 'Q&A and reviews', Icon: MessageSquare }] },
  { title: 'Money', items: [{ to: '/studio/revenue', label: 'Sales & earnings', Icon: DollarSign }, { to: '/studio/payouts', label: 'Payouts', Icon: Wallet }] },
]

// SiteRoot applies the console's platform settings to every page: name, favicon, site
// banner, maintenance page and "guest browsing off" (components/layout/SiteRoot.tsx).
export const router = createBrowserRouter([{ element: <SiteRoot />, children: [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: page(<HomePage />) },
      { path: '/courses', element: page(<CoursesPage />) },
      { path: '/courses/:slug', element: page(<CoursePage />) },
      { path: '/design', element: page(<DesignPage />) },
      { path: '/plans', element: page(<PlansPage />) },
      { path: '/verify', element: page(<VerifyPage />) },
      { path: '/verify/:code', element: page(<VerifyPage />) },
      { path: '/cart', element: <RequireAuth>{page(<CartPage />)}</RequireAuth> },
      { path: '/checkout/success', element: <RequireAuth>{page(<CheckoutSuccessPage />)}</RequireAuth> },
      {
        element: (
          <RequireAuth>
            <LearnerLayout />
          </RequireAuth>
        ),
        children: [
          { path: '/learn', element: page(<MyLearningPage />) },
          { path: '/learn/certificates', element: page(<CertificatesPage />), handle: { art: 'guilloche' } },
          { path: '/learn/achievements', element: page(<AchievementsPage />), handle: { art: 'honeycomb' } },
          { path: '/learn/required', element: page(<RequiredTrainingPage />), handle: { art: 'checklist' } },
          { path: '/notifications', element: page(<NotificationsPage />), handle: { art: 'signal' } },
          { path: '/wishlist', element: page(<WishlistPage />) },
          { path: '/account/orders', element: page(<OrdersPage />), handle: { art: 'ribbons' } },
          { path: '/wallet', element: page(<WalletPage />), handle: { art: 'coins' } },
          { path: '/wallet/buy', element: page(<TokenBuyPage />), handle: { art: 'coins' } },
          { path: '/wallet/result', element: page(<TokenResultPage />), handle: { art: 'coins' } },
          { path: '/subscription', element: page(<SubscriptionPage />), handle: { art: 'ribbons' } },
          { path: '/packages', element: page(<PackagesPage />), handle: { art: 'ribbons' } },
          { path: '/checkout/review', element: page(<CheckoutReviewPage />), handle: { art: 'ribbons' } },
          { path: '/account', element: page(<AccountPage />), handle: { art: 'dials' } },
          { path: '/teach', element: page(<TeachPage />), handle: { art: 'blueprint' } },
          { path: '/teach/invite/:token', element: page(<InstructorInvitePage />), handle: { art: 'blueprint' } },
          { path: '/support', element: page(<SupportPage />), handle: { art: 'bubbles' } },
          { path: '/support/:id', element: page(<TicketPage />), handle: { art: 'bubbles' } },
          ...corporateLearnerRoutes,
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // the player is full-screen: its own header, no site footer
  { path: '/learn/:slug/*', element: <RequireAuth>{page(<PlayerPage />)}</RequireAuth> },
  { path: '/login', element: page(<LoginPage />) },
  { path: '/signup', element: page(<SignupPage />) },
  { path: '/account/verify-email/:key', element: page(<VerifyEmailPage />) },
  { path: '/account/password/reset', element: page(<ForgotPasswordPage />) },
  { path: '/account/password/reset/key/:key', element: page(<ResetPasswordPage />) },
  { path: '/invite/:token', element: page(<InvitePage />) },
  {
    path: '/business',
    element: (
      <RequireAuth>
        <RequireManager>
          <BusinessLayout sections={businessNav} />
        </RequireManager>
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<ComplianceDashboard />) },
      { path: 'matrix', element: page(<MatrixPage />) },
      { path: 'requirements', element: page(<RequirementsPage />), handle: { art: 'checklist' } },
      { path: 'reports', element: page(<ReportsPage />), handle: { art: 'chartgrid' } },
      { path: 'people', element: page(<PeoplePage />), handle: { art: 'orgchart' } },
      { path: 'people/:memberId', element: page(<PersonPage />), handle: { art: 'orgchart' } },
      { path: 'units', element: page(<UnitsPage />), handle: { art: 'floorplan' } },
      { path: 'invites', element: page(<InvitesPage />), handle: { art: 'orgchart' } },
      { path: 'library', element: page(<LibraryPage />), handle: { art: 'mosaic' } },
      { path: 'assign', element: page(<AssignPage />), handle: { art: 'mosaic' } },
      { path: 'billing', element: page(<BillingPage />), handle: { art: 'ribbons' } },
      { path: 'settings', element: page(<CompanySettingsPage />), handle: { art: 'dials' } },
      ...corporateBusinessRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/studio',
    element: (
      <RequireAuth>
        <RequireRole allowed="instructor">
          <WorkspaceLayout area="Instructor" sections={studioNav} art="blueprint" />
        </RequireRole>
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<StudioDashboard />) },
      { path: 'courses', element: page(<StudioCoursesPage />) },
      // the builder's tabs are paths, so the curriculum can show its own artwork
      { path: 'courses/:courseId', element: page(<CourseBuilderPage />) },
      { path: 'courses/:courseId/curriculum', element: page(<CourseBuilderPage />), handle: { art: 'storyboard' } },
      { path: 'courses/:courseId/:tab', element: page(<CourseBuilderPage />) },
      { path: 'students', element: page(<StudentsPage />) },
      { path: 'grading', element: page(<GradingPage />) },
      { path: 'questions', element: page(<QuestionsPage />) },
      { path: 'revenue', element: page(<RevenuePage />), handle: { art: 'coins' } },
      { path: 'payouts', element: page(<PayoutsPage />), handle: { art: 'coins' } },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/console',
    element: (
      <RequireAuth>
        <RequireRole allowed="staff">{page(<ConsoleShell />)}</RequireRole>
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<ConsoleDashboardPage />) },
      { path: 'courses', element: page(<ConsoleCoursesPage />), handle: { art: 'mosaic' } },
      { path: 'instructors', element: page(<ConsoleInstructorsPage />), handle: { art: 'orgchart' } },
      { path: 'students', element: page(<ConsoleStudentsPage />), handle: { art: 'orgchart' } },
      { path: 'sales', element: page(<ConsoleSalesPage />), handle: { art: 'coins' } },
      { path: 'subscriptions', element: page(<ConsoleSubscriptionsPage />), handle: { art: 'coins' } },
      { path: 'pricing', element: page(<ConsolePricingPage />), handle: { art: 'coins' } },
      { path: 'promotions', element: page(<ConsolePromotionsPage />), handle: { art: 'coins' } },
      { path: 'commissions', element: page(<ConsoleCommissionsPage />), handle: { art: 'coins' } },
      { path: 'payouts', element: page(<ConsolePayoutsPage />), handle: { art: 'coins' } },
      { path: 'reports', element: page(<ConsoleReportsPage />), handle: { art: 'chartgrid' } },
      { path: 'approvals', element: page(<ConsoleApprovalsPage />), handle: { art: 'stamp' } },
      { path: 'reviews', element: page(<ConsoleReviewsPage />), handle: { art: 'bubbles' } },
      { path: 'communications', element: page(<ConsoleCommunicationsPage />), handle: { art: 'bubbles' } },
      { path: 'certificates', element: page(<ConsoleCertificatesPage />), handle: { art: 'guilloche' } },
      { path: 'companies', element: page(<ConsoleCompaniesPage />), handle: { art: 'contours' } },
      { path: 'settings', element: page(<ConsoleSettingsPage />), handle: { art: 'dials' } },
      { path: 'audit', element: page(<ConsoleAuditPage />) },
      ...corporateConsoleRoutes,
      { path: 'token-pricing', element: page(<ConsoleTokenPricingPage />), handle: { art: 'coins' } },
      { path: 'wallets', element: page(<ConsoleWalletsPage />), handle: { art: 'coins' } },
      { path: 'packages', element: page(<ConsolePackagesPage />), handle: { art: 'ribbons' } },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Outlet /> },
]}])
