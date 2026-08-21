import { useState } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useQuery } from '@tanstack/react-query'
import {
  FiGrid, FiUsers, FiClock, FiCalendar, FiDollarSign, FiBox, FiTarget, FiFolder,
  FiDownload, FiFileText, FiTrendingUp, FiSmile, FiFilter,
} from 'react-icons/fi'
import {
  PageHeader, Card, CardHeader, StatCard, Loader, Button, Select, Input, Badge, EmptyState,
} from '@/components/ui'
import { RevenueChart, BarsChart, DonutChart } from '@/components/charts/Charts'
import { reportService } from '@/features/reports/reportService'
import { DEPARTMENTS } from '@/features/reports/aggregate'
import { exportToExcel, exportToPdf } from '@/utils/export'
import { formatCurrency, cn } from '@/utils'
import toast from 'react-hot-toast'

const money = formatCurrency

const KPI_ICON = {
  users: FiUsers, clock: FiClock, calendar: FiCalendar, rupee: FiDollarSign,
  target: FiTarget, folder: FiFolder, box: FiBox, smile: FiSmile,
}

const BADGE_TONE = {
  Active: 'success', 'On Leave': 'warning', Inactive: 'default',
  Approved: 'success', Rejected: 'danger', Pending: 'warning', Cancelled: 'default',
  Present: 'success', Absent: 'danger', Late: 'warning', 'Early Exit': 'warning', 'Not Marked': 'default',
  Won: 'success', Lost: 'danger',
  'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger', Discontinued: 'default',
  Planning: 'default', 'On Hold': 'warning', Completed: 'success',
  Income: 'success', Expense: 'danger',
}
const badge = (s) => BADGE_TONE[s] || 'default'

