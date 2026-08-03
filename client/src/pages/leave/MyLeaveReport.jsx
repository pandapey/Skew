import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { FiArrowLeft, FiClock, FiCheck, FiX, FiSlash, FiCalendar } from 'react-icons/fi'
import { leaveApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, DataTable, Badge, Button, StatCard, Tabs, Input, Select,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { LEAVE_STATUS_TONE, formatDays } from '@/features/leave/constants'
import { formatDate } from '@/utils'

// Employee-facing Leave Report (Issue 4). Same redesign as Attendance Reports:
// a single tabbed view (Weekly / Monthly / Yearly) with only ONE period visible
// at a time, plus Date Range / Status / Leave Type filters and per-period
// PDF / CSV / Excel download.
//
// Uses ONLY the caller's own data:
//   leaveApi.myRequests ('/leave/me')      -> scoped to req.user on the server
//   leaveApi.balances   ('/leave/balances') -> derived per-user balances
// No RBAC change; both endpoints are already available to any authenticated
// non-client user and return the caller's own records.

const TABS = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled']

// Approved date is not a stored column — derive it from the approval workflow
// step (falls back to updatedAt for approved rows without a timestamped step).
const approvedDate = (r) => {
  const step = (r.workflow || []).find((w) => w.stage === 'Approved')
  return step?.at || (r.status === 'Approved' ? r.updatedAt : null)
}

const EXPORT_COLUMNS = [
  { header: 'Leave Type', accessor: (r) => r.typeCode || r.type || '-' },
  { header: 'Applied Date', accessor: (r) => formatDate(r.createdAt) },
  { header: 'From', accessor: (r) => formatDate(r.from) },
  { header: 'To', accessor: (r) => formatDate(r.to) },
  { header: 'Approved Date', accessor: (r) => formatDate(approvedDate(r)) },
  { header: 'Status', accessor: 'status' },
  { header: 'Duration', accessor: (r) => formatDays(r.days) },
  { header: 'Half Day', accessor: (r) => (r.halfDay ? r.halfDaySession : '') },
  { header: 'Sundays Excluded', accessor: (r) => r.sundaysExcluded || 0 },
  { header: 'Decision', accessor: (r) => r.decision?.action || '' },
  { header: 'Decision Comment', accessor: (r) => r.decision?.comment || '' },
  { header: 'Decided By', accessor: (r) => r.decision?.by || '' },
  { header: 'Reason', accessor: (r) => r.reason || '-' },
  { header: 'Approver', accessor: (r) => r.approver || '-' },
]

const TABLE_COLUMNS = [
  { key: 'type', header: 'Leave Type', render: (r) => <Badge tone="accent">{r.typeCode || r.type}</Badge> },
  { key: 'createdAt', header: 'Applied', sortable: true, render: (r) => formatDate(r.createdAt) },
  { key: 'from', header: 'From', render: (r) => formatDate(r.from) },
  { key: 'to', header: 'To', render: (r) => formatDate(r.to) },
  { key: 'approved', header: 'Approved', render: (r) => formatDate(approvedDate(r)) },
  { key: 'status', header: 'Status', render: (r) => <Badge tone={LEAVE_STATUS_TONE[r.status]}>{r.status}</Badge> },
  // Part 3/4: half days show as "0.5 day" and Sundays are already excluded.
  { key: 'days', header: 'Duration', render: (r) => (
    <span>
      {formatDays(r.days)}
      {r.halfDay && <span className="ml-1 text-xs text-muted">({r.halfDaySession})</span>}
      {r.sundaysExcluded > 0 && <span className="ml-1 text-xs text-muted">{`\u00b7 ${r.sundaysExcluded} Sun excl.`}</span>}
    </span>
  ) },
  // Part 2: the approver's mandatory comment, visible in the employee's own
  // leave history.
  { key: 'decision', header: 'Decision Comment', render: (r) => (
    r.decision?.comment
      ? (
        <div className="max-w-xs">
          <p className="text-sm">{r.decision.comment}</p>
          <p className="text-xs text-muted">{r.decision.by || ''}</p>
        </div>
      )
      : <span className="text-muted">{'\u2014'}</span>
  ) },
  { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 text-sm text-muted">{r.reason || '\u2014'}</span> },
]

// Inclusive [from,to] (YYYY-MM-DD) window for the active tab.
function rangeFor(tab, f) {
  if (tab === 'weekly') return { from: f.from, to: f.to }
  if (tab === 'monthly') {
    const start = dayjs(`${f.year}-${String(f.month + 1).padStart(2, '0')}-01`)
    return { from: start.format('YYYY-MM-DD'), to: start.endOf('month').format('YYYY-MM-DD') }
  }
  return { from: `${f.year}-01-01`, to: `${f.year}-12-31` } // yearly
}

export default function MyLeaveReport() {
  const navigate = useNavigate()
  const now = dayjs()
  const [tab, setTab] = useState('monthly')
  const [filters, setFilters] = useState({
    from: now.subtract(6, 'day').format('YYYY-MM-DD'),
    to: now.format('YYYY-MM-DD'),
    month: now.month(),
    year: now.year(),
    status: '',
    type: '',
  })
  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }))

  const { data, isLoading } = useQuery({
    queryKey: ['leave-mine-report'],
    queryFn: () => leaveApi.myRequests({ limit: 1000 }),
  })
  const { data: balances = [] } = useQuery({ queryKey: ['leave-balances'], queryFn: leaveApi.balances })
  const allRows = data?.data ?? []

  // Leave-type options derived from the caller's own requests + balances.
  const typeOptions = useMemo(() => {
    const set2 = new Map()
    balances.forEach((b) => b.type && set2.set(b.type, b.type))
    allRows.forEach((r) => { const t = r.type || r.typeCode; if (t) set2.set(t, t) })
    return [{ value: '', label: 'All Types' }, ...[...set2.keys()].map((t) => ({ value: t, label: t }))]
  }, [balances, allRows])

  const { from, to } = rangeFor(tab, filters)

  const { rows, summary, label } = useMemo(() => {
    const inRange = allRows
      .filter((r) => r.createdAt && dayjs(r.createdAt).format('YYYY-MM-DD') >= from && dayjs(r.createdAt).format('YYYY-MM-DD') <= to)
      .filter((r) => (filters.status ? r.status === filters.status : true))
      .filter((r) => (filters.type ? (r.type === filters.type || r.typeCode === filters.type) : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const count = (s) => inRange.filter((r) => r.status === s).length
    const s = {
      pending: count('Pending'),
      approved: count('Approved'),
      rejected: count('Rejected'),
      cancelled: count('Cancelled'),
      days: inRange.filter((r) => r.status === 'Approved').reduce((sum, r) => sum + (r.days || 0), 0),
    }
    const lbl =
      tab === 'weekly' ? `${formatDate(from)} \u2013 ${formatDate(to)}`
        : tab === 'monthly' ? `${MONTHS[filters.month]} ${filters.year}`
          : String(filters.year)
    return { rows: inRange, summary: s, label: lbl }
  }, [allRows, from, to, tab, filters])

  const filename = `my-leave-${tab}`

  return (
    <div>
      <PageHeader
        title="My Leave Report"
        subtitle="Weekly, monthly and yearly summaries of your own leave requests."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/leave')}>Back</Button>}
      />

      <div className="mb-4 overflow-x-auto">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`${TABS.find((t) => t.key === tab).label} Report`}
          subtitle={label}
          action={<ExportMenu rows={rows} columns={EXPORT_COLUMNS} filename={filename} title={`My Leave \u2014 ${label}`} subtitle="Skew Enterprise Hub" />}
        />

        {/* Filters: Date Range (weekly) / Month+Year / Year, plus Status + Leave Type. */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Select
            label="Status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
            options={[{ value: '', label: 'All Statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            label="Leave Type"
            value={filters.type}
            onChange={(e) => set({ type: e.target.value })}
            options={typeOptions}
          />
        </div>

        {/* Period summary. */}
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Pending" value={summary.pending} icon={FiClock} tone="warning" />
          <StatCard label="Approved" value={summary.approved} icon={FiCheck} tone="success" />
          <StatCard label="Rejected" value={summary.rejected} icon={FiX} tone="danger" />
          <StatCard label="Cancelled" value={summary.cancelled} icon={FiSlash} tone="accent" />
          <StatCard label="Approved Days" value={summary.days} icon={FiCalendar} tone="primary" />
        </div>

        <DataTable columns={TABLE_COLUMNS} data={rows} loading={isLoading} empty="No leave requests in this period" />
      </Card>
    </div>
  )
}
