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
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Employees = lazy(() => import('@/pages/Employees'))
const EmployeeDashboard = lazy(() => import('@/pages/employees/EmployeeDashboard'))
const EmployeeDetails = lazy(() => import('@/pages/employees/EmployeeDetails'))
const EmployeeForm = lazy(() => import('@/pages/employees/EmployeeForm'))
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
const HrClientBilling = lazy(() => import('@/pages/hr/ClientBilling'))
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
const ProjectReports = lazy(() => import('@/pages/projects/ProjectReports'))
const ProjectDetail = lazy(() => import('@/pages/projects/ProjectDetail'))
const ProjectForm = lazy(() => import('@/pages/projects/ProjectForm'))
const TaskReview = lazy(() => import('@/pages/projects/TaskReview'))
const MyTasks = lazy(() => import('@/pages/MyTasks'))
const TaskHistory = lazy(() => import('@/pages/TaskHistory'))
const MySalary = lazy(() => import('@/pages/MySalary'))
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
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminHub = lazy(() => import('@/pages/admin/AdminHub'))
const AdminUsers = lazy(() => import('@/pages/admin/Users'))
const AdminUserForm = lazy(() => import('@/pages/admin/UserForm'))
const AdminUserDetail = lazy(() => import('@/pages/admin/UserDetail'))
const AdminRoles = lazy(() => import('@/pages/admin/Roles'))
const AdminAuditLogs = lazy(() => import('@/pages/admin/AuditLogs'))
const AdminSystemLogs = lazy(() => import('@/pages/admin/SystemLogs'))
const AdminPlans = lazy(() => import('@/pages/admin/Plans'))
const AdminDbHealth = lazy(() => import('@/pages/admin/DatabaseHealth'))
const AdminAnalytics = lazy(() => import('@/pages/admin/Analytics'))
const Profile = lazy(() => import('@/pages/Profile'))
const Chat = lazy(() => import('@/features/chat/ChatPage'))
const Search = lazy(() => import('@/pages/Search'))

const ClientDashboard = lazy(() => import('@/features/client/ClientDashboard'))
const ClientProjects = lazy(() => import('@/features/client/ClientProjects'))
const ClientProjectDetail = lazy(() => import('@/features/client/ClientProjectDetail'))
const ClientBilling = lazy(() => import('@/features/client/ClientBilling'))
const ClientMeetings = lazy(() => import('@/features/client/ClientMeetings'))
const ClientNotifications = lazy(() => import('@/features/client/ClientNotifications'))
const ClientProfile = lazy(() => import('@/features/client/ClientProfile'))

const AdminClientDetail = lazy(() => import('@/pages/admin/ClientDetail'))

const ClientsModule = lazy(() => import('@/pages/Clients'))

const ClientForm = lazy(() => import('@/pages/clients/ClientForm'))

import { NotFound, Forbidden, ServerError } from '@/pages/error/ErrorPage'

import { RouteError } from './RouteError'

// Wrap lazy element in Suspense fallback.
const s = (El) => (
  <Suspense fallback={<Loader />}>
    <El />
  </Suspense>
)

const route = (path, El, roles = STAFF_ROLES) => ({
  path,
  element: <ProtectedRoute roles={roles}>{s(El)}</ProtectedRoute>,
})

// Role-aware home: clients land in their portal, staff in the dashboard.
function RoleHome() {
  const { user } = useAuth()
  return <Navigate to={user?.role === ROLES.CLIENT ? '/client' : '/dashboard'} replace />
}

