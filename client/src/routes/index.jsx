import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuth } from '@/hooks/useAuth'
import { Loader } from '@/components/ui'
import { ROLES, STAFF_ROLES } from '@/constants'
import { ClientLayout } from '@/layouts/ClientLayout'

// Lazy-loaded pages → code splitting per route.
const Login = lazy(() => import('@/pages/auth/Login'))
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Employees = lazy(() => import('@/pages/Employees'))
const EmployeeDashboard = lazy(() => import('@/pages/employees/EmployeeDashboard'))
const EmployeeDetails = lazy(() => import('@/pages/employees/EmployeeDetails'))
const HR = lazy(() => import('@/pages/HR'))
const HrDepartments = lazy(() => import('@/pages/hr/Departments'))
const HrDesignations = lazy(() => import('@/pages/hr/Designations'))
const HrRecruitment = lazy(() => import('@/pages/hr/Recruitment'))
const HrInterviews = lazy(() => import('@/pages/hr/Interviews'))
const HrOffers = lazy(() => import('@/pages/hr/Offers'))
const HrOnboarding = lazy(() => import('@/pages/hr/Onboarding'))
const HrPayroll = lazy(() => import('@/pages/hr/Payroll'))
const HrPerformance = lazy(() => import('@/pages/hr/Performance'))
const HrMovements = lazy(() => import('@/pages/hr/Movements'))
const HrReports = lazy(() => import('@/pages/hr/HrReports'))
const Attendance = lazy(() => import('@/pages/Attendance'))
const AttendanceReports = lazy(() => import('@/pages/attendance/AttendanceReports'))
const AttendanceShifts = lazy(() => import('@/pages/attendance/Shifts'))
const AttendanceHolidays = lazy(() => import('@/pages/attendance/Holidays'))
const MyAttendanceReport = lazy(() => import('@/pages/attendance/MyAttendanceReport'))
const Leave = lazy(() => import('@/pages/Leave'))
const LeaveReports = lazy(() => import('@/pages/leave/LeaveReports'))
const LeaveTypes = lazy(() => import('@/pages/leave/LeaveTypes'))
const MyLeaveReport = lazy(() => import('@/pages/leave/MyLeaveReport'))
const Projects = lazy(() => import('@/pages/Projects'))
const ProjectBoard = lazy(() => import('@/pages/projects/Board'))
const ProjectBacklog = lazy(() => import('@/pages/projects/Backlog'))
const ProjectSprints = lazy(() => import('@/pages/projects/Sprints'))
const ProjectBugs = lazy(() => import('@/pages/projects/Bugs'))
const ProjectMilestones = lazy(() => import('@/pages/projects/Milestones'))
const ProjectTimeline = lazy(() => import('@/pages/projects/Timeline'))
// Phase 6.9 (Task 15): ProjectCalendar removed — merged into the main
// Calendar (see client/src/features/calendar/CalendarApp.jsx).
const ProjectReports = lazy(() => import('@/pages/projects/ProjectReports'))
const ProjectDetail = lazy(() => import('@/pages/projects/ProjectDetail'))
const TaskReview = lazy(() => import('@/pages/projects/TaskReview'))
const MyTasks = lazy(() => import('@/pages/MyTasks'))
const TaskHistory = lazy(() => import('@/pages/TaskHistory'))
const MySalary = lazy(() => import('@/pages/MySalary'))
// Phase 6.7 (TASK 4 + TASK 5) / Phase 6.8 (TASK 3): employee salary documents.
// Lazy-loaded via the same convention as every other page so they are
// code-split and never shipped to roles that cannot reach them. SalarySlip was
// removed in Phase 6.8 - its content now lives inside SalaryReport (shared
// SalaryDocumentLayout), and SalaryHistory is the new dedicated history page.
const SalaryReport = lazy(() => import('@/pages/salary/SalaryReport'))
const SalaryHistory = lazy(() => import('@/pages/salary/SalaryHistory'))
const FinanceDashboard = lazy(() => import('@/pages/finance/Dashboard'))
const FinanceIncome = lazy(() => import('@/pages/finance/Income'))
const FinanceExpenses = lazy(() => import('@/pages/finance/Expenses'))
const FinanceTransactions = lazy(() => import('@/pages/finance/Transactions'))
const FinanceCategories = lazy(() => import('@/pages/finance/Categories'))
const FinanceInvoices = lazy(() => import('@/pages/finance/Invoices'))
const FinancePayments = lazy(() => import('@/pages/finance/Payments'))
const FinanceBudgets = lazy(() => import('@/pages/finance/Budgets'))
const FinanceTax = lazy(() => import('@/pages/finance/TaxReports'))
const FinanceMonthly = lazy(() => import('@/pages/finance/MonthlyReports'))
const FinanceYearly = lazy(() => import('@/pages/finance/YearlyReports'))
const FinanceCharts = lazy(() => import('@/pages/finance/Charts'))
const Announcements = lazy(() => import('@/pages/Announcements'))
const Files = lazy(() => import('@/pages/Files'))
const Calendar = lazy(() => import('@/pages/Calendar'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Reports = lazy(() => import('@/pages/Reports'))
// Phase 6.16 (TASK 5): Permissions, API Keys, Company, Email, Theme, Security
// and Activity Monitor lazy imports removed along with their UI routes below
// - the pages were deleted (they had no other importer; verified by grep) and
// their backend endpoints/services in adminApi.js and adminRoutes.js are left
// intact, exactly as the brief requires. AdminPermissions and AdminActivity
// are not imported anywhere else - PermissionsList (a different component,
// used by AdminUserDetail) and the permissions/activity backend routes are
// untouched.
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminHub = lazy(() => import('@/pages/admin/AdminHub'))
const AdminUsers = lazy(() => import('@/pages/admin/Users'))
const AdminUserDetail = lazy(() => import('@/pages/admin/UserDetail'))
const AdminRoles = lazy(() => import('@/pages/admin/Roles'))
const AdminAuditLogs = lazy(() => import('@/pages/admin/AuditLogs'))
const AdminSystemLogs = lazy(() => import('@/pages/admin/SystemLogs'))
const AdminBackup = lazy(() => import('@/pages/admin/Backup'))
const AdminRestore = lazy(() => import('@/pages/admin/Restore'))
const AdminDbHealth = lazy(() => import('@/pages/admin/DatabaseHealth'))
const AdminAnalytics = lazy(() => import('@/pages/admin/Analytics'))
const Profile = lazy(() => import('@/pages/Profile'))
const Search = lazy(() => import('@/pages/Search'))

// --- Client Portal (fully isolated, gated to the Client role) ---
const ClientDashboard = lazy(() => import('@/features/client/ClientDashboard'))
const ClientProjects = lazy(() => import('@/features/client/ClientProjects'))
const ClientProjectDetail = lazy(() => import('@/features/client/ClientProjectDetail'))
// Phase 6.10 (TASK 2 / TASK 6): ClientTasks, ClientTimeline, ClientDocuments and
// ClientMessages lazy imports removed together with their routes and page files
// - those four views are now tabs on ClientProjectDetail, so keeping the imports
// would ship dead chunks for pages that no longer exist.
const ClientBilling = lazy(() => import('@/features/client/ClientBilling'))
const ClientMeetings = lazy(() => import('@/features/client/ClientMeetings'))
// Phase 5.8 (Task 1): ClientAnnouncements removed from the Client Portal route tree.
// Phase 6.10 (TASK 4): the Notifications page for the client portal.
const ClientNotifications = lazy(() => import('@/features/client/ClientNotifications'))
const ClientProfile = lazy(() => import('@/features/client/ClientProfile'))

// --- Admin: Clients console ---
// Phase 5.9 (Task 3): the duplicate admin client screen was lazily imported
// here but never referenced anywhere in the route tree - unreachable dead code
// that still duplicated client CRUD. File deleted, import removed.
// `/clients` -> pages/Clients.jsx is now the single Clients module.
const AdminClientDetail = lazy(() => import('@/pages/admin/ClientDetail'))
// Top-level Clients module (moved out of the Admin console).
const ClientsModule = lazy(() => import('@/pages/Clients'))

import { NotFound, Forbidden, ServerError } from '@/pages/error/ErrorPage'
// Phase 6.10 (TASK 3): shared route-level error element - see RouteError.jsx.
import { RouteError } from './RouteError'

// Wrap lazy element in Suspense fallback.
const s = (El) => (
  <Suspense fallback={<Loader />}>
    <El />
  </Suspense>
)

// Helper to declare a protected dashboard route. Staff routes default to
// STAFF_ROLES so external Clients (who live entirely in the /client/* tree) can
// never reach an internal page by typing its URL. Client routes pass
// [ROLES.CLIENT] explicitly.
const route = (path, El, roles = STAFF_ROLES) => ({
  path,
  element: <ProtectedRoute roles={roles}>{s(El)}</ProtectedRoute>,
})

// Role-aware home: clients land in their portal, staff in the dashboard.
function RoleHome() {
  const { user } = useAuth()
  return <Navigate to={user?.role === ROLES.CLIENT ? '/client' : '/dashboard'} replace />
}

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    // Phase 6.10 (TASK 3): attached to all three top-level shells so no route in
    // the tree can fall through to React Router's default crash screen.
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: s(Login) },
      { path: '/forgot-password', element: s(ForgotPassword) },
      { path: '/reset-password', element: s(ResetPassword) },
    ],
  },
  {
    element: <DashboardLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RoleHome /> },
      route('/dashboard', Dashboard),
      route('/employees', Employees, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/employees/dashboard', EmployeeDashboard, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/employees/:id', EmployeeDetails, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/hr', HR, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/departments', HrDepartments, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/designations', HrDesignations, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/recruitment', HrRecruitment, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/interviews', HrInterviews, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/offers', HrOffers, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/onboarding', HrOnboarding, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/payroll', HrPayroll, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/performance', HrPerformance, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/movements', HrMovements, [ROLES.ADMIN, ROLES.HR]),
      route('/hr/reports', HrReports, [ROLES.ADMIN, ROLES.HR]),
      // Phase 6.1 (Tasks 1, 2 & 4) ROOT CAUSE: these two routes were gated to
      // [ROLES.ADMIN], which is why HR/Manager had no Clients page at all and
      // client creation could only be reached through the Admin panel.
      //
      // There is no separate "HR layout" or "Manager layout" in this codebase -
      // every staff role already renders inside DashboardLayout, the same shell
      // Admin uses for non-/admin pages. Opening these routes therefore gives HR
      // and Manager the Clients module INSIDE their own portal shell, with no
      // redirect to /admin/* and without duplicating the page three times.
      //
      // Data is scoped server-side (services/scopeService.js): Admin/HR see all
      // clients, a Manager sees only clients linked to projects they lead.
      route('/clients', ClientsModule, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/clients/:id', AdminClientDetail, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/attendance', Attendance),
      route('/attendance/reports', AttendanceReports, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/attendance/shifts', AttendanceShifts, [ROLES.ADMIN, ROLES.HR]),
      route('/attendance/holidays', AttendanceHolidays, [ROLES.ADMIN, ROLES.HR]),
      // Employee-facing monthly attendance report (own records only).
      route('/attendance/my-report', MyAttendanceReport),
      route('/leave', Leave),
      route('/leave/reports', LeaveReports, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      route('/leave/types', LeaveTypes, [ROLES.ADMIN, ROLES.HR]),
      // Employee-facing leave report (own requests + balances only).
      route('/leave/my-report', MyLeaveReport),
      route('/projects', Projects),
      route('/projects/board', ProjectBoard),
      route('/projects/backlog', ProjectBacklog),
      route('/projects/sprints', ProjectSprints, [ROLES.ADMIN, ROLES.MANAGER, ROLES.HR]),
      route('/projects/bugs', ProjectBugs),
      route('/projects/milestones', ProjectMilestones),
      route('/projects/timeline', ProjectTimeline),
      route('/projects/reports', ProjectReports),
      // Part 8: project-lead review queue. Open to all staff because a lead is
      // usually an Employee; the server returns only the caller's own queue.
      // Declared BEFORE '/projects/:id' so it is not swallowed by that param.
      route('/projects/reviews', TaskReview),
      route('/projects/:id', ProjectDetail),
      // My Work = My Project Tasks (own tasks only). Defaults to STAFF_ROLES so
      // employees can reach it; previously unregistered (#6).
      // Phase 6.2 (Task 6): '/my-work' route removed - pages/MyWork.jsx was a
      // duplicate of '/my-tasks' (same useMyTasks hook). Deleted, not aliased.
      // Employee-only self-service pages (Issues 5 & 6).
      route('/my-tasks', MyTasks, [ROLES.EMPLOYEE]),
      // Phase 5.5 (Task 5): Task History. Left at the default STAFF_ROLES
      // rather than gated to one role, because the SAME page serves the
      // employee's own history and the lead/manager/admin/HR project-wise
      // view. The server scopes the data per caller, so a wider route here
      // does not widen what anyone can actually see.
      route('/task-history', TaskHistory),
      // Phase 6.14 (TASK 8) ROOT CAUSE: these three routes were gated to
  // [ROLES.EMPLOYEE], but the Salary panel that links to them lives on
  // pages/Profile.jsx, whose nav entry is open to ALL staff roles. A Manager
  // could therefore see "Open Full Salary" / "Salary History" / "Salary Report"
  // and every one of them dead-ended on ProtectedRoute. The pages, query key
  // (['my-salary']) and components were all fine - only the guard was wrong.
  //
  // The guard is widened to STAFF_ROLES, which is exactly the audience that
  // already sees the buttons. This does NOT weaken RBAC: the underlying
  // endpoints (GET /hr/payroll/me and GET /hr/payroll/me/salary in
  // server/src/routes/hrRoutes.js) are mounted with `protect` only and resolve
  // the record from req.user, so they are self-scoped by construction - a
  // Manager can only ever load their OWN salary, never a subordinate's. Client
  // remains excluded because STAFF_ROLES omits it.
  route('/salary', MySalary, STAFF_ROLES),
      // Phase 6.7 (TASK 6) / Phase 6.8 (TASK 3 + TASK 7): the Salary History and
      // Salary Report pages are nested under the existing '/salary' path and
      // carry the SAME [ROLES.EMPLOYEE] guard as the Salary module itself -
      // Admin, HR, Manager and Client cannot reach them, exactly as before for
      // '/salary'. They read only GET /hr/payroll/me/salary, which is scoped to
      // the session identity, so no route here can expose another person's
      // payroll. '/salary/slip' was removed in Phase 6.8 - its content now
      // lives inside '/salary/report' (see SalaryReport.jsx).
      route('/salary/history', SalaryHistory, STAFF_ROLES),
      route('/salary/report', SalaryReport, STAFF_ROLES),
      // --- Finance module (hub + sub-pages) ---
      route('/finance', FinanceDashboard, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/income', FinanceIncome, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/expenses', FinanceExpenses, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/transactions', FinanceTransactions, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/categories', FinanceCategories, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/invoices', FinanceInvoices, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/payments', FinancePayments, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/budgets', FinanceBudgets, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/tax', FinanceTax, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/monthly', FinanceMonthly, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/yearly', FinanceYearly, [ROLES.ADMIN, ROLES.HR]),
      route('/finance/charts', FinanceCharts, [ROLES.ADMIN, ROLES.HR]),
      { path: '/expense', element: <Navigate to="/finance" replace /> },
      route('/announcements', Announcements),
      route('/files', Files),
      route('/calendar', Calendar),
      route('/notifications', Notifications),
      route('/reports', Reports, [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]),
      // --- Admin console (hub + sub-pages) ---
      {
        path: '/admin',
        element: (
          <ProtectedRoute roles={[ROLES.ADMIN]}>
            {s(AdminLayout)}
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: s(AdminHub) },
          { path: 'users', element: s(AdminUsers) },
          { path: 'users/:id', element: s(AdminUserDetail) },
          { path: 'roles', element: s(AdminRoles) },
          { path: 'audit-logs', element: s(AdminAuditLogs) },
          { path: 'system-logs', element: s(AdminSystemLogs) },
          { path: 'backup', element: s(AdminBackup) },
          { path: 'restore', element: s(AdminRestore) },
          { path: 'database-health', element: s(AdminDbHealth) },
          { path: 'analytics', element: s(AdminAnalytics) },
          // Phase 6.16 (TASK 5): 'permissions', 'api-keys', 'company-settings',
          // 'email-settings', 'theme-settings', 'security-settings' and
          // 'activity-monitor' routes removed - their pages are deleted and no
          // link in the app points at these paths any more (verified by grep).
        ],
      },
      route('/profile', Profile),
      route('/search', Search),
    ],
  },
  // --- Client Portal: SEPARATE tree, gated exclusively to the Client role ---
  {
    element: (
      <ProtectedRoute roles={[ROLES.CLIENT]}>
        <ClientLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
    children: [
      route('/client', ClientDashboard, [ROLES.CLIENT]),
      route('/client/projects', ClientProjects, [ROLES.CLIENT]),
      route('/client/projects/:id', ClientProjectDetail, [ROLES.CLIENT]),
      // Phase 6.10 (TASK 2 / TASK 6): '/client/tasks', '/client/timeline',
      // '/client/documents' and '/client/messages' removed. Task Progress,
      // Project Timeline, Documents and Messages are now tabs inside
      // '/client/projects/:id', so each view has exactly one route.
      route('/client/billing', ClientBilling, [ROLES.CLIENT]),
      route('/client/meetings', ClientMeetings, [ROLES.CLIENT]),
      // Phase 6.10 (TASK 4): same [ROLES.CLIENT] gate as every sibling route.
      route('/client/notifications', ClientNotifications, [ROLES.CLIENT]),
      route('/client/profile', ClientProfile, [ROLES.CLIENT]),
    ],
  },
  { path: '/403', element: <Forbidden /> },
  { path: '/500', element: <ServerError /> },
  { path: '*', element: <NotFound /> },
])
