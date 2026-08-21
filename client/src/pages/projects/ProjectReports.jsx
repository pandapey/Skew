import { useQuery } from '@tanstack/react-query'
import {
  FiFolder, FiCheckCircle, FiAlertCircle, FiFlag, FiTrendingUp, FiActivity, FiClock,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Loader, Badge } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { ExportMenu } from '@/components/ExportMenu'
import { ProgressBar } from '@/features/projects/ProgressBar'
import { PROJECT_STATUS_TONE, PRIORITY_TONE } from '@/features/projects/constants'
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatDate } from '@/utils'

export default function ProjectReports() {
  const { data: stats, isLoading } = useQuery({ queryKey: ['project-stats'], queryFn: projectApi.stats })
  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })

  if (isLoading) return <Loader label="Loading reports…" />

  const exportRows = projects.map((p) => ({
    name: p.name, code: p.code, client: p.client, status: p.status,
    priority: p.priority, progress: `${p.progress}%`, lead: p.lead, deadline: formatDate(p.deadline),
  }))
  const exportCols = [
    { header: 'Project', accessor: 'name' }, { header: 'Code', accessor: 'code' }, { header: 'Client', accessor: 'client' },
    { header: 'Status', accessor: 'status' }, { header: 'Priority', accessor: 'priority' },
    { header: 'Progress', accessor: 'progress' }, { header: 'Lead', accessor: 'lead' }, { header: 'Deadline', accessor: 'deadline' },
  ]

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Delivery health, throughput and workload across all projects."
        actions={<ExportMenu rows={exportRows} columns={exportCols} filename="project-report" title="Project Report" subtitle="Skew Enterprise Hub" />}
      />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={stats.totalProjects} icon={FiFolder} />
        <StatCard label="Active" value={stats.activeProjects} icon={FiActivity} tone="primary" />
        <StatCard label="Completed" value={stats.completedProjects} icon={FiCheckCircle} tone="success" />
        <StatCard label="Avg Progress" value={`${stats.avgProgress}%`} icon={FiTrendingUp} tone="accent" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tasks Done" value={`${stats.doneTasks}/${stats.totalTasks}`} icon={FiCheckCircle} tone="success" />
        <StatCard label="Open Tasks" value={stats.openTasks} icon={FiClock} tone="warning" />
        <StatCard label="Open Bugs" value={stats.openBugs} icon={FiAlertCircle} tone="danger" />
        <StatCard label="Milestones" value={`${stats.milestonesReached}/${stats.totalMilestones}`} icon={FiFlag} tone="primary" />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Task Throughput" subtitle="Created vs completed over time" />
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={stats.monthlyTrend} margin={{ left: -10, right: 10, top: 10 }}>
              <defs>
                <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} /><stop offset="95%" stopColor="#2563EB" stopOpacity={0} /></linearGradient>
                <linearGradient id="pd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.4} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94A3B8" />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="created" stroke="#2563EB" fill="url(#pc)" strokeWidth={2} />
              <Area type="monotone" dataKey="done" stroke="#10B981" fill="url(#pd)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CardHeader title="Projects by Status" />
          <DonutChart data={stats.byStatus} />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tasks by Status" />
          <BarsChart data={stats.tasksByStatus.map((s) => ({ name: s.name, tasks: s.value }))} xKey="name" bars={[{ key: 'tasks', color: '#2563EB' }]} />
        </Card>
        <Card>
          <CardHeader title="Tasks by Priority" />
          <BarsChart data={stats.byPriority.map((s) => ({ name: s.name, tasks: s.value }))} xKey="name" bars={[{ key: 'tasks', color: '#8B5CF6' }]} />
        </Card>
      </div>

      {/* Project progress table */}
      <Card>
        <CardHeader title="Project Progress" subtitle={`${projects.length} projects`} />
        <div className="space-y-3">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: p.color }} />
              <div className="w-40 flex-none truncate text-sm font-medium">{p.name}</div>
              <div className="flex-1"><ProgressBar value={p.progress} color={p.color} /></div>
              <span className="w-10 flex-none text-right text-xs text-muted">{p.progress}%</span>
              <Badge tone={PRIORITY_TONE[p.priority]}>{p.priority}</Badge>
              <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
