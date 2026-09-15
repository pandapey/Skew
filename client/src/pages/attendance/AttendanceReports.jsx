import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FiUsers, FiUserCheck, FiUserX, FiAlertCircle, FiTrendingUp,
} from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, StatCard, DataTable, Pagination, SearchInput,
  Select, Badge, Loader, EmptyState,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { useDebounce } from '@/hooks/useDebounce'
import { DEPARTMENTS } from '@/features/hr/constants'
import { ATTENDANCE_STATUS, STATUS_TONE } from '@/features/attendance/constants'
import { formatDate } from '@/utils'

const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export default function AttendanceReports() {
  const [params, setParams] = useState({ search: '', department: '', status: '', page: 1, limit: 10 })
  const debounced = useDebounce(params.search)
  const today = todayISO()

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({ queryKey: ['attendance-stats', today], queryFn: () => attendanceApi.stats({ date: today }) })
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-day', { ...params, search: debounced }],
    queryFn: () => attendanceApi.dayRecords({ ...params, search: debounced }),
  })
  const rows = data?.data ?? []
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  if (statsLoading) return <Loader label="Loading analytics…" />
  if (statsError || !stats) return <EmptyState title="Attendance stats unavailable" description="Could not load attendance analytics. Please retry." />

  const monthlyTrend = Array.isArray(stats.monthlyTrend) ? stats.monthlyTrend : []
  const hoursTrend = Array.isArray(stats.hoursTrend) ? stats.hoursTrend : []
  const hasMonthlyData = monthlyTrend.some((w) => (w.present || 0) + (w.absent || 0) + (w.late || 0) > 0)
  const hasHoursData = hoursTrend.some((d) => (d.hours || 0) > 0)
  const todayLabel = formatDate(today)

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.empCode}</p></div> },
    { key: 'department', header: 'Department' },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift}</Badge> },
    { key: 'checkIn', header: 'In', render: (r) => r.checkIn || '—' },
    { key: 'checkOut', header: 'Out', render: (r) => r.checkOut || '—' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  return (
    <div>
      <PageHeader title="Attendance Reports" subtitle="Monthly trends, department analytics and daily records." />

      {}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Employees" value={stats.totalEmployees ?? '—'} icon={FiUsers} />
        <StatCard label="Present" value={stats.present ?? '—'} icon={FiUserCheck} tone="success" />
        <StatCard label="Absent" value={stats.absent ?? '—'} icon={FiUserX} tone="danger" />
        <StatCard label="Late" value={stats.late ?? '—'} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Rate" value={`${stats.attendanceRate ?? 0}%`} icon={FiTrendingUp} tone="primary" />
      </div>

      {}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly Trend" subtitle="Present / Absent / Late by week" />
          {hasMonthlyData ? (
            <BarsChart data={monthlyTrend} xKey="week" bars={[
              { key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' },
            ]} />
          ) : (
            <EmptyState title="No attendance data available for this month." description="Monthly attendance trend will appear once records exist for this month." />
          )}
        </Card>
        <Card>
          <CardHeader title="Status Split" subtitle={todayLabel} />
          {(stats.statusSplit || []).length ? (
            <DonutChart data={stats.statusSplit} />
          ) : (
            <EmptyState title="No status data" description="Nothing recorded for today yet." />
          )}
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Working Hours" subtitle="Last 7 days (avg hours/day)" />
          {hasHoursData ? (
            <BarsChart data={hoursTrend} xKey="day" bars={[
              { key: 'hours', color: '#2563EB' },
            ]} />
          ) : (
            <EmptyState title="No attendance data available for this month." description="Working-hours data will appear once attendance is marked." />
          )}
        </Card>
        <Card>
          <CardHeader title="Department-wise Attendance" subtitle={todayLabel} />
          {(stats.byDepartment || []).length ? (
            <BarsChart data={stats.byDepartment} xKey="name" bars={[
              { key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' },
            ]} />
          ) : (
            <EmptyState title="No department data" description="Nothing recorded for today yet." />
          )}
        </Card>
      </div>

      {}
      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <CardHeader title="Daily Records" subtitle={todayLabel} className="mb-0" />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="sm:max-w-xs" />
            <Select className="sm:w-44" value={params.department} onChange={(e) => setParam({ department: e.target.value })}
              options={[{ value: '', label: 'All Departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
            <Select className="sm:w-40" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
              options={[{ value: '', label: 'All Status' }, ...ATTENDANCE_STATUS.map((s) => ({ value: s, label: s }))]} />
            <ExportMenu rows={rows} filename="attendance-day-report" title="Daily Attendance Report" subtitle={todayLabel}
              columns={[
                { header: 'Employee', accessor: 'employee' }, { header: 'Code', accessor: 'empCode' },
                { header: 'Department', accessor: 'department' }, { header: 'Shift', accessor: 'shift' },
                { header: 'In', accessor: 'checkIn' }, { header: 'Out', accessor: 'checkOut' },
                { header: 'Hours', accessor: 'workingHours' },
                { header: 'Status', accessor: 'status' },
              ]} />
          </div>
        </div>
        <DataTable columns={columns} data={rows} loading={isLoading} />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{data?.total || 0} records</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>
    </div>
  )
}
