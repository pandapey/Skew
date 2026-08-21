import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  FiClock, FiLogIn, FiAlertCircle, FiCalendar, FiBarChart2,
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
  const canReport = hasRole(ATTENDANCE_WRITE_ROLES)
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  const isManager = hasRole(ROLES.MANAGER)
  const isAdmin = hasRole(ROLES.ADMIN)
  const { data: history, isLoading } = useQuery({ queryKey: ['attendance-me', {}], queryFn: () => attendanceApi.myHistory({ limit: 8 }), enabled: !isAdmin })
  const [calendarMonth, setCalendarMonth] = useState(() => dayjs().startOf('month'))
  const { data: calendar = {} } = useQuery({
    queryKey: ['attendance-calendar', calendarMonth.year(), calendarMonth.month()],
    queryFn: () => attendanceApi.calendar({ year: calendarMonth.year(), month: calendarMonth.month() }),
    enabled: !isAdmin,
    placeholderData: keepPreviousData,
  })

  const { data: allHolidays = [] } = useQuery({
    queryKey: ['attendance-holidays'],
    queryFn: attendanceApi.holidays.all,
    enabled: !isAdmin,
    staleTime: 60_000,
  })
  const monthPrefix = calendarMonth.format('YYYY-MM')
  const monthHolidays = (Array.isArray(allHolidays) ? allHolidays : [])
    .filter((h) => String(h?.date || '').slice(0, 7) === monthPrefix)
  const { data: stats } = useQuery({ queryKey: ['attendance-stats'], queryFn: () => attendanceApi.stats(), enabled: canReport && !isAdmin })
  const { data: mySummary } = useQuery({ queryKey: ['attendance-my-summary'], queryFn: () => attendanceApi.mySummary(), enabled: !isAdmin })

  const rows = history?.data ?? []

  const columns = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift}</Badge> },
    { key: 'checkIn', header: 'Check In', render: (r) => r.checkIn || '—' },
    { key: 'checkOut', header: 'Check Out', render: (r) => r.checkOut || '—' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'breakMins', header: 'Break', render: (r) => `${r.breakMins}m` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  if (isAdmin) {
    return (
      <div>
        <PageHeader
          title="Company Attendance"
          subtitle="Organization-wide attendance monitoring, summaries and reports."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon={FiUserCheck} onClick={() => navigate('/attendance/leave')}>Leave</Button>
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
            <Button variant="ghost" icon={FiUserCheck} onClick={() => navigate('/attendance/leave')}>Leave</Button>
            {!isManager && (
              <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate(isEmployee ? '/attendance/my-report' : '/attendance/reports')}>Reports</Button>
            )}
            {isManager && (
              <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate('/attendance/my-report')}>My Attendance Report</Button>
            )}
          </div>
        )}
      />

      <div className="mb-4"><CheckInCard /></div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Present Days" value={mySummary ? mySummary.presentDays : '—'} icon={FiLogIn} tone="success" />
        <StatCard label="Late Entries" value={mySummary ? mySummary.lateDays : '—'} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Leave Days" value={mySummary ? (mySummary.leaveDays ?? 0) : '—'} icon={FiCalendar} tone="accent" />
        <StatCard label="Avg Hours" value={mySummary ? `${mySummary.avgHours}h` : '—'} icon={FiClock} />
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
                  { header: 'Hours', accessor: 'workingHours' }, { header: 'Break (min)', accessor: 'breakMins' },
                  { header: 'Status', accessor: 'status' },
                ]} />}
            />
            <DataTable columns={columns} data={rows} loading={isLoading} />
          </Card>

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
          <AttendanceCalendar
            calendar={calendar}
            holidays={monthHolidays}
            current={calendarMonth}
            onChange={setCalendarMonth}
          />
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
