import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FiUsers, FiUserCheck, FiUserX, FiBriefcase, FiTrendingUp, FiAward, FiArrowLeft } from 'react-icons/fi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Button, Loader, Avatar, Badge } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { formatCurrency } from '@/utils'

export default function EmployeeDashboard() {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({ queryKey: ['employee-stats'], queryFn: employeeApi.stats })
  const { data: empRes } = useQuery({ queryKey: ['employee-list-min'], queryFn: () => employeeApi.query({ limit: 100 }) })

  if (isLoading) return <Loader label="Loading analytics…" />

  const employees = empRes?.data || []
  const topPerformers = [...employees].sort((a, b) => (b.performance || 0) - (a.performance || 0)).slice(0, 5)
  const recentJoiners = [...employees].sort((a, b) => new Date(b.joiningDate || 0) - new Date(a.joiningDate || 0)).slice(0, 5)

  return (
    <div>
      <PageHeader
        title="Employee Dashboard"
        subtitle="Workforce analytics and insights."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/employees')}>Back to List</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Headcount" value={stats.total} icon={FiUsers} />
        <StatCard label="Active" value={stats.active} icon={FiUserCheck} tone="success" />
        <StatCard label="On Leave" value={stats.onLeave} icon={FiUserX} tone="warning" />
        <StatCard label="Departments" value={stats.departments} icon={FiBriefcase} tone="accent" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Headcount Growth" subtitle="Last 6 months" />
          <BarsChart data={stats.growth} xKey="month" bars={[{ key: 'headcount', color: '#2563EB' }]} />
        </Card>
        <Card>
          <CardHeader title="By Department" />
          <DonutChart data={stats.byDept} />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Gender Split" />
          <DonutChart data={stats.genderSplit} />
        </Card>
        <Card>
          <CardHeader title="Employment Status" />
          <DonutChart data={stats.byStatus} />
        </Card>
        <div className="grid grid-rows-2 gap-4">
          <StatCard label="Avg Salary (CTC)" value={formatCurrency(stats.avgSalary)} icon={FiUsers} tone="primary" />
          <StatCard label="Avg Performance" value={`${stats.avgPerformance}%`} icon={FiAward} tone="success" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top Performers" action={<FiAward className="text-warning" />} />
          <div className="space-y-2">
            {topPerformers.map((e, i) => (
              <button key={e._id} onClick={() => navigate(`/employees/${e._id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-app p-3 text-left transition hover:border-primary">
                <span className="text-sm font-bold text-muted">#{i + 1}</span>
                <Avatar name={e.name} size={34} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.name}</p><p className="text-xs text-muted">{e.designation}</p></div>
                <Badge tone="success">{e.performance}%</Badge>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent Joiners" />
          <div className="space-y-2">
            {recentJoiners.map((e) => (
              <button key={e._id} onClick={() => navigate(`/employees/${e._id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-app p-3 text-left transition hover:border-primary">
                <Avatar name={e.name} size={34} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.name}</p><p className="text-xs text-muted">{e.department}</p></div>
                <Badge tone="accent">{e.joiningDate ? String(e.joiningDate).slice(0, 10) : '—'}</Badge>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
