import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FiUsers, FiUserCheck, FiUserX, FiAlertCircle, FiZap, FiTrendingUp,
} from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, StatCard, DataTable, Pagination, SearchInput,
  Select, Badge, Loader,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { useDebounce } from '@/hooks/useDebounce'
import { DEPARTMENTS } from '@/features/hr/constants'
import { ATTENDANCE_STATUS, STATUS_TONE } from '@/features/attendance/constants'

export default function AttendanceReports() {
  const [params, setParams] = useState({ search: '', department: '', status: '', page: 1, limit: 10 })
  const debounced = useDebounce(params.search)
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
    } catch {
      return 'Asia/Kolkata'
    }
  }, [])

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['attendance-stats', timezone],
    queryFn: () => attendanceApi.stats({ timezone }),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-day', { ...params, search: debounced, timezone }],
    queryFn: () => attendanceApi.dayRecords({ ...params, search: debounced, timezone }),
  })
  const rows = data?.data ?? []
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  if (statsLoading) return <Loader label="Loading analytics…" />

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.empCode}</p></div> },
    { key: 'department', header: 'Department' },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift}</Badge> },
    { key: 'checkIn', header: 'In', render: (r) => r.checkIn || '—' },
    { key: 'checkOut', header: 'Out', render: (r) => r.checkOut || '—' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'overtimeHours', header: 'OT', render: (r) => r.overtimeHours ? <Badge tone="warning">+{r.overtimeHours}h</Badge> : '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  return (
    <div>
      <PageHeader title="Attendance Reports" subtitle="Monthly trends, department analytics and daily records." />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Employees" value={stats.totalEmployees} icon={FiUsers} />
        <StatCard label="Present" value={stats.present} icon={FiUserCheck} tone="success" />
        <StatCard label="Absent" value={stats.absent} icon={FiUserX} tone="danger" />
        <StatCard label="Late" value={stats.late} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Overtime" value={`${stats.totalOvertime}h`} icon={FiZap} tone="accent" />
        <StatCard label="Rate" value={`${stats.attendanceRate}%`} icon={FiTrendingUp} tone="primary" />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly Trend" subtitle="Present / Absent / Late by week" />
          <BarsChart data={stats.monthlyTrend} xKey="week" bars={[
            { key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Status Split" subtitle="Today" />
          <DonutChart data={stats.statusSplit} />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Working Hours & Overtime" subtitle="This week" />
          <BarsChart data={stats.hoursTrend} xKey="day" bars={[
            { key: 'hours', color: '#2563EB' }, { key: 'overtime', color: '#06B6D4' },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Department-wise Attendance" />
          <BarsChart data={stats.byDepartment} xKey="name" bars={[
            { key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' },
          ]} />
        </Card>
      </div>

      {/* Daily records table */}
      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <CardHeader title="Daily Records" subtitle="July 15, 2026" className="mb-0" />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="sm:max-w-xs" />
            <Select className="sm:w-44" value={params.department} onChange={(e) => setParam({ department: e.target.value })}
              options={[{ value: '', label: 'All Departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
            <Select className="sm:w-40" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
              options={[{ value: '', label: 'All Status' }, ...ATTENDANCE_STATUS.map((s) => ({ value: s, label: s }))]} />
            <ExportMenu rows={rows} filename="attendance-day-report" title="Daily Attendance Report" subtitle="July 15, 2026"
              columns={[
                { header: 'Employee', accessor: 'employee' }, { header: 'Code', accessor: 'empCode' },
                { header: 'Department', accessor: 'department' }, { header: 'Shift', accessor: 'shift' },
                { header: 'In', accessor: 'checkIn' }, { header: 'Out', accessor: 'checkOut' },
                { header: 'Hours', accessor: 'workingHours' }, { header: 'OT', accessor: 'overtimeHours' },
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
