import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { FiArrowLeft, FiClock, FiLogIn, FiUserX, FiCalendar } from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, DataTable, Badge, Button, StatCard, Tabs, Input, Select,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { STATUS_TONE } from '@/features/attendance/constants'
import { formatDate } from '@/utils'

const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const EXPORT_COLUMNS = [
  { header: 'Date', accessor: (r) => formatDate(r.date) },
  { header: 'Shift', accessor: 'shift' },
  { header: 'Check In', accessor: (r) => r.checkIn || '-' },
  { header: 'Check Out', accessor: (r) => r.checkOut || '-' },
  { header: 'Break (min)', accessor: (r) => r.breakMins ?? 0 },
  { header: 'Working Hours', accessor: (r) => r.workingHours ?? 0 },
  { header: 'Status', accessor: 'status' },
]

const TABLE_COLUMNS = [
  { key: 'date', header: 'Date', sortable: true, render: (r) => formatDate(r.date) },
  { key: 'shift', header: 'Shift', render: (r) => <Badge tone="accent">{r.shift || 'General'}</Badge> },
  { key: 'checkIn', header: 'Check In', render: (r) => r.checkIn || '\u2014' },
  { key: 'checkOut', header: 'Check Out', render: (r) => r.checkOut || '\u2014' },
  { key: 'breakMins', header: 'Break', render: (r) => (r.breakMins != null ? `${r.breakMins}m` : '\u2014') },
  { key: 'workingHours', header: 'Working Hours', sortable: true, render: (r) => (r.workingHours != null ? `${r.workingHours}h` : '\u2014') },
  { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
]

function rangeFor(tab, f) {
  if (tab === 'daily') return { from: f.date, to: f.date }
  if (tab === 'weekly') return { from: f.from, to: f.to }
  if (tab === 'monthly') {
    const start = dayjs(`${f.year}-${String(f.month + 1).padStart(2, '0')}-01`)
    return { from: start.format('YYYY-MM-DD'), to: start.endOf('month').format('YYYY-MM-DD') }
  }
  return { from: `${f.year}-01-01`, to: `${f.year}-12-31` } 
}

export default function MyAttendanceReport() {
  const navigate = useNavigate()
  const now = dayjs()
  const [tab, setTab] = useState('monthly')
  const [filters, setFilters] = useState({
    date: now.format('YYYY-MM-DD'),
    from: now.subtract(6, 'day').format('YYYY-MM-DD'),
    to: now.format('YYYY-MM-DD'),
    month: now.month(),
    year: now.year(),
  })
  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }))

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-my-report'],
    queryFn: () => attendanceApi.myHistory({ limit: 1000 }),
  })
  const allRows = data?.data ?? []

  const { from, to } = rangeFor(tab, filters)

  const { rows, summary, label } = useMemo(() => {
    const inRange = allRows
      .filter((r) => r.date && r.date >= from && r.date <= to)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    const worked = inRange.filter((r) => (r.workingHours || 0) > 0)
    const totalWorked = +worked.reduce((s, r) => s + (r.workingHours || 0), 0).toFixed(1)
    const workingDays = worked.length
    const s = {
      present: inRange.filter((r) => ['Present', 'Late', 'Early Exit'].includes(r.status)).length,
      absent: inRange.filter((r) => r.status === 'Absent').length,
      leave: inRange.filter((r) => r.status === 'On Leave').length,
      avgHours: workingDays ? +(totalWorked / workingDays).toFixed(1) : 0,
    }
    const lbl =
      tab === 'daily' ? formatDate(filters.date)
        : tab === 'weekly' ? `${formatDate(from)} \u2013 ${formatDate(to)}`
          : tab === 'monthly' ? `${MONTHS[filters.month]} ${filters.year}`
            : String(filters.year)
    return { rows: inRange, summary: s, label: lbl }
  }, [allRows, from, to, tab, filters])

  const filename = `my-attendance-${tab}`

  return (
    <div>
      <PageHeader
        title="My Attendance Report"
        subtitle="Daily, weekly, monthly and yearly summaries of your own attendance."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/attendance')}>Back</Button>}
      />

      <div className="mb-4 overflow-x-auto">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`${TABS.find((t) => t.key === tab).label} Report`}
          subtitle={label}
          action={<ExportMenu rows={rows} columns={EXPORT_COLUMNS} filename={filename} title={`My Attendance \u2014 ${label}`} subtitle="Skew Enterprise Hub" />}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tab === 'daily' && (
            <Input label="Date" type="date" value={filters.date} onChange={(e) => set({ date: e.target.value })} />
          )}
          {tab === 'weekly' && (
            <>
              <Input label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
              <Input label="To" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            </>
          )}
          {tab === 'monthly' && (
            <>
              <Select
                label="Month"
                value={String(filters.month)}
                onChange={(e) => set({ month: Number(e.target.value) })}
                options={MONTHS.map((m, i) => ({ value: String(i), label: m }))}
              />
              <Input label="Year" type="number" value={filters.year} onChange={(e) => set({ year: Number(e.target.value) })} />
            </>
          )}
          {tab === 'yearly' && (
            <Input label="Year" type="number" value={filters.year} onChange={(e) => set({ year: Number(e.target.value) })} />
          )}
        </div>
        
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Present Days" value={summary.present} icon={FiLogIn} tone="success" />
          <StatCard label="Absent Days" value={summary.absent} icon={FiUserX} tone="danger" />
          <StatCard label="Leave Days" value={summary.leave} icon={FiCalendar} tone="accent" />
          <StatCard label="Avg Hours" value={`${summary.avgHours}h`} icon={FiClock} />
        </div>

        <DataTable columns={TABLE_COLUMNS} data={rows} loading={isLoading} empty="No attendance records in this period" />
      </Card>
    </div>
  )
}
