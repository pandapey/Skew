import { useMemo, useState } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  FiUsers, FiUserCheck, FiUserX, FiAlertCircle, FiCalendar, FiBarChart2,
  FiLayers, FiGift, FiArrowRight, FiClock, FiPercent,
} from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import {
  Card, CardHeader, StatCard, DataTable, Badge, Pagination, SearchInput, Select, ProgressBar,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { STATUS_TONE, ATTENDANCE_STATUS } from './constants'
import { formatDate } from '@/utils'
import { useDebounce } from '@/hooks/useDebounce'

// Phase 5.7 (Task 5) - Company Attendance Dashboard (Admin only).
//
// This is the ADMIN replacement for the personal attendance page. It contains
// no Check In / Check Out / Working Hours / Break timer / personal history,
// because an Admin is an oversight role and is exempt from marking attendance
// (the server enforces that too - see attendanceService.assertMarksAttendance).
//
// Every figure below comes from endpoints that ALREADY existed:
//   GET /api/attendance/stats     -> today's org-wide summary + dept/role splits
//   GET /api/attendance/day       -> paginated, searchable, filterable records
//   GET /api/attendance/holidays  -> upcoming holidays
// No new API surface was introduced for this dashboard.

// Management tooling is pinned to the TOP of the admin dashboard.
const MANAGEMENT_LINKS = [
  { label: 'Monthly Report', hint: 'Org-wide attendance report', path: '/attendance/reports', icon: FiBarChart2, tone: 'primary' },
  { label: 'Shift Management', hint: 'Shifts, timings & grace', path: '/attendance/shifts', icon: FiLayers, tone: 'accent' },
  { label: 'Holiday Management', hint: 'Company holiday calendar', path: '/attendance/holidays', icon: FiGift, tone: 'success' },
]
const TONE_BG = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export function CompanyAttendanceDashboard() {
  const navigate = useNavigate()

  // Phase 5.7 (Task 7): persist search/department/status filters so Back
  // restores them. Date deliberately resets to today on each fresh visit so
  // a stale date never silently shows yesterday's data.
  const [params, , , setParams] = useViewState('company-att', {
    search: '', department: '', status: '', date: todayISO(), page: 1, limit: 10,
  })
  const setParam = (patch) => setParams((p) => ({
    ...p, ...patch, page: 1,
    date: 'date' in patch ? patch.date : p.date,
  }))
  const debouncedSearch = useDebounce(params.search, 300)

  // Org-wide summary for the selected date.
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['attendance-stats', params.date],
    queryFn: () => attendanceApi.stats({ date: params.date }),
  })

  // Paginated, searchable org-wide records for the selected date.
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-day', { ...params, search: debouncedSearch }],
    queryFn: () => attendanceApi.dayRecords({
      search: debouncedSearch,
      department: params.department,
      status: params.status,
      date: params.date,
      page: params.page,
      limit: params.limit,
    }),
    placeholderData: keepPreviousData,
  })

  const { data: holidays = [] } = useQuery({
    queryKey: ['attendance-holidays-all'],
    queryFn: attendanceApi.holidays.all,
  })

  const rows = data?.data ?? []

  // Department options are derived from the live summary rather than a
  // hardcoded list, so a newly created department appears automatically.
  const departmentOptions = useMemo(() => ([
    { value: '', label: 'All Departments' },
    ...(stats?.byDepartment || [])
      .map((d) => d.name)
      .filter(Boolean)
      .map((name) => ({ value: name, label: name })),
  ]), [stats])

  // Phase 5.9.1 (hotfix) - CRASH: "TypeError: holidays is not iterable".
  // ROOT CAUSE: attendanceApi.holidays.all pointed at GET /attendance/holidays,
  // the LIST route, which returns a paginated envelope
  // { data, total, page, limit, totalPages } - an OBJECT, not an array. The
  // axios interceptor already unwraps response.data, so this component received
  // that envelope directly. React Query's `data: holidays = []` default only
  // applies when data is `undefined`, so the default never kicked in, and the
  // spread `[...holidays]` threw - taking down the ENTIRE Admin Attendance page
  // before a single tile could render.
  // FIX: the endpoint is corrected in api/services.js (-> /all, a real array).
  // This normalisation is defence in depth so either shape is now survivable.
  const upcomingHolidays = useMemo(() => {
    const list = Array.isArray(holidays) ? holidays : (holidays?.data ?? [])
    const from = todayISO()
    return [...list]
      .filter((h) => h.date >= from)
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .slice(0, 5)
  }, [holidays])

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => (
      <div>
        <p className="text-sm font-medium">{r.employee}</p>
        <p className="text-xs text-muted">{r.empCode || '-'}</p>
      </div>
    ) },
    { key: 'department', header: 'Department', render: (r) => r.department || '-' },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift || 'General'}</Badge> },
    { key: 'checkIn', header: 'Check In', render: (r) => r.checkIn || '-' },
    { key: 'checkOut', header: 'Check Out', render: (r) => r.checkOut || '-' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours ?? 0}h` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  const exportColumns = [
    { header: 'Employee', accessor: 'employee' }, { header: 'Code', accessor: 'empCode' },
    { header: 'Department', accessor: 'department' }, { header: 'Date', accessor: 'date' },
    { header: 'Shift', accessor: 'shift' }, { header: 'Check In', accessor: 'checkIn' },
    { header: 'Check Out', accessor: 'checkOut' }, { header: 'Hours', accessor: 'workingHours' },
    { header: 'Status', accessor: 'status' },
  ]

  const isToday = params.date === todayISO()

  return (
    <div>
      {/* Management tooling, pinned to the TOP (Task 5) */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MANAGEMENT_LINKS.map((q) => (
          <button key={q.path} onClick={() => navigate(q.path)} className="group text-left">
            <Card className="flex items-center gap-3 transition hover:border-primary hover:shadow-card">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_BG[q.tone]}`}><q.icon /></div>
              <div className="flex-1">
                <p className="text-sm font-medium">{q.label}</p>
                <p className="text-xs text-muted">{q.hint}</p>
              </div>
              <FiArrowRight className="text-muted transition group-hover:translate-x-1 group-hover:text-primary" />
            </Card>
          </button>
        ))}
      </div>

      {/* Today's attendance summary */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Total Employees" value={stats?.totalEmployees ?? '-'} icon={FiUsers} />
        <StatCard label="Present" value={stats?.present ?? '-'} icon={FiUserCheck} tone="success" />
        <StatCard label="Absent" value={stats?.absent ?? '-'} icon={FiUserX} tone="danger" />
        <StatCard label="Late" value={stats?.late ?? '-'} icon={FiAlertCircle} tone="warning" />
        <StatCard label="On Leave" value={stats?.onLeave ?? '-'} icon={FiCalendar} />
        <StatCard label="Early Exit" value={stats?.earlyExit ?? '-'} icon={FiClock} tone="accent" />
        <StatCard label="Attendance Rate" value={stats ? `${stats.attendanceRate}%` : '-'} icon={FiPercent} tone="primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Searchable, filterable org-wide attendance table */}
          <Card>
            <CardHeader
              title="Company Attendance"
              subtitle={isToday ? "Today's records across the organization" : `Records for ${formatDate(params.date)}`}
              action={<ExportMenu rows={rows} columns={exportColumns} filename="company-attendance" title="Company Attendance" />}
            />

            {/* Quick filters */}
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <SearchInput
                value={params.search}
                onChange={(v) => setParam({ search: v })}
                placeholder="Search employee or code"
                className="sm:max-w-[220px]"
              />
              <Select
                className="sm:w-44"
                value={params.department}
                onChange={(e) => setParam({ department: e.target.value })}
                options={departmentOptions}
              />
              <Select
                className="sm:w-40"
                value={params.status}
                onChange={(e) => setParam({ status: e.target.value })}
                options={[{ value: '', label: 'All Status' }, ...ATTENDANCE_STATUS.map((s) => ({ value: s, label: s }))]}
              />
              <input
                type="date"
                value={params.date}
                onChange={(e) => setParam({ date: e.target.value || todayISO() })}
                className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm outline-none focus:border-primary sm:w-40"
                aria-label="Attendance date"
              />
            </div>

            <DataTable columns={columns} data={rows} loading={isLoading} empty="No attendance records found" />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{data?.total || 0} records</p>
              <Pagination
                page={params.page}
                totalPages={data?.totalPages || 1}
                onChange={(p) => setParams((prev) => ({ ...prev, page: p }))}
              />
            </div>
          </Card>

          {/* Department attendance */}
          <Card>
            <CardHeader title="Department Attendance" subtitle="Present / late / absent by department" />
            <div className="space-y-3">
              {(stats?.byDepartment || []).map((d) => {
                const total = d.present + d.late + d.absent
                const rate = Math.round(((d.present + d.late) / (total || 1)) * 100)
                return (
                  <div key={d.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{d.name || 'Unassigned'}</span>
                      <span className="text-xs text-muted">
                        {d.present} present, {d.late} late, {d.absent} absent
                      </span>
                    </div>
                    <ProgressBar value={rate} />
                  </div>
                )
              })}
              {!statsLoading && !(stats?.byDepartment || []).length && (
                <p className="text-sm text-muted">No attendance recorded for this date.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Role-wise attendance (Employees / HR / Managers) */}
          <Card>
            <CardHeader title="Attendance by Role" subtitle="Employees, HR and Managers" />
            <div className="space-y-2">
              {(stats?.byRole || []).map((r) => (
                <div key={r.name} className="rounded-xl border border-app p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm font-medium">{r.name}</p>
                    <Badge tone="primary">{r.total}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {r.present} present, {r.late} late, {r.onLeave} on leave, {r.absent} absent
                  </p>
                </div>
              ))}
              {!statsLoading && !(stats?.byRole || []).length && (
                <p className="text-sm text-muted">No role breakdown available for this date.</p>
              )}
            </div>
          </Card>

          {/* Real-time status split */}
          <Card>
            <CardHeader title="Status Breakdown" subtitle={isToday ? 'Live for today' : formatDate(params.date)} />
            <div className="space-y-2">
              {(stats?.statusSplit || []).map((s) => (
                <div key={s.name} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                  <Badge tone={STATUS_TONE[s.name]}>{s.name}</Badge>
                  <span className="text-sm font-semibold">{s.value}</span>
                </div>
              ))}
              {!statsLoading && !(stats?.statusSplit || []).length && (
                <p className="text-sm text-muted">Nothing recorded yet.</p>
              )}
            </div>
          </Card>

          {/* Upcoming holidays */}
          <Card>
            <CardHeader title="Upcoming Holidays" action={<FiGift className="text-muted" />} />
            <div className="space-y-2">
              {upcomingHolidays.map((h) => (
                <div key={h.id || h.date} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                  <div>
                    <p className="text-sm font-medium">{h.name}</p>
                    <p className="text-xs text-muted">{formatDate(h.date)}{h.day ? `, ${h.day}` : ''}</p>
                  </div>
                  <Badge tone="primary">{h.type}</Badge>
                </div>
              ))}
              {!upcomingHolidays.length && <p className="text-sm text-muted">No upcoming holidays.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
