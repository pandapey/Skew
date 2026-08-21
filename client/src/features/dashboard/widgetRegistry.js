import { lazy } from 'react'
import { ROLES } from '@/constants'

const ORG_VISIBILITY_ROLES = [ROLES.ADMIN, ROLES.MANAGER]
const APPROVAL_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export const WIDGET_REGISTRY = [
  {
    id: 'checkin',
    title: 'Attendance',
    component: lazy(() => import('./widgets/CheckInWidget')),
    minRoles: null,
    size: 'full',
  },
  {
    id: 'leave-balance',
    title: 'Leave Balance',
    component: lazy(() => import('./widgets/LeaveBalanceWidget')),
    minRoles: null,
    size: 'full',
  },
  {
    id: 'today-tasks',
    title: "Today's Tasks",
    component: lazy(() => import('./widgets/TodayTasksWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'today-meetings',
    title: "Today's Meetings",
    component: lazy(() => import('./widgets/TodayMeetingsWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'pending-approvals',
    title: 'Pending Approvals',
    component: lazy(() => import('./widgets/PendingApprovalsWidget')),
    minRoles: APPROVAL_ROLES,
    size: 'md',
  },
  {
    id: 'upcoming-holidays',
    title: 'Upcoming Holidays',
    component: lazy(() => import('./widgets/UpcomingHolidaysWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'my-projects',
    title: 'My Projects',
    component: lazy(() => import('./widgets/MyProjectsWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'salary-summary',
    title: 'Salary Summary',
    component: lazy(() => import('./widgets/SalaryWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'team-availability',
    title: 'Team Availability',
    component: lazy(() => import('./widgets/TeamAvailabilityWidget')),
    minRoles: APPROVAL_ROLES,
    size: 'md',
  },
  {
    id: 'recent-activity',
    title: 'Recent Activity',
    component: lazy(() => import('./widgets/RecentActivityWidget')),
    minRoles: null,
    size: 'md',
  },
  {
    id: 'org-kpis',
    title: 'Organization Overview',
    component: lazy(() => import('./widgets/OrgKpisWidget')),
    minRoles: ORG_VISIBILITY_ROLES,
    size: 'full',
  },
  {
    id: 'revenue-chart',
    title: 'Revenue vs Expense',
    component: lazy(() => import('./widgets/RevenueChartWidget')),
    minRoles: ORG_VISIBILITY_ROLES,
    size: 'lg',
  },
  {
    id: 'attendance-chart',
    title: 'Weekly Attendance',
    component: lazy(() => import('./widgets/AttendanceChartWidget')),
    minRoles: ORG_VISIBILITY_ROLES,
    size: 'lg',
  },
]

export const WIDGET_IDS = WIDGET_REGISTRY.map((w) => w.id)
export const getWidget = (id) => WIDGET_REGISTRY.find((w) => w.id === id)
