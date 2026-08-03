import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  FiClock, FiLogIn, FiAlertCircle, FiZap, FiCalendar, FiBarChart2,
  FiLayers, FiGift, FiArrowRight, FiUserCheck,
} from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import {
  PageHeader, Card, CardHeader, StatCard, DataTable, Badge, Button, Loader,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { CheckInCard } from '@/features/attendance/CheckInCard'
import { AttendanceCalendar } from '@/features/attendance/AttendanceCalendar'
import { CompanyAttendanceDashboard } from '@/features/attendance/CompanyAttendanceDashboard'
import { STATUS_TONE, ATTENDANCE_WRITE_ROLES } from '@/features/attendance/constants'
import { formatDate } from '@/utils'

const QUICK_LINKS = [
  { label: 'Monthly Report', path: '/attendance/reports', icon: FiBarChart2, tone: 'primary' },
  { label: 'Shift Management', path: '/attendance/shifts', icon: FiLayers, tone: 'accent' },
  { label: 'Holidays', path: '/attendance/holidays', icon: FiGift, tone: 'success' },
]
const TONE_BG = { primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success' }

export default function Attendance() {
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  // Org-wide stats are a manager/HR/admin endpoint (403 for regular employees),
  // so only fetch them when the user is allowed to.
  const canReport = hasRole(ATTENDANCE_WRITE_ROLES)
  // Employees only get their OWN monthly report; the shift/holidays quick links
  // point at HR/admin-only routes (403 for employees), so we swap them for a
  // single "Monthly Report" link to their own report page (#10).
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  // PHASE NEXT (TASK 5): Manager no longer sees the three attendance
  // administration widgets - Monthly Report, Shift Management and Holidays.
  // ROOT CAUSE: they were never Manager-specific; the QUICK_LINKS grid was
  // simply gated with `!isEmployee`, so every non-employee staff role got all
  // three. Only the Manager BRANCH of that condition changes here.
  // The routes (/attendance/reports, /attendance/shifts, /attendance/holidays),
  // their pages, their route guards and every backend attendance API are left
  // untouched and keep working for Admin/HR.
  const isManager = hasRole(ROLES.MANAGER)
  // Phase 5.7 (Task 5): Admin gets the Company Attendance Dashboard instead of
  // the personal attendance page. The personal queries below are disabled for
  // Admin so the page never even asks for an Admin's own attendance record.
  const isAdmin = hasRole(ROLES.ADMIN)
  const { data: history, isLoading } = useQuery({ queryKey: ['attendance-me', {}], queryFn: () => attendanceApi.myHistory({ limit: 8 }), enabled: !isAdmin })
  const { data: calendar = {} } = useQuery({ queryKey: ['attendance-calendar'], queryFn: attendanceApi.calendar, enabled: !isAdmin })
  const { data: stats } = useQuery({ queryKey: ['attendance-stats'], queryFn: () => attendanceApi.stats(), enabled: canReport && !isAdmin })
  // Personal month summary for the LOGGED-IN employee (Issue 2). Average Hours
  // and Overtime were previously read from the org-wide 'stats' query, which is
  // only fetched for managers/HR/admins (enabled: canReport) 2014 so they were always
  // '2014' for employees. These figures are personal, so they come from the
  // per-user /attendance/me/summary endpoint (real data, own records only).
  const { data: mySummary } = useQuery({ queryKey: ['attendance-my-summary'], queryFn: () => attendanceApi.mySummary(), enabled: !isAdmin })

  const rows = history?.data ?? []

  const columns = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift}</Badge> },
    { key: 'checkIn', header: 'Check In', render: (r) => r.checkIn || '—' },
    { key: 'checkOut', header: 'Check Out', render: (r) => r.checkOut || '—' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'breakMins', header: 'Break', render: (r) => `${r.breakMins}m` },
    { key: 'overtimeHours', header: 'OT', render: (r) => r.overtimeHours ? <Badge tone="warning">+{r.overtimeHours}h</Badge> : '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  // --- Phase 5.7 (Task 5): Admin → Company Attendance Dashboard -------------
  // Admin is an oversight role: no Check In / Check Out / Working Hours /
  // Break timer / personal attendance widgets. Every other role keeps the
  // personal attendance experience below, completely unchanged.
  if (isAdmin) {
    return (
      <div>
        <PageHeader
          title="Company Attendance"
          subtitle="Organization-wide attendance monitoring, summaries and reports."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {/* Phase 6.9 (TASK 6): Leave entry point for Admin too. The sidebar
                  Leave item was removed, so every role must be able to reach
                  Leave from Attendance - otherwise the merge would strand it. */}
              <Button variant="ghost" icon={FiUserCheck} onClick={() => navigate('/leave')}>Leave</Button>
              <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate('/attendance/reports')}>Monthly Report</Button>
            </div>
          )}
        />
        <CompanyAttendanceDashboard />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Check in, track your hours and view your attendance."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Phase 6.9 (TASK 6): Attendance -> Leave. This is the single entry
                point to the Leave module for HR / Manager / Employee now that
                the duplicate sidebar item is gone. It navigates to the EXISTING
                /leave route - no Leave UI is reimplemented here. */}
            <Button variant="ghost" icon={FiUserCheck} onClick={() => navigate('/leave')}>Leave</Button>
            {/* PHASE NEXT (TASK 5): this header button is the OTHER entry point
                to the same Monthly Report page, so leaving it would have made
                the widget removal cosmetic and left an orphaned button. Hidden
                for Manager only; Employees keep their own report and Admin/HR
                keep the org report. */}
            {!isManager && (
              <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate(isEmployee ? '/attendance/my-report' : '/attendance/reports')}>Reports</Button>
            )}
          </div>
        )}
      />

      <div className="mb-4"><CheckInCard /></div>

      {/* Personal month summary */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Present Days" value={mySummary ? mySummary.presentDays : '—'} icon={FiLogIn} tone="success" />
        <StatCard label="Late Entries" value={mySummary ? mySummary.lateDays : '—'} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Avg Hours" value={mySummary ? `${mySummary.avgHours}h` : '—'} icon={FiClock} />
        <StatCard label="Overtime" value={mySummary ? `${mySummary.overtime}h` : '—'} icon={FiZap} tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="My Attendance History"
              subtitle="Recent records"
              action={<ExportMenu rows={rows} filename="my-attendance" title="My Attendance"
                columns={[
                  { header: 'Date', accessor: 'date' }, { header: 'Shift', accessor: 'shift' },
                  { header: 'Check In', accessor: 'checkIn' }, { header: 'Check Out', accessor: 'checkOut' },
                  { header: 'Hours', accessor: 'workingHours' }, { header: 'Break (min)', accessor: 'breakMins' }, { header: 'OT', accessor: 'overtimeHours' },
                  { header: 'Status', accessor: 'status' },
                ]} />}
            />
            <DataTable columns={columns} data={rows} loading={isLoading} />
          </Card>

          {/* Quick links — admin/manager tooling only. Employees focus on
              attendance operations + history; the Monthly Report widget is
              removed for them (#2). Their report lives on the Reports page. */}
          {/* PHASE NEXT (TASK 5): now hidden for Manager as well as Employee.
              The whole grid is conditional (not its individual cells), so the
              removal leaves no empty grid columns and no blank strip - the
              History card simply becomes the last element of this column. */}
          {!isEmployee && !isManager && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {QUICK_LINKS.map((q) => (
              <button key={q.path} onClick={() => navigate(q.path)} className="group text-left">
                <Card className="flex items-center gap-3 transition hover:border-primary hover:shadow-card">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${TONE_BG[q.tone]}`}><q.icon /></div>
                  <span className="flex-1 text-sm font-medium">{q.label}</span>
                  <FiArrowRight className="text-muted transition group-hover:translate-x-1 group-hover:text-primary" />
                </Card>
              </button>
            ))}
          </div>
          )}
        </div>

        <div className="space-y-4">
          <AttendanceCalendar calendar={calendar} holidays={stats?.upcomingHolidays || []} />
          {/* Upcoming Holidays card removed for employees — the calendar already
              surfaces holidays for them (#10). Other roles keep the card. */}
          {!isEmployee && (
          <Card>
            <CardHeader title="Upcoming Holidays" action={<FiGift className="text-muted" />} />
            <div className="space-y-2">
              {(stats?.upcomingHolidays || []).map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                  <div><p className="text-sm font-medium">{h.name}</p><p className="text-xs text-muted">{formatDate(h.date)} · {h.day}</p></div>
                  <Badge tone="primary">{h.type}</Badge>
                </div>
              ))}
            </div>
          </Card>
          )}
        </div>
      </div>
    </div>
  )
}
