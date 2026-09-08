import { useMemo, useState, useEffect } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  FiUsers, FiUserCheck, FiUserX, FiAlertCircle, FiCalendar, FiBarChart2,
  FiLayers, FiGift, FiArrowRight,
} from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import {
  Card, CardHeader, StatCard, DataTable, Badge, Pagination, SearchInput, Select, ProgressBar,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { STATUS_TONE, ATTENDANCE_STATUS } from './constants'
import { formatDate } from '@/utils'
import { useDebounce } from '@/hooks/useDebounce'

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

const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export function CompanyAttendanceDashboard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [params, , , setParams] = useViewState('company-att', {
    search: '', department: '', status: '', date: todayISO(), page: 1, limit: 10,
  })

  useEffect(() => {
    const status = searchParams.get('status')
    const dateParam = searchParams.get('date')
    if (status !== null) {
      const decoded = decodeURIComponent(status)
      if (ATTENDANCE_STATUS.includes(decoded) && decoded !== params.status) {
        setParams((p) => ({ ...p, status: decoded, page: 1 }))
      } else if (decoded === '' && params.status !== '') {
        setParams((p) => ({ ...p, status: '', page: 1 }))
      }
    }
    if (dateParam && dateParam !== params.date) {
      setParams((p) => ({ ...p, date: dateParam, page: 1 }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const setParam = (patch) => setParams((p) => ({
    ...p, ...patch, page: 1,
    date: 'date' in patch ? patch.date : p.date,
  }))
  const debouncedSearch = useDebounce(params.search, 300)

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['attendance-stats', params.date],
    queryFn: () => attendanceApi.stats({ date: params.date }),
  })

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

  const departmentOptions = useMemo(() => ([
    { value: '', label: 'All Departments' },
    ...(stats?.byDepartment || [])
      .map((d) => d.name)
      .filter(Boolean)
      .map((name) => ({ value: name, label: name })),
  ]), [stats])

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
      {}
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

      {}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Employees" value={stats?.totalEmployees ?? '-'} icon={FiUsers} />
        <StatCard label="Present" value={stats?.present ?? '-'} icon={FiUserCheck} tone="success" />
        <StatCard label="Absent" value={stats?.absent ?? '-'} icon={FiUserX} tone="danger" />
        <StatCard label="Late" value={stats?.late ?? '-'} icon={FiAlertCircle} tone="warning" />
        <StatCard label="On Leave" value={stats?.onLeave ?? '-'} icon={FiCalendar} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {}
          <Card>
            <CardHeader
              title="Company Attendance"
              subtitle={isToday ? "Today's records across the organization" : `Records for ${formatDate(params.date)}`}
              action={<ExportMenu rows={rows} columns={exportColumns} filename="company-attendance" title="Company Attendance" />}
            />

            {}
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

          {}
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
          {}
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

          {}
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

          {}
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
