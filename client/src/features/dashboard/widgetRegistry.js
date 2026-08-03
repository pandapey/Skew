import { lazy } from 'react'
import { ROLES } from '@/constants'

// Roles with organization-wide visibility (financials, headcount, pipeline).
// Everyone else only sees the personal "My Day" widgets — this is how the
// brief's "remove employee-irrelevant KPI/revenue widgets" requirement is
// satisfied without deleting that data for the roles that rely on it.
const ORG_VISIBILITY_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]
const APPROVAL_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]

// Central widget registry: the Dashboard renders `WidgetGrid`, which maps a
// user's saved widget order (`workspace.dashboardLayout.order`) through this
// table. Adding a Phase-2+ widget means adding one entry here (+ one
// component file) — Dashboard.jsx itself never needs to change.
//
// `minRoles: null` = visible to every role. `size` drives the grid span in
// `WidgetGrid.jsx` ('sm' = 1 col, 'md' = default, 'lg' = 2 cols, 'full' = all
// cols on large screens).
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
    // Phase 5.4 (Task 2): personal salary summary, visible to every role.
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

// Phase 6.2 (Task 8): the 'frequent-pages' ("Frequently Visited") and
// 'continue-last' ("Continue Where You Left Off") entries were removed here.
// This registry is the single source the Dashboard maps a user's saved widget
// order through, so deleting the entries removes the cards from every layout -
// including layouts already persisted in redux-persist, because WidgetGrid
// resolves ids via getWidget() and skips unknown ids. No migration needed.
export const WIDGET_IDS = WIDGET_REGISTRY.map((w) => w.id)
export const getWidget = (id) => WIDGET_REGISTRY.find((w) => w.id === id)