const TAB_CONFIG = {
  employees: {
    title: 'Employee Report',
    kpis: (d) => [
      { label: 'Total Employees', value: d.kpis.total, icon: FiUsers, tone: 'primary' },
      { label: 'Active', value: d.kpis.active, icon: FiTrendingUp, tone: 'success' },
      { label: 'Avg Salary', value: money(d.kpis.avgSalary), icon: FiDollarSign, tone: 'accent' },
      { label: 'Avg Performance', value: `${d.kpis.avgPerformance}%`, icon: FiTarget, tone: 'warning' },
      { label: 'Departments', value: d.kpis.departments, icon: FiFolder, tone: 'primary' },
    ],
    charts: (d) => [
      { title: 'Headcount by Department', node: <BarsChart data={d.charts.byDept} xKey="name" bars={[{ key: 'value', color: '#2563EB' }]} /> },
      { title: 'By Status', node: <DonutChart data={d.charts.byStatus} /> },
      { title: 'Gender Split', node: <DonutChart data={d.charts.genderSplit} /> },
      { title: 'Headcount Growth', node: <BarsChart data={d.charts.growth} xKey="month" bars={[{ key: 'headcount', color: '#06B6D4' }]} /> },
    ],
    columns: [
      { key: 'name' }, { key: 'department' }, { key: 'designation' },
      { key: 'status', render: (r) => <Badge tone={badge(r.status)}>{r.status}</Badge> },
      { key: 'ctc', align: 'right', render: (r) => money(r.ctc) },
      { key: 'performance', align: 'right', render: (r) => `${r.performance}%` },
    ],
    exportColumns: [
      { header: 'Name', accessor: 'name' }, { header: 'Department', accessor: 'department' },
      { header: 'Designation', accessor: 'designation' }, { header: 'Status', accessor: 'status' },
      { header: 'CTC', accessor: 'ctc' }, { header: 'Performance', accessor: 'performance' },
    ],
    exportName: 'employee-report',
  },

  attendance: {
    title: 'Attendance Report',
    kpis: (d) => [
      { label: 'Present', value: d.kpis.present, icon: FiUsers, tone: 'success' },
      { label: 'Absent', value: d.kpis.absent, icon: FiCalendar, tone: 'danger' },
      { label: 'Late', value: d.kpis.late, icon: FiClock, tone: 'warning' },
      { label: 'Attendance Rate', value: `${d.kpis.attendanceRate}%`, icon: FiTrendingUp, tone: 'primary' },
      { label: 'Avg Hours', value: d.kpis.avgHours, icon: FiClock, tone: 'accent' },
    ],
    charts: (d) => [
      { title: 'Status Split', node: <DonutChart data={d.charts.statusSplit} /> },
      { title: 'By Department', node: <BarsChart data={d.charts.byDepartment} xKey="name" bars={[{ key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' }]} /> },
      { title: 'Weekly Trend', node: <BarsChart data={d.charts.monthlyTrend} xKey="week" bars={[{ key: 'present', color: '#10B981' }, { key: 'absent', color: '#EF4444' }, { key: 'late', color: '#F59E0B' }]} /> },
      { title: 'Working Hours / Day', node: <BarsChart data={d.charts.hoursTrend} xKey="day" bars={[{ key: 'hours', color: '#2563EB' }]} /> },
    ],
    columns: [
      { key: 'employee' }, { key: 'department' }, { key: 'date' },
      { key: 'status', render: (r) => <Badge tone={badge(r.status)}>{r.status}</Badge> },
      { key: 'checkIn' }, { key: 'checkOut' },
      { key: 'workingHours', align: 'right' },
    ],
    exportColumns: [
      { header: 'Employee', accessor: 'employee' }, { header: 'Department', accessor: 'department' },
      { header: 'Date', accessor: 'date' }, { header: 'Status', accessor: 'status' },
      { header: 'Check In', accessor: 'checkIn' }, { header: 'Check Out', accessor: 'checkOut' },
      { header: 'Working Hours', accessor: 'workingHours' },
    ],
    exportName: 'attendance-report',
  },

  leaves: {
    title: 'Leave Report',
    kpis: (d) => [
      { label: 'Total Requests', value: d.kpis.total, icon: FiCalendar, tone: 'primary' },
      { label: 'Pending', value: d.kpis.pending, icon: FiClock, tone: 'warning' },
      { label: 'Approved', value: d.kpis.approved, icon: FiTrendingUp, tone: 'success' },
      { label: 'Rejected', value: d.kpis.rejected, icon: FiCalendar, tone: 'danger' },
      { label: 'Days Approved', value: d.kpis.totalDaysApproved, icon: FiCalendar, tone: 'accent' },
    ],
    charts: (d) => [
      { title: 'By Status', node: <DonutChart data={d.charts.byStatus} /> },
      { title: 'By Type', node: <BarsChart data={d.charts.byType} xKey="name" bars={[{ key: 'value', color: '#8B5CF6' }]} /> },
      { title: 'By Department', node: <BarsChart data={d.charts.byDepartment} xKey="name" bars={[{ key: 'value', color: '#06B6D4' }]} /> },
      { title: 'Monthly Trend', node: <BarsChart data={d.charts.monthlyTrend} xKey="month" bars={[{ key: 'approved', color: '#10B981' }, { key: 'rejected', color: '#EF4444' }]} /> },
    ],
    columns: [
      { key: 'employee' }, { key: 'department' }, { key: 'type' },
      { key: 'from' }, { key: 'to' }, { key: 'days', align: 'right' },
      { key: 'status', render: (r) => <Badge tone={badge(r.status)}>{r.status}</Badge> },
      { key: 'reason' },
    ],
    exportColumns: [
      { header: 'Employee', accessor: 'employee' }, { header: 'Department', accessor: 'department' },
      { header: 'Type', accessor: 'type' }, { header: 'From', accessor: 'from' }, { header: 'To', accessor: 'to' },
      { header: 'Days', accessor: 'days' }, { header: 'Status', accessor: 'status' }, { header: 'Reason', accessor: 'reason' },
    ],
    exportName: 'leave-report',
  },

  finance: {
    title: 'Finance Report',
    kpis: (d) => [
      { label: 'Total Income', value: money(d.kpis.totalIncome), icon: FiTrendingUp, tone: 'success' },
      { label: 'Total Expense', value: money(d.kpis.totalExpense), icon: FiDollarSign, tone: 'danger' },
      { label: 'Net Profit', value: money(d.kpis.netProfit), icon: FiDollarSign, tone: 'accent' },
      { label: 'Profit Margin', value: `${d.kpis.profitMargin}%`, icon: FiTarget, tone: 'primary' },
      { label: 'Outstanding', value: money(d.kpis.outstandingAmount), icon: FiClock, tone: 'warning' },
    ],
    charts: (d) => [
      { title: 'Revenue vs Expense', node: <RevenueChart data={d.charts.monthlyTrend} /> },
      { title: 'Expense by Category', node: <DonutChart data={d.charts.expenseByCategory} /> },
      { title: 'Income by Category', node: <DonutChart data={d.charts.incomeByCategory} /> },
      { title: 'Budget vs Spent', node: <BarsChart data={d.charts.budgets} xKey="category" bars={[{ key: 'allocated', color: '#2563EB' }, { key: 'spent', color: '#EF4444' }]} /> },
    ],
    columns: [
      { key: 'title' }, { key: 'type', render: (r) => <Badge tone={badge(r.type)}>{r.type}</Badge> },
      { key: 'category' }, { key: 'amount', align: 'right', render: (r) => money(r.amount) },
      { key: 'taxRate', align: 'right', render: (r) => `${r.taxRate}%` }, { key: 'date' }, { key: 'method' },
    ],
    exportColumns: [
      { header: 'Title', accessor: 'title' }, { header: 'Type', accessor: 'type' },
      { header: 'Category', accessor: 'category' }, { header: 'Amount', accessor: 'amount' },
      { header: 'Tax Rate', accessor: 'taxRate' }, { header: 'Date', accessor: 'date' }, { header: 'Method', accessor: 'method' },
    ],
    exportName: 'finance-report',
  },

  projects: {
    title: 'Project Report',
    kpis: (d) => [
      { label: 'Total Projects', value: d.kpis.totalProjects, icon: FiFolder, tone: 'primary' },
      { label: 'Active', value: d.kpis.activeProjects, icon: FiTrendingUp, tone: 'success' },
      { label: 'Completed', value: d.kpis.completedProjects, icon: FiFolder, tone: 'accent' },
      { label: 'Avg Progress', value: `${d.kpis.avgProgress}%`, icon: FiTarget, tone: 'warning' },
      { label: 'Open Bugs', value: d.kpis.openBugs, icon: FiCalendar, tone: 'danger' },
    ],
    charts: (d) => [
      { title: 'By Status', node: <DonutChart data={d.charts.byStatus} /> },
      { title: 'Tasks by Status', node: <BarsChart data={d.charts.tasksByStatus} xKey="name" bars={[{ key: 'value', color: '#2563EB' }]} /> },
      { title: 'By Priority', node: <BarsChart data={d.charts.byPriority} xKey="name" bars={[{ key: 'value', color: '#F59E0B' }]} /> },
      { title: 'Created vs Done', node: <BarsChart data={d.charts.monthlyTrend} xKey="month" bars={[{ key: 'created', color: '#2563EB' }, { key: 'done', color: '#10B981' }]} /> },
    ],
    columns: [
      { key: 'name' }, { key: 'code' }, { key: 'client' }, { key: 'lead' },
      { key: 'status', render: (r) => <Badge tone={badge(r.status)}>{r.status}</Badge> },
      { key: 'priority', render: (r) => <Badge tone={badge(r.priority)}>{r.priority}</Badge> },
      { key: 'progress', align: 'right', render: (r) => `${r.progress}%` },
      { key: 'budget', align: 'right', render: (r) => money(r.budget) },
    ],
    exportColumns: [
      { header: 'Project', accessor: 'name' }, { header: 'Code', accessor: 'code' },
      { header: 'Client', accessor: 'client' }, { header: 'Lead', accessor: 'lead' },
      { header: 'Status', accessor: 'status' }, { header: 'Priority', accessor: 'priority' },
      { header: 'Progress', accessor: 'progress' }, { header: 'Budget', accessor: 'budget' },
    ],
    exportName: 'project-report',
  },
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: FiGrid, filter: 'none' },
  { key: 'employees', label: 'Employees', icon: FiUsers, filter: 'department' },
  { key: 'attendance', label: 'Attendance', icon: FiClock, filter: 'department' },
  { key: 'leaves', label: 'Leaves', icon: FiCalendar, filter: 'department' },
  { key: 'finance', label: 'Finance', icon: FiDollarSign, filter: 'none' },
  { key: 'projects', label: 'Projects', icon: FiFolder, filter: 'none' },
]

export default function Reports() {
  const [viewState, patchView] = useViewState('filters', { tab: 'dashboard', from: '', to: '', department: 'all' })
  const tab = viewState.tab
  const setTab = (v) => patchView({ tab: v })
  const from = viewState.from
  const setFrom = (v) => patchView({ from: v })
  const to = viewState.to
  const setTo = (v) => patchView({ to: v })
  const department = viewState.department
  const setDepartment = (v) => patchView({ department: v })

  const cfg = TAB_CONFIG[tab]
  const tabMeta = TABS.find((t) => t.key === tab)

  const { data, isLoading } = useQuery({
    queryKey: ['report', tab, from, to, department],
    queryFn: () => reportService[tab]({ from, to, department }),
  })

  const filterOpts = [
    { value: 'all', label: 'All Departments' },
    ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
  ]

  const clearFilters = () => { setFrom(''); setTo(''); setDepartment('all') }
  const hasFilters = !!(from || to || department !== 'all')

  const handleExcel = () => {
    if (!data?.table?.length) return toast.error('No data to export')
    exportToExcel(`${cfg.exportName}.xlsx`, data.table, cfg.exportColumns)
    toast.success('Exported to Excel')
  }
  const handlePdf = () => {
    if (!data?.table?.length) return toast.error('No data to export')
    exportToPdf(`${cfg.exportName}.pdf`, data.table, cfg.exportColumns, { title: cfg.title, subtitle: 'Skew Infotech Pvt. Ltd.' })
    toast.success('Exported to PDF')
  }

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Interactive insights across the organization."
        actions={
          tab !== 'dashboard' && data?.table?.length ? (
            <>
              <Button variant="ghost" icon={FiDownload} onClick={handleExcel}>Excel</Button>
              <Button variant="ghost" icon={FiFileText} onClick={handlePdf}>PDF</Button>
            </>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = t.key === tab
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition',
                active ? 'bg-primary text-white shadow-soft' : 'bg-black/5 text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10')}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Input type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            {tabMeta.filter !== 'none' && (
              <Select label={tabMeta.filter === 'category' ? 'Category' : 'Department'} value={department}
                onChange={(e) => setDepartment(e.target.value)} options={filterOpts} className="w-48" />
            )}
            {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear</Button>}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted"><FiFilter /> Filters apply to tables & charts</span>
        </div>
      </Card>

      {isLoading && <Loader label="Generating report…" />}

      {!isLoading && data && tab === 'dashboard' && <DashboardView data={data} />}
      {!isLoading && data && tab !== 'dashboard' && (
        <TabView cfg={cfg} data={data} />
      )}
    </div>
  )
}

/* --------------------------- Dashboard --------------------------- */
function DashboardView({ data }) {
  const { kpis, charts } = data
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = KPI_ICON[k.icon] || FiGrid
          return <StatCard key={k.key} label={k.label} value={k.value} icon={Icon} tone={k.tone} />
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue Trend"><RevenueChart data={charts.revenueTrend} /></ChartCard>
        <ChartCard title="Attendance Split"><DonutChart data={charts.attendanceSplit} /></ChartCard>
        <ChartCard title="Pipeline by Stage"><BarsChart data={charts.pipelineByStage} xKey="name" bars={[{ key: 'value', color: '#06B6D4' }]} /></ChartCard>
        <ChartCard title="Headcount by Department"><BarsChart data={charts.headcountByDept} xKey="name" bars={[{ key: 'value', color: '#2563EB' }]} /></ChartCard>
        <ChartCard title="Project Status" className="lg:col-span-2"><DonutChart data={charts.projectStatus} /></ChartCard>
      </div>
    </div>
  )
}

/* --------------------------- Domain tab --------------------------- */
function TabView({ cfg, data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cfg.kpis(data).map((k, i) => (
          <StatCard key={i} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cfg.charts(data).map((c, i) => (
          <ChartCard key={i} title={c.title}>{c.node}</ChartCard>
        ))}
      </div>

      <Card>
        <CardHeader title="Records" subtitle={`${data.table?.length || 0} rows`} />
        <div className="mt-2">
          <ReportTable columns={cfg.columns} rows={data.table || []} />
        </div>
      </Card>
    </div>
  )
}

/* --------------------------- Shared bits --------------------------- */
function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} />
      {children}
    </Card>
  )
}

function ReportTable({ columns, rows }) {
  if (!rows.length) return <EmptyState title="No records" subtitle="Try adjusting the date or department filter." />
  return (
    <div className="overflow-x-auto rounded-xl border border-app">
      <table className="w-full text-sm">
        <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-muted dark:bg-white/5">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-3 py-2', c.align === 'right' && 'text-right')}>{c.header || c.key}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-app">
          {rows.map((r, i) => (
            <tr key={r.id || i} className="hover:bg-black/5 dark:hover:bg-white/5">
              {columns.map((c) => (
                <td key={c.key} className={cn('whitespace-nowrap px-3 py-2', c.align === 'right' && 'text-right')}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