const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
}

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: s(Login) },
    ],
  },
  {
    element: <DashboardLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RoleHome /> },
      route('/dashboard', Dashboard),
      route('/employees', Employees, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/employees/dashboard', EmployeeDashboard, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/employees/new', AdminUserForm, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/employees/:id', EmployeeDetails, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/employees/:id/edit', EmployeeForm, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr', HR, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/departments', HrDepartments, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/designations', HrDesignations, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/recruitment', HrRecruitment, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/interviews', HrInterviews, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/offers', HrOffers, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/onboarding', HrOnboarding, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/payroll', HrPayroll, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/performance', HrPerformance, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/movements', HrMovements, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/reports', HrReports, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/hr/client-billing', HrClientBilling, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/clients', ClientsModule, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/clients/new', ClientForm, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/clients/:id/edit', ClientForm, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/clients/:id', AdminClientDetail, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/attendance', Attendance),
      route('/attendance/reports', AttendanceReports, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/attendance/shifts', AttendanceShifts, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/attendance/holidays', AttendanceHolidays, [ROLES.ADMIN, ROLES.MANAGER]),
      // Leave lives under Attendance so its breadcrumb reads Attendance > Leave;
      // the legacy /leave path redirects there.
      route('/attendance/leave', Leave),
      { path: '/leave', element: <Navigate to="/attendance/leave" replace /> },
      route('/leave/reports', LeaveReports, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/leave/types', LeaveTypes, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/leave/my-report', MyLeaveReport),
      route('/projects', Projects),
      route('/projects/new', ProjectForm, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/projects/board', ProjectBoard),
      route('/projects/backlog', ProjectBacklog),
      route('/projects/sprints', ProjectSprints, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/projects/bugs', ProjectBugs),
      route('/projects/milestones', ProjectMilestones),
      route('/projects/timeline', ProjectTimeline),
      route('/projects/reports', ProjectReports),
      route('/projects/reviews', TaskReview),
      route('/projects/:id', ProjectDetail),
      route('/my-tasks', MyTasks, [ROLES.EMPLOYEE]),
      // Employee-facing review queue and history live under My Tasks so the
      // breadcrumb reads My Tasks > Task Review / My Tasks > Task History.
      route('/my-tasks/review', TaskReview, [ROLES.EMPLOYEE]),
      route('/my-tasks/history', TaskHistory),
      { path: '/task-history', element: <Navigate to="/my-tasks/history" replace /> },
      // Salary lives under My Profile so its breadcrumb reads My Profile > Salary.
      route('/profile/salary', MySalary, STAFF_ROLES),
      { path: '/salary', element: <Navigate to="/profile/salary" replace /> },
      route('/salary/history', SalaryHistory, STAFF_ROLES),
      route('/salary/report', SalaryReport, STAFF_ROLES),
      // --- Finance module (hub + sub-pages) ---
      route('/finance', FinanceDashboard, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/income', FinanceIncome, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/expenses', FinanceExpenses, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/transactions', FinanceTransactions, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/categories', FinanceCategories, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/invoices', FinanceInvoices, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/payments', FinancePayments, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/budgets', FinanceBudgets, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/tax', FinanceTax, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/monthly', FinanceMonthly, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/yearly', FinanceYearly, [ROLES.ADMIN, ROLES.MANAGER]),
      route('/finance/charts', FinanceCharts, [ROLES.ADMIN, ROLES.MANAGER]),
      { path: '/expense', element: <Navigate to="/finance" replace /> },
      route('/announcements', Announcements),
      route('/files', Files),
      route('/calendar', Calendar),
      route('/notifications', Notifications),
      route('/chat', Chat),
      route('/reports', Reports, [ROLES.ADMIN, ROLES.MANAGER]),
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
          { path: 'users/new', element: s(AdminUserForm) },
          { path: 'users/:id/edit', element: s(AdminUserForm) },
          { path: 'users/:id', element: s(AdminUserDetail) },
          { path: 'roles', element: s(AdminRoles) },
          { path: 'audit-logs', element: s(AdminAuditLogs) },
          { path: 'system-logs', element: s(AdminSystemLogs) },
          { path: 'plans', element: s(AdminPlans) },
          { path: 'database-health', element: s(AdminDbHealth) },
          { path: 'analytics', element: s(AdminAnalytics) },
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
      route('/client/billing', ClientBilling, [ROLES.CLIENT]),
      route('/client/meetings', ClientMeetings, [ROLES.CLIENT]),
      route('/client/notifications', ClientNotifications, [ROLES.CLIENT]),
      route('/client/profile', ClientProfile, [ROLES.CLIENT]),
    ],
  },
  { path: '/403', element: <Forbidden /> },
  { path: '/500', element: <ServerError /> },
  { path: '*', element: <NotFound /> },
], { future: ROUTER_FUTURE })
