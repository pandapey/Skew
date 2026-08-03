import { useQuery } from '@tanstack/react-query'
import {
  FiUsers, FiTrello, FiTarget, FiUserCheck, FiPlus, FiCalendar,
  FiTrendingUp, FiClock,
} from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { dashboardService } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { CardHeader, StatCard, Badge, Avatar, Button, CardSkeleton, PageHeader } from '@/components/ui'
import { RevenueChart, BarsChart } from '@/components/charts/Charts'
import { GlassChartContainer, GlassWidget } from '@/components/glass'
import { DateTimeWidget } from '@/features/dashboard/DateTimeWidget'
// Phase 6.14 (TASK 1): the EXISTING attendance control. <CheckInButton/> is a
// header-sized variant that shares useAttendanceSession() with <CheckInCard/>,
// so it hits the same attendanceApi endpoints and the same ATTENDANCE_TODAY_KEY
// cache entry as the Attendance page and the dashboard Check-In widget.
import { CheckInButton } from '@/features/attendance/CheckInCard'
import { cn, formatDate } from '@/utils'

// Original organization dashboard \u2014 the "old style" retained for every role
// EXCEPT Employee (Employees get pages/EmployeeWorkspaceDashboard.jsx). Routing
// by role happens in pages/Dashboard.jsx.
export default function ClassicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === ROLES.ADMIN
  // Phase 6.5 (TASK 3): HR gets the same "Clients" label + no Pending Leave
  // widget as Admin (T1 Phase 6.4), but — unlike Admin — HR KEEPS Quick
  // Actions / My Tasks / Recent Activity. Manager, Employee and Client are
  // completely untouched by either change.
  const isHR = user?.role === ROLES.HR
  // Phase 6.6 (TASK 1): Manager now joins Admin/HR for the "Clients" label and
  // the Pending Leaves removal, and additionally loses the Revenue vs Expense
  // chart. Manager KEEPS Quick Actions / My Tasks / Recent Activity / Weekly
  // Attendance / Upcoming Meetings, so no functionality is lost — only the two
  // widgets the brief names are removed. Employee and Client are untouched
  // (Employees render pages/EmployeeWorkspaceDashboard.jsx entirely).
  const isManager = user?.role === ROLES.MANAGER
  // Phase 6.5 (TASK 1/3) ROOT CAUSE: widgets were hidden with simple
  // `{!isAdmin && ...}` guards that left their grid cell rendering as blank
  // space (empty columns in a 3/4-col grid) instead of reflowing the
  // remaining widgets. hidePendingLeave drives an adaptive grid instead of
  // just hiding content, without removing any functionality.
  const hidePendingLeave = isAdmin || isHR || isManager
  // Phase 6.6 (TASK 1) ROOT CAUSE: the Revenue vs Expense chart lived in its own
  // `lg:grid-cols-3` row with a single `lg:col-span-2` child, so the right third
  // of that row was ALREADY permanently blank for every role. Hiding the chart
  // with an inline guard would have left the empty wrapper row behind (blank
  // vertical gap + the row's gap-4 spacing). The whole row is therefore skipped
  // for Manager rather than just its contents.
  const hideRevenueChart = isManager
  // Phase 6.7 (TASK 1 + TASK 2) ROOT CAUSE: the Revenue vs Expense row is a
  // `lg:grid-cols-3` grid holding ONE `lg:col-span-2` child, so its right third
  // has ALWAYS been an unused column for every role that renders the chart
  // (Admin, HR, Client). Phase 6.6 only removed the row for Manager; it did not
  // fill the hole for Admin/HR. The fix is to give that row a real second child
  // instead of leaving the column empty:
  //   Admin -> Upcoming Meetings  (Admin has no My Tasks / Recent Activity, so
  //            its bottom row was ALSO mostly empty - moving Meetings up fixes
  //            two empty regions with one move and empties the bottom row,
  //            which is then skipped entirely.)
  //   HR    -> Quick Actions      (as named in the brief; HR keeps My Tasks and
  //            Upcoming Meetings in the bottom row, which stays full at 3-up.)
  // No new widget is created - existing widgets are relocated.
  const revenueSideIsMeetings = isAdmin
  const revenueSideIsQuickActions = isHR
  // Quick Actions has moved into the chart row for HR, so the attendance row no
  // longer has a side child for Admin OR HR and the chart must span the row.
  const attendanceFullWidth = isAdmin || isHR
  // Admin's bottom row would now render nothing at all (My Tasks and Recent
  // Activity are hidden for Admin, and Meetings moved up), so the whole row is
  // skipped rather than left as an empty grid.
  const hideBottomRow = isAdmin
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.stats })

  const quickActions = [
    { label: 'Add Employee', to: '/employees', icon: FiUsers },
    { label: 'New Project', to: '/projects', icon: FiTrello },
    { label: 'Apply Leave', to: '/leave', icon: FiUserCheck },
  ]

  // Phase 6.7 (TASK 1 + TASK 2): the Quick Actions and Upcoming Meetings widgets
  // are defined ONCE here and then placed in whichever row the role needs. This
  // is what makes "move the widget" possible WITHOUT duplicating the widget:
  // each is a single expression rendered in exactly one location per role.
  const quickActionsWidget = (
    <GlassWidget>
      <CardHeader title="Quick Actions" />
      <div className="grid grid-cols-2 gap-3">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.to)}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-app bg-black/[0.02] p-4 text-center text-sm font-medium transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 dark:bg-white/[0.03]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
              <a.icon className="h-5 w-5" />
            </span>
            {a.label}
          </button>
        ))}
      </div>
    </GlassWidget>
  )

  const meetingsWidget = (
    <GlassWidget>
      <CardHeader title="Upcoming Meetings" action={<FiCalendar className="text-muted" />} />
      <div className="space-y-2.5">
        {!isLoading && !data?.meetings?.length && (
          <p className="py-6 text-center text-sm text-muted">No upcoming events. Add one in the calendar.</p>
        )}
        {data?.meetings?.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-2xl border border-app p-3 transition hover:border-primary/40"
          >
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent/10 text-accent">
              <FiClock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.title}</p>
              <p className="text-xs text-muted">
                {m.time} \u00b7 {m.attendees} attendees
              </p>
            </div>
          </div>
        ))}
      </div>
    </GlassWidget>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0]} \ud83d\udc4b`}
        subtitle="Here's what's happening across your organization today."
        actions={
          // Phase 6.14 (TASK 1) ROOT CAUSE: this action was rendered
          // unconditionally for EVERY role that lands on the classic dashboard
          // (Admin, HR, Manager, Client) - there was no role branch here at
          // all, which is why Manager saw "New Project".
          // Phase 6.15 (TASK 1): HR has the exact same gap - HR also fell
          // into the "New Project" branch. HR now reuses the identical
          // CheckInButton (same useAttendanceSession query/mutations already
          // shared with Admin/Manager/Employee) instead of a second
          // implementation. Every other role keeps the original button.
          (isManager || isHR)
            ? <CheckInButton />
            : (
              // Phase 6.16 (TASK 4) ROOT CAUSE: this button only navigated to
              // the Projects module and left the user to click "Add Project"
              // a second time - it never used the `?newProject=1` query param
              // that Projects.jsx already listens for (the SAME mechanism
              // Clients.jsx's "New Client" round-trip and every other deep
              // link into the New Project form already reuses) to auto-open
              // the existing <ProjectModal/>. No new form, modal, or route.
              <Button icon={FiPlus} glow onClick={() => navigate('/projects?newProject=1')}>
                New Project
              </Button>
            )
        }
      />

      {/* KPI row — Phase 6.5 (T1/T3): column count adapts to how many KPI
          cards actually render, so hiding Pending Leaves for Admin/HR no
          longer leaves a blank 4th column. */}
      <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', hidePendingLeave ? 'xl:grid-cols-3' : 'xl:grid-cols-4')}>
        {/* Phase 6.9 (Task 20) ROOT CAUSE: these KPI cards rendered real backend
            numbers but had NO onClick at all, so "clicking every card" did
            nothing \u2014 a dead-link defect, not a data defect. Each card now
            navigates to the module it summarizes, using the existing routes
            already gated by the same roles that can see the card's data
            (Employees/Clients pages are Admin/HR/Manager-only; navigating an
            Employee/Client there is impossible because those roles render
            EmployeeWorkspaceDashboard / ClientDashboard instead of this
            component). No new route, query, or duplicate API call added. */}
        <StatCard label="Total Employees" value={data?.employees ?? '\u2014'} icon={FiUsers} trend={data?.trends?.employees} delay={0} onClick={() => navigate('/employees')} />
        <StatCard label="Active Projects" value={data?.projects ?? '\u2014'} icon={FiTrello} tone="accent" trend={data?.trends?.projects} delay={0.05} onClick={() => navigate('/projects')} />
        <StatCard label={(isAdmin || isHR || isManager) ? 'Clients' : 'Clients / Leads'} value={data?.clients ?? '\u2014'} icon={FiTarget} tone="success" trend={data?.trends?.clients} delay={0.1} onClick={() => navigate('/clients')} />
        {!hidePendingLeave && <StatCard label="Pending Leaves" value={data?.pendingLeaves ?? '\u2014'} icon={FiUserCheck} tone="warning" trend={data?.trends?.pendingLeaves} delay={0.15} onClick={() => navigate('/leave')} />}
      </div>

      {/* Charts — Phase 6.6 (TASK 1): the entire row (not just the chart) is
          skipped for Manager so removing "Revenue vs Expenses" leaves no empty
          row or stray gap. Admin/HR/Client render it exactly as before. */}
      {!hideRevenueChart && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassChartContainer
          className="lg:col-span-2"
          title="Revenue vs Expense"
          subtitle="Monthly cash flow"
          action={
            typeof data?.trends?.revenue === 'number' ? (
              <Badge tone={data.trends.revenue >= 0 ? 'success' : 'danger'}>
                <FiTrendingUp className="mr-1" />
                {data.trends.revenue >= 0 ? '+' : ''}{data.trends.revenue}%
              </Badge>
            ) : null
          }
        >
          {isLoading ? <CardSkeleton /> : <RevenueChart data={data.revenue} />}
        </GlassChartContainer>
        {/* Phase 6.7 (TASK 1 / TASK 2): the previously EMPTY right third of this
            row. Admin gets Upcoming Meetings, HR gets Quick Actions - both are
            the existing widgets, relocated (not copied). Client keeps the
            original single-child layout, unchanged. */}
        {revenueSideIsMeetings && meetingsWidget}
        {revenueSideIsQuickActions && quickActionsWidget}
      </div>}

      {/* Attendance + side widgets — Phase 6.5 (T1) ROOT CAUSE: the side
          column always rendered (as an empty <div>) even when Quick Actions
          was hidden for Admin, leaving a permanent blank 1/3 column next to
          the chart. The chart now reclaims that space for Admin instead of
          leaving it empty; HR/Manager/Employee/Client are unaffected since
          they still render Quick Actions exactly as before. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassChartContainer
          className={cn(attendanceFullWidth ? 'lg:col-span-3' : 'lg:col-span-2')}
          title="Weekly Attendance"
          subtitle="Present vs Absent"
        >
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <BarsChart
              data={data.attendance}
              xKey="day"
              bars={[
                { key: 'present', color: '#10B981' },
                { key: 'absent', color: '#EF4444' },
              ]}
            />
          )}
        </GlassChartContainer>

        {/* Quick Actions — hidden for Admin (T1 Phase 6.4). Phase 6.7 (TASK 2):
            also no longer here for HR, because it MOVED UP beside Revenue vs
            Expenses. It is rendered in exactly one place per role - never twice.
            Manager and Client keep it here exactly as before. */}
        {!isAdmin && !isHR && (
          <div className="space-y-4">{quickActionsWidget}</div>
        )}
      </div>

      {/* Bottom widgets — Phase 6.5 (T1): Meetings expands to fill the row
          for Admin (who has no My Tasks / Recent Activity), instead of
          leaving two blank grid columns. */}
      {!hideBottomRow && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* My Tasks — hidden for Admin (T1 Phase 6.4) */}
        {!isAdmin && <GlassWidget>
          <CardHeader title="My Tasks" action={<Badge tone="primary">{data?.tasks?.length || 0}</Badge>} />
          <div className="space-y-2.5">
            {!isLoading && !data?.tasks?.length && (
              <p className="py-6 text-center text-sm text-muted">No open tasks yet.</p>
            )}
            {data?.tasks?.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-2xl border border-app p-3 transition hover:border-primary/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-8 w-1.5 flex-none rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted">Due {formatDate(t.due)}</p>
                  </div>
                </div>
                <Badge>{t.priority}</Badge>
              </div>
            ))}
          </div>
        </GlassWidget>}

        {/* Meetings — Phase 6.7 (TASK 1): for Admin this widget now lives in the
            Revenue row above, so the whole bottom row is skipped for Admin and
            the old `lg:col-span-3` stretch is no longer needed anywhere. HR,
            Manager and Client render it here at 1/3 width, as before. */}
        {meetingsWidget}

        {/* Recent Activity — hidden for Admin (T1 Phase 6.4) */}
        {!isAdmin && <GlassWidget key="recent-activity">
          <CardHeader title="Recent Activity" />
          <div className="space-y-3.5">
            {!isLoading && !data?.activities?.length && (
              <p className="py-6 text-center text-sm text-muted">No recent activity yet.</p>
            )}
            {data?.activities?.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <Avatar name={a.user} size={32} />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{a.user}</span>{' '}
                    <span className="text-muted">{a.action}</span>
                  </p>
                  <p className="text-xs text-muted">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassWidget>}
      </div>}

      {/* Live date & time — Phase 6.7 (TASK 1): removed for Admin ONLY, per the
          brief ("remove the Time Widget completely ... only from the Admin
          Dashboard"). HR, Manager, Employee and Client keep it. */}
      {!isAdmin && <DateTimeWidget />}
    </div>
  )
}
