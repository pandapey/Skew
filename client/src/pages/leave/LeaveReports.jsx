import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiInbox, FiClock, FiCheck, FiX, FiCalendar, FiWatch } from 'react-icons/fi'
import { leaveApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, StatCard, DataTable, Pagination, SearchInput,
  Select, Badge, Loader,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { useDebounce } from '@/hooks/useDebounce'
import { DEPARTMENTS } from '@/features/hr/constants'
import { LEAVE_STATUS, LEAVE_STATUS_TONE, formatDays, formatHours } from '@/features/leave/constants'
import { formatDate } from '@/utils'

// Part 2: render the stored approve/reject decision (comment + who + when).
// Part 4 note: `days` is already Sunday-excluded by the server, so these
// columns print the persisted value rather than recomputing a date span.
function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return `${formatDate(value)} \u00b7 ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export default function LeaveReports() {
  const [params, setParams] = useState({ search: '', status: '', department: '', page: 1, limit: 10 })
  const debounced = useDebounce(params.search)

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['leave-stats'], queryFn: leaveApi.stats })
  const { data, isLoading } = useQuery({
    queryKey: ['leave-all', { ...params, search: debounced }],
    queryFn: () => leaveApi.query({ ...params, search: debounced }),
  })
  const rows = data?.data ?? []
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  if (statsLoading) return <Loader label="Loading analytics…" />

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.empCode}</p></div> },
    { key: 'department', header: 'Department' },
    { key: 'type', header: 'Type', render: (r) => <Badge tone="accent">{r.typeCode}</Badge> },
    { key: 'from', header: 'From', render: (r) => formatDate(r.from) },
    { key: 'to', header: 'To', render: (r) => formatDate(r.to) },
    { key: 'days', header: 'Days', render: (r) => (
      <span>
        {formatDays(r.days)}
        {r.halfDay && <span className="ml-1 text-xs text-muted">({r.halfDaySession})</span>}
        {r.sundaysExcluded > 0 && <span className="ml-1 text-xs text-muted">{`\u00b7 ${r.sundaysExcluded} Sun excl.`}</span>}
      </span>
    ) },
    { key: 'approver', header: 'Approver', render: (r) => r.approver || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={LEAVE_STATUS_TONE[r.status]}>{r.status}</Badge> },
    // Part 2: the mandatory decision comment, with author and timestamp.
    { key: 'decision', header: 'Decision Comment', render: (r) => (
      r.decision?.comment
        ? (
          <div className="max-w-xs">
            <p className="text-sm">{r.decision.comment}</p>
            <p className="text-xs text-muted">{`${r.decision.by || '\u2014'} \u00b7 ${formatDateTime(r.decision.at)}`}</p>
          </div>
        )
        : <span className="text-muted">{'\u2014'}</span>
    ) },
  ]

  return (
    <div>
      <PageHeader title="Leave Reports & Analytics" subtitle="Approval history, trends and department insights." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Total" value={stats.total} icon={FiInbox} />
        <StatCard label="Pending" value={stats.pending} icon={FiClock} tone="warning" />
        <StatCard label="Approved" value={stats.approved} icon={FiCheck} tone="success" />
        <StatCard label="Rejected" value={stats.rejected} icon={FiX} tone="danger" />
        <StatCard label="Days Approved" value={stats.totalDaysApproved} icon={FiCalendar} tone="accent" />
        {/*
          Phase 5.5 (Task 4): hourly permissions reported in HOURS, as their own
          figure. Optional-chained because `hourlyPermission` is an additive key
          — a cached response from before this phase simply renders 0h.
        */}
        <StatCard
          label="Permission Hours"
          value={formatHours(stats.hourlyPermission?.totalHoursApproved ?? 0)}
          icon={FiWatch}
          tone="accent"
        />
      </div>

      {/* Phase 5.5 (Task 4): hourly permission breakdown. */}
      {stats.hourlyPermission?.total > 0 && (
        <Card className="mb-4">
          <CardHeader
            title="Hourly Permission"
            subtitle={`${stats.hourlyPermission.total} request(s) · ${stats.hourlyPermission.pending} pending · ${stats.hourlyPermission.approved} approved · ${stats.hourlyPermission.rejected} rejected`}
            icon={FiWatch}
          />
          {stats.hourlyPermission.byDepartment?.length > 0 && (
            <BarsChart
              data={stats.hourlyPermission.byDepartment}
              xKey="name"
              bars={[{ key: 'value', color: '#7C3AED' }]}
            />
          )}
        </Card>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly Trend" subtitle="Approved vs Rejected" />
          <BarsChart data={stats.monthlyTrend} xKey="month" bars={[{ key: 'approved', color: '#10B981' }, { key: 'rejected', color: '#EF4444' }]} />
        </Card>
        <Card>
          <CardHeader title="By Status" />
          <DonutChart data={stats.byStatus} />
        </Card>
        <Card>
          <CardHeader title="By Leave Type" />
          <DonutChart data={stats.byType} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Approved Days by Department" />
          <BarsChart data={stats.byDepartment} xKey="name" bars={[{ key: 'value', color: '#2563EB' }]} />
        </Card>
      </div>

      {/* Approval history table */}
      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <CardHeader title="Approval History" subtitle="All leave requests" className="mb-0" />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="sm:max-w-xs" />
            <Select className="sm:w-44" value={params.department} onChange={(e) => setParam({ department: e.target.value })}
              options={[{ value: '', label: 'All Departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
            <Select className="sm:w-36" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
              options={[{ value: '', label: 'All Status' }, ...LEAVE_STATUS.map((s) => ({ value: s, label: s }))]} />
            <ExportMenu rows={rows} filename="leave-history" title="Leave Approval History"
              columns={[
                { header: 'Employee', accessor: 'employee' }, { header: 'Department', accessor: 'department' },
                { header: 'Type', accessor: 'type' }, { header: 'From', accessor: 'from' }, { header: 'To', accessor: 'to' },
                { header: 'Days', accessor: 'days' }, { header: 'Approver', accessor: 'approver' }, { header: 'Status', accessor: 'status' },
                { header: 'Half Day', accessor: (r) => (r.halfDay ? r.halfDaySession : '') },
                { header: 'Sundays Excluded', accessor: (r) => r.sundaysExcluded || 0 },
                { header: 'Decision', accessor: (r) => r.decision?.action || '' },
                { header: 'Decision Comment', accessor: (r) => r.decision?.comment || '' },
                { header: 'Decided By', accessor: (r) => r.decision?.by || '' },
                { header: 'Decided At', accessor: (r) => (r.decision?.at ? formatDateTime(r.decision.at) : '') },
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
