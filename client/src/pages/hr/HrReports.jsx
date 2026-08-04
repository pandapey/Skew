import { useQuery } from '@tanstack/react-query'
import { FiUsers, FiUserPlus, FiDollarSign, FiTrendingUp, FiLogOut, FiFileText, FiDownload } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Loader, Button } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { exportToExcel, exportToPdf } from '@/utils/export'
import { formatCurrency } from '@/utils'
import toast from 'react-hot-toast'

const REPORTS = [
  { label: 'Headcount Report', icon: FiUsers, tone: 'primary', desc: 'Department-wise staffing' },
  { label: 'Recruitment Report', icon: FiUserPlus, tone: 'success', desc: 'Jobs, sources & conversion' },
  { label: 'Payroll Report', icon: FiDollarSign, tone: 'accent', desc: 'Salary payout summary' },
  { label: 'Performance Report', icon: FiTrendingUp, tone: 'warning', desc: 'Ratings & appraisals' },
  { label: 'Attrition Report', icon: FiLogOut, tone: 'danger', desc: 'Exits & resignations' },
]

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success',
  accent: 'bg-accent/10 text-accent', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function HrReports() {
  const { data: stats, isLoading } = useQuery({ queryKey: ['hr-stats'], queryFn: hrApi.stats })
  const { data: jobsRes } = useQuery({ queryKey: ['hr-jobs-report'], queryFn: () => hrApi.jobs.query({ limit: 100 }) })
  const { data: movementsRes } = useQuery({ queryKey: ['hr-movements-report'], queryFn: () => hrApi.movements.query({ limit: 100 }) })
  const { data: payrollRes } = useQuery({ queryKey: ['hr-payroll-report'], queryFn: () => hrApi.payroll.query({ limit: 200 }) })
  if (isLoading) return <Loader label="Loading reports…" />

  const jobs = jobsRes?.data || []
  const movements = movementsRes?.data || []
  const payroll = payrollRes?.data || []

  const jobsBySource = jobs.map((j) => ({ name: j.department, value: j.applicants }))
  const attritionByType = ['Promotion', 'Transfer', 'Resignation', 'Exit'].map((t) => ({ name: t, value: movements.filter((m) => m.type === t).length }))

  const runReport = (label) => {
    if (label === 'Payroll Report') {
      exportToExcel('payroll-report.xlsx', payroll, [
        { header: 'Employee', accessor: 'employee' }, { header: 'Department', accessor: 'department' },
        { header: 'Gross', accessor: 'gross' }, { header: 'Net', accessor: 'net' }, { header: 'Status', accessor: 'status' },
      ])
    } else {
      exportToPdf(`${label.toLowerCase().replace(/\s/g, '-')}.pdf`,
        stats.headcountByDept, [{ header: 'Department', accessor: 'name' }, { header: 'Headcount', accessor: 'value' }],
        { title: label, subtitle: 'Skew Infotech Pvt. Ltd.' })
    }
    toast.success(`${label} exported`)
  }

  return (
    <div>
      <PageHeader title="HR Reports" subtitle="Workforce analytics and exports." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Headcount" value={stats.totalHeadcount} icon={FiUsers} />
        <StatCard label="Open Jobs" value={stats.openJobs} icon={FiUserPlus} tone="success" />
        <StatCard label="Monthly Payroll" value={formatCurrency(stats.monthlyPayroll)} icon={FiDollarSign} tone="accent" />
        <StatCard label="Attrition" value={stats.attrition} icon={FiLogOut} tone="danger" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.label} className="transition hover:shadow-card">
            <div className="flex items-start justify-between">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${TONE_BG[r.tone]}`}><r.icon className="h-5 w-5" /></div>
              <button onClick={() => runReport(r.label)} className="rounded-lg p-2 text-muted hover:bg-primary/10 hover:text-primary" title="Export"><FiDownload /></button>
            </div>
            <h3 className="mt-3 font-semibold">{r.label}</h3>
            <p className="text-sm text-muted">{r.desc}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Headcount by Department" />
          <BarsChart data={stats.headcountByDept.map((d) => ({ name: d.name, headcount: d.value }))} xKey="name" bars={[{ key: 'headcount', color: '#2563EB' }]} />
        </Card>
        <Card>
          <CardHeader title="Pipeline" subtitle="Candidates by stage" />
          <DonutChart data={stats.byStage} />
        </Card>
        <Card>
          <CardHeader title="Applicants by Department" />
          <BarsChart data={jobsBySource} xKey="name" bars={[{ key: 'value', color: '#06B6D4' }]} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Movements by Type" subtitle="Promotion / Transfer / Resignation / Exit" />
          <DonutChart data={attritionByType} />
        </Card>
      </div>
    </div>
  )
}
